package store

import (
	"fmt"
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
	FeaturedRank  int       `json:"featuredRank,omitempty"`
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
	SubmittedAt   *time.Time            `json:"submittedAt,omitempty"`
	ReviewedAt    *time.Time            `json:"reviewedAt,omitempty"`
	ReviewedBy    string                `json:"reviewedBy,omitempty"`
	ReviewNote    string                `json:"reviewNote,omitempty"`
}

type SkillRef struct {
	SkillID string `json:"skillId"`
	Version string `json:"version,omitempty"`
}

type ExpertSource struct {
	Type     string `json:"type"`
	RemoteID string `json:"remoteId,omitempty"`
}

type ExpertReview struct {
	Status      string     `json:"status"`
	Note        string     `json:"note,omitempty"`
	SubmittedBy string     `json:"submittedBy,omitempty"`
	SubmittedAt *time.Time `json:"submittedAt,omitempty"`
	ReviewedBy  string     `json:"reviewedBy,omitempty"`
	ReviewedAt  *time.Time `json:"reviewedAt,omitempty"`
}

type ExpertDistribution struct {
	Mode       string   `json:"mode"`
	Percentage int      `json:"percentage,omitempty"`
	UserIDs    []string `json:"userIds,omitempty"`
}

type Expert struct {
	APIVersion            string              `json:"apiVersion"`
	Kind                  string              `json:"kind"`
	ID                    string              `json:"id"`
	Name                  string              `json:"name"`
	Version               string              `json:"version"`
	Revision              int                 `json:"revision"`
	Source                ExpertSource        `json:"source"`
	Status                string              `json:"status"`
	Visibility            string              `json:"visibility"`
	Owner                 string              `json:"owner"`
	OwnerID               string              `json:"ownerId"`
	OrgID                 string              `json:"orgId,omitempty"`
	Category              string              `json:"category"`
	Avatar                string              `json:"avatar"`
	Description           string              `json:"description"`
	Mission               string              `json:"mission"`
	Tags                  []string            `json:"tags"`
	Instruction           string              `json:"instruction"`
	Methodology           []string            `json:"methodology"`
	Workflow              []string            `json:"workflow"`
	Limitations           []string            `json:"limitations"`
	Inputs                []string            `json:"inputs"`
	Outputs               []string            `json:"outputs"`
	Prompts               []string            `json:"prompts"`
	RequiredSkills        []string            `json:"requiredSkills"`
	RecommendedSkills     []string            `json:"recommendedSkills"`
	RequiredConnectors    []string            `json:"requiredConnectors"`
	RecommendedConnectors []string            `json:"recommendedConnectors"`
	ToolSelections        map[string][]string `json:"toolSelections"`
	PermissionProfile     string              `json:"permissionProfile"`
	DefaultWorkMode       string              `json:"defaultWorkMode"`
	ModelPolicy           string              `json:"modelPolicy"`
	Review                ExpertReview        `json:"review"`
	Distribution          ExpertDistribution  `json:"distribution"`
	InputSchema           map[string]any      `json:"inputSchema,omitempty"`
	OutputSchema          map[string]any      `json:"outputSchema,omitempty"`
	CreatedAt             time.Time           `json:"createdAt"`
	UpdatedAt             time.Time           `json:"updatedAt"`
}

type ExpertRevision struct {
	ExpertID  string    `json:"expertId"`
	Revision  int       `json:"revision"`
	Version   string    `json:"version"`
	Snapshot  Expert    `json:"snapshot"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
}

type Collection struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Featured    bool       `json:"featured"`
	Skills      []SkillRef `json:"skills"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type RecommendationMatch struct {
	SkillIDs          []string `json:"skillIds,omitempty"`
	SkillCategories   []string `json:"skillCategories,omitempty"`
	SkillTags         []string `json:"skillTags,omitempty"`
	RequestCategories []string `json:"requestCategories,omitempty"`
	QueryTerms        []string `json:"queryTerms,omitempty"`
	ConnectorIDs      []string `json:"connectorIds,omitempty"`
}

type RecommendationAction struct {
	ScoreBoost float64 `json:"scoreBoost,omitempty"`
	Pin        bool    `json:"pin,omitempty"`
	Exclude    bool    `json:"exclude,omitempty"`
	Reason     string  `json:"reason,omitempty"`
}

type RecommendationRule struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Description string               `json:"description,omitempty"`
	Enabled     bool                 `json:"enabled"`
	Priority    int                  `json:"priority"`
	Match       RecommendationMatch  `json:"match"`
	Action      RecommendationAction `json:"action"`
	UpdatedAt   time.Time            `json:"updatedAt"`
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
	APIVersion          string                         `json:"apiVersion"`
	Kind                string                         `json:"kind"`
	Version             int                            `json:"version"`
	Skills              map[string]*Skill              `json:"skills"`
	SkillVersions       map[string]*SkillVersion       `json:"skillVersions"`
	Experts             map[string]*Expert             `json:"experts"`
	ExpertRevisions     map[string]*ExpertRevision     `json:"expertRevisions"`
	Collections         map[string]*Collection         `json:"collections"`
	RecommendationRules map[string]*RecommendationRule `json:"recommendationRules"`
	Installations       map[string]*Installation       `json:"installations"`
	Projects            map[string]*SharedProject      `json:"projects"`
	ProjectRevisions    map[string]*ProjectRevision    `json:"projectRevisions"`
	UpdatedAt           time.Time                      `json:"updatedAt"`
}

func EmptyState() State {
	return State{
		APIVersion:          "meteomate.ai/v1",
		Kind:                "SkillHubState",
		Version:             3,
		Skills:              map[string]*Skill{},
		SkillVersions:       map[string]*SkillVersion{},
		Experts:             map[string]*Expert{},
		ExpertRevisions:     map[string]*ExpertRevision{},
		Collections:         map[string]*Collection{},
		RecommendationRules: map[string]*RecommendationRule{},
		Installations:       map[string]*Installation{},
		Projects:            map[string]*SharedProject{},
		ProjectRevisions:    map[string]*ProjectRevision{},
	}
}

func VersionKey(skillID, version string) string { return skillID + "@" + version }
func ExpertRevisionKey(expertID string, revision int) string {
	return fmt.Sprintf("%s@r%d", expertID, revision)
}
