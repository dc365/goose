package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
)

type createProjectInput struct {
	Name            string         `json:"name"`
	Description     string         `json:"description"`
	Visibility      string         `json:"visibility"`
	WorkspaceURI    string         `json:"workspaceURI"`
	Spec            map[string]any `json:"spec"`
	ClientProjectID string         `json:"clientProjectId"`
	BaseRevision    int            `json:"baseRevision"`
}

type updateProjectInput struct {
	Name            *string        `json:"name"`
	Description     *string        `json:"description"`
	Visibility      *string        `json:"visibility"`
	WorkspaceURI    *string        `json:"workspaceURI"`
	Spec            map[string]any `json:"spec"`
	ClientProjectID *string        `json:"clientProjectId"`
	BaseRevision    int            `json:"baseRevision"`
}

type projectMemberInput struct {
	Role         string `json:"role"`
	BaseRevision int    `json:"baseRevision"`
}

func parseProjectBaseRevision(value string) (int, error) {
	number, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || number <= 0 {
		return 0, errConflict("baseRevision 必须是正整数")
	}
	return number, nil
}

func normalizedProjectVisibility(value string) string {
	switch strings.TrimSpace(value) {
	case "organization":
		return "organization"
	default:
		return "private"
	}
}

func strictSecurityMode() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("METEOMATE_SECURITY_MODE"))) {
	case "strict", "secure", "hardened", "zero-trust", "zero_trust":
		return true
	case "", "internal", "intranet", "trusted-internal":
		return false
	default:
		return true
	}
}

func validateWorkspaceURI(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	// 内网业务模式默认接受 HTTP、UNC/共享盘、本机绝对路径、file URI，
	// 以及单位内部自定义协议。服务端只保存字符串，不主动访问该位置。
	if !strictSecurityMode() {
		return nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" {
		return errConflict("严格安全模式下 workspaceURI 必须是受支持的 URI")
	}
	if parsed.User != nil || parsed.Host == "" {
		return errConflict("严格安全模式下 workspaceURI 必须包含有效主机，且不能包含用户名或密码")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return errConflict("严格安全模式下 workspaceURI 不能包含查询参数或片段")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "smb", "nfs", "https", "s3", "minio", "meteomate":
		return nil
	default:
		return errConflict("严格安全模式下 workspaceURI 使用了不受支持的协议")
	}
}

func projectRole(actor auth.Actor, project *store.SharedProject) string {
	if project == nil || !actor.Authenticated() {
		return ""
	}
	if actor.IsAdmin() || actor.Subject == project.OwnerID {
		return "owner"
	}
	if member, ok := project.Members[actor.Subject]; ok {
		return member.Role
	}
	if project.Visibility == "organization" && actor.OrgID != "" && actor.OrgID == project.OrgID {
		return "viewer"
	}
	return ""
}

func canViewProject(actor auth.Actor, project *store.SharedProject) bool {
	return projectRole(actor, project) != ""
}

func canEditProject(actor auth.Actor, project *store.SharedProject) bool {
	role := projectRole(actor, project)
	return role == "owner" || role == "editor"
}

func canManageProject(actor auth.Actor, project *store.SharedProject) bool {
	return actor.IsAdmin() || projectRole(actor, project) == "owner"
}

func ensureProjectMaps(project *store.SharedProject) {
	if project.Spec == nil {
		project.Spec = map[string]any{}
	}
	if project.Members == nil {
		project.Members = map[string]store.ProjectMember{}
	}
}

func (s *Server) validateProjectMemberTarget(userID string, project *store.SharedProject) error {
	accounts := s.auth.Accounts()
	if accounts == nil || accounts.Count() == 0 {
		// Static service tokens used by automation and tests do not necessarily have account records.
		return nil
	}
	user, ok := accounts.Get(userID)
	if !ok || user.Status != "active" {
		return errConflict("项目成员必须是启用中的 MeteoMate 用户")
	}
	if project.OrgID != "" && user.OrgID != project.OrgID {
		return errConflict("项目成员必须属于项目所在组织")
	}
	return nil
}

