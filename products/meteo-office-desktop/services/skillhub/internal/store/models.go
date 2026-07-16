package store

import (
	"time"

	"github.com/dc365/goose/products/meteo-office-desktop/services/skillhub/internal/skillpkg"
)

type Publisher struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	OrgID string `json:"orgId,omitempty"`
}

type Signature struct {
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"keyId"`
	Value     string `json:"value"`
}

type Skill struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Summary       string    `json:"summary"`
	Description   string    `json:"description"`
	Categories    []string  `json:"categories"`
	Tags          []string  `json:"tags"`
	Icon          string    `json:"icon,omitempty"`
	Publisher     Publisher `json:"publisher"`
	OwnerID       string    `json:"ownerId"`
	OrgID         string    `json:"orgId,omitempty"`
	Visibility    string    `json:"visibility"`
	Status        string    `json:"status"`
	Featured      bool      `json:"featured"`
	LatestVersion string    `json:"latestVersion,omitempty"`
	Versions      []string  `json:"versions"`
	Downloads     int64     `json:"downloads"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type SkillVersion struct {
	SkillID       string                `json:"skillId"`
	Version       string                `json:"version"`
	Status        string                `json:"status"`
	Changelog     string                `json:"changelog,omitempty"`
	PackageDigest string                `json:"packageDigest"`
	PackageSize   int64                 `json:"packageSize"`
	Integrity     string                `json:"integrity"`
	Manifest      skillpkg.Skill        `json:"manifest"`
	Sidecar       map[string]any        `json:"sidecar,omitempty"`
	Files         []skillpkg.FileRecord `json:"files"`
	Risk          skillpkg.RiskReport   `json:"risk"`
	Warnings      []string              `json:"warnings,omitempty"`
	Signature     *Signature            `json:"signature,omitempty"`
	CreatedBy     string                `json:"createdBy"`
	CreatedAt     time.Time             `json:"createdAt"`
	PublishedAt   *time.Time            `json:"publishedAt,omitempty"`
	DeprecatedAt  *time.Time            `json:"deprecatedAt,omitempty"`
}

type SkillRef struct {
	SkillID string `json:"skillId"`
	Version string `json:"version,omitempty"`
}

type Collection struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Featured    bool       `json:"featured"`
	Skills      []SkillRef `json:"skills"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type Installation struct {
	ID          string    `json:"id"`
	ClientID    string    `json:"clientId"`
	UserID      string    `json:"userId"`
	OrgID       string    `json:"orgId,omitempty"`
	SkillID     string    `json:"skillId"`
	Version     string    `json:"version"`
	Scope       string    `json:"scope"`
	ProjectID   string    `json:"projectId,omitempty"`
	InstalledAt time.Time `json:"installedAt"`
	LastSeenAt  time.Time `json:"lastSeenAt"`
}

type State struct {
	APIVersion    string                   `json:"apiVersion"`
	Kind          string                   `json:"kind"`
	Version       int                      `json:"version"`
	Skills        map[string]*Skill        `json:"skills"`
	SkillVersions map[string]*SkillVersion `json:"skillVersions"`
	Collections   map[string]*Collection   `json:"collections"`
	Installations map[string]*Installation `json:"installations"`
	UpdatedAt     time.Time                `json:"updatedAt"`
}

func EmptyState() State {
	return State{
		APIVersion:    "meteomate.ai/v1",
		Kind:          "SkillHubState",
		Version:       1,
		Skills:        map[string]*Skill{},
		SkillVersions: map[string]*SkillVersion{},
		Collections:   map[string]*Collection{},
		Installations: map[string]*Installation{},
	}
}

func VersionKey(skillID, version string) string { return skillID + "@" + version }
