package api

import (
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/auth"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/modelcatalog"
	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/policy"
)

func (s *Server) myModelCatalog(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context())
	if !actor.Authenticated() {
		writeError(w, http.StatusUnauthorized, "authentication_required", "登录后才能读取组织模型目录")
		return
	}
	effective := s.policies.Effective(actor.Subject, actor.Role)
	writeJSON(w, http.StatusOK, filterPublicCatalog(s.models.PublicCatalog(), effective))
}

func (s *Server) listModelProviders(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, s.models.Snapshot())
}

func (s *Server) putModelProvider(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	providerID := strings.TrimSpace(r.PathValue("id"))
	var input modelcatalog.ProviderInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if err := s.validateProviderMutation(providerID, input); err != nil {
		writeError(w, http.StatusConflict, "provider_referenced_by_policy", err.Error())
		return
	}
	provider, err := s.models.Put(providerID, input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "model_provider_update_failed", err.Error())
		return
	}
	s.audit(r, "model.provider.put", providerID, map[string]any{
		"revision": provider.Revision, "protocol": provider.Protocol, "models": len(provider.Models),
	})
	writeJSON(w, http.StatusOK, provider)
}

func (s *Server) deleteModelProvider(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	providerID := strings.TrimSpace(r.PathValue("id"))
	if references := s.modelPolicyReferences(providerID); len(references) > 0 {
		writeError(w, http.StatusConflict, "provider_referenced_by_policy", "提供商仍被策略引用："+strings.Join(references, "、"))
		return
	}
	deleted, err := s.models.Delete(providerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "model_provider_delete_failed", err.Error())
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "model_provider_not_found", "模型提供商不存在")
		return
	}
	s.audit(r, "model.provider.delete", providerID, nil)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "id": providerID})
}

func (s *Server) recordModelProviderVerification(w http.ResponseWriter, r *http.Request) {
	if !requireAdmin(w, r) {
		return
	}
	providerID := strings.TrimSpace(r.PathValue("id"))
	var input modelcatalog.VerificationReport
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	actor := auth.FromContext(r.Context())
	provider, err := s.models.RecordVerification(providerID, actor.Subject, input)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "model_provider_not_found", err.Error())
			return
		}
		writeError(w, http.StatusBadRequest, "model_verification_failed", err.Error())
		return
	}
	s.audit(r, "model.provider.verify", providerID+"/"+input.ModelID, map[string]any{
		"status": input.Status, "revision": provider.Revision,
	})
	writeJSON(w, http.StatusOK, provider)
}

func filterPublicCatalog(catalog modelcatalog.PublicCatalog, effective policy.Effective) modelcatalog.PublicCatalog {
	allowedProviders := makeSet(effective.AllowedProviderIDs)
	allowedModels := makeSet(effective.AllowedModels)
	providers := make([]modelcatalog.PublicProvider, 0, len(catalog.Providers))
	for _, provider := range catalog.Providers {
		if !provider.Enabled || (len(allowedProviders) > 0 && !allowedProviders[provider.ID]) {
			continue
		}
		models := make([]modelcatalog.Model, 0, len(provider.Models))
		for _, model := range provider.Models {
			ref := provider.ID + "/" + model.ID
			if !model.Enabled || (len(allowedModels) > 0 && !allowedModels[ref]) {
				continue
			}
			if effective.RequireVerifiedModels && model.Verification.Status != "verified" {
				continue
			}
			models = append(models, model)
		}
		if len(models) == 0 {
			continue
		}
		provider.Models = models
		providers = append(providers, provider)
	}
	catalog.Providers = providers
	return catalog
}

