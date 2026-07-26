package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

func TestSeedExpertsFileCreatesAndUpdatesSystemExperts(t *testing.T) {
	root := t.TempDir()
	dataStore, err := store.Open(filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	signer, err := trust.OpenOrCreate(filepath.Join(root, "trust"))
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{Store: dataStore, Signer: signer, Authenticator: auth.New(nil)})
	if err != nil {
		t.Fatal(err)
	}
	if err := dataStore.Update(func(state *store.State) error {
		state.Skills["synoptic-analysis"] = &store.Skill{
			ID:            "synoptic-analysis",
			Name:          "Synoptic Analysis",
			Status:        "published",
			LatestVersion: "1.0.0",
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	filename := filepath.Join(root, "experts.json")
	writeExperts := func(version, description string, skills []string) {
		t.Helper()
		data, err := json.Marshal([]store.Expert{{
			ID:                "synoptic-expert",
			Name:              "Synoptic Expert",
			Version:           version,
			Status:            "enabled",
			Visibility:        "public",
			Description:       description,
			Instruction:       "Analyze the evidence before drawing a conclusion.",
			RecommendedSkills: skills,
		}})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, data, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	writeExperts("1.0.0", "Initial definition", []string{"synoptic-analysis"})
	if err := server.SeedExpertsFile(filename); err != nil {
		t.Fatal(err)
	}
	expert := dataStore.Snapshot().Experts["synoptic-expert"]
	if expert == nil || expert.Source.Type != "system" || expert.Status != "enabled" || expert.Revision != 1 {
		t.Fatalf("unexpected seeded Expert: %+v", expert)
	}
	if err := server.SeedExpertsFile(filename); err != nil {
		t.Fatalf("unchanged Expert seed should be idempotent: %v", err)
	}
	if revision := dataStore.Snapshot().Experts["synoptic-expert"].Revision; revision != 1 {
		t.Fatalf("idempotent seed created a revision: %d", revision)
	}

	writeExperts("1.1.0", "Updated definition", []string{"synoptic-analysis"})
	if err := server.SeedExpertsFile(filename); err != nil {
		t.Fatal(err)
	}
	expert = dataStore.Snapshot().Experts["synoptic-expert"]
	if expert.Version != "1.1.0" || expert.Description != "Updated definition" || expert.Revision != 2 {
		t.Fatalf("newer seed did not update the system Expert: %+v", expert)
	}
}

func TestSeedExpertsFileRejectsUnknownSkills(t *testing.T) {
	root := t.TempDir()
	dataStore, err := store.Open(filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	signer, err := trust.OpenOrCreate(filepath.Join(root, "trust"))
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{Store: dataStore, Signer: signer, Authenticator: auth.New(nil)})
	if err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(root, "experts.json")
	data, err := json.Marshal([]store.Expert{{
		ID:                "missing-skill-expert",
		Name:              "Missing Skill Expert",
		Version:           "1.0.0",
		Visibility:        "public",
		Instruction:       "Use only available capabilities.",
		RecommendedSkills: []string{"missing-skill"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filename, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := server.SeedExpertsFile(filename); err == nil || !strings.Contains(err.Error(), "Skill missing-skill is not published") {
		t.Fatalf("expected unknown Skill validation error, got %v", err)
	}
}
