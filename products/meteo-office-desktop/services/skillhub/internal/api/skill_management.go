package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

type updateSkillInput struct {
	Name        *string   `json:"name"`
	Summary     *string   `json:"summary"`
	Description *string   `json:"description"`
	Categories  *[]string `json:"categories"`
	Tags        *[]string `json:"tags"`
	Icon        *string   `json:"icon"`
	Visibility  *string   `json:"visibility"`
	OwnerID     *string   `json:"ownerId"`
}

func (s *Server) updateSkill(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.CanPublish() {
		writeError(w, http.StatusForbidden, "publisher_required", "Publisher or administrator access is required")
		return
	}
	var input updateSkillInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if err := validateSkillUpdate(input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_skill_update", err.Error())
		return
	}

	var nextOwner *auth.User
	if input.OwnerID != nil {
		if !actor.IsAdmin() {
			writeError(w, http.StatusForbidden, "administrator_required", "Only an administrator can transfer Skill ownership")
			return
		}
		accounts := s.auth.Accounts()
		if accounts == nil {
			writeError(w, http.StatusConflict, "managed_accounts_required", "Ownership transfer requires managed user accounts")
			return
		}
		owner, ok := accounts.Get(strings.TrimSpace(*input.OwnerID))
		if !ok || owner.Status != "active" || (owner.Role != "publisher" && owner.Role != "admin") {
			writeError(w, http.StatusBadRequest, "invalid_owner", "The new owner must be an active publisher or administrator")
			return
		}
		nextOwner = &owner
	}

	skillID := r.PathValue("id")
	var updated *store.Skill
	previousOwner := ""
	err := s.store.Update(func(state *store.State) error {
		skill := state.Skills[skillID]
		if skill == nil {
			return errNotFound("Skill not found")
		}
		if !actor.IsAdmin() && skill.OwnerID != actor.Subject {
			return errForbidden("Only the owner or an administrator can update this Skill")
		}
		previousOwner = skill.OwnerID
		if input.Name != nil {
			skill.Name = strings.TrimSpace(*input.Name)
		}
		if input.Summary != nil {
			skill.Summary = strings.TrimSpace(*input.Summary)
		}
		if input.Description != nil {
			skill.Description = strings.TrimSpace(*input.Description)
		}
		if input.Categories != nil {
			skill.Categories = unique(*input.Categories)
		}
		if input.Tags != nil {
			skill.Tags = unique(*input.Tags)
		}
		if input.Icon != nil {
			skill.Icon = strings.TrimSpace(*input.Icon)
		}
		if input.Visibility != nil {
			skill.Visibility = *input.Visibility
		}
		if nextOwner != nil {
			skill.OwnerID = nextOwner.ID
			skill.OrgID = nextOwner.OrgID
			skill.Publisher = store.Publisher{ID: nextOwner.ID, Name: nextOwner.DisplayName, OrgID: nextOwner.OrgID}
		}
		if skill.Visibility == "organization" && skill.OrgID == "" {
			return apiError{http.StatusBadRequest, "organization visibility requires an owner with an organization"}
		}
		skill.UpdatedAt = time.Now().UTC()
		updated = skill
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	detail := map[string]any{"visibility": updated.Visibility}
	if previousOwner != updated.OwnerID {
		detail["previousOwnerId"] = previousOwner
		detail["ownerId"] = updated.OwnerID
		s.audit(r, "skill.owner.transfer", skillID, detail)
	} else {
		s.audit(r, "skill.update", skillID, detail)
	}
	writeJSON(w, http.StatusOK, updated)
}

func validateSkillUpdate(input updateSkillInput) error {
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" || len([]rune(name)) > 120 {
			return errors.New("name must be 1-120 characters")
		}
	}
	if input.Summary != nil && len([]rune(strings.TrimSpace(*input.Summary))) > 300 {
		return errors.New("summary must be at most 300 characters")
	}
	if input.Description != nil && len([]rune(strings.TrimSpace(*input.Description))) > 4000 {
		return errors.New("description must be at most 4000 characters")
	}
	if input.Icon != nil && len([]rune(strings.TrimSpace(*input.Icon))) > 16 {
		return errors.New("icon must be at most 16 characters")
	}
	if input.Visibility != nil {
		switch *input.Visibility {
		case "private", "organization", "public":
		default:
			return errors.New("visibility must be private, organization, or public")
		}
	}
	if input.Categories != nil && len(unique(*input.Categories)) > 12 {
		return errors.New("categories must contain at most 12 values")
	}
	if input.Tags != nil && len(unique(*input.Tags)) > 24 {
		return errors.New("tags must contain at most 24 values")
	}
	return nil
}
