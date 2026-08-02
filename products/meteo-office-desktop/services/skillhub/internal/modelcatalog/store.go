package modelcatalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxProviders = 64
	maxModels    = 128
)

var (
	providerIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	secretRefPattern  = regexp.MustCompile(`^(env|vault|secret|k8s)://[^\s]+$`)
)

type VerificationCheck struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

type Verification struct {
	Status    string              `json:"status"`
	CheckedAt *time.Time          `json:"checkedAt,omitempty"`
	CheckedBy string              `json:"checkedBy,omitempty"`
	Message   string              `json:"message,omitempty"`
	Checks    []VerificationCheck `json:"checks"`
}

type Model struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	Enabled         bool         `json:"enabled"`
	ToolCall        bool         `json:"toolCall"`
	ImageInput      bool         `json:"imageInput"`
	Reasoning       bool         `json:"reasoning"`
	ContextLimit    int          `json:"contextLimit,omitempty"`
	MaxOutputTokens int          `json:"maxOutputTokens,omitempty"`
	Verification    Verification `json:"verification"`
}

type Provider struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	Description    string       `json:"description,omitempty"`
	Enabled        bool         `json:"enabled"`
	PresetMode     string       `json:"presetMode"`
	Protocol       string       `json:"protocol"`
	StreamingMode  string       `json:"streamingMode"`
	BaseURL        string       `json:"baseUrl"`
	EndpointPath   string       `json:"endpointPath,omitempty"`
	RequiresAuth   bool         `json:"requiresAuth"`
	CredentialMode string       `json:"credentialMode"`
	SecretRef      string       `json:"secretRef,omitempty"`
	Models         []Model      `json:"models"`
	Verification   Verification `json:"verification"`
	Revision       int          `json:"revision"`
	CreatedAt      time.Time    `json:"createdAt"`
	UpdatedAt      time.Time    `json:"updatedAt"`
}

type ProviderInput struct {
	Name           string  `json:"name"`
	Description    string  `json:"description,omitempty"`
	Enabled        bool    `json:"enabled"`
	PresetMode     string  `json:"presetMode"`
	Protocol       string  `json:"protocol"`
	StreamingMode  string  `json:"streamingMode"`
	BaseURL        string  `json:"baseUrl"`
	EndpointPath   string  `json:"endpointPath,omitempty"`
	RequiresAuth   bool    `json:"requiresAuth"`
	CredentialMode string  `json:"credentialMode"`
	SecretRef      string  `json:"secretRef,omitempty"`
	Models         []Model `json:"models"`
}

type VerificationReport struct {
	ModelID string              `json:"modelId"`
	Status  string              `json:"status"`
	Message string              `json:"message,omitempty"`
	Checks  []VerificationCheck `json:"checks"`
}

type State struct {
	APIVersion string               `json:"apiVersion"`
	Kind       string               `json:"kind"`
	Version    int                  `json:"version"`
	Revision   int                  `json:"revision"`
	Providers  map[string]*Provider `json:"providers"`
	UpdatedAt  time.Time            `json:"updatedAt"`
}

type PublicProvider struct {
	ID                   string       `json:"id"`
	Name                 string       `json:"name"`
	Description          string       `json:"description,omitempty"`
	Enabled              bool         `json:"enabled"`
	PresetMode           string       `json:"presetMode"`
	Protocol             string       `json:"protocol"`
	StreamingMode        string       `json:"streamingMode"`
	BaseURL              string       `json:"baseUrl"`
	EndpointPath         string       `json:"endpointPath,omitempty"`
	RequiresAuth         bool         `json:"requiresAuth"`
	CredentialMode       string       `json:"credentialMode"`
	CredentialConfigured bool         `json:"credentialConfigured"`
	Models               []Model      `json:"models"`
	Verification         Verification `json:"verification"`
	Revision             int          `json:"revision"`
	UpdatedAt            time.Time    `json:"updatedAt"`
}

type PublicCatalog struct {
	APIVersion string           `json:"apiVersion"`
	Kind       string           `json:"kind"`
	Revision   int              `json:"revision"`
	Providers  []PublicProvider `json:"providers"`
	UpdatedAt  time.Time        `json:"updatedAt"`
}

type Store struct {
	mu    sync.RWMutex
	path  string
	state State
}

func NewMemory() *Store {
	return &Store{state: emptyState()}
}

func Open(root string) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("model catalog data root is required")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, err
	}
	store := NewMemory()
	store.path = filepath.Join(abs, "model-catalog.json")
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) Snapshot() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneState(s.state)
}

