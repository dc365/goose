package api

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/adminui"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/policy"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

const maxJSONBody = 2 << 20

type Server struct {
	store    *store.Store
	signer   *trust.Signer
	auth     *auth.Authenticator
	logger   *slog.Logger
	mux      *http.ServeMux
	logins   *loginLimiter
	policies *policy.Store
}

type Config struct {
	Store         *store.Store
	Signer        *trust.Signer
	Authenticator *auth.Authenticator
	Policies      *policy.Store
	Logger        *slog.Logger
}

func New(config Config) (*Server, error) {
	if config.Store == nil || config.Signer == nil || config.Authenticator == nil {
		return nil, errors.New("store, signer and authenticator are required")
	}
	logger := config.Logger
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}
	policies := config.Policies
	if policies == nil {
		policies = policy.NewMemory()
	}
	s := &Server{
		store: config.Store, signer: config.Signer, auth: config.Authenticator,
		logger: logger, mux: http.NewServeMux(), logins: newLoginLimiter(), policies: policies,
	}
	s.routes()
	return s, nil
}
func (s *Server) Handler() http.Handler {
	return s.auth.Middleware(s.requestLog(s.securityHeaders(s.auditGate(s.mux))))
}
func (s *Server) routes() {
	s.mux.Handle("GET /admin", http.RedirectHandler("/admin/", http.StatusTemporaryRedirect))
	s.mux.Handle("GET /admin/", adminui.Handler())
	s.mux.Handle("GET /favicon.ico", adminui.Handler())
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("POST /v1/auth/login", s.login)
	s.mux.HandleFunc("POST /v1/auth/logout", s.logout)
	s.mux.HandleFunc("GET /v1/me", s.me)
	s.mux.HandleFunc("PATCH /v1/me", s.updateMe)
	s.mux.HandleFunc("POST /v1/me/password", s.changePassword)
	s.mux.HandleFunc("GET /v1/me/policy", s.myPolicy)
	s.mux.HandleFunc("GET /v1/admin/users", s.listUsers)
	s.mux.HandleFunc("POST /v1/admin/users", s.createUser)
	s.mux.HandleFunc("PATCH /v1/admin/users/{id}", s.updateUser)
	s.mux.HandleFunc("POST /v1/admin/users/{id}/reset-password", s.resetUserPassword)
	s.mux.HandleFunc("POST /v1/admin/users/{id}/revoke-sessions", s.revokeUserSessions)
	s.mux.HandleFunc("GET /v1/admin/sessions", s.listSessions)
	s.mux.HandleFunc("DELETE /v1/admin/sessions/{id}", s.revokeSession)
	s.mux.HandleFunc("GET /v1/admin/audit", s.listAudit)
	s.mux.HandleFunc("GET /v1/admin/policies", s.listPolicies)
	s.mux.HandleFunc("PUT /v1/admin/policies/organization", s.updateOrganizationPolicy)
	s.mux.HandleFunc("PUT /v1/admin/policies/roles/{role}", s.updateRolePolicy)
	s.mux.HandleFunc("DELETE /v1/admin/policies/roles/{role}", s.deleteRolePolicy)
	s.mux.HandleFunc("PUT /v1/admin/policies/users/{id}", s.updateUserPolicy)
	s.mux.HandleFunc("DELETE /v1/admin/policies/users/{id}", s.deleteUserPolicy)
	s.mux.HandleFunc("GET /v1/admin/policies/effective/users/{id}", s.previewUserPolicy)
	s.mux.HandleFunc("GET /v1/trust/keys", s.trustKeys)
	s.mux.HandleFunc("GET /v1/skills", s.listSkills)
	s.mux.HandleFunc("GET /v1/skills/{id}", s.getSkill)
	s.mux.HandleFunc("PATCH /v1/skills/{id}", s.updateSkill)
	s.mux.HandleFunc("GET /v1/skills/{id}/versions/{version}", s.getVersion)
	s.mux.HandleFunc("GET /v1/skills/{id}/versions/{version}/download", s.downloadVersion)
	s.mux.HandleFunc("GET /v1/projects", s.listProjects)
	s.mux.HandleFunc("POST /v1/projects", s.createProject)
	s.mux.HandleFunc("GET /v1/projects/{id}", s.getProject)
	s.mux.HandleFunc("PUT /v1/projects/{id}", s.updateProject)
	s.mux.HandleFunc("PUT /v1/projects/{id}/members/{userId}", s.setProjectMember)
	s.mux.HandleFunc("DELETE /v1/projects/{id}/members/{userId}", s.removeProjectMember)
	s.mux.HandleFunc("GET /v1/experts", s.listExperts)
	s.mux.HandleFunc("POST /v1/experts", s.createExpert)
	s.mux.HandleFunc("GET /v1/experts/{id}", s.getExpert)
	s.mux.HandleFunc("PUT /v1/experts/{id}", s.updateExpert)
	s.mux.HandleFunc("POST /v1/experts/{id}/submit-review", s.submitExpertReview)
	s.mux.HandleFunc("POST /v1/experts/{id}/review", s.reviewExpert)
	s.mux.HandleFunc("POST /v1/experts/{id}/status", s.setExpertStatus)
	s.mux.HandleFunc("PUT /v1/experts/{id}/distribution", s.updateExpertDistribution)
	s.mux.HandleFunc("POST /v1/experts/{id}/rollback/{revision}", s.rollbackExpert)
	s.mux.HandleFunc("GET /v1/experts/{id}/revisions", s.listExpertRevisions)
	s.mux.HandleFunc("GET /v1/experts/{id}/revisions/{revision}", s.getExpertRevision)
	s.mux.HandleFunc("POST /v1/packages/inspect", s.inspectPackage)
	s.mux.HandleFunc("POST /v1/skills/{id}/versions", s.uploadVersion)
	s.mux.HandleFunc("POST /v1/skills/{id}/versions/{version}/publish", s.publishVersion)
	s.mux.HandleFunc("POST /v1/skills/{id}/versions/{version}/reject", s.rejectVersionReview)
	s.mux.HandleFunc("POST /v1/skills/{id}/versions/{version}/deprecate", s.deprecateVersion)
	s.mux.HandleFunc("GET /v1/collections", s.listCollections)
	s.mux.HandleFunc("PUT /v1/collections/{id}", s.putCollection)
	s.mux.HandleFunc("DELETE /v1/collections/{id}", s.deleteCollection)
	s.mux.HandleFunc("GET /v1/admin/recommendation-rules", s.listRecommendationRules)
	s.mux.HandleFunc("PUT /v1/admin/recommendation-rules/{id}", s.putRecommendationRule)
	s.mux.HandleFunc("DELETE /v1/admin/recommendation-rules/{id}", s.deleteRecommendationRule)
	s.mux.HandleFunc("PUT /v1/admin/featured-placements", s.putFeaturedPlacements)
	s.mux.HandleFunc("GET /v1/recommendations", s.recommendations)
	s.mux.HandleFunc("GET /v1/installations", s.listInstallations)
	s.mux.HandleFunc("POST /v1/installations", s.createInstallation)
	s.mux.HandleFunc("DELETE /v1/installations/{id}", s.deleteInstallation)
	s.mux.HandleFunc("GET /v1/admin/installations/summary", s.installationSummary)
}
func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "meteomate-skillhub", "time": time.Now().UTC()})
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	response := map[string]any{"authenticated": actor.Authenticated(), "actor": actor}
	if accounts := s.auth.Accounts(); accounts != nil && actor.Authenticated() {
		if user, ok := accounts.Get(actor.Subject); ok {
			response["user"] = user.Public()
		}
	}
	writeJSON(w, http.StatusOK, response)
}
func (s *Server) trustKeys(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"keys": []trust.PublicKey{s.signer.PublicKey()}})
}
func (s *Server) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		s.logger.Info("http_request", "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(started).Milliseconds(), "actor", auth.FromContext(r.Context()).Subject)
	})
}
func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) auditGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		statefulDownload := r.Method == http.MethodGet &&
			strings.HasPrefix(r.URL.Path, "/v1/skills/") && strings.HasSuffix(r.URL.Path, "/download")
		switch {
		case statefulDownload,
			r.Method == http.MethodPost,
			r.Method == http.MethodPut,
			r.Method == http.MethodPatch,
			r.Method == http.MethodDelete:
			if err := s.audit(r, "request.mutation", r.URL.Path, map[string]any{"method": r.Method}); err != nil {
				writeError(w, http.StatusServiceUnavailable, "audit_unavailable", "审计服务不可用，已拒绝变更操作")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) audit(r *http.Request, action, target string, detail map[string]any) error {
	return s.auditAs(r, auth.FromContext(r.Context()), action, target, detail)
}

func (s *Server) auditAs(r *http.Request, actor auth.Actor, action, target string, detail map[string]any) error {
	event := store.AuditEvent{
		Time: time.Now().UTC(), Action: action, Target: target,
		Actor:  store.AuditActor{Subject: actor.Subject, Name: actor.Name, Role: actor.Role, OrgID: actor.OrgID},
		Remote: r.RemoteAddr, Detail: detail,
	}
	if err := s.store.AppendAudit(event); err != nil {
		s.logger.Error("audit_write_failed", "error", err)
		return err
	}
	return nil
}
