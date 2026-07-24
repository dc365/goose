package api

import (
	"fmt"
	"os"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/skillpkg"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

func (s *Server) SeedDirectory(root string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		directory := root + string(os.PathSeparator) + entry.Name()
		data, err := skillpkg.ZipDirectory(directory)
		if err != nil {
			return fmt.Errorf("zip %s: %w", entry.Name(), err)
		}
		report, err := skillpkg.InspectZIP(data, skillpkg.DefaultLimits())
		if err != nil {
			return fmt.Errorf("inspect %s: %w", entry.Name(), err)
		}
		digest, _, err := s.store.PutPackage(data)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		categories := stringSlice(report.Sidecar["categories"])
		tags := stringSlice(report.Sidecar["tags"])
		icon, _ := report.Sidecar["icon"].(string)
		err = s.store.Update(func(state *store.State) error {
			key := store.VersionKey(report.Skill.ID, report.Skill.Version)
			if existing := state.SkillVersions[key]; existing != nil {
				if existing.PackageDigest != digest {
					return fmt.Errorf("seed %s content differs from published %s; bump the Skill version", entry.Name(), key)
				}
				if skill := state.Skills[report.Skill.ID]; skill != nil && skill.OwnerID == "meteomate" && skill.LatestVersion == report.Skill.Version {
					skill.Name = report.Skill.DisplayName
					skill.Summary = report.Skill.Description
					skill.Description = report.Skill.Description
					skill.Categories = categories
					skill.Tags = tags
					skill.Icon = icon
					skill.UpdatedAt = now
				}
				return nil
			}
			skill := state.Skills[report.Skill.ID]
			if skill == nil {
				skill = &store.Skill{ID: report.Skill.ID, Name: report.Skill.DisplayName, Summary: report.Skill.Description, Description: report.Skill.Description,
					Categories: categories, Tags: tags, Icon: icon, Publisher: store.Publisher{ID: "meteomate", Name: "MeteoMate"},
					OwnerID: "meteomate", Visibility: "public", Status: "published", Featured: true, Versions: []string{}, CreatedAt: now, UpdatedAt: now}
				state.Skills[skill.ID] = skill
			}
			signature := &store.Signature{Algorithm: "ed25519", KeyID: s.signer.KeyID(), Value: s.signer.Sign(trust.Message(report.Skill.ID, report.Skill.Version, digest))}
			publishedAt := now
			version := &store.SkillVersion{SkillID: report.Skill.ID, Version: report.Skill.Version, Status: "published", PackageDigest: digest, PackageSize: int64(len(data)),
				Integrity: report.Integrity, Manifest: report.Skill, Sidecar: report.Sidecar, Files: report.Files, Risk: report.Risk, Warnings: report.Warnings,
				Signature: signature, CreatedBy: "meteomate", CreatedAt: now, PublishedAt: &publishedAt}
			state.SkillVersions[key] = version
			skill.Versions = append(skill.Versions, report.Skill.Version)
			if skill.LatestVersion == "" || semverCompare(report.Skill.Version, skill.LatestVersion) >= 0 {
				skill.LatestVersion = report.Skill.Version
				skill.Name = report.Skill.DisplayName
				skill.Summary = report.Skill.Description
				skill.Description = report.Skill.Description
				skill.Categories = categories
				skill.Tags = tags
				skill.Icon = icon
			}
			skill.UpdatedAt = now
			return nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}
