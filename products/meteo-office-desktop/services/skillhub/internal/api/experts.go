package api

import (
	"errors"
	"hash/fnv"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

var expertIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,127}$`)

type expertMutationInput struct {
	store.Expert
	BaseRevision int `json:"baseRevision,omitempty"`
}

func (s *Server) listExperts(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	state := s.store.Snapshot()
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	includeInactive := r.URL.Query().Get("includeInactive") == "true" && actor.Authenticated()
	limit := parseLimit(r.URL.Query().Get("limit"), 100, 300)
	offset := parseOffset(r.URL.Query().Get("offset"))
	items := make([]store.Expert, 0, len(state.Experts))
	for _, expert := range state.Experts {
		if !canViewExpert(actor, expert) {
			continue
		}
		if expert.Status != "enabled" && (!includeInactive || (!actor.IsAdmin() && actor.Subject != expert.OwnerID)) {
			continue
		}
		haystack := strings.ToLower(strings.Join(append(
			[]string{expert.Name, expert.Description, expert.Mission, expert.Category},
			expert.Tags...,
		), " "))
		if query != "" && !strings.Contains(haystack, query) {
			continue
		}
		items = append(items, *expert)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Source.Type != items[j].Source.Type {
			return expertSourceRank(items[i].Source.Type) < expertSourceRank(items[j].Source.Type)
		}
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})
	total := len(items)
	items = paginate(items, offset, limit)
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "offset": offset, "limit": limit})
}

func (s *Server) getExpert(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	expert := s.store.Snapshot().Experts[r.PathValue("id")]
	if expert == nil || !canViewExpert(actor, expert) {
		writeError(w, http.StatusNotFound, "expert_not_found", "Expert not found")
		return
	}
	writeJSON(w, http.StatusOK, expert)
}

func (s *Server) listExpertRevisions(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	state := s.store.Snapshot()
	expert := state.Experts[r.PathValue("id")]
	if expert == nil || !canManageExpert(actor, expert) {
		writeError(w, http.StatusNotFound, "expert_not_found", "Expert not found")
		return
	}
	items := make([]store.ExpertRevision, 0, expert.Revision)
	for revision := 1; revision <= expert.Revision; revision++ {
		if item := state.ExpertRevisions[store.ExpertRevisionKey(expert.ID, revision)]; item != nil {
			items = append(items, *item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Revision > items[j].Revision })
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (s *Server) getExpertRevision(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	state := s.store.Snapshot()
	expert := state.Experts[r.PathValue("id")]
	revision := parseOffset(r.PathValue("revision"))
	record := state.ExpertRevisions[store.ExpertRevisionKey(r.PathValue("id"), revision)]
	if expert == nil || record == nil || !canManageExpert(actor, expert) {
		writeError(w, http.StatusNotFound, "expert_revision_not_found", "Expert revision not found")
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (s *Server) createExpert(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "Authentication is required")
		return
	}
	var input expertMutationInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	now := time.Now().UTC()
	expert, err := prepareExpert(input.Expert, nil, actor, now)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_expert", err.Error())
		return
	}
	err = s.store.Update(func(state *store.State) error {
		if state.Experts[expert.ID] != nil {
			return errConflict("Expert ID already exists")
		}
		state.Experts[expert.ID] = expert
		state.ExpertRevisions[store.ExpertRevisionKey(expert.ID, expert.Revision)] = expertRevision(expert, actor)
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "expert.create", expert.ID, map[string]any{"revision": expert.Revision, "status": expert.Status})
	writeJSON(w, http.StatusCreated, expert)
}

func (s *Server) updateExpert(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "Authentication is required")
		return
	}
	var input expertMutationInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	expertID := r.PathValue("id")
	var updated *store.Expert
	err := s.store.Update(func(state *store.State) error {
		current := state.Experts[expertID]
		if current == nil {
			return errNotFound("Expert not found")
		}
		if !actor.IsAdmin() && current.OwnerID != actor.Subject {
			return errForbidden("Only the owner or an administrator can update this Expert")
		}
		if input.BaseRevision != current.Revision {
			return errConflict("Expert was updated elsewhere; refresh before saving")
		}
		input.Expert.ID = expertID
		next, err := prepareExpert(input.Expert, current, actor, time.Now().UTC())
		if err != nil {
			return apiError{http.StatusBadRequest, err.Error()}
		}
		state.Experts[expertID] = next
		state.ExpertRevisions[store.ExpertRevisionKey(expertID, next.Revision)] = expertRevision(next, actor)
		updated = next
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "expert.update", expertID, map[string]any{"revision": updated.Revision, "status": updated.Status})
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) submitExpertReview(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "Authentication is required")
		return
	}
	expertID := r.PathValue("id")
	var submitted *store.Expert
	err := s.store.Update(func(state *store.State) error {
		current := state.Experts[expertID]
		if current == nil {
			return errNotFound("Expert not found")
		}
		if !actor.IsAdmin() && current.OwnerID != actor.Subject {
			return errForbidden("Only the owner or an administrator can submit this Expert")
		}
		if current.Visibility == "private" {
			return apiError{http.StatusBadRequest, "Private Experts do not require review"}
		}
		if current.Status == "archived" {
			return errConflict("Archived Experts cannot be submitted for review")
		}
		if current.Review.Status == "pending" {
			submitted = current
			return nil
		}
		now := time.Now().UTC()
		next := *current
		next.Revision++
		next.Status = "draft"
		next.Review = store.ExpertReview{
			Status:      "pending",
			SubmittedBy: actor.Subject,
			SubmittedAt: &now,
		}
		next.UpdatedAt = now
		state.Experts[expertID] = &next
		state.ExpertRevisions[store.ExpertRevisionKey(expertID, next.Revision)] = expertRevision(&next, actor)
		submitted = &next
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "expert.review.submit", expertID, map[string]any{"revision": submitted.Revision})
	writeJSON(w, http.StatusAccepted, submitted)
}

func (s *Server) reviewExpert(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input struct {
		Decision     string `json:"decision"`
		Note         string `json:"note"`
		BaseRevision int    `json:"baseRevision"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	input.Decision = strings.ToLower(strings.TrimSpace(input.Decision))
	input.Note = strings.TrimSpace(input.Note)
	if input.Decision != "approve" && input.Decision != "reject" {
		writeError(w, http.StatusBadRequest, "invalid_decision", "Decision must be approve or reject")
		return
	}
	if input.Decision == "reject" && input.Note == "" {
		writeError(w, http.StatusBadRequest, "review_note_required", "A rejection note is required")
		return
	}
	if len([]rune(input.Note)) > 500 {
		writeError(w, http.StatusBadRequest, "review_note_too_long", "Review note cannot exceed 500 characters")
		return
	}
	actor := auth.FromContext(r.Context())
	expertID := r.PathValue("id")
	var reviewed *store.Expert
	err := s.store.Update(func(state *store.State) error {
		current := state.Experts[expertID]
		if current == nil {
			return errNotFound("Expert not found")
		}
		if input.BaseRevision != current.Revision {
			return errConflict("Expert was updated elsewhere; refresh before reviewing")
		}
		if current.Review.Status != "pending" {
			return errConflict("Only pending Experts can be reviewed")
		}
		now := time.Now().UTC()
		next := *current
		next.Revision++
		if input.Decision == "approve" {
			next.Review.Status = "approved"
		} else {
			next.Review.Status = "rejected"
		}
		next.Review.Note = input.Note
		next.Review.ReviewedBy = actor.Subject
		next.Review.ReviewedAt = &now
		if input.Decision == "approve" {
			next.Status = "enabled"
		} else {
			next.Status = "draft"
		}
		next.UpdatedAt = now
		state.Experts[expertID] = &next
		state.ExpertRevisions[store.ExpertRevisionKey(expertID, next.Revision)] = expertRevision(&next, actor)
		reviewed = &next
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "expert.review."+input.Decision, expertID, map[string]any{"revision": reviewed.Revision, "note": input.Note})
	writeJSON(w, http.StatusOK, reviewed)
}

