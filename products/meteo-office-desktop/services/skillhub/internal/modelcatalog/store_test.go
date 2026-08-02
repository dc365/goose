package modelcatalog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestCatalogPersistenceAndSecretBoundary(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	provider, err := store.Put("doubao", ProviderInput{
		Name: "豆包", Enabled: true, PresetMode: "volcengine-ark", Protocol: "responses",
		StreamingMode: "off", BaseURL: "https://ark.cn-beijing.volces.com/api/v3/",
		RequiresAuth: true, CredentialMode: "secret_ref", SecretRef: "vault://meteomate/doubao",
		Models: []Model{{
			ID: "doubao-seed-2-1-pro", Name: "Doubao Seed 2.1 Pro", Enabled: true,
			ToolCall: true, ImageInput: true, Reasoning: true, ContextLimit: 256000, MaxOutputTokens: 32000,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if provider.BaseURL != "https://ark.cn-beijing.volces.com/api/v3" || provider.Revision != 1 {
		t.Fatalf("provider was not normalized: %+v", provider)
	}
	verified, err := store.RecordVerification("doubao", "admin", VerificationReport{
		ModelID: "doubao-seed-2-1-pro", Status: "verified", Message: "Responses 非流式验证通过",
		Checks: []VerificationCheck{{ID: "text", Status: "passed"}, {ID: "tool_call", Status: "passed"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if verified.Models[0].Verification.Status != "verified" || verified.Verification.CheckedBy != "admin" {
		t.Fatalf("verification was not recorded: %+v", verified)
	}

	publicJSON, err := json.Marshal(store.PublicCatalog())
	if err != nil {
		t.Fatal(err)
	}
	if string(publicJSON) == "" || containsText(string(publicJSON), "vault://") {
		t.Fatalf("public catalog exposed a secret reference: %s", publicJSON)
	}
	if !store.PublicCatalog().Providers[0].CredentialConfigured {
		t.Fatal("public catalog did not report configured credential metadata")
	}

	reopened, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	restored := reopened.Snapshot().Providers["doubao"]
	if restored == nil || restored.SecretRef != "vault://meteomate/doubao" || restored.Models[0].Verification.Status != "verified" {
		t.Fatalf("catalog did not persist: %+v", restored)
	}
	info, err := os.Stat(filepath.Join(root, "model-catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("catalog file permissions are %o", info.Mode().Perm())
	}
}

func TestCatalogRejectsPlaintextCredentialsAndInvalidTransport(t *testing.T) {
	store := NewMemory()
	base := ProviderInput{
		Name: "单位网关", Enabled: true, PresetMode: "openai-compatible", Protocol: "chat_completions",
		StreamingMode: "on", BaseURL: "https://llm.example.test/v1", RequiresAuth: true,
		CredentialMode: "secret_ref", SecretRef: "sk-plaintext",
		Models: []Model{{ID: "weather-pro", Enabled: true}},
	}
	if _, err := store.Put("unit-gateway", base); err == nil {
		t.Fatal("catalog accepted a plaintext credential")
	}
	base.SecretRef = "env://UNIT_LLM_KEY"
	base.BaseURL = "https://user:password@llm.example.test/v1"
	if _, err := store.Put("unit-gateway", base); err == nil {
		t.Fatal("catalog accepted credentials in baseUrl")
	}
	base.BaseURL = "https://llm.example.test/v1"
	base.Protocol = "completions"
	if _, err := store.Put("unit-gateway", base); err == nil {
		t.Fatal("catalog accepted an unsupported protocol")
	}
}

func containsText(value, target string) bool {
	for index := 0; index+len(target) <= len(value); index++ {
		if value[index:index+len(target)] == target {
			return true
		}
	}
	return false
}
