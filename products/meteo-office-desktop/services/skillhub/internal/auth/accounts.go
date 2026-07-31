package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	argonMemory      = 19 * 1024
	argonIterations  = 2
	argonParallelism = 1
	argonSaltLength  = 16
	argonKeyLength   = 32
)

var (
	usernamePattern       = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,63}$`)
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrAccountDisabled    = errors.New("account is disabled")
	ErrLastActiveAdmin    = errors.New("at least one active managed administrator is required")
)

type User struct {
	ID                 string     `json:"id"`
	Username           string     `json:"username"`
	DisplayName        string     `json:"displayName"`
	PasswordHash       string     `json:"passwordHash"`
	Role               string     `json:"role"`
	OrgID              string     `json:"orgId,omitempty"`
	Status             string     `json:"status"`
	MustChangePassword bool       `json:"mustChangePassword"`
	LastLoginAt        *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

type PublicUser struct {
	ID                 string     `json:"id"`
	Username           string     `json:"username"`
	DisplayName        string     `json:"displayName"`
	Role               string     `json:"role"`
	OrgID              string     `json:"orgId,omitempty"`
	Status             string     `json:"status"`
	MustChangePassword bool       `json:"mustChangePassword"`
	DefaultSpaceID     string     `json:"defaultSpaceId"`
	LastLoginAt        *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

func (u User) Public() PublicUser {
	return PublicUser{
		ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Role: u.Role,
		OrgID: u.OrgID, Status: u.Status, MustChangePassword: u.MustChangePassword,
		DefaultSpaceID: "personal:" + u.ID, LastLoginAt: u.LastLoginAt, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt,
	}
}

func (u User) Actor() Actor {
	return Actor{Subject: u.ID, Name: u.DisplayName, Role: u.Role, OrgID: u.OrgID}
}

func (u PublicUser) Actor() Actor {
	return Actor{Subject: u.ID, Name: u.DisplayName, Role: u.Role, OrgID: u.OrgID}
}

type CreateUserInput struct {
	Username           string `json:"username"`
	DisplayName        string `json:"displayName"`
	Password           string `json:"password"`
	Role               string `json:"role"`
	OrgID              string `json:"orgId"`
	MustChangePassword bool   `json:"mustChangePassword"`
}

type UpdateUserInput struct {
	DisplayName        *string `json:"displayName"`
	Role               *string `json:"role"`
	OrgID              *string `json:"orgId"`
	Status             *string `json:"status"`
	MustChangePassword *bool   `json:"mustChangePassword"`
}

type accountState struct {
	APIVersion string           `json:"apiVersion"`
	Kind       string           `json:"kind"`
	Version    int              `json:"version"`
	Users      map[string]*User `json:"users"`
	UpdatedAt  time.Time        `json:"updatedAt"`
}

type AccountStore struct {
	mu    sync.RWMutex
	path  string
	state accountState
}

func OpenAccountStore(root string) (*AccountStore, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("account data root is required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	store := &AccountStore{
		path: filepath.Join(root, "users.json"),
		state: accountState{
			APIVersion: "meteomate.ai/v1", Kind: "AccountState", Version: 1,
			Users: map[string]*User{},
		},
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *AccountStore) load() error {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s.saveLocked()
	}
	if err != nil {
		return err
	}
	var state accountState
	if err := json.Unmarshal(data, &state); err != nil {
		recovery := fmt.Sprintf("%s.corrupt-%d", s.path, time.Now().Unix())
		_ = os.WriteFile(recovery, data, 0o600)
		return fmt.Errorf("decode accounts (backup: %s): %w", recovery, err)
	}
	if state.Users == nil {
		state.Users = map[string]*User{}
	}
	if state.APIVersion == "" {
		state.APIVersion = "meteomate.ai/v1"
	}
	if state.Kind == "" {
		state.Kind = "AccountState"
	}
	if state.Version == 0 {
		state.Version = 1
	}
	s.state = state
	return nil
}

func (s *AccountStore) saveLocked() error {
	s.state.UpdatedAt = time.Now().UTC()
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

func (s *AccountStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.state.Users)
}

func (s *AccountStore) List() []PublicUser {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]PublicUser, 0, len(s.state.Users))
	for _, user := range s.state.Users {
		items = append(items, user.Public())
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	return items
}

func (s *AccountStore) Get(id string) (User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	user := s.state.Users[id]
	if user == nil {
		return User{}, false
	}
	return *user, true
}

func (s *AccountStore) Create(input CreateUserInput) (PublicUser, error) {
	username := normalizeUsername(input.Username)
	if !usernamePattern.MatchString(username) {
		return PublicUser{}, errors.New("username must be 3-64 lowercase letters, numbers, dots, underscores, or hyphens")
	}
	if err := validateRole(input.Role); err != nil {
		return PublicUser{}, err
	}
	passwordHash, err := hashPassword(input.Password)
	if err != nil {
		return PublicUser{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.state.Users {
		if existing.Username == username {
			return PublicUser{}, errors.New("username already exists")
		}
	}
	now := time.Now().UTC()
	user := &User{
		ID: newUserID(), Username: username, DisplayName: strings.TrimSpace(input.DisplayName),
		PasswordHash: passwordHash, Role: input.Role, OrgID: strings.TrimSpace(input.OrgID),
		Status: "active", MustChangePassword: input.MustChangePassword, CreatedAt: now, UpdatedAt: now,
	}
	if user.DisplayName == "" {
		user.DisplayName = username
	}
	s.state.Users[user.ID] = user
	if err := s.saveLocked(); err != nil {
		delete(s.state.Users, user.ID)
		return PublicUser{}, err
	}
	return user.Public(), nil
}

func (s *AccountStore) Update(id string, input UpdateUserInput) (PublicUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	user := s.state.Users[id]
	if user == nil {
		return PublicUser{}, errors.New("user not found")
	}
	previous := *user
	next := previous
	if input.DisplayName != nil {
		value := strings.TrimSpace(*input.DisplayName)
		if value == "" {
			return PublicUser{}, errors.New("displayName must not be empty")
		}
		next.DisplayName = value
	}
	if input.Role != nil {
		if err := validateRole(*input.Role); err != nil {
			return PublicUser{}, err
		}
		next.Role = *input.Role
	}
	if input.OrgID != nil {
		next.OrgID = strings.TrimSpace(*input.OrgID)
	}
	if input.Status != nil {
		if *input.Status != "active" && *input.Status != "disabled" {
			return PublicUser{}, errors.New("status must be active or disabled")
		}
		next.Status = *input.Status
	}
	if input.MustChangePassword != nil {
		next.MustChangePassword = *input.MustChangePassword
	}
	if previous.Role == "admin" && previous.Status == "active" && (next.Role != "admin" || next.Status != "active") && s.activeAdminCountLocked() <= 1 {
		return PublicUser{}, ErrLastActiveAdmin
	}
	next.UpdatedAt = time.Now().UTC()
	*user = next
	if err := s.saveLocked(); err != nil {
		*user = previous
		return PublicUser{}, err
	}
	return user.Public(), nil
}

func (s *AccountStore) RecordVerifiedLogin(id, verifiedPasswordHash string) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	user := s.state.Users[id]
	if user == nil {
		return User{}, errors.New("user not found")
	}
	if user.Status != "active" {
		return User{}, ErrAccountDisabled
	}
	if subtle.ConstantTimeCompare([]byte(user.PasswordHash), []byte(verifiedPasswordHash)) != 1 {
		return User{}, ErrInvalidCredentials
	}
	previous := user.LastLoginAt
	now := time.Now().UTC()
	user.LastLoginAt = &now
	if err := s.saveLocked(); err != nil {
		user.LastLoginAt = previous
		return User{}, err
	}
	return *user, nil
}

func (s *AccountStore) activeAdminCountLocked() int {
	count := 0
	for _, user := range s.state.Users {
		if user.Role == "admin" && user.Status == "active" {
			count++
		}
	}
	return count
}

func (s *AccountStore) ResetPassword(id, password string, mustChange bool) error {
	passwordHash, err := hashPassword(password)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	user := s.state.Users[id]
	if user == nil {
		return errors.New("user not found")
	}
	previousHash, previousMustChange, previousUpdated := user.PasswordHash, user.MustChangePassword, user.UpdatedAt
	user.PasswordHash = passwordHash
	user.MustChangePassword = mustChange
	user.UpdatedAt = time.Now().UTC()
	if err := s.saveLocked(); err != nil {
		user.PasswordHash, user.MustChangePassword, user.UpdatedAt = previousHash, previousMustChange, previousUpdated
		return err
	}
	return nil
}

func (s *AccountStore) Verify(username, password string) (User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	username = normalizeUsername(username)
	for _, user := range s.state.Users {
		if user.Username != username {
			continue
		}
		if !verifyPassword(password, user.PasswordHash) {
			return User{}, ErrInvalidCredentials
		}
		if user.Status != "active" {
			return User{}, ErrAccountDisabled
		}
		return *user, nil
	}
	return User{}, ErrInvalidCredentials
}

func normalizeUsername(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validateRole(role string) error {
	switch role {
	case "viewer", "publisher", "admin":
		return nil
	default:
		return errors.New("role must be viewer, publisher, or admin")
	}
}

func validatePassword(password string) error {
	length := len([]rune(password))
	if length < 8 || length > 256 {
		return errors.New("password must contain 8-256 characters")
	}
	return nil
}

func hashPassword(password string) (string, error) {
	if err := validatePassword(password); err != nil {
		return "", err
	}
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonIterations, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	var memory uint32
	var iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(expected) == 0 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func newUserID() string {
	buffer := make([]byte, 16)
	_, _ = rand.Read(buffer)
	return "usr-" + hex.EncodeToString(buffer)
}
