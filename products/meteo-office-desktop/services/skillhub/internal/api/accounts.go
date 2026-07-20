package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
)

type loginInput struct {
	Username string `json:"username"`
	Password string `json:"password"`
	ClientID string `json:"clientId"`
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var input loginInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	input.ClientID = strings.TrimSpace(input.ClientID)
	if len(input.Username) > 64 || len([]rune(input.Password)) > 256 || len(input.ClientID) > 128 {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "用户名或密码错误")
		return
	}
	now := time.Now().UTC()
	attemptKey := loginAttemptKey(r.RemoteAddr, input.Username)
	if allowed, retryAfter := s.logins.allow(attemptKey, now); !allowed {
		seconds := int(retryAfter.Seconds()) + 1
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		s.auditAs(r, auth.Actor{Role: "anonymous"}, "auth.login.blocked", strings.ToLower(input.Username), map[string]any{"clientId": input.ClientID, "retryAfterSeconds": seconds})
		writeError(w, http.StatusTooManyRequests, "login_rate_limited", "登录失败次数过多，请稍后再试")
		return
	}
	result, err := s.auth.Login(input.Username, input.Password, input.ClientID)
	if err != nil {
		s.logins.failed(attemptKey, now)
		status := http.StatusUnauthorized
		code := "invalid_credentials"
		message := "用户名或密码错误"
		if errors.Is(err, auth.ErrAccountDisabled) {
			code = "account_disabled"
			message = "账户已被停用"
		}
		s.auditAs(r, auth.Actor{Role: "anonymous"}, "auth.login.failed", strings.ToLower(input.Username), map[string]any{"clientId": input.ClientID, "reason": code})
		writeError(w, status, code, message)
		return
	}
	s.logins.succeeded(attemptKey)
	s.auditAs(r, result.User.Actor(), "auth.login", result.User.ID, map[string]any{"clientId": input.ClientID})
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	removed := s.auth.Logout(auth.BearerToken(r))
	if actor.Authenticated() {
		s.audit(r, "auth.logout", actor.Subject, nil)
	}
	writeJSON(w, http.StatusOK, map[string]any{"loggedOut": removed})
}

func (s *Server) updateMe(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "登录后才能修改账户")
		return
	}
	accounts := s.auth.Accounts()
	if accounts == nil {
		writeError(w, http.StatusNotImplemented, "accounts_unavailable", "账户服务未配置")
		return
	}
	var input struct {
		DisplayName string `json:"displayName"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	user, err := accounts.Update(actor.Subject, auth.UpdateUserInput{DisplayName: &input.DisplayName})
	if err != nil {
		writeError(w, http.StatusBadRequest, "profile_update_failed", err.Error())
		return
	}
	s.audit(r, "user.profile.update", user.ID, nil)
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	accounts := s.auth.Accounts()
	if !actor.Authenticated() || accounts == nil {
		writeError(w, http.StatusUnauthorized, "authentication_required", "登录后才能修改密码")
		return
	}
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	user, err := accounts.Verify(findUsername(accounts, actor.Subject), input.CurrentPassword)
	if err != nil || user.ID != actor.Subject {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "当前密码错误")
		return
	}
	if err := accounts.ResetPassword(actor.Subject, input.NewPassword, false); err != nil {
		writeError(w, http.StatusBadRequest, "password_update_failed", err.Error())
		return
	}
	s.audit(r, "user.password.change", actor.Subject, nil)
	s.auth.LogoutUser(actor.Subject)
	writeJSON(w, http.StatusOK, map[string]any{"changed": true, "loginRequired": true})
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": s.auth.Accounts().List()})
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input auth.CreateUserInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	user, err := s.auth.Accounts().Create(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "user_create_failed", err.Error())
		return
	}
	s.audit(r, "user.create", user.ID, map[string]any{"username": user.Username, "role": user.Role})
	writeJSON(w, http.StatusCreated, user)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input auth.UpdateUserInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	user, err := s.auth.Accounts().Update(r.PathValue("id"), input)
	if err != nil {
		if errors.Is(err, auth.ErrLastActiveAdmin) {
			writeError(w, http.StatusConflict, "last_admin_required", "必须保留至少一个启用的管理员账户")
			return
		}
		writeError(w, http.StatusBadRequest, "user_update_failed", err.Error())
		return
	}
	revoked := 0
	if user.Status == "disabled" {
		revoked = s.auth.LogoutUser(user.ID)
	}
	s.audit(r, "user.update", user.ID, map[string]any{"role": user.Role, "status": user.Status, "sessionsRevoked": revoked})
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	userID := r.PathValue("id")
	if err := s.auth.Accounts().ResetPassword(userID, input.Password, true); err != nil {
		writeError(w, http.StatusBadRequest, "password_reset_failed", err.Error())
		return
	}
	revoked := s.auth.LogoutUser(userID)
	s.audit(r, "user.password.reset", userID, map[string]any{"sessionsRevoked": revoked})
	writeJSON(w, http.StatusOK, map[string]any{"reset": true, "sessionsRevoked": revoked})
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	items := s.auth.ListSessions(strings.TrimSpace(r.URL.Query().Get("userId")))
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	sessionID := r.PathValue("id")
	if !s.auth.RevokeSession(sessionID) {
		writeError(w, http.StatusNotFound, "session_not_found", "会话不存在或已经失效")
		return
	}
	s.audit(r, "session.revoke", sessionID, nil)
	writeJSON(w, http.StatusOK, map[string]any{"revoked": true})
}

func (s *Server) revokeUserSessions(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	userID := r.PathValue("id")
	if _, ok := s.auth.Accounts().Get(userID); !ok {
		writeError(w, http.StatusNotFound, "user_not_found", "用户不存在")
		return
	}
	revoked := s.auth.LogoutUser(userID)
	s.audit(r, "user.sessions.revoke", userID, map[string]any{"sessionsRevoked": revoked})
	writeJSON(w, http.StatusOK, map[string]any{"revoked": revoked})
}

func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	result, err := s.store.ReadAudit(r.URL.Query().Get("q"), r.URL.Query().Get("action"), parseLimit(r.URL.Query().Get("limit"), 100, 500))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "audit_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	actor := auth.FromContext(r.Context())
	if !actor.IsAdmin() {
		writeError(w, http.StatusForbidden, "admin_required", "需要管理员权限")
		return false
	}
	return true
}

func findUsername(accounts *auth.AccountStore, id string) string {
	user, ok := accounts.Get(strings.TrimSpace(id))
	if !ok {
		return ""
	}
	return user.Username
}
