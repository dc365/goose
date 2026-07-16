package api

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

func (s *Server) listSkills(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	state := s.store.Snapshot()
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	category := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("category")))
	includeDrafts := r.URL.Query().Get("includeDrafts") == "true" && actor.Authenticated()
	limit := parseLimit(r.URL.Query().Get("limit"), 50, 200)
	offset := parseOffset(r.URL.Query().Get("offset"))

	items := make([]store.Skill, 0)
	for _, skill := range state.Skills {
		if !canViewSkill(actor, skill) {
			continue
		}
		if !includeDrafts && skill.LatestVersion == "" {
			continue
		}
		if includeDrafts && !actor.IsAdmin() && actor.Subject != skill.OwnerID {
			continue
		}
		haystack := strings.ToLower(strings.Join(append([]string{skill.Name, skill.Summary, skill.Description}, skill.Tags...), " "))
		if query != "" && !strings.Contains(haystack, query) {
			continue
		}
		if category != "" && !containsFold(skill.Categories, category) {
			continue
		}
		items = append(items, *skill)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Featured != items[j].Featured {
			return items[i].Featured
		}
		if items[i].Downloads != items[j].Downloads {
			return items[i].Downloads > items[j].Downloads
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})
	total := len(items)
	items = paginate(items, offset, limit)
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "offset": offset, "limit": limit})
}
func (s *Server) getSkill(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	state := s.store.Snapshot()
	skill := state.Skills[r.PathValue("id")]
	if skill == nil || !canViewSkill(actor, skill) {
		writeError(w, http.StatusNotFound, "skill_not_found", "Skill not found")
		return
	}
	versions := make([]store.SkillVersion, 0)
	for _, version := range skill.Versions {
		candidate := state.SkillVersions[store.VersionKey(skill.ID, version)]
		if candidate == nil {
			continue
		}
		if candidate.Status != "published" && !actor.IsAdmin() && actor.Subject != skill.OwnerID {
			continue
		}
		versions = append(versions, *candidate)
	}
	sort.Slice(versions, func(i, j int) bool { return semverCompare(versions[i].Version, versions[j].Version) > 0 })
	writeJSON(w, http.StatusOK, map[string]any{"skill": skill, "versions": versions})
}
func (s *Server) getVersion(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	state := s.store.Snapshot()
	skill := state.Skills[r.PathValue("id")]
	version := state.SkillVersions[store.VersionKey(r.PathValue("id"), r.PathValue("version"))]
	if skill == nil || version == nil || !canViewSkill(actor, skill) {
		writeError(w, http.StatusNotFound, "version_not_found", "Skill version not found")
		return
	}
	if version.Status != "published" && !actor.IsAdmin() && actor.Subject != skill.OwnerID {
		writeError(w, http.StatusNotFound, "version_not_found", "Skill version not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"skill": skill, "version": version, "downloadUrl": downloadPath(skill.ID, version.Version)})
}
func (s *Server) downloadVersion(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	state := s.store.Snapshot()
	skillID := r.PathValue("id")
	versionID := r.PathValue("version")
	skill := state.Skills[skillID]
	version := state.SkillVersions[store.VersionKey(skillID, versionID)]
	if skill == nil || version == nil || version.Status != "published" || !canViewSkill(actor, skill) {
		writeError(w, http.StatusNotFound, "version_not_found", "Skill version not found")
		return
	}
	path, err := s.store.PackagePath(version.PackageDigest)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "package_missing", "Package file is missing")
		return
	}
	_ = s.store.Update(func(state *store.State) error {
		if current := state.Skills[skillID]; current != nil {
			current.Downloads++
			current.UpdatedAt = time.Now().UTC()
		}
		return nil
	})
	s.audit(r, "skill.download", skillID+"@"+versionID, map[string]any{"digest": version.PackageDigest})
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s-%s.zip"`, skillID, versionID))
	w.Header().Set("X-MeteoMate-Digest", version.PackageDigest)
	if version.Signature != nil {
		w.Header().Set("X-MeteoMate-Signature", version.Signature.Value)
		w.Header().Set("X-MeteoMate-Key-Id", version.Signature.KeyID)
	}
	http.ServeFile(w, r, path)
}
