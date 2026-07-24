package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

func TestSeedDirectoryRejectsChangedPublishedVersion(t *testing.T) {
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
	seedRoot := filepath.Join(root, "bundled-skills")
	skillRoot := filepath.Join(seedRoot, "seed-weather")
	if err := os.MkdirAll(skillRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	writeSkill := func(description string) {
		t.Helper()
		skill := "---\nname: seed-weather\ndescription: " + description + "\n---\n\n# Workflow\n\nVerify the result.\n"
		if err := os.WriteFile(filepath.Join(skillRoot, "SKILL.md"), []byte(skill), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(skillRoot, "meteomate.json"), []byte(`{"displayName":"Seed Weather","version":"1.0.0","icon":"天","categories":["天气分析"],"tags":["天气"]}`), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	writeSkill("First published package used for seed validation.")
	if err := server.SeedDirectory(seedRoot); err != nil {
		t.Fatal(err)
	}
	if err := server.SeedDirectory(seedRoot); err != nil {
		t.Fatalf("unchanged seed should be idempotent: %v", err)
	}
	writeSkill("Changed package content without a version bump.")
	if err := server.SeedDirectory(seedRoot); err == nil || !strings.Contains(err.Error(), "bump the Skill version") {
		t.Fatalf("expected immutable version error, got %v", err)
	}
}