func appendProjectRevision(state *store.State, project *store.SharedProject, actor auth.Actor, now time.Time) {
	ensureProjectMaps(project)
	data, _ := json.Marshal(project)
	var snapshot store.SharedProject
	_ = json.Unmarshal(data, &snapshot)
	ensureProjectMaps(&snapshot)
	state.ProjectRevisions[store.ProjectRevisionKey(project.ID, project.Revision)] = &store.ProjectRevision{
		ProjectID: project.ID,
		Revision:  project.Revision,
		Snapshot:  snapshot,
		CreatedBy: actor.Subject,
		CreatedAt: now,
	}
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "请先登录")
		return
	}
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))
	state := s.store.Snapshot()
	items := make([]store.SharedProject, 0, len(state.Projects))
	for _, project := range state.Projects {
		ensureProjectMaps(project)
		if !canViewProject(actor, project) {
			continue
		}
		searchable := strings.ToLower(strings.Join([]string{project.Name, project.Description, project.ClientProjectID}, " "))
		if query != "" && !strings.Contains(searchable, query) {
			continue
		}
		items = append(items, *project)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "请先登录")
		return
	}
	var input createProjectInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len([]rune(input.Name)) > 120 {
		writeError(w, http.StatusBadRequest, "invalid_name", "项目名称不能为空且不能超过 120 个字符")
		return
	}
	if err := validateWorkspaceURI(input.WorkspaceURI); err != nil {
		s.writeStoreError(w, err)
		return
	}
	visibility := normalizedProjectVisibility(input.Visibility)
	if visibility == "organization" && actor.OrgID == "" {
		writeError(w, http.StatusForbidden, "organization_required", "组织可见项目需要当前用户属于组织")
		return
	}
	now := time.Now().UTC()
	project := &store.SharedProject{
		APIVersion: "meteomate.ai/v1", Kind: "Project", ID: newID("project"),
		ClientProjectID: strings.TrimSpace(input.ClientProjectID), Name: input.Name,
		Description: strings.TrimSpace(input.Description), Revision: 1, OwnerID: actor.Subject,
		OrgID: actor.OrgID, Visibility: visibility, WorkspaceURI: strings.TrimSpace(input.WorkspaceURI),
		Spec: input.Spec, Members: map[string]store.ProjectMember{}, CreatedAt: now, UpdatedAt: now,
	}
	ensureProjectMaps(project)
	if err := s.store.Update(func(state *store.State) error {
		state.Projects[project.ID] = project
		appendProjectRevision(state, project, actor, now)
		return nil
	}); err != nil {
		s.writeStoreError(w, err)
		return
	}
	_ = s.audit(r, "project.created", project.ID, map[string]any{"revision": project.Revision, "visibility": project.Visibility})
	writeJSON(w, http.StatusCreated, project)
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	project := s.store.Snapshot().Projects[r.PathValue("id")]
	if project == nil || !canViewProject(actor, project) {
		writeError(w, http.StatusNotFound, "project_not_found", "共享项目不存在或无权访问")
		return
	}
	ensureProjectMaps(project)
	writeJSON(w, http.StatusOK, project)
}

