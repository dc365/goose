package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type Actor struct {
	Subject string `json:"subject"`
	Name    string `json:"name,omitempty"`
	Role    string `json:"role"`
	OrgID   string `json:"orgId,omitempty"`
}

func (a Actor) Authenticated() bool { return a.Subject != "" }
func (a Actor) IsAdmin() bool       { return a.Role == "admin" }
func (a Actor) CanPublish() bool    { return a.Role == "publisher" || a.Role == "admin" }

type Authenticator struct {
	tokens     map[string]Actor
	accounts   *AccountStore
	sessionTTL time.Duration
	refreshes  *RefreshStore
	mu         sync.Mutex
	sessions   map[[32]byte]session
}

type session struct {
	ID         string
	UserID     string
	ClientID   string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
}

type SessionView struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	ClientID   string    `json:"clientId"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

type LoginResult struct {
	SessionToken     string     `json:"sessionToken"`
	ExpiresAt        time.Time  `json:"expiresAt"`
	RefreshToken     string     `json:"refreshToken,omitempty"`
	RefreshExpiresAt *time.Time `json:"refreshExpiresAt,omitempty"`
	User             PublicUser `json:"user"`
}

func New(tokens map[string]Actor) *Authenticator {
	return NewWithAccounts(tokens, nil, 12*time.Hour)
}

func NewWithAccounts(tokens map[string]Actor, accounts *AccountStore, sessionTTL time.Duration) *Authenticator {
	return NewWithRefreshStore(tokens, accounts, sessionTTL, NewMemoryRefreshStore(defaultRefreshTTL))
}

func NewWithRefreshStore(tokens map[string]Actor, accounts *AccountStore, sessionTTL time.Duration, refreshes *RefreshStore) *Authenticator {
	copy := make(map[string]Actor, len(tokens))
	for token, actor := range tokens {
		if strings.TrimSpace(token) == "" || strings.TrimSpace(actor.Subject) == "" {
			continue
		}
		if actor.Role == "" {
			actor.Role = "viewer"
		}
		copy[token] = actor
	}
	if sessionTTL <= 0 {
		sessionTTL = 12 * time.Hour
	}
	if refreshes == nil {
		refreshes = NewMemoryRefreshStore(defaultRefreshTTL)
	}
	return &Authenticator{tokens: copy, accounts: accounts, sessionTTL: sessionTTL, refreshes: refreshes, sessions: map[[32]byte]session{}}
}

func ParseTokensJSON(value string) (map[string]Actor, error) {
	if strings.TrimSpace(value) == "" {
		return map[string]Actor{}, nil
	}
	var tokens map[string]Actor
	if err := json.Unmarshal([]byte(value), &tokens); err != nil {
		return nil, err
	}
	for token, actor := range tokens {
		if strings.TrimSpace(token) == "" || strings.TrimSpace(actor.Subject) == "" {
			return nil, errors.New("each token must have a non-empty token key and subject")
		}
		switch actor.Role {
		case "", "viewer", "publisher", "admin":
		default:
			return nil, errors.New("token role must be viewer, publisher, or admin")
		}
	}
	return tokens, nil
}

type actorKey struct{}

func (a *Authenticator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor := Actor{Role: "anonymous"}
		if token := BearerToken(r); token != "" {
			actor = a.resolve(token)
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, actor)))
	})
}

func (a *Authenticator) Accounts() *AccountStore { return a.accounts }

func (a *Authenticator) Login(username, password, clientID string, remember bool) (LoginResult, error) {
	if a.accounts == nil {
		return LoginResult{}, errors.New("account login is not configured")
	}
	user, err := a.accounts.Verify(username, password)
	if err != nil {
		return LoginResult{}, err
	}
	user, err = a.accounts.RecordLogin(user.ID)
	if err != nil {
		return LoginResult{}, err
	}
	token, err := newAccessToken()
	if err != nil {
		return LoginResult{}, err
	}
	now := time.Now().UTC()
	expiresAt := now.Add(a.sessionTTL)
	sessionID, err := newSessionID()
	if err != nil {
		return LoginResult{}, err
	}
	result := LoginResult{SessionToken: token, ExpiresAt: expiresAt, User: user.Public()}
	if remember {
		refreshToken, refreshSession, err := a.refreshes.Create(user.ID, clientID, now)
		if err != nil {
			return LoginResult{}, err
		}
		sessionID = refreshSession.ID
		refreshExpiresAt := refreshSession.ExpiresAt
		result.RefreshToken = refreshToken
		result.RefreshExpiresAt = &refreshExpiresAt
	}
	a.mu.Lock()
	a.cleanupLocked(now)
	a.sessions[sha256.Sum256([]byte(token))] = session{
		ID: sessionID, UserID: user.ID,
		ClientID: strings.TrimSpace(clientID), CreatedAt: now, LastSeenAt: now, ExpiresAt: expiresAt,
	}
	a.mu.Unlock()
	return result, nil
}

func (a *Authenticator) Refresh(refreshToken string) (LoginResult, error) {
	if a.accounts == nil {
		return LoginResult{}, errors.New("account login is not configured")
	}
	accessToken, err := newAccessToken()
	if err != nil {
		return LoginResult{}, err
	}
	now := time.Now().UTC()
	rotatedToken, refreshSession, err := a.refreshes.Rotate(refreshToken, now)
	if err != nil {
		return LoginResult{}, err
	}
	user, ok := a.accounts.Get(refreshSession.UserID)
	if !ok || user.Status != "active" {
		_, _ = a.refreshes.RevokeID(refreshSession.ID, now)
		return LoginResult{}, ErrInvalidRefreshToken
	}
	expiresAt := now.Add(a.sessionTTL)
	a.mu.Lock()
	a.cleanupLocked(now)
	for key, current := range a.sessions {
		if current.ID == refreshSession.ID {
			delete(a.sessions, key)
		}
	}
	a.sessions[sha256.Sum256([]byte(accessToken))] = session{
		ID: refreshSession.ID, UserID: user.ID, ClientID: refreshSession.ClientID,
		CreatedAt: now, LastSeenAt: now, ExpiresAt: expiresAt,
	}
	a.mu.Unlock()
	refreshExpiresAt := refreshSession.ExpiresAt
	return LoginResult{
		SessionToken: accessToken, ExpiresAt: expiresAt, RefreshToken: rotatedToken,
		RefreshExpiresAt: &refreshExpiresAt, User: user.Public(),
	}, nil
}

func (a *Authenticator) Logout(accessToken, refreshToken string) (bool, error) {
	removed := false
	familyID := ""
	a.mu.Lock()
	if accessToken != "" {
		key := sha256.Sum256([]byte(accessToken))
		if current, ok := a.sessions[key]; ok {
			familyID = current.ID
			delete(a.sessions, key)
			removed = true
		}
	}
	a.mu.Unlock()
	now := time.Now().UTC()
	if refreshToken != "" {
		revoked, err := a.refreshes.RevokeToken(refreshToken, now)
		if err != nil {
			return removed, err
		}
		removed = removed || revoked
	}
	if familyID != "" {
		revoked, err := a.refreshes.RevokeID(familyID, now)
		return removed || revoked, err
	}
	return removed, nil
}

func (a *Authenticator) LogoutUser(userID string) (int, error) {
	now := time.Now().UTC()
	ids := map[string]struct{}{}
	for _, current := range a.refreshes.List(userID, now) {
		ids[current.ID] = struct{}{}
	}
	if _, err := a.refreshes.RevokeUser(userID, now); err != nil {
		return 0, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for key, current := range a.sessions {
		if current.UserID == userID {
			ids[current.ID] = struct{}{}
			delete(a.sessions, key)
		}
	}
	return len(ids), nil
}

func (a *Authenticator) ListSessions(userID string) []SessionView {
	now := time.Now().UTC()
	byID := map[string]SessionView{}
	for _, current := range a.refreshes.List(userID, now) {
		byID[current.ID] = current
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cleanupLocked(now)
	for _, current := range a.sessions {
		if userID != "" && current.UserID != userID {
			continue
		}
		if _, persistent := byID[current.ID]; persistent {
			continue
		}
		byID[current.ID] = SessionView{
			ID: current.ID, UserID: current.UserID, ClientID: current.ClientID,
			CreatedAt: current.CreatedAt, LastSeenAt: current.LastSeenAt, ExpiresAt: current.ExpiresAt,
		}
	}
	items := make([]SessionView, 0, len(byID))
	for _, current := range byID {
		items = append(items, current)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items
}

func (a *Authenticator) RevokeSession(id string) (bool, error) {
	revoked, err := a.refreshes.RevokeID(id, time.Now().UTC())
	if err != nil {
		return false, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for key, current := range a.sessions {
		if current.ID == id {
			delete(a.sessions, key)
			revoked = true
		}
	}
	return revoked, nil
}

func (a *Authenticator) resolve(token string) Actor {
	if actor, ok := a.tokens[token]; ok {
		return actor
	}
	if a.accounts == nil {
		return Actor{Role: "anonymous"}
	}
	now := time.Now().UTC()
	key := sha256.Sum256([]byte(token))
	a.mu.Lock()
	a.cleanupLocked(now)
	current, ok := a.sessions[key]
	if ok && current.ExpiresAt.After(now) {
		current.LastSeenAt = now
		a.sessions[key] = current
	}
	a.mu.Unlock()
	if !ok || !current.ExpiresAt.After(now) {
		return Actor{Role: "anonymous"}
	}
	user, ok := a.accounts.Get(current.UserID)
	if !ok || user.Status != "active" {
		return Actor{Role: "anonymous"}
	}
	return user.Actor()
}

func (a *Authenticator) cleanupLocked(now time.Time) {
	for key, current := range a.sessions {
		if !current.ExpiresAt.After(now) {
			delete(a.sessions, key)
		}
	}
}

func newAccessToken() (string, error) {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}
	return "mms_" + base64.RawURLEncoding.EncodeToString(tokenBytes), nil
}

func BearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return ""
	}
	return strings.TrimSpace(header[len("Bearer "):])
}

func FromContext(ctx context.Context) Actor {
	actor, _ := ctx.Value(actorKey{}).(Actor)
	if actor.Role == "" {
		actor.Role = "anonymous"
	}
	return actor
}
