package auth

import (
	"crypto/sha256"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRefreshStorePersistsRotationAndDetectsReplay(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, time.August, 1, 8, 0, 0, 0, time.UTC)
	store, err := OpenRefreshStore(root, 30*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	first, session, err := store.Create("usr-1", "desktop-macos", now)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "refresh-sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), first) {
		t.Fatal("raw refresh token was written to disk")
	}

	reopened, err := OpenRefreshStore(root, 30*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	second, rotated, err := reopened.Rotate(first, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if second == first || rotated.ID != session.ID || !rotated.ExpiresAt.After(session.ExpiresAt) {
		t.Fatalf("unexpected rotation: first=%q second=%q session=%+v rotated=%+v", first, second, session, rotated)
	}
	if _, _, err := reopened.Rotate(first, now.Add(2*time.Hour)); !errors.Is(err, ErrRefreshTokenReuse) {
		t.Fatalf("expected refresh token reuse detection, got %v", err)
	}
	if _, _, err := reopened.Rotate(second, now.Add(3*time.Hour)); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("expected token family revocation after replay, got %v", err)
	}
}

func TestAuthenticatorRefreshSurvivesRestartAndLogout(t *testing.T) {
	root := t.TempDir()
	accounts, err := OpenAccountStore(filepath.Join(root, "accounts"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := accounts.Create(CreateUserInput{
		Username: "forecaster", DisplayName: "Forecaster", Password: "weather-2026", Role: "publisher",
	}); err != nil {
		t.Fatal(err)
	}
	refreshes, err := OpenRefreshStore(filepath.Join(root, "sessions"), 30*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	firstAuthenticator := NewWithRefreshStore(nil, accounts, 30*time.Minute, refreshes)
	login, err := firstAuthenticator.Login("forecaster", "weather-2026", "desktop-macos", true)
	if err != nil {
		t.Fatal(err)
	}
	if login.RefreshToken == "" || login.RefreshExpiresAt == nil {
		t.Fatal("remembered login did not issue a refresh token")
	}

	reopened, err := OpenRefreshStore(filepath.Join(root, "sessions"), 30*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	secondAuthenticator := NewWithRefreshStore(nil, accounts, 30*time.Minute, reopened)
	refreshed, err := secondAuthenticator.Refresh(login.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.User.Username != "forecaster" || refreshed.SessionToken == "" || refreshed.RefreshToken == login.RefreshToken {
		t.Fatalf("unexpected refreshed login: %+v", refreshed)
	}
	loggedOut, err := secondAuthenticator.Logout("", refreshed.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if !loggedOut {
		t.Fatal("refresh-token logout did not revoke the session")
	}
	if secondAuthenticator.resolve(refreshed.SessionToken).Authenticated() {
		t.Fatal("refresh-token logout left the access session active")
	}
	if _, err := secondAuthenticator.Refresh(refreshed.RefreshToken); !errors.Is(err, ErrInvalidRefreshToken) {
		t.Fatalf("expected logged-out refresh token to be invalid, got %v", err)
	}
}

func TestRefreshReplayRevokesAccessSession(t *testing.T) {
	root := t.TempDir()
	accounts, err := OpenAccountStore(filepath.Join(root, "accounts"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := accounts.Create(CreateUserInput{
		Username: "forecaster", DisplayName: "Forecaster", Password: "weather-2026", Role: "publisher",
	}); err != nil {
		t.Fatal(err)
	}
	authenticator := NewWithAccounts(nil, accounts, 30*time.Minute)
	login, err := authenticator.Login("forecaster", "weather-2026", "desktop-macos", true)
	if err != nil {
		t.Fatal(err)
	}
	refreshed, err := authenticator.Refresh(login.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	if !authenticator.resolve(refreshed.SessionToken).Authenticated() {
		t.Fatal("refreshed access token was not active")
	}
	activeSessions := authenticator.ListSessions(refreshed.User.ID)
	if len(activeSessions) != 1 {
		t.Fatalf("expected one active session, got %d", len(activeSessions))
	}
	if _, err := authenticator.Refresh(login.RefreshToken); !errors.Is(err, ErrRefreshTokenReuse) {
		t.Fatalf("expected refresh token reuse detection, got %v", err)
	}
	if authenticator.resolve(refreshed.SessionToken).Authenticated() {
		t.Fatal("refresh replay left the access session active")
	}
	authenticator.mu.Lock()
	authenticator.sessions[sha256.Sum256([]byte(refreshed.SessionToken))] = session{
		ID: activeSessions[0].ID, UserID: refreshed.User.ID, ClientID: "desktop-macos",
		CreatedAt: time.Now().UTC(), LastSeenAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(time.Minute),
		Persistent: true,
	}
	authenticator.mu.Unlock()
	if authenticator.resolve(refreshed.SessionToken).Authenticated() {
		t.Fatal("late access insertion bypassed revoked refresh family")
	}
}

func TestPersistentSessionListUsesLatestAccessActivity(t *testing.T) {
	root := t.TempDir()
	accounts, err := OpenAccountStore(filepath.Join(root, "accounts"))
	if err != nil {
		t.Fatal(err)
	}
	user, err := accounts.Create(CreateUserInput{
		Username: "observer", DisplayName: "Observer", Password: "weather-2026", Role: "viewer",
	})
	if err != nil {
		t.Fatal(err)
	}
	authenticator := NewWithAccounts(nil, accounts, 30*time.Minute)
	login, err := authenticator.Login("observer", "weather-2026", "desktop-macos", true)
	if err != nil {
		t.Fatal(err)
	}
	before := authenticator.ListSessions(user.ID)
	if len(before) != 1 {
		t.Fatalf("expected one persistent session, got %d", len(before))
	}
	time.Sleep(5 * time.Millisecond)
	if !authenticator.resolve(login.SessionToken).Authenticated() {
		t.Fatal("access token was not active")
	}
	after := authenticator.ListSessions(user.ID)
	if len(after) != 1 || !after[0].LastSeenAt.After(before[0].LastSeenAt) {
		t.Fatalf("session activity was not merged: before=%+v after=%+v", before, after)
	}
}
