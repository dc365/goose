package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/policy"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

func newTestServer(t *testing.T) (*httptest.Server, *trust.Signer) {
	return newTestServerWithPolicies(t, policy.NewMemory())
}

func newTestServerWithPolicies(t *testing.T, policies *policy.Store) (*httptest.Server, *trust.Signer) {
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
	authenticator := auth.New(map[string]auth.Actor{
		"publisher-token": {Subject: "publisher", Name: "Publisher", Role: "publisher", OrgID: "org-1"},
		"admin-token":     {Subject: "admin", Name: "Admin", Role: "admin", OrgID: "org-1"},
		"viewer-token":    {Subject: "viewer", Name: "Viewer", Role: "viewer", OrgID: "org-1"},
	})
	accounts, err := auth.OpenAccountStore(filepath.Join(root, "accounts"))
	if err != nil {
		t.Fatal(err)
	}
	authenticator = auth.NewWithAccounts(map[string]auth.Actor{
		"publisher-token": {Subject: "publisher", Name: "Publisher", Role: "publisher", OrgID: "org-1"},
		"admin-token":     {Subject: "admin", Name: "Admin", Role: "admin", OrgID: "org-1"},
		"viewer-token":    {Subject: "viewer", Name: "Viewer", Role: "viewer", OrgID: "org-1"},
	}, accounts, time.Hour)
	server, err := New(Config{Store: dataStore, Signer: signer, Authenticator: authenticator, Policies: policies})
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(server.Handler()), signer
}

