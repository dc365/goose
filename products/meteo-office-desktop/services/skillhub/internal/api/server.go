package api

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/store"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/trust"
)

const maxJSONBody = 2 << 20

type Server struct {
	store  *store.Store
	signer *trust.Signer
	auth   *auth.Authenticator
	logger *slog.Logger
	mux    *http.ServeMux
}

type Config struct {
	Store         *store.Store
	Signer        *trust.Signer
	Authenticator *auth.Authenticator
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
	s := &Server{store: config.Store, signer: config.Signer, auth: config.Authenticator, logger: logger, mux: http.NewServeMux()}
	s.routes()
	return s, nil
}
func (s *Server) Handler() http.Handler {
	return s.auth.Middleware(s.requestLog(s.securityHeaders(s.mux)))
}
func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.health)
	s.mux.HandleFunc("GET /v1/me", s.me)
	s.mux.HandleFunc("GET /v1/trust/keys", s.trustKeys)
	s.mux.HandleFunc("GET /v1/skills", s.listSkills)
	s.mux.HandleFunc("GET /v1/skills/{id}", s.getSkill)
	s.mux.HandleFunc("GET /v1/skills/{id}/versions/{version}", s.getVersion)
	s.mux.HandleFunc("GET /v1/skills/{id}/versions/{version}/download", s.downloadVersion)
	s.mux.HandleFunc("POST /v1/packages/inspect", s.inspectPackage)
	s.mux.HandleFunc("POST /v1/skills/{id}/versions", s.uploadVersion)
	s.mux.HandleFunc("POST /v1/skills/{id}/versions/{version}/publish", s.publishVersion)
	s.mux.HandleFunc("POST /v1/skills/{id}/versions/{version}/deprecate", s.deprecateVersion)
	s.mux.HandleFunc("GET /v1/collections", s.listCollections)
	s.mux.HandleFunc("PUT /v1/collections/{id}", s.putCollection)
	s.mux.HandleFunc("GET /v1/recommendations", s.recommendations)
	s.mux.HandleFunc("GET /v1/installations", s.listInstallations)
	s.mux.HandleFunc("POST /v1/installations", s.createInstallation)
	s.mux.HandleFunc("DELETE /v1/installations/{id}", s.deleteInstallation)
}
func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "meteomate-skillhub", "time": time.Now().UTC()})
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, auth.FromContext(r.Context()))
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
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
func (s *Server) audit(r *http.Request, action, target string, detail map[string]any) {
	actor := auth.FromContext(r.Context())
	event := map[string]any{"time": time.Now().UTC(), "action": action, "target": target, "actor": actor, "remote": r.RemoteAddr, "detail": detail}
	if err := s.store.AppendAudit(event); err != nil {
		s.logger.Error("audit_write_failed", "error", err)
	}
}
