package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
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
	tokens map[string]Actor
}

func New(tokens map[string]Actor) *Authenticator {
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
	return &Authenticator{tokens: copy}
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
		if header := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(header), "bearer ") {
			token := strings.TrimSpace(header[len("Bearer "):])
			if resolved, ok := a.tokens[token]; ok {
				actor = resolved
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, actor)))
	})
}

func FromContext(ctx context.Context) Actor {
	actor, _ := ctx.Value(actorKey{}).(Actor)
	if actor.Role == "" {
		actor.Role = "anonymous"
	}
	return actor
}
