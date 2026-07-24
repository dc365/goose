package api

import (
	"errors"
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
	featuredSkills := make([]*store.Skill, 0)
	for _, skill := range state.Skills {
		if skill.Featured && skill.LatestVersion != "" && canViewSkill(actor, skill) {
			featuredSkills = append(featuredSkills, skill)
		}
	}
	sort.SliceStable(featuredSkills, func(i, j int) bool {
		left, right := featuredSkills[i].FeaturedRank, featuredSkills[j].FeaturedRank
		if left != right {
			if left == 0 {
				return false
			}
			if right == 0 {
				return true
			}
			return left < right
		}
		return featuredSkills[i].Name < featuredSkills[j].Name
	})
	for _, skill := range featuredSkills {
		featured.Skills = append(featured.Skills, store.SkillRef{SkillID: skill.ID, Version: skill.LatestVersion})
	}
	if len(featured.Skills) > 0 {
		items = append([]store.Collection{featured}, items...)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].ID == "featured" || items[j].ID == "featured" {
			return items[i].ID == "featured"
		}
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
	input.ID = strings.TrimSpace(r.PathValue("id"))
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	if err := validateCollection(input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_collection", err.Error())
		return
	}
	input.UpdatedAt = time.Now().UTC()
	if err := s.store.Update(func(state *store.State) error {
		seen := map[string]bool{}
		refs := make([]store.SkillRef, 0, len(input.Skills))
		for _, ref := range input.Skills {
			ref.SkillID = strings.TrimSpace(ref.SkillID)
			if ref.SkillID == "" || seen[ref.SkillID] {
				continue
			}
			skill := state.Skills[ref.SkillID]
			if skill == nil {
				return errNotFound("Collection Skill not found: " + ref.SkillID)
			}
			if ref.Version == "" {
				ref.Version = skill.LatestVersion
			}
			version := state.SkillVersions[store.VersionKey(ref.SkillID, ref.Version)]
			if version == nil || version.Status != "published" {
				return errConflict("Collection items must reference a published Skill version")
			}
			seen[ref.SkillID] = true
			refs = append(refs, ref)
		}
		input.Skills = refs
		state.Collections[input.ID] = &input
		return nil
	}); err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "collection.put", input.ID, map[string]any{"skillCount": len(input.Skills), "featured": input.Featured})
	writeJSON(w, http.StatusOK, input)
}

func (s *Server) deleteCollection(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.IsAdmin() {
		writeError(w, http.StatusForbidden, "admin_required", "Admin token required")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "featured" {
		writeError(w, http.StatusBadRequest, "managed_collection", "The generated featured collection cannot be deleted")
		return
	}
	if err := s.store.Update(func(state *store.State) error {
		if state.Collections[id] == nil {
			return errNotFound("Collection not found")
		}
		delete(state.Collections, id)
		return nil
	}); err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "collection.delete", id, nil)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

func (s *Server) listRecommendationRules(w http.ResponseWriter, r *http.Request) {
	if !auth.FromContext(r.Context()).IsAdmin() {
		writeError(w, http.StatusForbidden, "admin_required", "Admin token required")
		return
	}
	state := s.store.Snapshot()
	items := make([]store.RecommendationRule, 0, len(state.RecommendationRules))
	for _, rule := range state.RecommendationRules {
		items = append(items, *rule)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Priority != items[j].Priority {
			return items[i].Priority > items[j].Priority
		}
		return items[i].Name < items[j].Name
	})
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) putRecommendationRule(w http.ResponseWriter, r *http.Request) {
	if !auth.FromContext(r.Context()).IsAdmin() {
		writeError(w, http.StatusForbidden, "admin_required", "Admin token required")
		return
	}
	var input store.RecommendationRule
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	input.ID = strings.TrimSpace(r.PathValue("id"))
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	input.Action.Reason = strings.TrimSpace(input.Action.Reason)
	normalizeRecommendationRule(&input)
	if err := validateRecommendationRule(input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_recommendation_rule", err.Error())
		return
	}
	input.UpdatedAt = time.Now().UTC()
	if err := s.store.Update(func(state *store.State) error {
		state.RecommendationRules[input.ID] = &input
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "store_failed", err.Error())
		return
	}
	s.audit(r, "recommendation.rule.put", input.ID, map[string]any{"enabled": input.Enabled, "priority": input.Priority})
	writeJSON(w, http.StatusOK, input)
}

