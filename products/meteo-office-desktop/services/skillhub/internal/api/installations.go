package api

import (
	"net/http"
	"sort"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

func (s *Server) listInstallations(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "Bearer token required")
		return
	}
	state := s.store.Snapshot()
	items := make([]store.Installation, 0)
	for _, installation := range state.Installations {
		if actor.IsAdmin() || installation.UserID == actor.Subject {
			items = append(items, *installation)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].LastSeenAt.After(items[j].LastSeenAt) })
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
func (s *Server) createInstallation(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "Bearer token required")
		return
	}
	var input store.Installation
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if input.SkillID == "" || input.Version == "" || input.ClientID == "" {
		writeError(w, http.StatusBadRequest, "invalid_installation", "skillId, version and clientId are required")
		return
	}
	state := s.store.Snapshot()
	skill := state.Skills[input.SkillID]
	version := state.SkillVersions[store.VersionKey(input.SkillID, input.Version)]
	if skill == nil || version == nil || version.Status != "published" || !canViewSkill(actor, skill) {
		writeError(w, http.StatusNotFound, "version_not_found", "Published Skill version not found")
		return
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = newID("inst")
	}
	input.UserID = actor.Subject
	input.OrgID = actor.OrgID
	input.InstalledAt = now
	input.LastSeenAt = now
	if input.Scope == "" {
		input.Scope = "user"
	}
	if err := s.store.Update(func(state *store.State) error { state.Installations[input.ID] = &input; return nil }); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", err.Error())
		return
	}
	s.audit(r, "installation.create", input.ID, map[string]any{"skill": input.SkillID + "@" + input.Version})
	writeJSON(w, http.StatusCreated, input)
}
func (s *Server) deleteInstallation(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "Bearer token required")
		return
	}
	id := r.PathValue("id")
	err := s.store.Update(func(state *store.State) error {
		installation := state.Installations[id]
		if installation == nil {
			return errNotFound("Installation not found")
		}
		if !actor.IsAdmin() && installation.UserID != actor.Subject {
			return errForbidden("Cannot delete another user's installation")
		}
		delete(state.Installations, id)
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "installation.delete", id, nil)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}