func (s *Server) updateProject(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	projectID := r.PathValue("id")
	var input updateProjectInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	var updated store.SharedProject
	err := s.store.Update(func(state *store.State) error {
		project := state.Projects[projectID]
		if project == nil || !canViewProject(actor, project) {
			return errNotFound("共享项目不存在或无权访问")
		}
		if !canEditProject(actor, project) {
			return errForbidden("当前成员没有编辑项目的权限")
		}
		if input.BaseRevision <= 0 || input.BaseRevision != project.Revision {
			return errConflict("项目已经被其他成员更新，请刷新后重试")
		}
		if input.Name != nil {
			name := strings.TrimSpace(*input.Name)
			if name == "" || len([]rune(name)) > 120 {
				return errConflict("项目名称不能为空且不能超过 120 个字符")
			}
			project.Name = name
		}
		if input.Description != nil {
			project.Description = strings.TrimSpace(*input.Description)
		}
		if input.ClientProjectID != nil {
			project.ClientProjectID = strings.TrimSpace(*input.ClientProjectID)
		}
		if input.WorkspaceURI != nil {
			if err := validateWorkspaceURI(*input.WorkspaceURI); err != nil {
				return err
			}
			project.WorkspaceURI = strings.TrimSpace(*input.WorkspaceURI)
		}
		if input.Visibility != nil {
			visibility := normalizedProjectVisibility(*input.Visibility)
			if visibility == "organization" && project.OrgID == "" {
				return errConflict("组织可见项目需要组织标识")
			}
			project.Visibility = visibility
		}
		if input.Spec != nil {
			project.Spec = input.Spec
		}
		project.Revision++
		project.UpdatedAt = time.Now().UTC()
		appendProjectRevision(state, project, actor, project.UpdatedAt)
		updated = *project
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	_ = s.audit(r, "project.updated", projectID, map[string]any{"revision": updated.Revision})
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) setProjectMember(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	projectID := r.PathValue("id")
	userID := strings.TrimSpace(r.PathValue("userId"))
	var input projectMemberInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if userID == "" || (input.Role != "viewer" && input.Role != "editor" && input.Role != "owner") {
		writeError(w, http.StatusBadRequest, "invalid_member", "成员 ID 或角色无效")
		return
	}
	var updated store.SharedProject
	err := s.store.Update(func(state *store.State) error {
		project := state.Projects[projectID]
		if project == nil || !canViewProject(actor, project) {
			return errNotFound("共享项目不存在或无权访问")
		}
		if !canManageProject(actor, project) {
			return errForbidden("只有项目所有者或管理员可以管理成员")
		}
		if input.BaseRevision <= 0 || input.BaseRevision != project.Revision {
			return errConflict("项目已经被其他成员更新，请刷新后重试")
		}
		ensureProjectMaps(project)
		if err := s.validateProjectMemberTarget(userID, project); err != nil {
			return err
		}
		now := time.Now().UTC()
		if input.Role == "owner" {
			if project.OwnerID != userID {
				project.Members[project.OwnerID] = store.ProjectMember{UserID: project.OwnerID, Role: "editor", AddedBy: actor.Subject, AddedAt: now}
			}
			delete(project.Members, userID)
			project.OwnerID = userID
		} else if userID == project.OwnerID {
			return errConflict("不能把当前所有者直接降级，请先转移所有权")
		} else {
			project.Members[userID] = store.ProjectMember{UserID: userID, Role: input.Role, AddedBy: actor.Subject, AddedAt: now}
		}
		project.Revision++
		project.UpdatedAt = now
		appendProjectRevision(state, project, actor, now)
		updated = *project
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	_ = s.audit(r, "project.member.updated", projectID, map[string]any{"userId": userID, "role": input.Role, "revision": updated.Revision})
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) removeProjectMember(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	projectID := r.PathValue("id")
	userID := strings.TrimSpace(r.PathValue("userId"))
	baseRevision, err := parseProjectBaseRevision(r.URL.Query().Get("baseRevision"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_revision", "baseRevision 必须是正整数")
		return
	}
	var updated store.SharedProject
	err = s.store.Update(func(state *store.State) error {
		project := state.Projects[projectID]
		if project == nil || !canViewProject(actor, project) {
			return errNotFound("共享项目不存在或无权访问")
		}
		if !canManageProject(actor, project) {
			return errForbidden("只有项目所有者或管理员可以管理成员")
		}
		if baseRevision != project.Revision {
			return errConflict("项目已经被其他成员更新，请刷新后重试")
		}
		if userID == project.OwnerID {
			return errConflict("不能移除项目所有者，请先转移所有权")
		}
		ensureProjectMaps(project)
		if _, ok := project.Members[userID]; !ok {
			return errNotFound("项目成员不存在")
		}
		delete(project.Members, userID)
		now := time.Now().UTC()
		project.Revision++
		project.UpdatedAt = now
		appendProjectRevision(state, project, actor, now)
		updated = *project
		return nil
	})
	if err != nil {
		s.writeStoreError(w, err)
		return
	}
	_ = s.audit(r, "project.member.removed", projectID, map[string]any{"userId": userID, "revision": updated.Revision})
	writeJSON(w, http.StatusOK, updated)
}
