package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/skillpkg"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

func (s *Server) inspectPackage(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.CanPublish() {
		writeError(w, http.StatusForbidden, "publisher_required", "Publisher or admin token required")
		return
	}
	data, _, err := readMultipartPackage(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_package", err.Error())
		return
	}
	report, err := skillpkg.InspectZIP(data, skillpkg.DefaultLimits())
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "inspection_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}

type uploadMetadata struct {
	Name        string   `json:"name"`
	Summary     string   `json:"summary"`
	Description string   `json:"description"`
	Categories  []string `json:"categories"`
	Tags        []string `json:"tags"`
	Icon        string   `json:"icon"`
	Visibility  string   `json:"visibility"`
	Changelog   string   `json:"changelog"`
	Featured    bool     `json:"featured"`
}

func (s *Server) uploadVersion(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.CanPublish() {
		writeError(w, http.StatusForbidden, "publisher_required", "Publisher or admin token required")
		return
	}
	data, form, err := readMultipartPackage(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_package", err.Error())
		return
	}
	report, err := skillpkg.InspectZIP(data, skillpkg.DefaultLimits())
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "inspection_failed", err.Error())
		return
	}
	skillID := r.PathValue("id")
	if skillID != report.Skill.ID {
		writeError(w, http.StatusUnprocessableEntity, "skill_id_mismatch", "URL skill ID must match SKILL.md name")
		return
	}
	if report.Risk.Level == "critical" {
		writeError(w, http.StatusUnprocessableEntity, "critical_risk", "Critical-risk packages cannot be uploaded")
		return
	}
	metadata := uploadMetadata{}
	if raw := form.Value["metadata"]; len(raw) > 0 && strings.TrimSpace(raw[0]) != "" {
		if err := json.Unmarshal([]byte(raw[0]), &metadata); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_metadata", err.Error())
			return
		}
	}
	metadata.Visibility = normalizeVisibility(metadata.Visibility)
	if metadata.Visibility == "organization" && actor.OrgID == "" {
		writeError(w, http.StatusBadRequest, "organization_required", "Organization visibility requires an orgId on the token")
		return
	}
	digest, _, err := s.store.PutPackage(data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "package_store_failed", err.Error())
		return
	}
	now := time.Now().UTC()
	var createdSkill *store.Skill
	var createdVersion *store.SkillVersion
	err = s.store.Update(func(state *store.State) error {
		skill := state.Skills[skillID]
		if skill != nil && !actor.IsAdmin() && skill.OwnerID != actor.Subject {
			return errForbidden("Skill belongs to another publisher")
		}
		key := store.VersionKey(skillID, report.Skill.Version)
		if state.SkillVersions[key] != nil {
			return errConflict("This Skill version already exists")
		}
		if skill == nil {
			name := strings.TrimSpace(metadata.Name)
			if name == "" {
				name = report.Skill.DisplayName
			}
			description := strings.TrimSpace(metadata.Description)
			if description == "" {
				description = report.Skill.Description
			}
			skill = &store.Skill{
				ID: skillID, Name: name, Summary: strings.TrimSpace(metadata.Summary), Description: description,
				Categories: unique(metadata.Categories), Tags: unique(metadata.Tags), Icon: strings.TrimSpace(metadata.Icon),
				Publisher: store.Publisher{ID: actor.Subject, Name: firstNonEmpty(actor.Name, actor.Subject), OrgID: actor.OrgID},
				OwnerID:   actor.Subject, OrgID: actor.OrgID, Visibility: metadata.Visibility, Status: "draft",
				Featured: metadata.Featured && actor.IsAdmin(), Versions: []string{}, CreatedAt: now, UpdatedAt: now,
			}
			state.Skills[skillID] = skill
		} else {
			if metadata.Name != "" {
				skill.Name = strings.TrimSpace(metadata.Name)
			}
			if metadata.Summary != "" {
				skill.Summary = strings.TrimSpace(metadata.Summary)
			}
			if metadata.Description != "" {
				skill.Description = strings.TrimSpace(metadata.Description)
			}
			if len(metadata.Categories) > 0 {
				skill.Categories = unique(metadata.Categories)
			}
			if len(metadata.Tags) > 0 {
				skill.Tags = unique(metadata.Tags)
			}
			if metadata.Icon != "" {
				skill.Icon = strings.TrimSpace(metadata.Icon)
			}
			skill.Visibility = metadata.Visibility
			if actor.IsAdmin() {
				skill.Featured = metadata.Featured
			}
			if skill.LatestVersion == "" {
				skill.Status = "draft"
			}
			skill.UpdatedAt = now
		}
		version := &store.SkillVersion{
			SkillID: skillID, Version: report.Skill.Version, Status: "draft", Changelog: metadata.Changelog,
			PackageDigest: digest, PackageSize: int64(len(data)), Integrity: report.Integrity, Manifest: report.Skill,
			Sidecar: report.Sidecar, Files: report.Files, Risk: report.Risk, Warnings: report.Warnings,
			CreatedBy: actor.Subject, CreatedAt: now,
		}
		state.SkillVersions[key] = version
		skill.Versions = append(skill.Versions, version.Version)
		createdSkill = skill
		createdVersion = version
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "skill.version.upload", skillID+"@"+report.Skill.Version, map[string]any{"digest": digest, "risk": report.Risk.Level})
	writeJSON(w, http.StatusCreated, map[string]any{"skill": createdSkill, "version": createdVersion, "inspection": report})
}
func (s *Server) publishVersion(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.CanPublish() {
		writeError(w, http.StatusForbidden, "publisher_required", "Publisher or admin token required")
		return
	}
	skillID, versionID := r.PathValue("id"), r.PathValue("version")
	var published *store.SkillVersion
	status := http.StatusOK
	action := "skill.version.publish"
	err := s.store.Update(func(state *store.State) error {
		skill := state.Skills[skillID]
		version := state.SkillVersions[store.VersionKey(skillID, versionID)]
		if skill == nil || version == nil {
			return errNotFound("Skill version not found")
		}
		if !actor.IsAdmin() && skill.OwnerID != actor.Subject {
			return errForbidden("Only the owner or an admin can publish this Skill")
		}
		if version.Status == "published" {
			published = version
			return nil
		}
		publishMode := s.policies.Effective(actor.Subject, actor.Role).SkillPublishMode
		if !actor.IsAdmin() && (publishMode == "admin_approval" || version.Risk.Level == "high") {
			now := time.Now().UTC()
			version.Status = "pending_review"
			version.SubmittedAt = &now
			version.ReviewedAt = nil
			version.ReviewedBy = ""
			version.ReviewNote = ""
			if skill.LatestVersion == "" {
				skill.Status = "pending_review"
			}
			skill.UpdatedAt = now
			published = version
			status = http.StatusAccepted
			action = "skill.version.submit_review"
			return nil
		}
		finalizePublishedVersion(skill, version, actor.Subject, s.signer)
		published = version
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, action, skillID+"@"+versionID, nil)
	writeJSON(w, status, published)
}

func finalizePublishedVersion(skill *store.Skill, version *store.SkillVersion, reviewer string, signer *trust.Signer) {
	now := time.Now().UTC()
	version.Status = "published"
	version.PublishedAt = &now
	version.ReviewedAt = &now
	version.ReviewedBy = reviewer
	version.ReviewNote = ""
	version.Signature = &store.Signature{
		Algorithm: "ed25519", KeyID: signer.KeyID(),
		Value: signer.Sign(trust.Message(skill.ID, version.Version, version.PackageDigest)),
	}
	skill.Status = "published"
	if skill.LatestVersion == "" || semverCompare(version.Version, skill.LatestVersion) >= 0 {
		skill.LatestVersion = version.Version
	}
	skill.UpdatedAt = now
}

func (s *Server) rejectVersionReview(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input struct {
		Note string `json:"note"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	input.Note = strings.TrimSpace(input.Note)
	if len([]rune(input.Note)) > 500 {
		writeError(w, http.StatusBadRequest, "review_note_too_long", "Review note cannot exceed 500 characters")
		return
	}
	skillID, versionID := r.PathValue("id"), r.PathValue("version")
	actor := auth.FromContext(r.Context())
	var rejected *store.SkillVersion
	err := s.store.Update(func(state *store.State) error {
		skill := state.Skills[skillID]
		version := state.SkillVersions[store.VersionKey(skillID, versionID)]
		if skill == nil || version == nil {
			return errNotFound("Skill version not found")
		}
		if version.Status != "pending_review" {
			return errConflict("Only pending reviews can be rejected")
		}
		now := time.Now().UTC()
		version.Status = "draft"
		version.ReviewedAt = &now
		version.ReviewedBy = actor.Subject
		version.ReviewNote = input.Note
		if skill.LatestVersion == "" {
			skill.Status = "draft"
		}
		skill.UpdatedAt = now
		rejected = version
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "skill.version.reject", skillID+"@"+versionID, map[string]any{"note": rejected.ReviewNote})
	writeJSON(w, http.StatusOK, rejected)
}
func (s *Server) deprecateVersion(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.CanPublish() {
		writeError(w, http.StatusForbidden, "publisher_required", "Publisher or admin token required")
		return
	}
	skillID, versionID := r.PathValue("id"), r.PathValue("version")
	err := s.store.Update(func(state *store.State) error {
		skill := state.Skills[skillID]
		version := state.SkillVersions[store.VersionKey(skillID, versionID)]
		if skill == nil || version == nil {
			return errNotFound("Skill version not found")
		}
		if !actor.IsAdmin() && skill.OwnerID != actor.Subject {
			return errForbidden("Only the owner or an admin can deprecate this Skill")
		}
		now := time.Now().UTC()
		version.Status = "deprecated"
		version.DeprecatedAt = &now
		if skill.LatestVersion == versionID {
			skill.LatestVersion = latestPublishedVersion(state, skill)
		}
		if skill.LatestVersion == "" {
			skill.Status = "deprecated"
			for _, candidateID := range skill.Versions {
				candidate := state.SkillVersions[store.VersionKey(skillID, candidateID)]
				if candidate != nil && candidate.Status == "draft" {
					skill.Status = "draft"
					break
				}
			}
		}
		skill.UpdatedAt = now
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "skill.version.deprecate", skillID+"@"+versionID, nil)
	writeJSON(w, http.StatusOK, map[string]any{"deprecated": true})
}
