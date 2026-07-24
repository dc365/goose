package policy

import (
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

const (
	maxListItems                = 128
	DefaultAutoCompactThreshold = 0.8
	DefaultSkillPublishMode     = "publisher_direct"
	minimumAutoCompactThreshold = 0.5
	maximumAutoCompactThreshold = 0.95
)

var permissionProfiles = map[string]struct{}{
	"analysis-readonly":  {},
	"artifact-approval":  {},
	"workspace-approval": {},
}

type Settings struct {
	DefaultModel                string   `json:"defaultModel"`
	AllowedModels               []string `json:"allowedModels"`
	DefaultSkillIDs             []string `json:"defaultSkillIds"`
	AllowedSkillIDs             []string `json:"allowedSkillIds"`
	AllowedConnectorIDs         []string `json:"allowedConnectorIds"`
	DefaultPermissionProfileID  string   `json:"defaultPermissionProfileId"`
	AllowedPermissionProfileIDs []string `json:"allowedPermissionProfileIds"`
	AutoCompactThreshold        float64  `json:"autoCompactThreshold"`
	SkillPublishMode            string   `json:"skillPublishMode"`
}

type Patch struct {
	DefaultModel                *string   `json:"defaultModel,omitempty"`
	AllowedModels               *[]string `json:"allowedModels,omitempty"`
	DefaultSkillIDs             *[]string `json:"defaultSkillIds,omitempty"`
	AllowedSkillIDs             *[]string `json:"allowedSkillIds,omitempty"`
	AllowedConnectorIDs         *[]string `json:"allowedConnectorIds,omitempty"`
	DefaultPermissionProfileID  *string   `json:"defaultPermissionProfileId,omitempty"`
	AllowedPermissionProfileIDs *[]string `json:"allowedPermissionProfileIds,omitempty"`
	AutoCompactThreshold        *float64  `json:"autoCompactThreshold,omitempty"`
}

type Effective struct {
	Settings
	Sources   map[string]string `json:"sources"`
	Revision  int               `json:"revision"`
	UpdatedAt time.Time         `json:"updatedAt"`
}

type State struct {
	APIVersion   string           `json:"apiVersion"`
	Kind         string           `json:"kind"`
	Version      int              `json:"version"`
	Revision     int              `json:"revision"`
	Organization Settings         `json:"organization"`
	Roles        map[string]Patch `json:"roles"`
	Users        map[string]Patch `json:"users"`
	UpdatedAt    time.Time        `json:"updatedAt"`
}

type Store struct {
	mu    sync.RWMutex
	path  string
	state State
}

func DefaultSettings() Settings {
	return Settings{
		AllowedModels:               []string{},
		DefaultSkillIDs:             []string{},
		AllowedSkillIDs:             []string{},
		AllowedConnectorIDs:         []string{},
		AllowedPermissionProfileIDs: []string{},
		AutoCompactThreshold:        DefaultAutoCompactThreshold,
		SkillPublishMode:            DefaultSkillPublishMode,
	}
}

func Open(root string) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("policy data root is required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	store := NewMemory()
	store.path = filepath.Join(root, "policies.json")
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func NewMemory() *Store {
	return &Store{state: State{
		APIVersion: "meteomate.ai/v1", Kind: "OrganizationPolicyState", Version: 1,
		Organization: DefaultSettings(), Roles: map[string]Patch{}, Users: map[string]Patch{},
	}}
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s.saveLocked()
	}
	if err != nil {
		return err
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		recovery := fmt.Sprintf("%s.corrupt-%d", s.path, time.Now().Unix())
		_ = os.WriteFile(recovery, data, 0o600)
		return fmt.Errorf("decode organization policies (backup: %s): %w", recovery, err)
	}
	if state.APIVersion == "" {
		state.APIVersion = "meteomate.ai/v1"
	}
	if state.Kind == "" {
		state.Kind = "OrganizationPolicyState"
	}
	if state.Version == 0 {
		state.Version = 1
	}
	if state.Roles == nil {
		state.Roles = map[string]Patch{}
	}
	if state.Users == nil {
		state.Users = map[string]Patch{}
	}
	organization, err := normalizeSettings(state.Organization)
	if err != nil {
		return err
	}
	state.Organization = organization
	s.state = state
	return nil
}

func (s *Store) saveLocked() error {
	s.state.Revision++
	s.state.UpdatedAt = time.Now().UTC()
	if s.path == "" {
		return nil
	}
	data, err := json.MarshalIndent(s.state, "", "  ")
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
	return nil
}

func (s *Store) Snapshot() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneState(s.state)
}

