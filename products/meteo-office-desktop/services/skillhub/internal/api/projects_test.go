package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

func projectRequest(t *testing.T, method, url, token, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func decodeProject(t *testing.T, resp *http.Response) store.SharedProject {
	t.Helper()
	defer resp.Body.Close()
	var project store.SharedProject
	if err := json.NewDecoder(resp.Body).Decode(&project); err != nil {
		t.Fatal(err)
	}
	return project
}

func TestSharedProjectACLAndOptimisticConcurrency(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	createBody := `{"name":"华南暴雨过程","description":"共享研判项目","visibility":"organization","workspaceURI":"smb://weather/projects/south-rain","clientProjectId":"local-1","spec":{"meteorologicalContext":{"region":"华南"}}}`
	resp := projectRequest(t, http.MethodPost, server.URL+"/v1/projects", "publisher-token", createBody)
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("create project: %d", resp.StatusCode)
	}
	project := decodeProject(t, resp)
	if project.Revision != 1 || project.OwnerID != "publisher" || project.Visibility != "organization" {
		t.Fatalf("unexpected project: %+v", project)
	}

	resp = projectRequest(t, http.MethodGet, server.URL+"/v1/projects/"+project.ID, "viewer-token", "")
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("organization viewer should read project: %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = projectRequest(t, http.MethodPut, server.URL+"/v1/projects/"+project.ID, "viewer-token", `{"name":"非法更新","baseRevision":1}`)
	if resp.StatusCode != http.StatusForbidden {
		resp.Body.Close()
		t.Fatalf("viewer update should be forbidden: %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = projectRequest(t, http.MethodPut, server.URL+"/v1/projects/"+project.ID, "publisher-token", `{"description":"第二版","baseRevision":1}`)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("owner update: %d", resp.StatusCode)
	}
	project = decodeProject(t, resp)
	if project.Revision != 2 || project.Description != "第二版" {
		t.Fatalf("unexpected updated project: %+v", project)
	}

	resp = projectRequest(t, http.MethodPut, server.URL+"/v1/projects/"+project.ID, "publisher-token", `{"description":"过期写入","baseRevision":1}`)
	if resp.StatusCode != http.StatusConflict {
		resp.Body.Close()
		t.Fatalf("stale update should conflict: %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = projectRequest(t, http.MethodPut, server.URL+"/v1/projects/"+project.ID+"/members/viewer", "publisher-token", `{"role":"editor","baseRevision":2}`)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("set member: %d", resp.StatusCode)
	}
	project = decodeProject(t, resp)
	if project.Revision != 3 || project.Members["viewer"].Role != "editor" {
		t.Fatalf("unexpected member state: %+v", project)
	}

	resp = projectRequest(t, http.MethodPut, server.URL+"/v1/projects/"+project.ID+"/members/viewer", "publisher-token", `{"role":"viewer","baseRevision":2}`)
	if resp.StatusCode != http.StatusConflict {
		resp.Body.Close()
		t.Fatalf("stale member update should conflict: %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = projectRequest(t, http.MethodPut, server.URL+"/v1/projects/"+project.ID, "viewer-token", `{"description":"协同编辑","baseRevision":3}`)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("editor update: %d", resp.StatusCode)
	}
	project = decodeProject(t, resp)
	if project.Revision != 4 || project.Description != "协同编辑" {
		t.Fatalf("unexpected editor update: %+v", project)
	}
}

func TestSharedProjectInternalModeAcceptsHTTPAndLocalWorkspaceLocations(t *testing.T) {
	t.Setenv("METEOMATE_SECURITY_MODE", "internal")
	server, _ := newTestServer(t)
	defer server.Close()
	cases := []string{
		`/Users/test/weather`,
		`C:\\weather\\products`,
		`\\\\weather-server\\share\\products`,
		`file:///mnt/weather/products`,
		`http://10.0.0.8:8080/projects/rain?token=internal-token`,
		`https://user:password@weather.example/projects/rain`,
		`meteomate-internal://weather/project/001`,
	}
	for index, workspaceURI := range cases {
		body, _ := json.Marshal(map[string]any{"name": fmt.Sprintf("internal-%d", index), "visibility": "private", "workspaceURI": workspaceURI, "spec": map[string]any{}})
		resp := projectRequest(t, http.MethodPost, server.URL+"/v1/projects", "publisher-token", string(body))
		project := decodeProject(t, resp)
		if resp.StatusCode != http.StatusCreated || project.WorkspaceURI != workspaceURI {
			t.Fatalf("internal workspace location should be accepted (%s): %d %+v", workspaceURI, resp.StatusCode, project)
		}
	}
}

func TestSharedProjectStrictModeRetainsURIValidation(t *testing.T) {
	t.Setenv("METEOMATE_SECURITY_MODE", "strict")
	server, _ := newTestServer(t)
	defer server.Close()
	cases := []string{
		`/Users/test/weather`,
		`http://weather.example/projects/rain`,
		`https://user:password@weather.example/projects/rain`,
		`https://weather.example/projects/rain?token=secret`,
		`https:///missing-host`,
	}
	for _, workspaceURI := range cases {
		body, _ := json.Marshal(map[string]any{"name": "strict-invalid", "visibility": "private", "workspaceURI": workspaceURI, "spec": map[string]any{}})
		resp := projectRequest(t, http.MethodPost, server.URL+"/v1/projects", "publisher-token", string(body))
		resp.Body.Close()
		if resp.StatusCode != http.StatusConflict {
			t.Fatalf("strict mode should reject workspace location (%s): %d", workspaceURI, resp.StatusCode)
		}
	}
}

func TestSharedProjectUnknownSecurityModeFailsClosed(t *testing.T) {
	t.Setenv("METEOMATE_SECURITY_MODE", "strcit")
	if !strictSecurityMode() {
		t.Fatal("unknown security mode must retain strict URI validation")
	}
	if err := validateWorkspaceURI(`/Users/test/weather`); err == nil {
		t.Fatal("unknown security mode must reject an unrestricted local workspace path")
	}
}