func TestPublicationApprovalAndInstallationGovernance(t *testing.T) {
	policies := policy.NewMemory()
	settings := policy.DefaultSettings()
	settings.SkillPublishMode = "admin_approval"
	settings.AllowedSkillIDs = []string{"governed-weather"}
	settings.DefaultSkillIDs = []string{"governed-weather"}
	if _, err := policies.SetOrganization(settings); err != nil {
		t.Fatal(err)
	}
	server, _ := newTestServerWithPolicies(t, policies)
	defer server.Close()

	upload(t, server.URL, "publisher-token", "governed-weather", skillZIP(t, "governed-weather", "1.0.0"), "organization")
	resp := post(t, http.MethodPost, server.URL+"/v1/skills/governed-weather/versions/1.0.0/publish", "publisher-token", nil)
	var submitted store.SkillVersion
	if err := json.NewDecoder(resp.Body).Decode(&submitted); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted || submitted.Status != "pending_review" {
		t.Fatalf("publisher review submission: %d %+v", resp.StatusCode, submitted)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/admin/installations/summary", "admin-token", nil)
	var before struct {
		Metrics        map[string]int `json:"metrics"`
		PendingReviews []any          `json:"pendingReviews"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&before); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || before.Metrics["pendingReviews"] != 1 || len(before.PendingReviews) != 1 {
		t.Fatalf("review queue summary: %d %+v", resp.StatusCode, before)
	}

	resp = post(t, http.MethodPost, server.URL+"/v1/skills/governed-weather/versions/1.0.0/publish", "admin-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin approval: %d", resp.StatusCode)
	}
	installation := `{"clientId":"desktop-governance","skillId":"governed-weather","version":"1.0.0","scope":"project","projectId":"project-fuzhou"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/installations", "viewer-token", strings.NewReader(installation))
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("installation report: %d", resp.StatusCode)
	}

	upload(t, server.URL, "publisher-token", "governed-weather", skillZIP(t, "governed-weather", "1.1.0"), "organization")
	resp = post(t, http.MethodPost, server.URL+"/v1/skills/governed-weather/versions/1.1.0/publish", "publisher-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("upgrade review submission: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodPost, server.URL+"/v1/skills/governed-weather/versions/1.1.0/publish", "admin-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upgrade approval: %d", resp.StatusCode)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/admin/installations/summary", "admin-token", nil)
	var summary struct {
		Metrics map[string]int `json:"metrics"`
		Items   []struct {
			LatestVersion string `json:"latestVersion"`
			UpgradeReady  bool   `json:"upgradeReady"`
			ProjectID     string `json:"projectId"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || summary.Metrics["installations"] != 1 || summary.Metrics["upgrades"] != 1 || summary.Metrics["projects"] != 1 {
		t.Fatalf("governance metrics: %d %+v", resp.StatusCode, summary)
	}
	if len(summary.Items) != 1 || !summary.Items[0].UpgradeReady || summary.Items[0].LatestVersion != "1.1.0" || summary.Items[0].ProjectID != "project-fuzhou" {
		t.Fatalf("governance installation detail: %+v", summary.Items)
	}

	upload(t, server.URL, "publisher-token", "governed-weather", skillZIP(t, "governed-weather", "1.2.0"), "organization")
	resp = post(t, http.MethodPost, server.URL+"/v1/skills/governed-weather/versions/1.2.0/publish", "publisher-token", nil)
	resp.Body.Close()
	resp = post(t, http.MethodPost, server.URL+"/v1/skills/governed-weather/versions/1.2.0/reject", "admin-token", strings.NewReader(`{"note":"补充变更说明"}`))
	var rejected store.SkillVersion
	if err := json.NewDecoder(resp.Body).Decode(&rejected); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || rejected.Status != "draft" || rejected.ReviewNote != "补充变更说明" {
		t.Fatalf("review rejection: %d %+v", resp.StatusCode, rejected)
	}
}

func TestMutationFailsClosedWhenAuditUnavailable(t *testing.T) {
	root := t.TempDir()
	dataRoot := filepath.Join(root, "data")
	dataStore, err := store.Open(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dataRoot, "audit.jsonl"), 0o700); err != nil {
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
		"admin-token": {Subject: "admin", Name: "Admin", Role: "admin", OrgID: "org-1"},
	}, accounts, time.Hour)
	service, err := New(Config{Store: dataStore, Signer: signer, Authenticator: authenticator})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(service.Handler())
	defer server.Close()

	body := `{"username":"blocked.user","displayName":"Blocked User","password":"blocked-user-2026","role":"viewer","orgId":"org-1"}`
	resp := post(t, http.MethodPost, server.URL+"/v1/admin/users", "admin-token", strings.NewReader(body))
	payload, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable || !bytes.Contains(payload, []byte("audit_unavailable")) {
		t.Fatalf("mutation was not blocked when audit failed: %d %s", resp.StatusCode, payload)
	}
	if accounts.Count() != 0 {
		t.Fatalf("user mutation reached storage despite audit failure: %+v", accounts.List())
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/skills/example/versions/1.0.0/download", "", nil)
	payload, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable || !bytes.Contains(payload, []byte("audit_unavailable")) {
		t.Fatalf("stateful download bypassed audit gate: %d %s", resp.StatusCode, payload)
	}
}

func TestManagedUserLoginAndAdministration(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	createBody := `{"username":"analyst","displayName":"值班预报员","password":"weather-2026","role":"publisher","orgId":"org-1","mustChangePassword":true}`
	resp := post(t, http.MethodPost, server.URL+"/v1/admin/users", "admin-token", strings.NewReader(createBody))
	payload, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create user: %d %s", resp.StatusCode, payload)
	}
	if bytes.Contains(payload, []byte("passwordHash")) || bytes.Contains(payload, []byte("weather-2026")) {
		t.Fatalf("user response leaked credentials: %s", payload)
	}

	loginBody := `{"username":"analyst","password":"weather-2026","clientId":"desktop-test"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/auth/login", "", strings.NewReader(loginBody))
	var login struct {
		SessionToken string          `json:"sessionToken"`
		User         auth.PublicUser `json:"user"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&login); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || login.SessionToken == "" || login.User.Username != "analyst" {
		t.Fatalf("unexpected login: %d %+v", resp.StatusCode, login)
	}
	if !login.User.MustChangePassword {
		t.Fatalf("temporary password did not require a change: %+v", login.User)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/me", login.SessionToken, nil)
	var me map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if me["authenticated"] != true {
		t.Fatalf("session was not authenticated: %+v", me)
	}

	changeBody := `{"currentPassword":"weather-2026","newPassword":"weather-updated-2026"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/me/password", login.SessionToken, strings.NewReader(changeBody))
	if resp.StatusCode != http.StatusOK {
		payload, _ = io.ReadAll(resp.Body)
		t.Fatalf("change password: %d %s", resp.StatusCode, payload)
	}
	resp.Body.Close()
	resp = post(t, http.MethodGet, server.URL+"/v1/me", login.SessionToken, nil)
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if me["authenticated"] != false {
		t.Fatalf("password change did not revoke session: %+v", me)
	}

	loginBody = `{"username":"analyst","password":"weather-updated-2026","clientId":"desktop-test"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/auth/login", "", strings.NewReader(loginBody))
	if err := json.NewDecoder(resp.Body).Decode(&login); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || login.User.MustChangePassword {
		t.Fatalf("updated password login failed: %d %+v", resp.StatusCode, login)
	}

	resp = post(t, http.MethodPost, server.URL+"/v1/auth/logout", login.SessionToken, nil)
	resp.Body.Close()
	resp = post(t, http.MethodGet, server.URL+"/v1/me", login.SessionToken, nil)
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if me["authenticated"] != false {
		t.Fatalf("logout did not revoke session: %+v", me)
	}
}

func TestOrganizationPolicyManagementAndEffectiveUserPolicy(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	organization := `{"defaultModel":"goose/gpt-5.5","allowedModels":["goose/gpt-5.5","goose/gpt-5.5-mini"],"defaultSkillIds":["skill-creator"],"allowedConnectorIds":["weather-data"],"defaultPermissionProfileId":"artifact-approval","allowedPermissionProfileIds":["analysis-readonly","artifact-approval"],"autoCompactThreshold":0.82}`
	resp := post(t, http.MethodPut, server.URL+"/v1/admin/policies/organization", "admin-token", strings.NewReader(organization))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update organization policy: %d", resp.StatusCode)
	}

	role := `{"defaultModel":"goose/gpt-5.5-mini","allowedModels":["goose/gpt-5.5-mini"],"defaultPermissionProfileId":"analysis-readonly","autoCompactThreshold":0.75}`
	resp = post(t, http.MethodPut, server.URL+"/v1/admin/policies/roles/viewer", "admin-token", strings.NewReader(role))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update role policy: %d", resp.StatusCode)
	}

	createUser := `{"username":"policy.user","displayName":"策略用户","password":"policy-user-2026","role":"viewer","orgId":"meteomate","mustChangePassword":false}`
	resp = post(t, http.MethodPost, server.URL+"/v1/admin/users", "admin-token", strings.NewReader(createUser))
	var user auth.PublicUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create policy user: %d", resp.StatusCode)
	}

	userSkills := `{"defaultSkillIds":["forecast-writing","skill-creator"],"allowedConnectorIds":[]}`
	resp = post(t, http.MethodPut, server.URL+"/v1/admin/policies/users/"+user.ID, "admin-token", strings.NewReader(userSkills))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update user policy: %d", resp.StatusCode)
	}

	loginBody := `{"username":"policy.user","password":"policy-user-2026","clientId":"policy-test"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/auth/login", "", strings.NewReader(loginBody))
	var login struct {
		SessionToken string `json:"sessionToken"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&login); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if login.SessionToken == "" {
		t.Fatal("policy user did not receive a session")
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/me/policy", login.SessionToken, nil)
	var result struct {
		DefaultSpaceID string           `json:"defaultSpaceId"`
		ProfileBinding string           `json:"profileBindingId"`
		Policy         policy.Effective `json:"policy"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || result.DefaultSpaceID != "personal:"+user.ID || result.ProfileBinding != "user:"+user.ID {
		t.Fatalf("effective policy identity: %d %+v", resp.StatusCode, result)
	}
	if result.Policy.DefaultModel != "goose/gpt-5.5-mini" || len(result.Policy.DefaultSkillIDs) != 2 || len(result.Policy.AllowedConnectorIDs) != 0 || result.Policy.AutoCompactThreshold != 0.75 {
		t.Fatalf("effective policy precedence failed: %+v", result.Policy)
	}
	if result.Policy.Sources["defaultModel"] != "role:viewer" || result.Policy.Sources["defaultSkillIds"] != "user:"+user.ID || result.Policy.Sources["autoCompactThreshold"] != "role:viewer" {
		t.Fatalf("effective policy sources failed: %+v", result.Policy.Sources)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/admin/policies", login.SessionToken, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer read admin policies: %d", resp.StatusCode)
	}

	resp = post(t, http.MethodDelete, server.URL+"/v1/admin/policies/users/"+user.ID, "admin-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("reset user policy: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodGet, server.URL+"/v1/admin/policies/effective/users/"+user.ID, "admin-token", nil)
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(result.Policy.DefaultSkillIDs) != 1 || result.Policy.DefaultSkillIDs[0] != "skill-creator" {
		t.Fatalf("user policy reset did not inherit organization: %+v", result.Policy)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/admin/audit?action=policy.user.update", "admin-token", nil)
	var audit store.AuditResult
	if err := json.NewDecoder(resp.Body).Decode(&audit); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if audit.Total != 1 || audit.Items[0].Target != user.ID {
		t.Fatalf("policy audit missing: %+v", audit)
	}
}

func TestAdminConsoleSessionsAuditAndLoginRateLimit(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	resp, err := http.Get(server.URL + "/admin/")
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !bytes.Contains(page, []byte("MeteoMate 管理后台")) || !bytes.Contains(page, []byte("能力资产")) || !bytes.Contains(page, []byte("组织治理")) || !bytes.Contains(page, []byte("Skill 管理")) || !bytes.Contains(page, []byte("专家管理")) || !bytes.Contains(page, []byte("上传 Skill")) || !bytes.Contains(page, []byte("内容运营")) || !bytes.Contains(page, []byte("推荐结果模拟器")) || bytes.Contains(page, []byte("SkillHub 管理控制台")) {
		t.Fatalf("admin console unavailable: %d %s", resp.StatusCode, page)
	}
	if !strings.Contains(resp.Header.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatalf("admin console CSP missing: %q", resp.Header.Get("Content-Security-Policy"))
	}
	resp, err = http.Get(server.URL + "/admin/assets/admin.js")
	if err != nil {
		t.Fatal(err)
	}
	script, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/javascript") {
		t.Fatalf("admin JavaScript unavailable: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	if !bytes.Contains(script, []byte("/v1/packages/inspect")) || !bytes.Contains(script, []byte("includeDrafts=true")) || !bytes.Contains(script, []byte("changeSkillVersionStatus")) || !bytes.Contains(script, []byte("/v1/admin/recommendation-rules")) || !bytes.Contains(script, []byte("runRecommendationSimulation")) || !bytes.Contains(script, []byte("initializeExpertSkillPicker")) || bytes.Contains(script, []byte("必需 Skill ID")) {
		t.Fatalf("admin Skill lifecycle controls missing")
	}
	if !bytes.Contains(script, []byte("sessionStorage")) || !bytes.Contains(script, []byte("restoreAdminSession")) || !bytes.Contains(script, []byte("api('/v1/me'")) || bytes.Contains(script, []byte("localStorage")) {
		t.Fatalf("admin session reload recovery missing")
	}
	resp, err = http.Get(server.URL + "/favicon.ico")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("admin favicon unavailable: %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}

	createAdmin := `{"username":"managed.admin","displayName":"主管理员","password":"managed-admin-2026","role":"admin","orgId":"meteomate"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/admin/users", "admin-token", strings.NewReader(createAdmin))
	var managedAdmin auth.PublicUser
	if err := json.NewDecoder(resp.Body).Decode(&managedAdmin); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create managed admin: %d %+v", resp.StatusCode, managedAdmin)
	}
	resp = post(t, http.MethodPatch, server.URL+"/v1/admin/users/"+managedAdmin.ID, "admin-token", strings.NewReader(`{"status":"disabled"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("last managed admin was not protected: %d", resp.StatusCode)
	}

	createUser := `{"username":"session.user","displayName":"会话测试用户","password":"session-user-2026","role":"viewer","orgId":"meteomate"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/admin/users", "admin-token", strings.NewReader(createUser))
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create session user: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodPost, server.URL+"/v1/auth/login", "", strings.NewReader(`{"username":"session.user","password":"session-user-2026","clientId":"desktop-session-test"}`))
	var login struct {
		SessionToken string `json:"sessionToken"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&login); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	resp = post(t, http.MethodGet, server.URL+"/v1/admin/sessions", "admin-token", nil)
	var sessions struct {
		Items []auth.SessionView `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(sessions.Items) != 1 || sessions.Items[0].ClientID != "desktop-session-test" {
		t.Fatalf("unexpected sessions: %+v", sessions.Items)
	}
	resp = post(t, http.MethodDelete, server.URL+"/v1/admin/sessions/"+sessions.Items[0].ID, "admin-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("revoke session: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodGet, server.URL+"/v1/me", login.SessionToken, nil)
	var me map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if me["authenticated"] != false {
		t.Fatalf("revoked session remained valid: %+v", me)
	}

	createRateUser := `{"username":"rate.user","displayName":"限速测试用户","password":"rate-user-2026","role":"viewer"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/admin/users", "admin-token", strings.NewReader(createRateUser))
	resp.Body.Close()
	for attempt := 0; attempt < loginFailureLimit; attempt++ {
		resp = post(t, http.MethodPost, server.URL+"/v1/auth/login", "", strings.NewReader(`{"username":"rate.user","password":"wrong-password","clientId":"rate-test"}`))
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("failure %d returned %d", attempt+1, resp.StatusCode)
		}
	}
	resp = post(t, http.MethodPost, server.URL+"/v1/auth/login", "", strings.NewReader(`{"username":"rate.user","password":"wrong-password","clientId":"rate-test"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("login rate limit missing: %d retry=%q", resp.StatusCode, resp.Header.Get("Retry-After"))
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/admin/audit?limit=200", "admin-token", nil)
	var audit store.AuditResult
	if err := json.NewDecoder(resp.Body).Decode(&audit); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if audit.Total < 8 {
		t.Fatalf("audit events missing: %+v", audit)
	}
	foundRevoke, foundBlocked := false, false
	for _, event := range audit.Items {
		foundRevoke = foundRevoke || event.Action == "session.revoke"
		foundBlocked = foundBlocked || event.Action == "auth.login.blocked"
	}
	if !foundRevoke || !foundBlocked {
		t.Fatalf("expected security audit events: revoke=%v blocked=%v", foundRevoke, foundBlocked)
	}
}

func skillZIP(t *testing.T, id, version string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	files := map[string]string{
		id + "/SKILL.md":       "---\nname: " + id + "\ndescription: Creates a structured weather review when a user requests meteorological analysis\nmetadata:\n  version: \"" + version + "\"\n---\n\n# Workflow\n\n1. Read data.\n2. Validate evidence.\n",
		id + "/meteomate.json": `{"displayName":"Weather Review","version":"` + version + `","categories":["天气分析"],"requires":{"connectors":["weather-data"]},"permissions":{"filesystem":{"write":[]},"shell":false}}`,
	}
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func upload(t *testing.T, baseURL, token, id string, data []byte, visibility string) map[string]any {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("package", id+".zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	metadata, _ := json.Marshal(map[string]any{"name": "Weather Review", "summary": "Structured weather review", "categories": []string{"天气分析"}, "tags": []string{"weather"}, "visibility": visibility, "featured": true})
	_ = writer.WriteField("metadata", string(metadata))
	_ = writer.Close()
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/v1/skills/"+id+"/versions", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload status %d: %s", resp.StatusCode, payload)
	}
	var result map[string]any
	if err := json.Unmarshal(payload, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func post(t *testing.T, method, endpoint, token string, body io.Reader) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, endpoint, body)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestPublishListDownloadAndVerify(t *testing.T) {
	server, signer := newTestServer(t)
	defer server.Close()
	data := skillZIP(t, "weather-review", "1.2.0")
	upload(t, server.URL, "publisher-token", "weather-review", data, "public")
	resp := post(t, http.MethodPost, server.URL+"/v1/skills/weather-review/versions/1.2.0/publish", "publisher-token", nil)
	if resp.StatusCode != http.StatusOK {
		payload, _ := io.ReadAll(resp.Body)
		t.Fatalf("publish: %d %s", resp.StatusCode, payload)
	}
	resp.Body.Close()

	resp, err := http.Get(server.URL + "/v1/skills?q=weather")
	if err != nil {
		t.Fatal(err)
	}
	var list map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if int(list["total"].(float64)) != 1 {
		t.Fatalf("unexpected list: %+v", list)
	}

	resp, err = http.Get(server.URL + "/v1/skills/weather-review/versions/1.2.0/download")
	if err != nil {
		t.Fatal(err)
	}
	downloaded, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.Equal(downloaded, data) {
		t.Fatal("download differs")
	}
	signature := resp.Header.Get("X-MeteoMate-Signature")
	if signature == "" {
		t.Fatal("signature missing")
	}
	if !trust.Verify(signer.PublicKey().PublicKey, trust.Message("weather-review", "1.2.0", resp.Header.Get("X-MeteoMate-Digest")), signature) {
		t.Fatal("signature verification failed")
	}

	recommendationURL := server.URL + "/v1/recommendations?" + url.Values{"categories": {"天气分析"}, "connectorIds": {"weather-data"}}.Encode()
	resp, err = http.Get(recommendationURL)
	if err != nil {
		t.Fatal(err)
	}
	var recommendations map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&recommendations)
	resp.Body.Close()
	if len(recommendations["items"].([]any)) != 1 {
		t.Fatalf("unexpected recommendations: %+v", recommendations)
	}
}

func TestContentOperationsCollectionsAndRecommendationRules(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	for _, id := range []string{"forecast-brief", "operations-review"} {
		upload(t, server.URL, "publisher-token", id, skillZIP(t, id, "1.0.0"), "public")
		resp := post(t, http.MethodPost, server.URL+"/v1/skills/"+id+"/versions/1.0.0/publish", "publisher-token", nil)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("publish %s: %d", id, resp.StatusCode)
		}
	}

	featuredBody := `{"items":[{"skillId":"operations-review","rank":1},{"skillId":"forecast-brief","rank":2}]}`
	resp := post(t, http.MethodPut, server.URL+"/v1/admin/featured-placements", "admin-token", strings.NewReader(featuredBody))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("save featured placements: %d", resp.StatusCode)
	}

	resp, err := http.Get(server.URL + "/v1/collections")
	if err != nil {
		t.Fatal(err)
	}
	var collections struct {
		Items []store.Collection `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&collections); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(collections.Items) != 1 || collections.Items[0].ID != "featured" || collections.Items[0].Skills[0].SkillID != "operations-review" {
		t.Fatalf("unexpected featured collection: %+v", collections.Items)
	}

	collectionBody := `{"name":"值班气象套件","description":"值班分析和复盘","featured":true,"skills":[{"skillId":"forecast-brief"},{"skillId":"operations-review"}]}`
	resp = post(t, http.MethodPut, server.URL+"/v1/collections/duty-weather", "admin-token", strings.NewReader(collectionBody))
	var collection store.Collection
	if err := json.NewDecoder(resp.Body).Decode(&collection); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || len(collection.Skills) != 2 || collection.Skills[0].Version != "1.0.0" {
		t.Fatalf("save collection: %d %+v", resp.StatusCode, collection)
	}

	ruleBody := `{"name":"下周天气优先","description":"制作类任务优先展示预报简报","enabled":true,"priority":500,"match":{"skillIds":["forecast-brief"],"queryTerms":["下周天气"]},"action":{"scoreBoost":80,"pin":true,"reason":"匹配下周天气制作场景"}}`
	resp = post(t, http.MethodPut, server.URL+"/v1/admin/recommendation-rules/weekly-forecast", "admin-token", strings.NewReader(ruleBody))
	var rule store.RecommendationRule
	if err := json.NewDecoder(resp.Body).Decode(&rule); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !rule.Enabled || !rule.Action.Pin {
		t.Fatalf("save recommendation rule: %d %+v", resp.StatusCode, rule)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/admin/recommendation-rules", "publisher-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("publisher listed recommendation rules: %d", resp.StatusCode)
	}

	recommendationURL := server.URL + "/v1/recommendations?" + url.Values{"q": {"制作下周天气产品"}}.Encode()
	resp, err = http.Get(recommendationURL)
	if err != nil {
		t.Fatal(err)
	}
	var recommendations struct {
		Items []struct {
			Skill   store.Skill `json:"skill"`
			Pinned  bool        `json:"pinned"`
			RuleIDs []string    `json:"ruleIds"`
			Reasons []string    `json:"reasons"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&recommendations); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(recommendations.Items) != 2 || recommendations.Items[0].Skill.ID != "forecast-brief" || !recommendations.Items[0].Pinned || len(recommendations.Items[0].RuleIDs) != 1 {
		t.Fatalf("unexpected recommendation preview: %+v", recommendations.Items)
	}

	resp = post(t, http.MethodDelete, server.URL+"/v1/admin/recommendation-rules/weekly-forecast", "admin-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete recommendation rule: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodDelete, server.URL+"/v1/collections/duty-weather", "admin-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete collection: %d", resp.StatusCode)
	}
}

func TestSkillOwnershipAndLifecycleManagement(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	upload(t, server.URL, "publisher-token", "managed-weather", skillZIP(t, "managed-weather", "1.0.0"), "private")

	resp := post(t, http.MethodGet, server.URL+"/v1/skills?includeDrafts=true", "publisher-token", nil)
	var owned struct {
		Items []store.Skill `json:"items"`
		Total int           `json:"total"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&owned); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || owned.Total != 1 || owned.Items[0].Status != "draft" {
		t.Fatalf("owner draft list: %d %+v", resp.StatusCode, owned)
	}

	resp = post(t, http.MethodPatch, server.URL+"/v1/skills/managed-weather", "viewer-token", strings.NewReader(`{"name":"No access"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer updated Skill: %d", resp.StatusCode)
	}

	resp = post(t, http.MethodPatch, server.URL+"/v1/skills/managed-weather", "publisher-token", strings.NewReader(`{"name":"值班天气复盘","summary":"面向值班业务的天气复盘","visibility":"organization","categories":["天气分析","复盘"]}`))
	var updated store.Skill
	if err := json.NewDecoder(resp.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || updated.Name != "值班天气复盘" || updated.Visibility != "organization" {
		t.Fatalf("owner update: %d %+v", resp.StatusCode, updated)
	}

	resp = post(t, http.MethodPatch, server.URL+"/v1/skills/managed-weather", "publisher-token", strings.NewReader(`{"featured":true}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("publisher changed featured placement: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodPatch, server.URL+"/v1/skills/managed-weather", "admin-token", strings.NewReader(`{"featured":true}`))
	if err := json.NewDecoder(resp.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !updated.Featured {
		t.Fatalf("admin featured update: %d %+v", resp.StatusCode, updated)
	}

	createOwner := `{"username":"skill.owner","displayName":"技能负责人","password":"skill-owner-2026","role":"publisher","orgId":"org-1","mustChangePassword":false}`
	resp = post(t, http.MethodPost, server.URL+"/v1/admin/users", "admin-token", strings.NewReader(createOwner))
	var owner auth.PublicUser
	if err := json.NewDecoder(resp.Body).Decode(&owner); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create replacement owner: %d %+v", resp.StatusCode, owner)
	}

	transfer := `{"ownerId":"` + owner.ID + `"}`
	resp = post(t, http.MethodPatch, server.URL+"/v1/skills/managed-weather", "admin-token", strings.NewReader(transfer))
	if err := json.NewDecoder(resp.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || updated.OwnerID != owner.ID || updated.Publisher.Name != owner.DisplayName {
		t.Fatalf("owner transfer: %d %+v", resp.StatusCode, updated)
	}

	resp = post(t, http.MethodPatch, server.URL+"/v1/skills/managed-weather", "publisher-token", strings.NewReader(`{"summary":"stale owner"}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("previous owner retained update access: %d", resp.StatusCode)
	}

	login := `{"username":"skill.owner","password":"skill-owner-2026","clientId":"desktop-owner-test"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/auth/login", "", strings.NewReader(login))
	var session struct {
		SessionToken string `json:"sessionToken"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || session.SessionToken == "" {
		t.Fatalf("replacement owner login: %d", resp.StatusCode)
	}

	resp = post(t, http.MethodPost, server.URL+"/v1/skills/managed-weather/versions/1.0.0/publish", session.SessionToken, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("replacement owner publish: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodPost, server.URL+"/v1/skills/managed-weather/versions/1.0.0/deprecate", session.SessionToken, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("replacement owner deprecate: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodGet, server.URL+"/v1/skills/managed-weather", "admin-token", nil)
	var detail struct {
		Skill store.Skill `json:"skill"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if detail.Skill.Status != "deprecated" || detail.Skill.LatestVersion != "" {
		t.Fatalf("deprecated lifecycle state: %+v", detail.Skill)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/admin/audit?action=skill.owner.transfer", "admin-token", nil)
	var audit store.AuditResult
	if err := json.NewDecoder(resp.Body).Decode(&audit); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if audit.Total != 1 || audit.Items[0].Target != "managed-weather" {
		t.Fatalf("ownership audit missing: %+v", audit)
	}
}

func TestOrganizationVisibilityAndInstallation(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	upload(t, server.URL, "publisher-token", "org-skill", skillZIP(t, "org-skill", "1.0.0"), "organization")
	resp := post(t, http.MethodPost, server.URL+"/v1/skills/org-skill/versions/1.0.0/publish", "publisher-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("publish status %d", resp.StatusCode)
	}
	resp, _ = http.Get(server.URL + "/v1/skills/org-skill")
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("anonymous should not see org skill: %d", resp.StatusCode)
	}
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/skills/org-skill", nil)
	req.Header.Set("Authorization", "Bearer viewer-token")
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("org viewer: %d", resp.StatusCode)
	}
	installation := `{"clientId":"desktop-test","skillId":"org-skill","version":"1.0.0","scope":"user"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/installations", "viewer-token", strings.NewReader(installation))
	payload, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("installation: %d %s", resp.StatusCode, payload)
	}
	var created store.Installation
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	replayed := `{"id":"` + created.ID + `","clientId":"desktop-test","skillId":"org-skill","version":"1.0.0","scope":"user"}`
	resp = post(t, http.MethodPost, server.URL+"/v1/installations", "viewer-token", strings.NewReader(replayed))
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("installation update: %d", resp.StatusCode)
	}
	resp = post(t, http.MethodPost, server.URL+"/v1/installations", "publisher-token", strings.NewReader(replayed))
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("installation ownership bypass: %d", resp.StatusCode)
	}
}