func (s *Store) PublicCatalog() PublicCatalog {
	state := s.Snapshot()
	providers := make([]PublicProvider, 0, len(state.Providers))
	for _, provider := range state.Providers {
		providers = append(providers, PublicProvider{
			ID: provider.ID, Name: provider.Name, Description: provider.Description,
			Enabled: provider.Enabled, PresetMode: provider.PresetMode, Protocol: provider.Protocol,
			StreamingMode: provider.StreamingMode, BaseURL: provider.BaseURL, EndpointPath: provider.EndpointPath,
			RequiresAuth: provider.RequiresAuth, CredentialMode: provider.CredentialMode,
			CredentialConfigured: provider.CredentialMode == "secret_ref" && provider.SecretRef != "",
			Models:               cloneModels(provider.Models), Verification: provider.Verification,
			Revision: provider.Revision, UpdatedAt: provider.UpdatedAt,
		})
	}
	sort.Slice(providers, func(i, j int) bool { return providers[i].Name < providers[j].Name })
	return PublicCatalog{
		APIVersion: state.APIVersion,
		Kind:       "OrganizationModelCatalog",
		Revision:   state.Revision,
		Providers:  providers,
		UpdatedAt:  state.UpdatedAt,
	}
}

func (s *Store) Put(id string, input ProviderInput) (Provider, error) {
	provider, err := normalizeProvider(id, input)
	if err != nil {
		return Provider{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.state.Providers[id]; !exists && len(s.state.Providers) >= maxProviders {
		return Provider{}, fmt.Errorf("model catalog cannot contain more than %d providers", maxProviders)
	}
	now := time.Now().UTC()
	previous := s.state.Providers[id]
	provider.ID = id
	provider.CreatedAt = now
	provider.Revision = 1
	provider.Verification = untestedVerification()
	if previous != nil {
		provider.CreatedAt = previous.CreatedAt
		provider.Revision = previous.Revision + 1
		provider.Verification = cloneVerification(previous.Verification)
		for index := range provider.Models {
			if oldModel := findModel(previous.Models, provider.Models[index].ID); oldModel != nil {
				provider.Models[index].Verification = cloneVerification(oldModel.Verification)
			}
		}
	}
	provider.UpdatedAt = now
	s.state.Providers[id] = &provider
	if err := s.saveLocked(); err != nil {
		if previous == nil {
			delete(s.state.Providers, id)
		} else {
			s.state.Providers[id] = previous
		}
		return Provider{}, err
	}
	return *cloneProvider(&provider), nil
}

func (s *Store) Delete(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, exists := s.state.Providers[id]
	if !exists {
		return false, nil
	}
	delete(s.state.Providers, id)
	if err := s.saveLocked(); err != nil {
		s.state.Providers[id] = previous
		return false, err
	}
	return true, nil
}

func (s *Store) RecordVerification(providerID, actor string, report VerificationReport) (Provider, error) {
	report, err := normalizeVerificationReport(report)
	if err != nil {
		return Provider{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	provider := s.state.Providers[providerID]
	if provider == nil {
		return Provider{}, errors.New("model provider not found")
	}
	model := findModel(provider.Models, report.ModelID)
	if model == nil {
		return Provider{}, errors.New("model not found in provider catalog")
	}
	previous := cloneProvider(provider)
	now := time.Now().UTC()
	verification := Verification{
		Status: report.Status, CheckedAt: &now, CheckedBy: strings.TrimSpace(actor),
		Message: report.Message, Checks: append([]VerificationCheck(nil), report.Checks...),
	}
	model.Verification = verification
	provider.Verification = verification
	provider.Revision++
	provider.UpdatedAt = now
	if err := s.saveLocked(); err != nil {
		s.state.Providers[providerID] = previous
		return Provider{}, err
	}
	return *cloneProvider(provider), nil
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s.saveLocked()
	}
	if err != nil {
		return err
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		recovery := fmt.Sprintf("%s.corrupt-%d", s.path, time.Now().Unix())
		_ = os.WriteFile(recovery, data, 0o600)
		return fmt.Errorf("decode model catalog (backup: %s): %w", recovery, err)
	}
	if state.Providers == nil {
		state.Providers = map[string]*Provider{}
	}
	if state.APIVersion == "" {
		state.APIVersion = "meteomate.ai/v1"
	}
	if state.Kind == "" {
		state.Kind = "OrganizationModelCatalogState"
	}
	if state.Version == 0 {
		state.Version = 1
	}
	for id, provider := range state.Providers {
		input := ProviderInput{
			Name: provider.Name, Description: provider.Description, Enabled: provider.Enabled,
			PresetMode: provider.PresetMode, Protocol: provider.Protocol, StreamingMode: provider.StreamingMode,
			BaseURL: provider.BaseURL, EndpointPath: provider.EndpointPath, RequiresAuth: provider.RequiresAuth,
			CredentialMode: provider.CredentialMode, SecretRef: provider.SecretRef, Models: provider.Models,
		}
		normalized, normalizeErr := normalizeProvider(id, input)
		if normalizeErr != nil {
			return fmt.Errorf("invalid model provider %s: %w", id, normalizeErr)
		}
		normalized.ID = id
		normalized.Revision = provider.Revision
		normalized.CreatedAt = provider.CreatedAt
		normalized.UpdatedAt = provider.UpdatedAt
		normalized.Verification = normalizeStoredVerification(provider.Verification)
		for index := range normalized.Models {
			if stored := findModel(provider.Models, normalized.Models[index].ID); stored != nil {
				normalized.Models[index].Verification = normalizeStoredVerification(stored.Verification)
			}
		}
		state.Providers[id] = &normalized
	}
	s.state = state
	return nil
}

func (s *Store) saveLocked() error {
	s.state.Revision++
	s.state.UpdatedAt = time.Now().UTC()
	if s.path == "" {
		return nil
	}
	data, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	temporary := fmt.Sprintf("%s.tmp-%d", s.path, time.Now().UnixNano())
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, s.path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func emptyState() State {
	return State{
		APIVersion: "meteomate.ai/v1", Kind: "OrganizationModelCatalogState", Version: 1,
		Providers: map[string]*Provider{},
	}
}

func normalizeProvider(id string, input ProviderInput) (Provider, error) {
	id = strings.TrimSpace(id)
	if !providerIDPattern.MatchString(id) {
		return Provider{}, errors.New("provider id must use lowercase letters, numbers, dots, underscores, or hyphens")
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 80 {
		return Provider{}, errors.New("provider name is required and cannot exceed 80 characters")
	}
	description := strings.TrimSpace(input.Description)
	if len([]rune(description)) > 500 {
		return Provider{}, errors.New("provider description cannot exceed 500 characters")
	}
	baseURL, err := normalizeBaseURL(input.BaseURL)
	if err != nil {
		return Provider{}, err
	}
	presetMode := strings.TrimSpace(input.PresetMode)
	if presetMode == "" {
		presetMode = "openai-compatible"
	}
	if presetMode != "openai-compatible" && presetMode != "volcengine-ark" {
		return Provider{}, errors.New("presetMode must be openai-compatible or volcengine-ark")
	}
	protocol := strings.TrimSpace(input.Protocol)
	if protocol != "chat_completions" && protocol != "responses" {
		return Provider{}, errors.New("protocol must be chat_completions or responses")
	}
	streamingMode := strings.TrimSpace(input.StreamingMode)
	if streamingMode == "" {
		streamingMode = "auto"
	}
	if streamingMode != "auto" && streamingMode != "on" && streamingMode != "off" {
		return Provider{}, errors.New("streamingMode must be auto, on, or off")
	}
	endpointPath := strings.Trim(strings.TrimSpace(input.EndpointPath), "/")
	if strings.ContainsAny(endpointPath, "?#") || len(endpointPath) > 240 {
		return Provider{}, errors.New("endpointPath must be a relative path without query or fragment")
	}
	credentialMode := strings.TrimSpace(input.CredentialMode)
	secretRef := strings.TrimSpace(input.SecretRef)
	if !input.RequiresAuth {
		credentialMode = "none"
		secretRef = ""
	} else {
		if credentialMode == "" {
			credentialMode = "local"
		}
		if credentialMode != "local" && credentialMode != "secret_ref" {
			return Provider{}, errors.New("credentialMode must be local or secret_ref when authentication is required")
		}
		if credentialMode == "secret_ref" && !secretRefPattern.MatchString(secretRef) {
			return Provider{}, errors.New("secretRef must use env://, vault://, secret://, or k8s:// and cannot contain plaintext credentials")
		}
		if credentialMode == "local" {
			secretRef = ""
		}
	}
	models, err := normalizeModels(input.Models)
	if err != nil {
		return Provider{}, err
	}
	return Provider{
		ID: id, Name: name, Description: description, Enabled: input.Enabled,
		PresetMode: presetMode, Protocol: protocol, StreamingMode: streamingMode,
		BaseURL: baseURL, EndpointPath: endpointPath, RequiresAuth: input.RequiresAuth,
		CredentialMode: credentialMode, SecretRef: secretRef, Models: models,
		Verification: untestedVerification(),
	}, nil
}

func normalizeBaseURL(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("baseUrl must be an absolute HTTP or HTTPS URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("baseUrl cannot contain credentials, query, or fragment")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return parsed.String(), nil
}

func normalizeModels(input []Model) ([]Model, error) {
	if len(input) == 0 {
		return nil, errors.New("provider must contain at least one model")
	}
	if len(input) > maxModels {
		return nil, fmt.Errorf("provider cannot contain more than %d models", maxModels)
	}
	seen := map[string]struct{}{}
	models := make([]Model, 0, len(input))
	for _, model := range input {
		model.ID = strings.TrimSpace(model.ID)
		model.Name = strings.TrimSpace(model.Name)
		if model.ID == "" || len([]rune(model.ID)) > 160 || strings.ContainsAny(model.ID, "\r\n\t") {
			return nil, errors.New("model id is required, cannot exceed 160 characters, and cannot contain control whitespace")
		}
		if _, exists := seen[model.ID]; exists {
			return nil, fmt.Errorf("duplicate model id: %s", model.ID)
		}
		seen[model.ID] = struct{}{}
		if model.Name == "" {
			model.Name = model.ID
		}
		if len([]rune(model.Name)) > 100 {
			return nil, fmt.Errorf("model name cannot exceed 100 characters: %s", model.ID)
		}
		if model.ContextLimit < 0 || model.MaxOutputTokens < 0 {
			return nil, fmt.Errorf("model token limits cannot be negative: %s", model.ID)
		}
		model.Verification = untestedVerification()
		models = append(models, model)
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models, nil
}

func normalizeVerificationReport(input VerificationReport) (VerificationReport, error) {
	input.ModelID = strings.TrimSpace(input.ModelID)
	input.Message = strings.TrimSpace(input.Message)
	if input.ModelID == "" {
		return VerificationReport{}, errors.New("modelId is required")
	}
	if input.Status != "verified" && input.Status != "failed" {
		return VerificationReport{}, errors.New("verification status must be verified or failed")
	}
	if len([]rune(input.Message)) > 500 {
		return VerificationReport{}, errors.New("verification message cannot exceed 500 characters")
	}
	allowedChecks := map[string]bool{
		"text": true, "streaming": true, "tool_call": true, "image_input": true, "reasoning": true,
	}
	seen := map[string]bool{}
	checks := make([]VerificationCheck, 0, len(input.Checks))
	for _, check := range input.Checks {
		check.ID = strings.TrimSpace(check.ID)
		check.Message = strings.TrimSpace(check.Message)
		if !allowedChecks[check.ID] || seen[check.ID] {
			return VerificationReport{}, fmt.Errorf("unsupported or duplicate verification check: %s", check.ID)
		}
		if check.Status != "passed" && check.Status != "failed" && check.Status != "skipped" {
			return VerificationReport{}, fmt.Errorf("invalid verification check status: %s", check.Status)
		}
		seen[check.ID] = true
		checks = append(checks, check)
	}
	input.Checks = checks
	return input, nil
}

func untestedVerification() Verification {
	return Verification{Status: "untested", Checks: []VerificationCheck{}}
}

func normalizeStoredVerification(input Verification) Verification {
	if input.Status != "verified" && input.Status != "failed" {
		return untestedVerification()
	}
	input.Checks = append([]VerificationCheck(nil), input.Checks...)
	return input
}

func findModel(models []Model, id string) *Model {
	for index := range models {
		if models[index].ID == id {
			return &models[index]
		}
	}
	return nil
}

func cloneVerification(input Verification) Verification {
	input.Checks = append([]VerificationCheck(nil), input.Checks...)
	return input
}

func cloneModels(input []Model) []Model {
	models := append([]Model(nil), input...)
	for index := range models {
		models[index].Verification = cloneVerification(models[index].Verification)
	}
	return models
}

func cloneProvider(input *Provider) *Provider {
	if input == nil {
		return nil
	}
	copy := *input
	copy.Models = cloneModels(input.Models)
	copy.Verification = cloneVerification(input.Verification)
	return &copy
}

func cloneState(input State) State {
	copy := input
	copy.Providers = make(map[string]*Provider, len(input.Providers))
	for id, provider := range input.Providers {
		copy.Providers[id] = cloneProvider(provider)
	}
	return copy
}
