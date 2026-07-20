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
	SessionToken string     `json:"sessionToken"`
	ExpiresAt    time.Time  `json:"expiresAt"`
	User         PublicUser `json:"user"`
}

func New(tokens map[string]Actor) *Authenticator {
	return NewWithAccounts(tokens, nil, 12*time.Hour)
}

func NewWithAccounts(tokens map[string]Actor, accounts *AccountStore, sessionTTL time.Duration) *Authenticator {
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
	return &Authenticator{tokens: copy, accounts: accounts, sessionTTL: sessionTTL, sessions: map[[32]byte]session{}}
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

func (a *Authenticator) Login(username, password, clientID string) (LoginResult, error) {
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
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return LoginResult{}, err
	}
	token := "mms_" + base64.RawURLEncoding.EncodeToString(tokenBytes)
	sessionIDBytes := make([]byte, 12)
	if _, err := rand.Read(sessionIDBytes); err != nil {
		return LoginResult{}, err
	}
	now := time.Now().UTC()
	expiresAt := now.Add(a.sessionTTL)
	a.mu.Lock()
	a.cleanupLocked(now)
	a.sessions[sha256.Sum256([]byte(token))] = session{
		ID: "ses_" + base64.RawURLEncoding.EncodeToString(sessionIDBytes), UserID: user.ID,
		ClientID: strings.TrimSpace(clientID), CreatedAt: now, LastSeenAt: now, ExpiresAt: expiresAt,
	}
	a.mu.Unlock()
	return LoginResult{SessionToken: token, ExpiresAt: expiresAt, User: user.Public()}, nil
}

func (a *Authenticator) Logout(token string) bool {
	if token == "" {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	key := sha256.Sum256([]byte(token))
	if _, ok := a.sessions[key]; !ok {
		return false
	}
	delete(a.sessions, key)
	return true
}

func (a *Authenticator) LogoutUser(userID string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	removed := 0
	for key, current := range a.sessions {
		if current.UserID == userID {
			delete(a.sessions, key)
			removed++
		}
	}
	return removed
}

func (a *Authenticator) ListSessions(userID string) []SessionView {
	now := time.Now().UTC()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cleanupLocked(now)
	items := make([]SessionView, 0, len(a.sessions))
	for _, current := range a.sessions {
		if userID != "" && current.UserID != userID {
			continue
		}
		items = append(items, SessionView{
			ID: current.ID, UserID: current.UserID, ClientID: current.ClientID,
			CreatedAt: current.CreatedAt, LastSeenAt: current.LastSeenAt, ExpiresAt: current.ExpiresAt,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items
}

func (a *Authenticator) RevokeSession(id string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	for key, current := range a.sessions {
		if current.ID == id {
			delete(a.sessions, key)
			return true
		}
	}
	return false
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