func (s *Store) SetOrganization(input Settings) (State, error) {
	next, err := normalizeSettings(input)
	if err != nil {
		return State{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.state.Organization
	s.state.Organization = next
	if err := s.saveLocked(); err != nil {
		s.state.Organization = previous
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) SetRole(role string, input Patch) (State, error) {
	if role != "viewer" && role != "publisher" && role != "admin" {
		return State{}, errors.New("role policy must target viewer, publisher, or admin")
	}
	next, err := normalizePatch(input)
	if err != nil {
		return State{}, err
	}
	return s.setPatch("role", role, next)
}

func (s *Store) DeleteRole(role string) (State, error) {
	return s.deletePatch("role", role)
}

func (s *Store) SetUser(userID string, input Patch) (State, error) {
	if strings.TrimSpace(userID) == "" {
		return State{}, errors.New("user policy requires a user id")
	}
	next, err := normalizePatch(input)
	if err != nil {
		return State{}, err
	}
	return s.setPatch("user", userID, next)
}

func (s *Store) DeleteUser(userID string) (State, error) {
	return s.deletePatch("user", userID)
}

func (s *Store) setPatch(kind, id string, input Patch) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	target := s.state.Roles
	if kind == "user" {
		target = s.state.Users
	}
	previous, existed := target[id]
	target[id] = input
	if err := s.saveLocked(); err != nil {
		if existed {
			target[id] = previous
		} else {
			delete(target, id)
		}
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) deletePatch(kind, id string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	target := s.state.Roles
	if kind == "user" {
		target = s.state.Users
	}
	previous, existed := target[id]
	if !existed {
		return cloneState(s.state), nil
	}
	delete(target, id)
	if err := s.saveLocked(); err != nil {
		target[id] = previous
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) Effective(userID, role string) Effective {
	s.mu.RLock()
	defer s.mu.RUnlock()
	settings := cloneSettings(s.state.Organization)
	sources := map[string]string{
		"defaultModel": "organization", "allowedModels": "organization",
		"defaultSkillIds": "organization", "allowedSkillIds": "organization", "allowedConnectorIds": "organization",
		"defaultPermissionProfileId": "organization", "allowedPermissionProfileIds": "organization",
		"autoCompactThreshold": "organization", "skillPublishMode": "organization",
	}
	applyPatch(&settings, sources, s.state.Roles[role], "role:"+role)
	applyPatch(&settings, sources, s.state.Users[userID], "user:"+userID)
	if len(settings.AllowedModels) > 0 && !contains(settings.AllowedModels, settings.DefaultModel) {
		settings.DefaultModel = ""
		sources["defaultModel"] = "policy-fallback"
	}
	if len(settings.AllowedPermissionProfileIDs) > 0 && !contains(settings.AllowedPermissionProfileIDs, settings.DefaultPermissionProfileID) {
		settings.DefaultPermissionProfileID = settings.AllowedPermissionProfileIDs[0]
		sources["defaultPermissionProfileId"] = "policy-fallback"
	}
	if len(settings.AllowedSkillIDs) > 0 {
		filtered := intersection(settings.DefaultSkillIDs, settings.AllowedSkillIDs)
		if len(filtered) != len(settings.DefaultSkillIDs) {
			sources["defaultSkillIds"] = "policy-fallback"
		}
		settings.DefaultSkillIDs = filtered
	}
	return Effective{Settings: settings, Sources: sources, Revision: s.state.Revision, UpdatedAt: s.state.UpdatedAt}
}

func normalizeSettings(input Settings) (Settings, error) {
	publishMode, err := normalizeSkillPublishMode(input.SkillPublishMode)
	if err != nil {
		return Settings{}, err
	}
	result := Settings{
		DefaultModel:               strings.TrimSpace(input.DefaultModel),
		DefaultPermissionProfileID: strings.TrimSpace(input.DefaultPermissionProfileID),
		SkillPublishMode:           publishMode,
	}
	if result.AutoCompactThreshold, err = normalizeAutoCompactThreshold(input.AutoCompactThreshold, true); err != nil {
		return Settings{}, err
	}
	if result.AllowedModels, err = normalizeList(input.AllowedModels, "allowedModels"); err != nil {
		return Settings{}, err
	}
	if result.DefaultSkillIDs, err = normalizeList(input.DefaultSkillIDs, "defaultSkillIds"); err != nil {
		return Settings{}, err
	}
	if result.AllowedSkillIDs, err = normalizeList(input.AllowedSkillIDs, "allowedSkillIds"); err != nil {
		return Settings{}, err
	}
	if result.AllowedConnectorIDs, err = normalizeList(input.AllowedConnectorIDs, "allowedConnectorIds"); err != nil {
		return Settings{}, err
	}
	if result.AllowedPermissionProfileIDs, err = normalizePermissionProfiles(input.AllowedPermissionProfileIDs); err != nil {
		return Settings{}, err
	}
	if result.DefaultPermissionProfileID != "" {
		if _, ok := permissionProfiles[result.DefaultPermissionProfileID]; !ok {
			return Settings{}, errors.New("defaultPermissionProfileId is not supported")
		}
	}
	if len(result.AllowedModels) > 0 && result.DefaultModel != "" && !contains(result.AllowedModels, result.DefaultModel) {
		return Settings{}, errors.New("defaultModel must be included in allowedModels")
	}
	if len(result.AllowedSkillIDs) > 0 && !isSubset(result.DefaultSkillIDs, result.AllowedSkillIDs) {
		return Settings{}, errors.New("defaultSkillIds must be included in allowedSkillIds")
	}
	if len(result.AllowedPermissionProfileIDs) > 0 && result.DefaultPermissionProfileID != "" && !contains(result.AllowedPermissionProfileIDs, result.DefaultPermissionProfileID) {
		return Settings{}, errors.New("defaultPermissionProfileId must be included in allowedPermissionProfileIds")
	}
	return result, nil
}

func normalizePatch(input Patch) (Patch, error) {
	result := Patch{}
	if input.AutoCompactThreshold != nil {
		value, err := normalizeAutoCompactThreshold(*input.AutoCompactThreshold, false)
		if err != nil {
			return Patch{}, err
		}
		result.AutoCompactThreshold = &value
	}
	if input.DefaultModel != nil {
		value := strings.TrimSpace(*input.DefaultModel)
		result.DefaultModel = &value
	}
	if input.DefaultPermissionProfileID != nil {
		value := strings.TrimSpace(*input.DefaultPermissionProfileID)
		if value != "" {
			if _, ok := permissionProfiles[value]; !ok {
				return Patch{}, errors.New("defaultPermissionProfileId is not supported")
			}
		}
		result.DefaultPermissionProfileID = &value
	}
	fields := []struct {
		input  *[]string
		output **[]string
		name   string
	}{
		{input.AllowedModels, &result.AllowedModels, "allowedModels"},
		{input.DefaultSkillIDs, &result.DefaultSkillIDs, "defaultSkillIds"},
		{input.AllowedSkillIDs, &result.AllowedSkillIDs, "allowedSkillIds"},
		{input.AllowedConnectorIDs, &result.AllowedConnectorIDs, "allowedConnectorIds"},
	}
	for _, field := range fields {
		if field.input == nil {
			continue
		}
		value, err := normalizeList(*field.input, field.name)
		if err != nil {
			return Patch{}, err
		}
		*field.output = &value
	}
	if input.AllowedPermissionProfileIDs != nil {
		value, err := normalizePermissionProfiles(*input.AllowedPermissionProfileIDs)
		if err != nil {
			return Patch{}, err
		}
		result.AllowedPermissionProfileIDs = &value
	}
	return result, nil
}

func normalizeAutoCompactThreshold(value float64, useDefault bool) (float64, error) {
	if value == 0 && useDefault {
		return DefaultAutoCompactThreshold, nil
	}
	if value < minimumAutoCompactThreshold || value > maximumAutoCompactThreshold {
		return 0, fmt.Errorf("autoCompactThreshold must be between %.2f and %.2f", minimumAutoCompactThreshold, maximumAutoCompactThreshold)
	}
	return value, nil
}

func normalizeSkillPublishMode(value string) (string, error) {
	switch strings.TrimSpace(value) {
	case "", DefaultSkillPublishMode:
		return DefaultSkillPublishMode, nil
	case "admin_approval":
		return "admin_approval", nil
	default:
		return "", errors.New("skillPublishMode must be publisher_direct or admin_approval")
	}
}

func normalizePermissionProfiles(values []string) ([]string, error) {
	result, err := normalizeList(values, "allowedPermissionProfileIds")
	if err != nil {
		return nil, err
	}
	for _, value := range result {
		if _, ok := permissionProfiles[value]; !ok {
			return nil, fmt.Errorf("unsupported permission profile: %s", value)
		}
	}
	return result, nil
}

func normalizeList(values []string, field string) ([]string, error) {
	if len(values) > maxListItems {
		return nil, fmt.Errorf("%s cannot contain more than %d items", field, maxListItems)
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, item := range values {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		if len([]rune(value)) > 160 {
			return nil, fmt.Errorf("%s contains an item longer than 160 characters", field)
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result, nil
}

func applyPatch(settings *Settings, sources map[string]string, patch Patch, source string) {
	if patch.DefaultModel != nil {
		settings.DefaultModel = *patch.DefaultModel
		sources["defaultModel"] = source
	}
	if patch.AllowedModels != nil {
		settings.AllowedModels = append([]string(nil), (*patch.AllowedModels)...)
		sources["allowedModels"] = source
	}
	if patch.DefaultSkillIDs != nil {
		settings.DefaultSkillIDs = append([]string(nil), (*patch.DefaultSkillIDs)...)
		sources["defaultSkillIds"] = source
	}
	if patch.AllowedSkillIDs != nil {
		settings.AllowedSkillIDs = append([]string(nil), (*patch.AllowedSkillIDs)...)
		sources["allowedSkillIds"] = source
	}
	if patch.AllowedConnectorIDs != nil {
		settings.AllowedConnectorIDs = append([]string(nil), (*patch.AllowedConnectorIDs)...)
		sources["allowedConnectorIds"] = source
	}
	if patch.DefaultPermissionProfileID != nil {
		settings.DefaultPermissionProfileID = *patch.DefaultPermissionProfileID
		sources["defaultPermissionProfileId"] = source
	}
	if patch.AllowedPermissionProfileIDs != nil {
		settings.AllowedPermissionProfileIDs = append([]string(nil), (*patch.AllowedPermissionProfileIDs)...)
		sources["allowedPermissionProfileIds"] = source
	}
	if patch.AutoCompactThreshold != nil {
		settings.AutoCompactThreshold = *patch.AutoCompactThreshold
		sources["autoCompactThreshold"] = source
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func isSubset(values, allowed []string) bool {
	for _, value := range values {
		if !contains(allowed, value) {
			return false
		}
	}
	return true
}

func intersection(values, allowed []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if contains(allowed, value) {
			result = append(result, value)
		}
	}
	return result
}

func cloneSettings(input Settings) Settings {
	input.AllowedModels = append([]string(nil), input.AllowedModels...)
	input.DefaultSkillIDs = append([]string(nil), input.DefaultSkillIDs...)
	input.AllowedSkillIDs = append([]string(nil), input.AllowedSkillIDs...)
	input.AllowedConnectorIDs = append([]string(nil), input.AllowedConnectorIDs...)
	input.AllowedPermissionProfileIDs = append([]string(nil), input.AllowedPermissionProfileIDs...)
	return input
}

func cloneState(input State) State {
	data, _ := json.Marshal(input)
	var output State
	_ = json.Unmarshal(data, &output)
	return output
}
