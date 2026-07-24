package policy

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestPolicyPrecedenceAndPersistence(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "policy"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.SetOrganization(Settings{
		DefaultModel:                "goose/gpt-5.5",
		AllowedModels:               []string{"goose/gpt-5.5", "goose/gpt-5.5-mini"},
		DefaultSkillIDs:             []string{"forecast-writing"},
		AllowedConnectorIDs:         []string{"weather-data"},
		DefaultPermissionProfileID:  "artifact-approval",
		AllowedPermissionProfileIDs: []string{"analysis-readonly", "artifact-approval"},
		AutoCompactThreshold:        0.82,
	})
	if err != nil {
		t.Fatal(err)
	}
	roleModels := []string{"goose/gpt-5.5-mini"}
	roleDefault := "goose/gpt-5.5-mini"
	rolePermission := "analysis-readonly"
	roleThreshold := 0.75
	if _, err := store.SetRole("viewer", Patch{
		AllowedModels: &roleModels, DefaultModel: &roleDefault, DefaultPermissionProfileID: &rolePermission,
		AutoCompactThreshold: &roleThreshold,
	}); err != nil {
		t.Fatal(err)
	}
	userSkills := []string{"forecast-writing", "synoptic-analysis"}
	if _, err := store.SetUser("usr-one", Patch{DefaultSkillIDs: &userSkills}); err != nil {
		t.Fatal(err)
	}

	effective := store.Effective("usr-one", "viewer")
	if effective.DefaultModel != roleDefault || effective.DefaultPermissionProfileID != rolePermission || effective.AutoCompactThreshold != roleThreshold {
		t.Fatalf("role policy was not applied: %+v", effective)
	}
	if !reflect.DeepEqual(effective.DefaultSkillIDs, []string{"forecast-writing", "synoptic-analysis"}) {
		t.Fatalf("user policy was not applied: %+v", effective.DefaultSkillIDs)
	}
	if effective.Sources["defaultSkillIds"] != "user:usr-one" || effective.Sources["allowedConnectorIds"] != "organization" {
		t.Fatalf("policy sources are incorrect: %+v", effective.Sources)
	}

	reopened, err := Open(filepath.Join(filepath.Dir(store.path), "."))
	if err != nil {
		t.Fatal(err)
	}
	restored := reopened.Effective("usr-one", "viewer")
	if !reflect.DeepEqual(restored.Settings, effective.Settings) {
		t.Fatalf("persisted policy changed: got %+v want %+v", restored.Settings, effective.Settings)
	}
}

func TestPolicyValidationAndFallback(t *testing.T) {
	store := NewMemory()
	invalidThreshold := 0.49
	if _, err := store.SetRole("viewer", Patch{AutoCompactThreshold: &invalidThreshold}); err == nil {
		t.Fatal("policy accepted an automatic compaction threshold below the safe range")
	}
	if _, err := store.SetOrganization(Settings{
		DefaultModel:  "goose/blocked",
		AllowedModels: []string{"goose/allowed"},
	}); err == nil {
		t.Fatal("organization accepted a default model outside the allowlist")
	}
	if _, err := store.SetOrganization(Settings{
		DefaultSkillIDs: []string{"blocked-skill"},
		AllowedSkillIDs: []string{"approved-skill"},
	}); err == nil {
		t.Fatal("organization accepted a default Skill outside the allowlist")
	}
	if _, err := store.SetOrganization(Settings{SkillPublishMode: "automatic"}); err == nil {
		t.Fatal("organization accepted an unsupported Skill publication mode")
	}
	unsupported := []string{"trusted-workspace"}
	if _, err := store.SetRole("viewer", Patch{AllowedPermissionProfileIDs: &unsupported}); err == nil {
		t.Fatal("policy accepted an unsupported permission profile")
	}
	allowed := []string{"goose/allowed"}
	if _, err := store.SetOrganization(Settings{AllowedModels: allowed}); err != nil {
		t.Fatal(err)
	}
	blockedDefault := "goose/blocked"
	if _, err := store.SetUser("usr-one", Patch{DefaultModel: &blockedDefault}); err != nil {
		t.Fatal(err)
	}
	effective := store.Effective("usr-one", "viewer")
	if effective.DefaultModel != "" || effective.Sources["defaultModel"] != "policy-fallback" {
		t.Fatalf("invalid inherited default was not neutralized: %+v", effective)
	}
	allowedSkills := []string{"approved-skill"}
	defaultSkills := []string{"approved-skill", "blocked-skill"}
	if _, err := store.SetRole("viewer", Patch{AllowedSkillIDs: &allowedSkills, DefaultSkillIDs: &defaultSkills}); err != nil {
		t.Fatal(err)
	}
	effective = store.Effective("usr-one", "viewer")
	if !reflect.DeepEqual(effective.DefaultSkillIDs, []string{"approved-skill"}) || effective.Sources["defaultSkillIds"] != "policy-fallback" {
		t.Fatalf("default Skills were not constrained by the allowlist: %+v", effective)
	}
}
