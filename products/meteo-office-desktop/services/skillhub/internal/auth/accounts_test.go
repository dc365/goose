package auth

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestAccountStorePersistsHashedPasswords(t *testing.T) {
	root := filepath.Join(t.TempDir(), "auth")
	store, err := OpenAccountStore(root)
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(CreateUserInput{
		Username: "Forecaster.One", DisplayName: "预报员一", Password: "weather-2026", Role: "publisher",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Username != "forecaster.one" || created.DefaultSpaceID != "personal:"+created.ID {
		t.Fatalf("unexpected public user: %+v", created)
	}
	verified, err := store.Verify("forecaster.one", "weather-2026")
	if err != nil || verified.ID != created.ID {
		t.Fatalf("verify failed: %+v %v", verified, err)
	}
	if _, err := store.Verify("forecaster.one", "wrong-password"); err == nil {
		t.Fatal("wrong password was accepted")
	}
	reopened, err := OpenAccountStore(root)
	if err != nil {
		t.Fatal(err)
	}
	stored, ok := reopened.Get(created.ID)
	if !ok || !strings.HasPrefix(stored.PasswordHash, "$argon2id$") || strings.Contains(stored.PasswordHash, "weather-2026") {
		t.Fatalf("password was not stored as Argon2id: %+v", stored)
	}
	encoded, _ := json.Marshal(created)
	if strings.Contains(string(encoded), "password") {
		t.Fatalf("public user exposes password fields: %s", encoded)
	}
}

func TestAccountStoreProtectsLastActiveAdministrator(t *testing.T) {
	store, err := OpenAccountStore(filepath.Join(t.TempDir(), "auth"))
	if err != nil {
		t.Fatal(err)
	}
	admin, err := store.Create(CreateUserInput{
		Username: "admin.one", DisplayName: "系统管理员", Password: "admin-password-2026", Role: "admin",
	})
	if err != nil {
		t.Fatal(err)
	}
	disabled := "disabled"
	if _, err := store.Update(admin.ID, UpdateUserInput{Status: &disabled}); !errors.Is(err, ErrLastActiveAdmin) {
		t.Fatalf("last administrator was disabled: %v", err)
	}
	viewer := "viewer"
	if _, err := store.Update(admin.ID, UpdateUserInput{Role: &viewer}); !errors.Is(err, ErrLastActiveAdmin) {
		t.Fatalf("last administrator was demoted: %v", err)
	}
	if _, err := store.Create(CreateUserInput{
		Username: "admin.two", DisplayName: "备用管理员", Password: "backup-admin-2026", Role: "admin",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Update(admin.ID, UpdateUserInput{Status: &disabled}); err != nil {
		t.Fatalf("administrator was not disabled after adding a replacement: %v", err)
	}
}
