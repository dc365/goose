package api

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

type installationGovernanceItem struct {
	store.Installation
	SkillName     string `json:"skillName"`
	LatestVersion string `json:"latestVersion,omitempty"`
	UserName      string `json:"userName"`
	UpgradeReady  bool   `json:"upgradeReady"`
	Active        bool   `json:"active"`
}

type versionDistribution struct {
	SkillID   string `json:"skillId"`
	SkillName string `json:"skillName"`
	Version   string `json:"version"`
	Count     int    `json:"count"`
}

type reviewQueueItem struct {
	SkillID     string     `json:"skillId"`
	SkillName   string     `json:"skillName"`
	Version     string     `json:"version"`
	OwnerName   string     `json:"ownerName"`
	Risk        string     `json:"risk"`
	SubmittedAt *time.Time `json:"submittedAt,omitempty"`
}

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
	input.Scope = strings.TrimSpace(input.Scope)
	input.ProjectID = strings.TrimSpace(input.ProjectID)
	if input.Scope == "" {
		input.Scope = "user"
	}
	if input.Scope != "user" && input.Scope != "project" {
		writeError(w, http.StatusBadRequest, "invalid_installation_scope", "scope must be user or project")
		return
	}
	if input.Scope == "project" && input.ProjectID == "" {
		writeError(w, http.StatusBadRequest, "project_required", "projectId is required for project installations")
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
	} else if existing := state.Installations[input.ID]; existing != nil {
		if existing.UserID != actor.Subject {
			writeError(w, http.StatusForbidden, "installation_forbidden", "Cannot update another user's installation")
			return
		}
		input.InstalledAt = existing.InstalledAt
	}
	input.UserID = actor.Subject
	input.OrgID = actor.OrgID
	if input.InstalledAt.IsZero() {
		input.InstalledAt = now
	}
	input.LastSeenAt = now
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

func (s *Server) installationSummary(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	state := s.store.Snapshot()
	users := map[string]string{}
	if accounts := s.auth.Accounts(); accounts != nil {
		for _, user := range accounts.List() {
			users[user.ID] = firstNonEmpty(user.DisplayName, user.Username)
		}
	}
	activeCutoff := time.Now().UTC().Add(-30 * 24 * time.Hour)
	items := make([]installationGovernanceItem, 0, len(state.Installations))
	clients, installedUsers, projects := map[string]bool{}, map[string]bool{}, map[string]bool{}
	byScope := map[string]int{"user": 0, "project": 0}
	distributionCounts := map[string]int{}
	upgrades := 0
	for _, installation := range state.Installations {
		skill := state.Skills[installation.SkillID]
		skillName, latestVersion := installation.SkillID, ""
		if skill != nil {
			skillName, latestVersion = firstNonEmpty(skill.Name, skill.ID), skill.LatestVersion
		}
		active := !installation.LastSeenAt.Before(activeCutoff)
		upgradeReady := latestVersion != "" && semverCompare(installation.Version, latestVersion) < 0
		if upgradeReady {
			upgrades++
		}
		if active {
			clients[installation.ClientID] = true
		}
		installedUsers[installation.UserID] = true
		if installation.ProjectID != "" {
			projects[installation.ProjectID] = true
		}
		scope := strings.TrimSpace(installation.Scope)
		if scope == "" {
			scope = "user"
		}
		byScope[scope]++
		distributionCounts[installation.SkillID+"\x00"+installation.Version]++
		items = append(items, installationGovernanceItem{
			Installation: *installation, SkillName: skillName, LatestVersion: latestVersion,
			UserName: firstNonEmpty(users[installation.UserID], installation.UserID), UpgradeReady: upgradeReady, Active: active,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].LastSeenAt.After(items[j].LastSeenAt) })
	distribution := make([]versionDistribution, 0, len(distributionCounts))
	for key, count := range distributionCounts {
		parts := strings.SplitN(key, "\x00", 2)
		skillName := parts[0]
		if skill := state.Skills[parts[0]]; skill != nil {
			skillName = firstNonEmpty(skill.Name, skill.ID)
		}
		distribution = append(distribution, versionDistribution{SkillID: parts[0], SkillName: skillName, Version: parts[1], Count: count})
	}
	sort.Slice(distribution, func(i, j int) bool {
		if distribution[i].Count != distribution[j].Count {
			return distribution[i].Count > distribution[j].Count
		}
		return distribution[i].SkillName < distribution[j].SkillName
	})
	reviews := make([]reviewQueueItem, 0)
	for _, version := range state.SkillVersions {
		if version.Status != "pending_review" {
			continue
		}
		skill := state.Skills[version.SkillID]
		if skill == nil {
			continue
		}
		reviews = append(reviews, reviewQueueItem{
			SkillID: skill.ID, SkillName: firstNonEmpty(skill.Name, skill.ID), Version: version.Version,
			OwnerName: firstNonEmpty(skill.Publisher.Name, skill.OwnerID), Risk: version.Risk.Level, SubmittedAt: version.SubmittedAt,
		})
	}
	sort.Slice(reviews, func(i, j int) bool {
		if reviews[i].SubmittedAt == nil {
			return false
		}
		if reviews[j].SubmittedAt == nil {
			return true
		}
		return reviews[i].SubmittedAt.After(*reviews[j].SubmittedAt)
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"metrics": map[string]any{
			"installations": len(items), "activeClients": len(clients), "users": len(installedUsers),
			"projects": len(projects), "upgrades": upgrades, "pendingReviews": len(reviews),
		},
		"byScope": byScope, "items": items, "versionDistribution": distribution, "pendingReviews": reviews,
	})
}
