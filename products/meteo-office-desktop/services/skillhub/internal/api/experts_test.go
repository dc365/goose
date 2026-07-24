package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

func TestExpertOwnershipVisibilityAndOptimisticRevision(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	createBody := `{
		"id":"forecast-review",
		"name":"Forecast Review",
		"version":"1.0.0",
		"status":"enabled",
		"visibility":"private",
		"instruction":"Review forecast evidence before delivery."
	}`
	resp := post(t, http.MethodPost, server.URL+"/v1/experts", "publisher-token", strings.NewReader(createBody))
	var created store.Expert
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || created.Revision != 1 || created.OwnerID != "publisher" {
		t.Fatalf("unexpected Expert create response: %d %+v", resp.StatusCode, created)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/experts/forecast-review", "viewer-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("private Expert leaked to another user: %d", resp.StatusCode)
	}

	updateBody := `{
		"id":"forecast-review",
		"name":"Forecast Review",
		"version":"1.1.0",
		"status":"enabled",
		"visibility":"private",
		"instruction":"Review forecast evidence, uncertainty, and delivery quality.",
		"baseRevision":1
	}`
	resp = post(t, http.MethodPut, server.URL+"/v1/experts/forecast-review", "publisher-token", strings.NewReader(updateBody))
	var updated store.Expert
	if err := json.NewDecoder(resp.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || updated.Revision != 2 || updated.Version != "1.1.0" {
		t.Fatalf("unexpected Expert update response: %d %+v", resp.StatusCode, updated)
	}

	resp = post(t, http.MethodPut, server.URL+"/v1/experts/forecast-review", "publisher-token", strings.NewReader(updateBody))
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("stale Expert revision was accepted: %d", resp.StatusCode)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/experts/forecast-review/revisions", "publisher-token", nil)
	var revisions struct {
		Items []store.ExpertRevision `json:"items"`
		Total int                    `json:"total"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&revisions); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || revisions.Total != 2 || len(revisions.Items) != 2 {
		t.Fatalf("unexpected Expert revision history: %d %+v", resp.StatusCode, revisions)
	}
}

func TestOrganizationExpertIsVisibleInsideOrganization(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	body := `{
		"id":"operations-duty",
		"name":"Operations Duty",
		"version":"1.0.0",
		"status":"enabled",
		"visibility":"organization",
		"instruction":"Triage incidents and provide an auditable handoff."
	}`
	resp := post(t, http.MethodPost, server.URL+"/v1/experts", "admin-token", strings.NewReader(body))
	var created store.Expert
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || created.Status != "draft" || created.Review.Status != "not_submitted" {
		t.Fatalf("organization Expert was published without review: %d %+v", resp.StatusCode, created)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/experts/operations-duty", "viewer-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unreviewed organization Expert was visible: %d", resp.StatusCode)
	}

	resp = post(t, http.MethodPost, server.URL+"/v1/experts/operations-duty/submit-review", "admin-token", strings.NewReader(`{}`))
	var pending store.Expert
	if err := json.NewDecoder(resp.Body).Decode(&pending); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted || pending.Revision != 2 || pending.Review.Status != "pending" {
		t.Fatalf("organization Expert review submission failed: %d %+v", resp.StatusCode, pending)
	}

	resp = post(t, http.MethodPost, server.URL+"/v1/experts/operations-duty/review", "admin-token", strings.NewReader(`{
		"decision":"approve",
		"note":"职责和能力范围符合组织规范",
		"baseRevision":2
	}`))
	var expert store.Expert
	if err := json.NewDecoder(resp.Body).Decode(&expert); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || expert.Status != "enabled" || expert.Review.Status != "approved" || expert.Revision != 3 {
		t.Fatalf("organization Expert approval failed: %d %+v", resp.StatusCode, expert)
	}

	resp = post(t, http.MethodPut, server.URL+"/v1/experts/operations-duty/distribution", "admin-token", strings.NewReader(`{
		"mode":"allowlist",
		"userIds":["publisher"],
		"baseRevision":3
	}`))
	var restricted store.Expert
	if err := json.NewDecoder(resp.Body).Decode(&restricted); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || restricted.Revision != 4 || restricted.Distribution.Mode != "allowlist" {
		t.Fatalf("organization Expert distribution update failed: %d %+v", resp.StatusCode, restricted)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/experts/operations-duty", "viewer-token", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("organization Expert escaped its allowlist: %d", resp.StatusCode)
	}

	resp = post(t, http.MethodPut, server.URL+"/v1/experts/operations-duty/distribution", "admin-token", strings.NewReader(`{
		"mode":"allowlist",
		"userIds":["viewer"],
		"baseRevision":4
	}`))
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("organization Expert allowlist replacement failed: %d", resp.StatusCode)
	}

	resp = post(t, http.MethodGet, server.URL+"/v1/experts/operations-duty", "viewer-token", nil)
	if err := json.NewDecoder(resp.Body).Decode(&expert); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || expert.Source.Type != "organization" || expert.OrgID != "org-1" {
		t.Fatalf("organization Expert was not visible to its allowlist: %d %+v", resp.StatusCode, expert)
	}

	resp = post(t, http.MethodPost, server.URL+"/v1/experts/operations-duty/rollback/3", "admin-token", strings.NewReader(`{
		"baseRevision":5
	}`))
	var rolledBack store.Expert
	if err := json.NewDecoder(resp.Body).Decode(&rolledBack); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || rolledBack.Revision != 6 || rolledBack.Status != "enabled" || rolledBack.Review.Status != "approved" {
		t.Fatalf("organization Expert rollback failed: %d %+v", resp.StatusCode, rolledBack)
	}
	if rolledBack.Distribution.Mode != "allowlist" || len(rolledBack.Distribution.UserIDs) != 1 || rolledBack.Distribution.UserIDs[0] != "viewer" {
		t.Fatalf("rollback changed the active distribution: %+v", rolledBack.Distribution)
	}
}