func (s *Server) setExpertStatus(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input struct {
		Status       string `json:"status"`
		BaseRevision int    `json:"baseRevision"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	input.Status = strings.ToLower(strings.TrimSpace(input.Status))
	if input.Status != "enabled" && input.Status != "disabled" && input.Status != "archived" {
		writeError(w, http.StatusBadRequest, "invalid_status", "Status must be enabled, disabled, or archived")
		return
	}
	actor := auth.FromContext(r.Context())
	expertID := r.PathValue("id")
	var updated *store.Expert
	err := s.store.Update(func(state *store.State) error {
		current := state.Experts[expertID]
		if current == nil {
			return errNotFound("Expert not found")
		}
		if input.BaseRevision != current.Revision {
			return errConflict("Expert was updated elsewhere; refresh before changing status")
		}
		if input.Status == "enabled" && current.Visibility != "private" && current.Review.Status != "approved" {
			return errConflict("Expert must be approved before it can be enabled")
		}
		if current.Status == input.Status {
			updated = current
			return nil
		}
		now := time.Now().UTC()
		next := *current
		next.Revision++
		next.Status = input.Status
		next.UpdatedAt = now
		state.Experts[expertID] = &next
		state.ExpertRevisions[store.ExpertRevisionKey(expertID, next.Revision)] = expertRevision(&next, actor)
		updated = &next
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "expert.status.update", expertID, map[string]any{"revision": updated.Revision, "status": updated.Status})
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) updateExpertDistribution(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input struct {
		store.ExpertDistribution
		BaseRevision int `json:"baseRevision"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	distribution, err := normalizeExpertDistribution(input.ExpertDistribution)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_distribution", err.Error())
		return
	}
	actor := auth.FromContext(r.Context())
	expertID := r.PathValue("id")
	var updated *store.Expert
	err = s.store.Update(func(state *store.State) error {
		current := state.Experts[expertID]
		if current == nil {
			return errNotFound("Expert not found")
		}
		if input.BaseRevision != current.Revision {
			return errConflict("Expert was updated elsewhere; refresh before changing distribution")
		}
		if current.Visibility == "private" {
			return apiError{http.StatusBadRequest, "Private Experts do not support managed distribution"}
		}
		now := time.Now().UTC()
		next := *current
		next.Revision++
		next.Distribution = distribution
		next.UpdatedAt = now
		state.Experts[expertID] = &next
		state.ExpertRevisions[store.ExpertRevisionKey(expertID, next.Revision)] = expertRevision(&next, actor)
		updated = &next
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "expert.distribution.update", expertID, map[string]any{
		"revision": updated.Revision, "mode": distribution.Mode,
		"percentage": distribution.Percentage, "users": len(distribution.UserIDs),
	})
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) rollbackExpert(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	var input struct {
		BaseRevision int `json:"baseRevision"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	targetRevision := parseOffset(r.PathValue("revision"))
	actor := auth.FromContext(r.Context())
	expertID := r.PathValue("id")
	var rolledBack *store.Expert
	err := s.store.Update(func(state *store.State) error {
		current := state.Experts[expertID]
		record := state.ExpertRevisions[store.ExpertRevisionKey(expertID, targetRevision)]
		if current == nil || record == nil {
			return errNotFound("Expert revision not found")
		}
		if input.BaseRevision != current.Revision {
			return errConflict("Expert was updated elsewhere; refresh before rolling back")
		}
		if targetRevision >= current.Revision {
			return errConflict("Rollback target must be older than the current revision")
		}
		now := time.Now().UTC()
		next := record.Snapshot
		next.Revision = current.Revision + 1
		next.OwnerID = current.OwnerID
		next.Owner = current.Owner
		next.OrgID = current.OrgID
		next.Visibility = current.Visibility
		next.Source = current.Source
		next.Distribution = current.Distribution
		next.CreatedAt = current.CreatedAt
		next.UpdatedAt = now
		if next.Visibility == "private" {
			next.Status = "enabled"
			next.Review = store.ExpertReview{Status: "not_required"}
		} else if record.Snapshot.Review.Status == "approved" || (record.Snapshot.Review.Status == "" && record.Snapshot.Status == "enabled") {
			next.Status = "enabled"
			next.Review = store.ExpertReview{
				Status:     "approved",
				Note:       "已回滚至修订 " + r.PathValue("revision"),
				ReviewedBy: actor.Subject,
				ReviewedAt: &now,
			}
		} else {
			next.Status = "draft"
			next.Review = store.ExpertReview{Status: "not_submitted"}
		}
		state.Experts[expertID] = &next
		state.ExpertRevisions[store.ExpertRevisionKey(expertID, next.Revision)] = expertRevision(&next, actor)
		rolledBack = &next
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	s.audit(r, "expert.rollback", expertID, map[string]any{
		"fromRevision": input.BaseRevision, "targetRevision": targetRevision, "revision": rolledBack.Revision,
	})
	writeJSON(w, http.StatusOK, rolledBack)
}

func prepareExpert(input store.Expert, current *store.Expert, actor auth.Actor, now time.Time) (*store.Expert, error) {
	input.ID = strings.ToLower(strings.TrimSpace(input.ID))
	input.Name = strings.TrimSpace(input.Name)
	input.Version = strings.TrimSpace(input.Version)
	input.Instruction = strings.TrimSpace(input.Instruction)
	if !expertIDPattern.MatchString(input.ID) {
		return nil, errors.New("id must be 3-128 lowercase letters, numbers, dots, underscores, or hyphens")
	}
	if input.Name == "" || len([]rune(input.Name)) > 120 {
		return nil, errors.New("name must be 1-120 characters")
	}
	if input.Version == "" || len(input.Version) > 64 {
		return nil, errors.New("version is required and must not exceed 64 characters")
	}
	if input.Instruction == "" || len([]rune(input.Instruction)) > 64000 {
		return nil, errors.New("instruction must be 1-64000 characters")
	}
	switch input.Status {
	case "draft", "enabled", "disabled", "archived":
	default:
		input.Status = "draft"
	}
	switch input.Visibility {
	case "private", "organization", "public":
	default:
		input.Visibility = "private"
	}
	if !actor.IsAdmin() && input.Visibility != "private" {
		return nil, errors.New("only an administrator can publish organization or system Experts")
	}
	if input.Visibility == "organization" && actor.OrgID == "" {
		return nil, errors.New("organization visibility requires an organization")
	}
	if input.Distribution.Mode == "" && current != nil {
		input.Distribution = current.Distribution
	}
	distribution, err := normalizeExpertDistribution(input.Distribution)
	if err != nil {
		return nil, err
	}
	input.Distribution = distribution
	if input.Visibility == "private" {
		input.Review = store.ExpertReview{Status: "not_required"}
		input.Distribution = store.ExpertDistribution{Mode: "all", Percentage: 100}
	} else {
		input.Status = "draft"
		input.Review = store.ExpertReview{Status: "not_submitted"}
	}
	if input.DefaultWorkMode != "ask" && input.DefaultWorkMode != "plan" && input.DefaultWorkMode != "execute" {
		input.DefaultWorkMode = "execute"
	}
	if input.PermissionProfile == "" {
		input.PermissionProfile = "artifact-approval"
	}
	if input.ModelPolicy == "" {
		input.ModelPolicy = "inherit"
	}
	input.APIVersion = "meteomate.ai/v1"
	input.Kind = "Expert"
	input.OwnerID = actor.Subject
	input.Owner = firstNonEmpty(actor.Name, actor.Subject)
	input.OrgID = actor.OrgID
	input.Source = store.ExpertSource{Type: expertSourceType(input.Visibility), RemoteID: input.ID}
	input.Tags = unique(input.Tags)
	input.Methodology = unique(input.Methodology)
	input.Workflow = unique(input.Workflow)
	input.Limitations = unique(input.Limitations)
	input.Inputs = unique(input.Inputs)
	input.Outputs = unique(input.Outputs)
	input.Prompts = unique(input.Prompts)
	input.RequiredSkills = unique(input.RequiredSkills)
	input.RecommendedSkills = without(input.RecommendedSkills, set(input.RequiredSkills))
	input.RequiredConnectors = unique(input.RequiredConnectors)
	input.RecommendedConnectors = without(input.RecommendedConnectors, set(input.RequiredConnectors))
	input.ToolSelections = normalizeExpertToolSelections(input.ToolSelections, append(input.RequiredConnectors, input.RecommendedConnectors...))
	input.UpdatedAt = now
	if current == nil {
		input.Revision = 1
		input.CreatedAt = now
	} else {
		input.Revision = current.Revision + 1
		input.CreatedAt = current.CreatedAt
		input.OwnerID = current.OwnerID
		input.Owner = current.Owner
		input.OrgID = current.OrgID
		input.Source = current.Source
		if actor.IsAdmin() {
			input.Source = store.ExpertSource{Type: expertSourceType(input.Visibility), RemoteID: input.ID}
		}
	}
	return &input, nil
}

func expertRevision(expert *store.Expert, actor auth.Actor) *store.ExpertRevision {
	return &store.ExpertRevision{
		ExpertID: expert.ID, Revision: expert.Revision, Version: expert.Version,
		Snapshot: *expert, CreatedBy: actor.Subject, CreatedAt: expert.UpdatedAt,
	}
}

func canViewExpert(actor auth.Actor, expert *store.Expert) bool {
	if expert == nil {
		return false
	}
	if canManageExpert(actor, expert) {
		return true
	}
	if expert.Status != "enabled" || !expertInDistribution(actor, expert) {
		return false
	}
	switch expert.Visibility {
	case "public":
		return true
	case "organization":
		return actor.Authenticated() && actor.OrgID != "" && actor.OrgID == expert.OrgID
	default:
		return false
	}
}

func canManageExpert(actor auth.Actor, expert *store.Expert) bool {
	return expert != nil && (actor.IsAdmin() || actor.Subject == expert.OwnerID)
}

func expertInDistribution(actor auth.Actor, expert *store.Expert) bool {
	switch expert.Distribution.Mode {
	case "", "all":
		return true
	case "percentage":
		if !actor.Authenticated() || expert.Distribution.Percentage <= 0 {
			return false
		}
		hasher := fnv.New32a()
		_, _ = hasher.Write([]byte(expert.ID + "\x00" + actor.Subject))
		return int(hasher.Sum32()%100) < expert.Distribution.Percentage
	case "allowlist":
		for _, userID := range expert.Distribution.UserIDs {
			if actor.Subject == userID {
				return true
			}
		}
	}
	return false
}

func normalizeExpertDistribution(input store.ExpertDistribution) (store.ExpertDistribution, error) {
	input.Mode = strings.ToLower(strings.TrimSpace(input.Mode))
	input.UserIDs = unique(input.UserIDs)
	switch input.Mode {
	case "", "all":
		return store.ExpertDistribution{Mode: "all", Percentage: 100}, nil
	case "percentage":
		if input.Percentage < 1 || input.Percentage > 100 {
			return store.ExpertDistribution{}, errors.New("distribution percentage must be between 1 and 100")
		}
		return store.ExpertDistribution{Mode: "percentage", Percentage: input.Percentage}, nil
	case "allowlist":
		if len(input.UserIDs) == 0 {
			return store.ExpertDistribution{}, errors.New("allowlist distribution requires at least one user")
		}
		return store.ExpertDistribution{Mode: "allowlist", UserIDs: input.UserIDs}, nil
	default:
		return store.ExpertDistribution{}, errors.New("distribution mode must be all, percentage, or allowlist")
	}
}

func expertSourceType(visibility string) string {
	switch visibility {
	case "organization":
		return "organization"
	case "public":
		return "system"
	default:
		return "user"
	}
}

func expertSourceRank(source string) int {
	switch source {
	case "system":
		return 0
	case "organization":
		return 1
	default:
		return 2
	}
}

func normalizeExpertToolSelections(value map[string][]string, connectorIDs []string) map[string][]string {
	allowed := set(connectorIDs)
	result := map[string][]string{}
	for connectorID, toolNames := range value {
		if allowed[connectorID] {
			result[connectorID] = unique(toolNames)
		}
	}
	return result
}

func without(values []string, excluded map[string]bool) []string {
	result := []string{}
	for _, value := range unique(values) {
		if !excluded[value] {
			result = append(result, value)
		}
	}
	return result
}
