package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
)

func TestRememberedLoginRotatesRefreshTokens(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	create := `{"username":"remembered.user","displayName":"Remembered User","password":"weather-2026","role":"publisher"}`
	resp := post(t, http.MethodPost, server.URL+"/v1/admin/users", "admin-token", strings.NewReader(create))
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create remembered user: %d", resp.StatusCode)
	}

	loginBody := `{"username":"remembered.user","password":"weather-2026","clientId":"desktop-macos","remember":true}`
	resp = post(t, http.MethodPost, server.URL+"/v1/auth/login", "", strings.NewReader(loginBody))
	var login auth.LoginResult
	if err := json.NewDecoder(resp.Body).Decode(&login); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || login.RefreshToken == "" || login.RefreshExpiresAt == nil {
		t.Fatalf("remembered login: %d %+v", resp.StatusCode, login)
	}

	refreshBody := `{"refreshToken":"` + login.RefreshToken + `"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/auth/refresh", "", strings.NewReader(refreshBody))
	var refreshed auth.LoginResult
	if err := json.NewDecoder(resp.Body).Decode(&refreshed); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || refreshed.RefreshToken == "" || refreshed.RefreshToken == login.RefreshToken {
		t.Fatalf("refresh rotation: %d %+v", resp.StatusCode, refreshed)
	}

	resp = post(t, http.MethodPost, server.URL+"/v1/auth/refresh", "", strings.NewReader(refreshBody))
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replayed refresh token: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodPost, server.URL+"/v1/auth/refresh", "", strings.NewReader(`{"refreshToken":"`+refreshed.RefreshToken+`"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("active token after replay: %d", resp.StatusCode)
	}
}
