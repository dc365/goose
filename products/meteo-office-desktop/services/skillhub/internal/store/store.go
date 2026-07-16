package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Store struct {
	mu           sync.RWMutex
	root         string
	metadataPath string
	packagesDir  string
	auditPath    string
	state        State
}

func Open(root string) (*Store, error) {
	if root == "" {
		return nil, errors.New("data root is required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	packagesDir := filepath.Join(root, "packages", "sha256")
	if err := os.MkdirAll(packagesDir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{
		root:         root,
		metadataPath: filepath.Join(root, "metadata.json"),
		packagesDir:  packagesDir,
		auditPath:    filepath.Join(root, "audit.jsonl"),
		state:        EmptyState(),
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.metadataPath)
	if errors.Is(err, os.ErrNotExist) {
		return s.saveLocked()
	}
	if err != nil {
		return err
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		recovery := fmt.Sprintf("%s.corrupt-%d", s.metadataPath, time.Now().Unix())
		_ = os.WriteFile(recovery, data, 0o600)
		return fmt.Errorf("decode metadata (backup: %s): %w", recovery, err)
	}
	ensureMaps(&state)
	s.state = state
	return nil
}

func ensureMaps(state *State) {
	if state.Skills == nil {
		state.Skills = map[string]*Skill{}
	}
	if state.SkillVersions == nil {
		state.SkillVersions = map[string]*SkillVersion{}
	}
	if state.Collections == nil {
		state.Collections = map[string]*Collection{}
	}
	if state.Installations == nil {
		state.Installations = map[string]*Installation{}
	}
	if state.APIVersion == "" {
		state.APIVersion = "meteomate.ai/v1"
	}
	if state.Kind == "" {
		state.Kind = "SkillHubState"
	}
	if state.Version == 0 {
		state.Version = 1
	}
}

func (s *Store) Snapshot() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	data, _ := json.Marshal(s.state)
	var copy State
	_ = json.Unmarshal(data, &copy)
	ensureMaps(&copy)
	return copy
}

func (s *Store) Update(fn func(*State) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, _ := json.Marshal(s.state)
	var next State
	if err := json.Unmarshal(data, &next); err != nil {
		return err
	}
	ensureMaps(&next)
	if err := fn(&next); err != nil {
		return err
	}
	next.UpdatedAt = time.Now().UTC()
	previous := s.state
	s.state = next
	if err := s.saveLocked(); err != nil {
		s.state = previous
		return err
	}
	return nil
}

func (s *Store) saveLocked() error {
	ensureMaps(&s.state)
	s.state.UpdatedAt = time.Now().UTC()
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	temp := fmt.Sprintf("%s.tmp-%d", s.metadataPath, time.Now().UnixNano())
	if err := os.WriteFile(temp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temp, s.metadataPath); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return nil
}

func (s *Store) PutPackage(data []byte) (string, string, error) {
	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])
	path := filepath.Join(s.packagesDir, digest+".zip")
	if _, err := os.Stat(path); err == nil {
		return digest, path, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", "", err
	}
	temp := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(temp, data, 0o600); err != nil {
		return "", "", err
	}
	if err := os.Rename(temp, path); err != nil {
		_ = os.Remove(temp)
		return "", "", err
	}
	return digest, path, nil
}

func (s *Store) PackagePath(digest string) (string, error) {
	if !digestPattern.MatchString(digest) {
		return "", errors.New("invalid package digest")
	}
	path := filepath.Join(s.packagesDir, digest+".zip")
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return path, nil
}

func (s *Store) AppendAudit(event any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(s.auditPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.Write(append(data, '\n'))
	return err
}

func (s *Store) Root() string { return s.root }
