package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/modelcatalog"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/policy"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

func newModelCatalogTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	root := t.TempDir()
	dataStore, err := store.Open(filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	signer, err := trust.OpenOrCreate(filepath.Join(root, "trust"))
	if err != nil {
		t.Fatal(err)
	}
	accounts, err := auth.OpenAccountStore(filepath.Join(root, "accounts"))
	if err != nil {
		t.Fatal(err)
	}
	authenticator := auth.NewWithAccounts(map[string]auth.Actor{
		"admin-token":  {Subject: "admin", Name: "Admin", Role: "admin", OrgID: "org-1"},
		"viewer-token": {Subject: "viewer", Name: "Viewer", Role: "viewer", OrgID: "org-1"},
	}, accounts, time.Hour)
	server, err := New(Config{
		Store: dataStore, Signer: signer, Authenticator: authenticator,
		Policies: policy.NewMemory(), ModelCatalog: modelcatalog.NewMemory(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(server.Handler())
}

func TestModelCatalogGovernanceAndPublicSecretBoundary(t *testing.T) {
	server := newModelCatalogTestServer(t)
	defer server.Close()

	provider := `{
		"name":"豆包","description":"组织统一登记的火山方舟连接","enabled":true,
		"presetMode":"volcengine-ark","protocol":"responses","streamingMode":"off",
		"baseUrl":"https://ark.cn-beijing.volces.com/api/v3","endpointPath":"api/v3/responses",
		"requiresAuth":true,"credentialMode":"secret_ref","secretRef":"vault://meteomate/doubao",
		"models":[{"id":"doubao-seed-2-1-pro","name":"Doubao Seed 2.1 Pro","enabled":true,"toolCall":true,"imageInput":true,"reasoning":true,"contextLimit":256000,"maxOutputTokens":32000}]
	}`
	resp := post(t, http.MethodPut, server.URL+"/v1/admin/model-providers/doubao", "viewer-token", strings.NewReader(provider))
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer changed model catalog: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodPut, server.URL+"/v1/admin/model-providers/doubao", "admin-token", strings.NewReader(provider))
	adminPayload, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(adminPayload), "vault://meteomate/doubao") {
		t.Fatalf("administrator provider update: %d %s", resp.StatusCode, adminPayload)
	}

	verification := `{"modelId":"doubao-seed-2-1-pro","status":"verified","message":"Responses 与工具调用通过","checks":[{"id":"text","status":"passed"},{"id":"tool_call","status":"passed"}]}`
	resp = post(t, http.MethodPost, server.URL+"/v1/admin/model-providers/doubao/verification", "admin-token", strings.NewReader(verification))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("verification report status: %d", resp.StatusCode)
	}

	settings := `{"defaultModel":"doubao/doubao-seed-2-1-pro","allowedModels":["doubao/doubao-seed-2-1-pro"],"allowedProviderIds":["doubao"],"requireVerifiedModels":true,"autoCompactThreshold":0.8}`
	resp = post(t, http.MethodPut, server.URL+"/v1/admin/policies/organization", "admin-token", strings.NewReader(settings))
	policyPayload, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("model policy update: %d %s", resp.StatusCode, policyPayload)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/me/model-catalog", "viewer-token", nil)
	publicPayload, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("public catalog status: %d %s", resp.StatusCode, publicPayload)
	}
	if strings.Contains(string(publicPayload), "vault://") || strings.Contains(string(publicPayload), "secretRef") {
		t.Fatalf("public catalog exposed secret reference: %s", publicPayload)
	}
	var catalog modelcatalog.PublicCatalog
	if err := json.Unmarshal(publicPayload, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Providers) != 1 || len(catalog.Providers[0].Models) != 1 || !catalog.Providers[0].CredentialConfigured {
		t.Fatalf("filtered public catalog is incomplete: %+v", catalog)
	}

	resp = post(t, http.MethodDelete, server.URL+"/v1/admin/model-providers/doubao", "admin-token", nil)
	deletePayload, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict || !strings.Contains(string(deletePayload), "策略") {
		t.Fatalf("referenced provider deletion was not blocked: %d %s", resp.StatusCode, deletePayload)
	}
}

func TestPolicyRejectsUnknownCatalogModel(t *testing.T) {
	server := newModelCatalogTestServer(t)
	defer server.Close()
	provider := `{"name":"单位模型","enabled":true,"presetMode":"openai-compatible","protocol":"chat_completions","streamingMode":"on","baseUrl":"https://llm.example.test/v1","requiresAuth":true,"credentialMode":"local","models":[{"id":"weather-pro","enabled":true}]}`
	resp := post(t, http.MethodPut, server.URL+"/v1/admin/model-providers/unit", "admin-token", strings.NewReader(provider))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("provider setup: %d", resp.StatusCode)
	}
	settings := `{"defaultModel":"unit/missing","allowedModels":["unit/missing"],"allowedProviderIds":["unit"],"autoCompactThreshold":0.8}`
	resp = post(t, http.MethodPut, server.URL+"/v1/admin/policies/organization", "admin-token", strings.NewReader(settings))
	payload, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(payload), "不存在") {
		t.Fatalf("unknown catalog model was accepted: %d %s", resp.StatusCode, payload)
	}
}

func TestRolePolicyInheritsVerifiedModelRequirement(t *testing.T) {
	server := newModelCatalogTestServer(t)
	defer server.Close()
	provider := `{"name":"单位模型","enabled":true,"presetMode":"openai-compatible","protocol":"chat_completions","streamingMode":"on","baseUrl":"https://llm.example.test/v1","requiresAuth":true,"credentialMode":"local","models":[{"id":"weather-pro","enabled":true}]}`
	resp := post(t, http.MethodPut, server.URL+"/v1/admin/model-providers/unit", "admin-token", strings.NewReader(provider))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("provider setup: %d", resp.StatusCode)
	}

	organization := `{"allowedProviderIds":["unit"],"requireVerifiedModels":true,"autoCompactThreshold":0.8}`
	resp = post(t, http.MethodPut, server.URL+"/v1/admin/policies/organization", "admin-token", strings.NewReader(organization))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("organization policy setup: %d", resp.StatusCode)
	}

	role := `{"defaultModel":"unit/weather-pro","allowedModels":["unit/weather-pro"]}`
	resp = post(t, http.MethodPut, server.URL+"/v1/admin/policies/roles/viewer", "admin-token", strings.NewReader(role))
	payload, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(payload), "尚未验证") {
		t.Fatalf("role override bypassed inherited verification requirement: %d %s", resp.StatusCode, payload)
	}
}
