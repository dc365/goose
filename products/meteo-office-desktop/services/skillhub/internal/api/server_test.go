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
	"path/filepath"
	"strings"
	"testing"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

func newTestServer(t *testing.T) (*httptest.Server, *trust.Signer) {
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
	server, err := New(Config{Store: dataStore, Signer: signer, Authenticator: authenticator})
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(server.Handler()), signer
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
}
