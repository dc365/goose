package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/skillpkg"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

func readMultipartPackage(w http.ResponseWriter, r *http.Request) ([]byte, *multipart.Form, error) {
	r.Body = http.MaxBytesReader(w, r.Body, skillpkg.DefaultMaxArchiveBytes+maxJSONBody)
	if err := r.ParseMultipartForm(skillpkg.DefaultMaxArchiveBytes); err != nil {
		return nil, nil, err
	}
	file, _, err := r.FormFile("package")
	if err != nil {
		return nil, r.MultipartForm, errors.New("multipart field 'package' is required")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, skillpkg.DefaultMaxArchiveBytes+1))
	if err != nil {
		return nil, r.MultipartForm, err
	}
	if int64(len(data)) > skillpkg.DefaultMaxArchiveBytes {
		return nil, r.MultipartForm, errors.New("package exceeds size limit")
	}
	return data, r.MultipartForm, nil
}
func canViewSkill(actor auth.Actor, skill *store.Skill) bool {
	if skill == nil {
		return false
	}
	if actor.IsAdmin() || actor.Subject == skill.OwnerID {
		return true
	}
	switch skill.Visibility {
	case "public":
		return true
	case "organization":
		return actor.Authenticated() && actor.OrgID != "" && actor.OrgID == skill.OrgID
	case "private":
		return false
	default:
		return false
	}
}
func normalizeVisibility(value string) string {
	switch value {
	case "organization", "private":
		return value
	default:
		return "public"
	}
}
func latestPublishedVersion(state *store.State, skill *store.Skill) string {
	latest := ""
	for _, versionID := range skill.Versions {
		version := state.SkillVersions[store.VersionKey(skill.ID, versionID)]
		if version != nil && version.Status == "published" && (latest == "" || semverCompare(versionID, latest) > 0) {
			latest = versionID
		}
	}
	return latest
}
func downloadPath(skillID, version string) string {
	return "/v1/skills/" + skillID + "/versions/" + version + "/download"
}
func sidecarConnectorIDs(sidecar map[string]any) []string {
	requires, _ := sidecar["requires"].(map[string]any)
	return stringSlice(requires["connectors"])
}
func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return unique(typed)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(fmt.Sprint(item)); text != "" {
				result = append(result, text)
			}
		}
		return unique(result)
	case string:
		return splitCSV(typed)
	default:
		return nil
	}
}
func parseLimit(value string, fallback, max int) int {
	number, err := strconv.Atoi(value)
	if err != nil || number <= 0 {
		return fallback
	}
	if number > max {
		return max
	}
	return number
}
func parseOffset(value string) int {
	number, err := strconv.Atoi(value)
	if err != nil || number < 0 {
		return 0
	}
	return number
}
func paginate[T any](items []T, offset, limit int) []T {
	if offset >= len(items) {
		return []T{}
	}
	end := offset + limit
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end]
}
func containsFold(values []string, needle string) bool {
	for _, value := range values {
		if strings.EqualFold(value, needle) {
			return true
		}
	}
	return false
}
func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return unique(strings.Split(value, ","))
}
func unique(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
func set(values []string) map[string]bool {
	result := map[string]bool{}
	for _, value := range values {
		result[value] = true
	}
	return result
}
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func semverCompare(left, right string) int {
	parse := func(value string) []int {
		core := strings.SplitN(value, "-", 2)[0]
		parts := strings.Split(core, ".")
		out := make([]int, 3)
		for i := 0; i < len(parts) && i < 3; i++ {
			out[i], _ = strconv.Atoi(parts[i])
		}
		return out
	}
	a, b := parse(left), parse(right)
	for i := 0; i < 3; i++ {
		if a[i] > b[i] {
			return 1
		}
		if a[i] < b[i] {
			return -1
		}
	}
	return strings.Compare(left, right)
}
func newID(prefix string) string {
	buffer := make([]byte, 8)
	_, _ = rand.Read(buffer)
	return prefix + "-" + hex.EncodeToString(buffer)
}
func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request contains multiple JSON values")
		}
		return err
	}
	return nil
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message}})
}

type apiError struct {
	status  int
	message string
}

func (e apiError) Error() string        { return e.message }
func errNotFound(message string) error  { return apiError{http.StatusNotFound, message} }
func errForbidden(message string) error { return apiError{http.StatusForbidden, message} }
func errConflict(message string) error  { return apiError{http.StatusConflict, message} }
func (s *Server) writeStoreError(w http.ResponseWriter, err error) {
	var apiErr apiError
	if errors.As(err, &apiErr) {
		writeError(w, apiErr.status, "request_rejected", apiErr.message)
		return
	}
	writeError(w, http.StatusInternalServerError, "store_failed", err.Error())
}