func (s *Server) validateProviderMutation(providerID string, input modelcatalog.ProviderInput) error {
	references := s.modelPolicyReferences(providerID)
	if len(references) == 0 {
		return nil
	}
	if !input.Enabled {
		return errors.New("提供商已被策略引用，不能停用")
	}
	available := map[string]bool{}
	for _, model := range input.Models {
		if model.Enabled {
			available[providerID+"/"+strings.TrimSpace(model.ID)] = true
		}
	}
	missing := []string{}
	for _, reference := range references {
		if strings.HasPrefix(reference, providerID+"/") && !available[reference] {
			missing = append(missing, reference)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return errors.New("以下策略模型仍在使用，不能删除或停用：" + strings.Join(missing, "、"))
	}
	return nil
}

func (s *Server) modelPolicyReferences(providerID string) []string {
	state := s.policies.Snapshot()
	references := map[string]bool{}
	collectSettingsReferences(references, providerID, state.Organization.DefaultModel, state.Organization.AllowedModels, state.Organization.AllowedProviderIDs)
	for _, patch := range state.Roles {
		collectPatchReferences(references, providerID, patch)
	}
	for _, patch := range state.Users {
		collectPatchReferences(references, providerID, patch)
	}
	result := make([]string, 0, len(references))
	for reference := range references {
		result = append(result, reference)
	}
	sort.Strings(result)
	return result
}

func collectSettingsReferences(output map[string]bool, providerID, defaultModel string, allowedModels, allowedProviderIDs []string) {
	if containsValue(allowedProviderIDs, providerID) {
		output[providerID] = true
	}
	for _, model := range append([]string{defaultModel}, allowedModels...) {
		if strings.HasPrefix(model, providerID+"/") {
			output[model] = true
		}
	}
}

func collectPatchReferences(output map[string]bool, providerID string, patch policy.Patch) {
	defaultModel := ""
	if patch.DefaultModel != nil {
		defaultModel = *patch.DefaultModel
	}
	models := []string{}
	if patch.AllowedModels != nil {
		models = *patch.AllowedModels
	}
	providers := []string{}
	if patch.AllowedProviderIDs != nil {
		providers = *patch.AllowedProviderIDs
	}
	collectSettingsReferences(output, providerID, defaultModel, models, providers)
}

func (s *Server) validatePolicySettingsAgainstCatalog(settings policy.Settings) error {
	return validateModelPolicyReferences(s.models.Snapshot(), settings.DefaultModel, settings.AllowedModels, settings.AllowedProviderIDs, settings.RequireVerifiedModels)
}

func applyModelPolicyPatch(settings *policy.Settings, patch policy.Patch) {
	if patch.DefaultModel != nil {
		settings.DefaultModel = *patch.DefaultModel
	}
	if patch.AllowedModels != nil {
		settings.AllowedModels = append([]string(nil), (*patch.AllowedModels)...)
	}
	if patch.AllowedProviderIDs != nil {
		settings.AllowedProviderIDs = append([]string(nil), (*patch.AllowedProviderIDs)...)
	}
	if patch.RequireVerifiedModels != nil {
		settings.RequireVerifiedModels = *patch.RequireVerifiedModels
	}
}

func validateModelPolicyReferences(catalog modelcatalog.State, defaultModel string, models, providers []string, requireVerified bool) error {
	if len(catalog.Providers) == 0 {
		return nil
	}
	for _, providerID := range providers {
		provider := catalog.Providers[providerID]
		if provider == nil || !provider.Enabled {
			return errors.New("策略引用了不存在或已停用的提供商：" + providerID)
		}
	}
	references := append([]string{}, models...)
	if strings.TrimSpace(defaultModel) != "" {
		references = append(references, defaultModel)
	}
	for _, reference := range references {
		providerID, modelID, ok := strings.Cut(reference, "/")
		if !ok || providerID == "" || modelID == "" {
			return errors.New("模型必须使用 provider/model 格式：" + reference)
		}
		provider := catalog.Providers[providerID]
		if provider == nil || !provider.Enabled {
			return errors.New("策略引用了不存在或已停用的提供商：" + providerID)
		}
		model := catalogModel(provider.Models, modelID)
		if model == nil || !model.Enabled {
			return errors.New("策略引用了不存在或已停用的模型：" + reference)
		}
		if requireVerified && model.Verification.Status != "verified" {
			return errors.New("策略要求仅使用已验证模型，但模型尚未验证：" + reference)
		}
	}
	return nil
}

func catalogModel(models []modelcatalog.Model, id string) *modelcatalog.Model {
	for index := range models {
		if models[index].ID == id {
			return &models[index]
		}
	}
	return nil
}

func makeSet(values []string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

func containsValue(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
