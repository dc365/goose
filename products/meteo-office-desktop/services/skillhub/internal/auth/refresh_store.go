package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const defaultRefreshTTL = 30 * 24 * time.Hour

var (
	ErrInvalidRefreshToken = errors.New("invalid refresh token")
	ErrRefreshTokenReuse   = errors.New("refresh token reuse detected")
)

type RefreshTokenReuseError struct {
	FamilyID string
}

func (e *RefreshTokenReuseError) Error() string { return ErrRefreshTokenReuse.Error() }
func (e *RefreshTokenReuseError) Unwrap() error { return ErrRefreshTokenReuse }

type refreshFamily struct {
	ID               string     `json:"id"`
	UserID           string     `json:"userId"`
	ClientID         string     `json:"clientId"`
	CurrentTokenHash string     `json:"currentTokenHash"`
	CreatedAt        time.Time  `json:"createdAt"`
	LastSeenAt       time.Time  `json:"lastSeenAt"`
	ExpiresAt        time.Time  `json:"expiresAt"`
	RevokedAt        *time.Time `json:"revokedAt,omitempty"`
}

type retiredRefreshToken struct {
	FamilyID  string    `json:"familyId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type refreshState struct {
	Version  int                            `json:"version"`
	Families map[string]refreshFamily       `json:"families"`
	Retired  map[string]retiredRefreshToken `json:"retiredTokens"`
}

type RefreshStore struct {
	mu    sync.Mutex
	path  string
	ttl   time.Duration
	state refreshState
}

func NewMemoryRefreshStore(ttl time.Duration) *RefreshStore {
	return &RefreshStore{ttl: normalizeRefreshTTL(ttl), state: emptyRefreshState()}
}

func OpenRefreshStore(root string, ttl time.Duration) (*RefreshStore, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("refresh session data root is required")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	store := &RefreshStore{
		path:  filepath.Join(root, "refresh-sessions.json"),
		ttl:   normalizeRefreshTTL(ttl),
		state: emptyRefreshState(),
	}
	data, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &store.state); err != nil {
		return nil, fmt.Errorf("decode refresh sessions: %w", err)
	}
	store.normalizeLocked()
	return store, nil
}

func (s *RefreshStore) Create(userID, clientID string, now time.Time) (string, SessionView, error) {
	token, hash, err := newRefreshToken()
	if err != nil {
		return "", SessionView{}, err
	}
	id, err := newSessionID()
	if err != nil {
		return "", SessionView{}, err
	}
	family := refreshFamily{
		ID: id, UserID: userID, ClientID: strings.TrimSpace(clientID), CurrentTokenHash: hash,
		CreatedAt: now, LastSeenAt: now, ExpiresAt: now.Add(s.ttl),
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneRefreshState(s.state)
	cleanupRefreshState(&next, now)
	next.Families[family.ID] = family
	if err := s.commitLocked(next); err != nil {
		return "", SessionView{}, err
	}
	return token, family.view(), nil
}

func (s *RefreshStore) Rotate(token string, now time.Time) (string, SessionView, error) {
	hash := hashRefreshToken(token)
	if hash == "" {
		return "", SessionView{}, ErrInvalidRefreshToken
	}
	newToken, newHash, err := newRefreshToken()
	if err != nil {
		return "", SessionView{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneRefreshState(s.state)
	cleanupRefreshState(&next, now)
	if retired, ok := next.Retired[hash]; ok {
		if family, exists := next.Families[retired.FamilyID]; exists && family.RevokedAt == nil {
			revokedAt := now
			family.RevokedAt = &revokedAt
			next.Families[family.ID] = family
			if err := s.commitLocked(next); err != nil {
				return "", SessionView{}, err
			}
		}
		return "", SessionView{}, &RefreshTokenReuseError{FamilyID: retired.FamilyID}
	}
	for id, family := range next.Families {
		if family.CurrentTokenHash != hash {
			continue
		}
		if family.RevokedAt != nil || !family.ExpiresAt.After(now) {
			return "", SessionView{}, ErrInvalidRefreshToken
		}
		next.Retired[hash] = retiredRefreshToken{FamilyID: family.ID, ExpiresAt: family.ExpiresAt}
		family.CurrentTokenHash = newHash
		family.LastSeenAt = now
		family.ExpiresAt = now.Add(s.ttl)
		next.Families[id] = family
		if err := s.commitLocked(next); err != nil {
			return "", SessionView{}, err
		}
		return newToken, family.view(), nil
	}
	return "", SessionView{}, ErrInvalidRefreshToken
}

func (s *RefreshStore) RevokeToken(token string, now time.Time) (string, bool, error) {
	hash := hashRefreshToken(token)
	if hash == "" {
		return "", false, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneRefreshState(s.state)
	cleanupRefreshState(&next, now)
	for id, family := range next.Families {
		if family.CurrentTokenHash != hash {
			continue
		}
		if family.RevokedAt != nil {
			return family.ID, false, nil
		}
		revokedAt := now
		family.RevokedAt = &revokedAt
		next.Families[id] = family
		return family.ID, true, s.commitLocked(next)
	}
	if retired, ok := next.Retired[hash]; ok {
		revoked, err := s.revokeIDLocked(&next, retired.FamilyID, now)
		return retired.FamilyID, revoked, err
	}
	return "", false, nil
}

func (s *RefreshStore) RevokeID(id string, now time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneRefreshState(s.state)
	cleanupRefreshState(&next, now)
	return s.revokeIDLocked(&next, id, now)
}

func (s *RefreshStore) RevokeUser(userID string, now time.Time) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneRefreshState(s.state)
	cleanupRefreshState(&next, now)
	revoked := 0
	for id, family := range next.Families {
		if family.UserID != userID || family.RevokedAt != nil {
			continue
		}
		revokedAt := now
		family.RevokedAt = &revokedAt
		next.Families[id] = family
		revoked++
	}
	if revoked == 0 {
		return 0, nil
	}
	return revoked, s.commitLocked(next)
}

func (s *RefreshStore) List(userID string, now time.Time) []SessionView {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneRefreshState(s.state)
	cleanupRefreshState(&next, now)
	s.state = next
	items := make([]SessionView, 0, len(next.Families))
	for _, family := range next.Families {
		if family.RevokedAt != nil || (userID != "" && family.UserID != userID) {
			continue
		}
		items = append(items, family.view())
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items
}

func (s *RefreshStore) Active(id string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	family, ok := s.state.Families[id]
	return ok && family.RevokedAt == nil && family.ExpiresAt.After(now)
}

func (s *RefreshStore) revokeIDLocked(next *refreshState, id string, now time.Time) (bool, error) {
	family, ok := next.Families[id]
	if !ok || family.RevokedAt != nil {
		return false, nil
	}
	revokedAt := now
	family.RevokedAt = &revokedAt
	next.Families[id] = family
	return true, s.commitLocked(*next)
}

func (s *RefreshStore) commitLocked(next refreshState) error {
	if s.path != "" {
		data, err := json.MarshalIndent(next, "", "  ")
		if err != nil {
			return err
		}
		temporary := fmt.Sprintf("%s.tmp-%d", s.path, time.Now().UnixNano())
		if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
			return err
		}
		if err := os.Rename(temporary, s.path); err != nil {
			_ = os.Remove(temporary)
			return err
		}
	}
	s.state = next
	return nil
}

func (s *RefreshStore) normalizeLocked() {
	if s.state.Version == 0 {
		s.state.Version = 1
	}
	if s.state.Families == nil {
		s.state.Families = map[string]refreshFamily{}
	}
	if s.state.Retired == nil {
		s.state.Retired = map[string]retiredRefreshToken{}
	}
}

func emptyRefreshState() refreshState {
	return refreshState{Version: 1, Families: map[string]refreshFamily{}, Retired: map[string]retiredRefreshToken{}}
}

func cloneRefreshState(state refreshState) refreshState {
	next := emptyRefreshState()
	for id, family := range state.Families {
		next.Families[id] = family
	}
	for hash, retired := range state.Retired {
		next.Retired[hash] = retired
	}
	return next
}

func cleanupRefreshState(state *refreshState, now time.Time) {
	for hash, retired := range state.Retired {
		if !retired.ExpiresAt.After(now) {
			delete(state.Retired, hash)
		}
	}
	for id, family := range state.Families {
		if !family.ExpiresAt.After(now) {
			delete(state.Families, id)
		}
	}
}

func normalizeRefreshTTL(ttl time.Duration) time.Duration {
	if ttl <= 0 {
		return defaultRefreshTTL
	}
	return ttl
}

func newRefreshToken() (string, string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", err
	}
	token := "mmr_" + base64.RawURLEncoding.EncodeToString(bytes)
	return token, hashRefreshToken(token), nil
}

func newSessionID() (string, error) {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "ses_" + base64.RawURLEncoding.EncodeToString(bytes), nil
}

func hashRefreshToken(token string) string {
	if strings.TrimSpace(token) == "" {
		return ""
	}
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func (f refreshFamily) view() SessionView {
	return SessionView{
		ID: f.ID, UserID: f.UserID, ClientID: f.ClientID,
		CreatedAt: f.CreatedAt, LastSeenAt: f.LastSeenAt, ExpiresAt: f.ExpiresAt,
	}
}
