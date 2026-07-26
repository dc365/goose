package api

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

func (s *Server) SeedExpertsFile(filename string) error {
	data, err := os.ReadFile(filename)
	if err != nil {
		return err
	}
	var seeds []store.Expert
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("decode Expert seed: %w", err)
	}
	if len(seeds) == 0 {
		return fmt.Errorf("Expert seed is empty")
	}

	now := time.Now().UTC()
	actor := auth.Actor{Subject: "meteomate", Name: "MeteoMate", Role: "admin"}
	return s.store.Update(func(state *store.State) error {
		for _, seed := range seeds {
			current := state.Experts[seed.ID]
			if current != nil {
				if current.Source.Type != "system" {
					return fmt.Errorf("seed Expert %s conflicts with a managed Expert", seed.ID)
				}
				if semverCompare(seed.Version, current.Version) <= 0 {
					continue
				}
			}

			prepared, err := prepareExpert(seed, current, actor, now)
			if err != nil {
				return fmt.Errorf("prepare seed Expert %s: %w", seed.ID, err)
			}
			if err := validateExpertSkills(state, prepared); err != nil {
				return fmt.Errorf("seed Expert %s: %w", seed.ID, err)
			}
			prepared.Status = "enabled"
			prepared.Visibility = "public"
			prepared.Owner = "MeteoMate"
			prepared.OwnerID = "meteomate"
			prepared.Source = store.ExpertSource{Type: "system", RemoteID: prepared.ID}
			prepared.Review = store.ExpertReview{Status: "approved", Note: "MeteoMate 内置专家", ReviewedBy: "meteomate", ReviewedAt: &now}
			prepared.Distribution = store.ExpertDistribution{Mode: "all", Percentage: 100}
			state.Experts[prepared.ID] = prepared
			state.ExpertRevisions[store.ExpertRevisionKey(prepared.ID, prepared.Revision)] = expertRevision(prepared, actor)
		}
		return nil
	})
}

func validateExpertSkills(state *store.State, expert *store.Expert) error {
	for _, skillID := range append(expert.RequiredSkills, expert.RecommendedSkills...) {
		skill := state.Skills[skillID]
		if skill == nil || skill.Status != "published" || skill.LatestVersion == "" {
			return fmt.Errorf("Skill %s is not published", skillID)
		}
	}
	return nil
}