func (s *Server) deleteRecommendationRule(w http.ResponseWriter, r *http.Request) {
	if !auth.FromContext(r.Context()).IsAdmin() {
		writeError(w, http.StatusForbidden, "admin_required", "Admin token required")
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if err := s.store.Update(func(state *store.State) error {
		if state.RecommendationRules[id] == nil {
			return errNotFound("Recommendation rule not found")
		}
		delete(state.RecommendationRules, id)
		return nil
	}); err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "recommendation.rule.delete", id, nil)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "id": id})
}

type featuredPlacement struct {
	SkillID string `json:"skillId"`
	Rank    int    `json:"rank"`
}

func (s *Server) putFeaturedPlacements(w http.ResponseWriter, r *http.Request) {
	if !auth.FromContext(r.Context()).IsAdmin() {
		writeError(w, http.StatusForbidden, "admin_required", "Admin token required")
		return
	}
	var input struct {
		Items []featuredPlacement `json:"items"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if len(input.Items) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_featured_placements", "At most 100 featured Skills are allowed")
		return
	}
	if err := s.store.Update(func(state *store.State) error {
		for _, skill := range state.Skills {
			skill.Featured = false
			skill.FeaturedRank = 0
		}
		seen := map[string]bool{}
		for index, item := range input.Items {
			item.SkillID = strings.TrimSpace(item.SkillID)
			if item.SkillID == "" || seen[item.SkillID] {
				return apiError{status: http.StatusBadRequest, message: "featured Skill ids must be unique and non-empty"}
			}
			skill := state.Skills[item.SkillID]
			if skill == nil || skill.LatestVersion == "" {
				return errNotFound("Featured Skill not found: " + item.SkillID)
			}
			version := state.SkillVersions[store.VersionKey(skill.ID, skill.LatestVersion)]
			if version == nil || version.Status != "published" {
				return errConflict("Featured placement requires a published Skill version")
			}
			rank := item.Rank
			if rank <= 0 {
				rank = index + 1
			}
			if rank > 999 {
				return apiError{status: http.StatusBadRequest, message: "featured rank must be between 1 and 999"}
			}
			skill.Featured = true
			skill.FeaturedRank = rank
			skill.UpdatedAt = time.Now().UTC()
			seen[item.SkillID] = true
		}
		return nil
	}); err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "featured.placements.put", "featured", map[string]any{"skillCount": len(input.Items)})
	writeJSON(w, http.StatusOK, map[string]any{"items": input.Items})
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
		Skill    store.Skill `json:"skill"`
		Score    float64     `json:"score"`
		Reasons  []string    `json:"reasons"`
		RuleIDs  []string    `json:"ruleIds,omitempty"`
		Pinned   bool        `json:"pinned,omitempty"`
		PinOrder int         `json:"-"`
	}
	rules := enabledRecommendationRules(state.RecommendationRules)
	items := make([]scored, 0)
	for _, skill := range state.Skills {
		if skill.LatestVersion == "" || !canViewSkill(actor, skill) || installed[skill.ID] {
			continue
		}
		version := state.SkillVersions[store.VersionKey(skill.ID, skill.LatestVersion)]
		if version == nil || version.Status != "published" {
			continue
		}
		item := scored{Skill: *skill, Score: math.Log1p(float64(skill.Downloads)), PinOrder: 100000}
		if skill.Featured {
			item.Score += 50
			item.Reasons = append(item.Reasons, "精选推荐")
		}
		if skill.FeaturedRank > 0 {
			item.Pinned = true
			item.PinOrder = 20000 + skill.FeaturedRank
			item.Score += 100
			item.Reasons = append(item.Reasons, "人工置顶")
		}
		for _, category := range categories {
			if containsFold(skill.Categories, strings.ToLower(category)) {
				item.Score += 20
				item.Reasons = append(item.Reasons, "匹配分类 "+category)
			}
		}
		if query != "" && strings.Contains(strings.ToLower(skill.Name+" "+skill.Description+" "+strings.Join(skill.Tags, " ")), query) {
			item.Score += 15
			item.Reasons = append(item.Reasons, "匹配当前需求")
		}
		required := sidecarConnectorIDs(version.Sidecar)
		matched := 0
		for _, connector := range required {
			if connectors[connector] {
				matched++
				item.Score += 8
			} else {
				item.Score -= 3
			}
		}
		if matched > 0 {
			item.Reasons = append(item.Reasons, "可复用已连接服务")
		}
		excluded := false
		for _, rule := range rules {
			if !recommendationRuleMatches(rule, skill, categories, connectors, query) {
				continue
			}
			item.RuleIDs = append(item.RuleIDs, rule.ID)
			if rule.Action.Exclude {
				excluded = true
				break
			}
			item.Score += rule.Action.ScoreBoost
			if rule.Action.Pin {
				item.Pinned = true
				order := 10000 - rule.Priority
				if order < item.PinOrder {
					item.PinOrder = order
				}
			}
			reason := rule.Action.Reason
			if reason == "" {
				reason = "命中运营规则 " + rule.Name
			}
			item.Reasons = append(item.Reasons, reason)
		}
		if !excluded {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Pinned != items[j].Pinned {
			return items[i].Pinned
		}
		if items[i].Pinned && items[i].PinOrder != items[j].PinOrder {
			return items[i].PinOrder < items[j].PinOrder
		}
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

func validateCollection(input store.Collection) error {
	if !validContentID(input.ID) || input.ID == "featured" {
		return errors.New("collection id must use lowercase letters, numbers, and hyphens")
	}
	if input.Name == "" || len([]rune(input.Name)) > 120 {
		return errors.New("collection name must be 1-120 characters")
	}
	if len([]rune(input.Description)) > 500 {
		return errors.New("collection description must be at most 500 characters")
	}
	if len(input.Skills) > 100 {
		return errors.New("collection may contain at most 100 Skills")
	}
	return nil
}

func validateRecommendationRule(input store.RecommendationRule) error {
	if !validContentID(input.ID) {
		return errors.New("rule id must use lowercase letters, numbers, and hyphens")
	}
	if input.Name == "" || len([]rune(input.Name)) > 120 {
		return errors.New("rule name must be 1-120 characters")
	}
	if input.Priority < -9999 || input.Priority > 9999 {
		return errors.New("priority must be between -9999 and 9999")
	}
	if input.Action.ScoreBoost < -10000 || input.Action.ScoreBoost > 10000 {
		return errors.New("scoreBoost must be between -10000 and 10000")
	}
	if input.Action.Exclude && (input.Action.Pin || input.Action.ScoreBoost != 0) {
		return errors.New("exclude rules cannot also pin or change score")
	}
	return nil
}

func normalizeRecommendationRule(rule *store.RecommendationRule) {
	rule.Match.SkillIDs = unique(rule.Match.SkillIDs)
	rule.Match.SkillCategories = unique(rule.Match.SkillCategories)
	rule.Match.SkillTags = unique(rule.Match.SkillTags)
	rule.Match.RequestCategories = unique(rule.Match.RequestCategories)
	rule.Match.QueryTerms = unique(rule.Match.QueryTerms)
	rule.Match.ConnectorIDs = unique(rule.Match.ConnectorIDs)
}

func enabledRecommendationRules(rules map[string]*store.RecommendationRule) []store.RecommendationRule {
	items := make([]store.RecommendationRule, 0, len(rules))
	for _, rule := range rules {
		if rule.Enabled {
			items = append(items, *rule)
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Priority > items[j].Priority })
	return items
}

func recommendationRuleMatches(rule store.RecommendationRule, skill *store.Skill, requestCategories []string, connectors map[string]bool, query string) bool {
	match := rule.Match
	if len(match.SkillIDs) > 0 && !containsFold(match.SkillIDs, skill.ID) {
		return false
	}
	if len(match.SkillCategories) > 0 && !intersectsFold(match.SkillCategories, skill.Categories) {
		return false
	}
	if len(match.SkillTags) > 0 && !intersectsFold(match.SkillTags, skill.Tags) {
		return false
	}
	if len(match.RequestCategories) > 0 && !intersectsFold(match.RequestCategories, requestCategories) {
		return false
	}
	if len(match.QueryTerms) > 0 && !containsAnyText(query, match.QueryTerms) {
		return false
	}
	if len(match.ConnectorIDs) > 0 {
		matched := false
		for _, id := range match.ConnectorIDs {
			if connectors[id] {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

func validContentID(value string) bool {
	if value == "" || len(value) > 80 || value[0] == '-' || value[len(value)-1] == '-' {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < '0' || character > '9') && character != '-' {
			return false
		}
	}
	return true
}

func intersectsFold(left, right []string) bool {
	for _, value := range left {
		if containsFold(right, strings.ToLower(value)) {
			return true
		}
	}
	return false
}

func containsAnyText(text string, terms []string) bool {
	for _, term := range terms {
		if strings.Contains(text, strings.ToLower(strings.TrimSpace(term))) {
			return true
		}
	}
	return false
}
