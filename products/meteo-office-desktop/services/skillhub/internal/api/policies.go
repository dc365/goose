package api

import (
	"net/http"
	"strings"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/policy"
)

func (s *Server) myPolicy(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "登录后才能读取组织策略")
		return
	}
	writeJSON(w, http.StatusOK, s.effectivePolicy(actor.Subject, actor.Role, actor.OrgID))
}

func (s *Server) listPolicies(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, s.policies.Snapshot())
}

func (s *Server) updateOrganizationPolicy(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input policy.Settings
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	state, err := s.policies.SetOrganization(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "policy_update_failed", err.Error())
		return
	}
	s.audit(r, "policy.organization.update", "organization", map[string]any{"revision": state.Revision})
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) updateRolePolicy(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	role := strings.TrimSpace(r.PathValue("role"))
	var input policy.Patch
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	state, err := s.policies.SetRole(role, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "policy_update_failed", err.Error())
		return
	}
	s.audit(r, "policy.role.update", role, map[string]any{"revision": state.Revision})
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) deleteRolePolicy(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	role := strings.TrimSpace(r.PathValue("role"))
	state, err := s.policies.DeleteRole(role)
	if err != nil {
		writeError(w, http.StatusBadRequest, "policy_delete_failed", err.Error())
		return
	}
	s.audit(r, "policy.role.reset", role, map[string]any{"revision": state.Revision})
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) updateUserPolicy(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	userID := strings.TrimSpace(r.PathValue("id"))
	if _, ok := s.auth.Accounts().Get(userID); !ok {
		writeError(w, http.StatusNotFound, "user_not_found", "用户不存在")
		return
	}
	var input policy.Patch
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	state, err := s.policies.SetUser(userID, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "policy_update_failed", err.Error())
		return
	}
	s.audit(r, "policy.user.update", userID, map[string]any{"revision": state.Revision})
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) deleteUserPolicy(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	userID := strings.TrimSpace(r.PathValue("id"))
	state, err := s.policies.DeleteUser(userID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "policy_delete_failed", err.Error())
		return
	}
	s.audit(r, "policy.user.reset", userID, map[string]any{"revision": state.Revision})
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) previewUserPolicy(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	userID := strings.TrimSpace(r.PathValue("id"))
	user, ok := s.auth.Accounts().Get(userID)
	if !ok {
		writeError(w, http.StatusNotFound, "user_not_found", "用户不存在")
		return
	}
	writeJSON(w, http.StatusOK, s.effectivePolicy(user.ID, user.Role, user.OrgID))
}

func (s *Server) effectivePolicy(userID, role, orgID string) map[string]any {
	effective := s.policies.Effective(userID, role)
	return map[string]any{
		"userId":           userID,
		"role":             role,
		"orgId":            orgID,
		"defaultSpaceId":   "personal:" + userID,
		"profileBindingId": "user:" + userID,
		"policy":           effective,
	}
}
