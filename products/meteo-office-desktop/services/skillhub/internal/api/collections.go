package api

import (
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

func (s *Server) listCollections(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	state := s.store.Snapshot()
	items := make([]store.Collection, 0, len(state.Collections)+1)
	for _, collection := range state.Collections {
		filtered := *collection
		filtered.Skills = filtered.Skills[:0]
		for _, ref := range collection.Skills {
			skill := state.Skills[ref.SkillID]
			if skill != nil && skill.LatestVersion != "" && canViewSkill(actor, skill) {
				filtered.Skills = append(filtered.Skills, ref)
			}
		}
		items = append(items, filtered)
	}
	featured := store.Collection{ID: "featured", Name: "精选技能", Description: "由 MeteoMate 编辑推荐的技能", Featured: true, UpdatedAt: state.UpdatedAt}
	for _, skill := range state.Skills {
		if skill.Featured && skill.LatestVersion != "" && canViewSkill(actor, skill) {
			featured.Skills = append(featured.Skills, store.SkillRef{SkillID: skill.ID, Version: skill.LatestVersion})
		}
	}
	if len(featured.Skills) > 0 {
		items = append([]store.Collection{featured}, items...)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Featured != items[j].Featured {
			return items[i].Featured
		}
		return items[i].Name < items[j].Name
	})
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
func (s *Server) putCollection(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.IsAdmin() {
		writeError(w, http.StatusForbidden, "admin_required", "Admin token required")
		return
	}
	var input store.Collection
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	input.ID = r.PathValue("id")
	if input.ID == "" || input.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_collection", "Collection id and name are required")
		return
	}
	input.UpdatedAt = time.Now().UTC()
	if err := s.store.Update(func(state *store.State) error {
		state.Collections[input.ID] = &input
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", err.Error())
		return
	}
	s.audit(r, "collection.put", input.ID, nil)
	writeJSON(w, http.StatusOK, input)
}
func (s *Server) recommendations(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	state := s.store.Snapshot()
	categories := splitCSV(r.URL.Query().Get("categories"))
	installed := set(splitCSV(r.URL.Query().Get("installedSkillIds")))
	connectors := set(splitCSV(r.URL.Query().Get("connectorIds")))
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	limit := parseLimit(r.URL.Query().Get("limit"), 12, 50)
	type scored struct {
		Skill   store.Skill `json:"skill"`
		Score   float64     `json:"score"`
		Reasons []string    `json:"reasons"`
	}
	items := make([]scored, 0)
	for _, skill := range state.Skills {
		if skill.LatestVersion == "" || !canViewSkill(actor, skill) || installed[skill.ID] {
			continue
		}
		version := state.SkillVersions[store.VersionKey(skill.ID, skill.LatestVersion)]
		if version == nil || version.Status != "published" {
			continue
		}
		score := math.Log1p(float64(skill.Downloads))
		reasons := make([]string, 0)
		if skill.Featured {
			score += 50
			reasons = append(reasons, "精选推荐")
		}
		for _, category := range categories {
			if containsFold(skill.Categories, strings.ToLower(category)) {
				score += 20
				reasons = append(reasons, "匹配分类 "+category)
			}
		}
		if query != "" && strings.Contains(strings.ToLower(skill.Name+" "+skill.Description+" "+strings.Join(skill.Tags, " ")), query) {
			score += 15
			reasons = append(reasons, "匹配当前需求")
		}
		required := sidecarConnectorIDs(version.Sidecar)
		matched := 0
		for _, connector := range required {
			if connectors[connector] {
				matched++
				score += 8
			} else {
				score -= 3
			}
		}
		if matched > 0 {
			reasons = append(reasons, "可复用已连接服务")
		}
		items = append(items, scored{Skill: *skill, Score: score, Reasons: reasons})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Score != items[j].Score {
			return items[i].Score > items[j].Score
		}
		return items[i].Skill.Name < items[j].Skill.Name
	})
	if len(items) > limit {
		items = items[:limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
