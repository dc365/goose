package store

import (
	"fmt"
	"time"
)

type ProjectMember struct {
	UserID  string    `json:"userId"`
	Role    string    `json:"role"`
	AddedBy string    `json:"addedBy,omitempty"`
	AddedAt time.Time `json:"addedAt"`
}

type SharedProject struct {
	APIVersion      string                   `json:"apiVersion"`
	Kind            string                   `json:"kind"`
	ID              string                   `json:"id"`
	ClientProjectID string                   `json:"clientProjectId,omitempty"`
	Name            string                   `json:"name"`
	Description     string                   `json:"description,omitempty"`
	Revision        int                      `json:"revision"`
	OwnerID         string                   `json:"ownerId"`
	OrgID           string                   `json:"orgId,omitempty"`
	Visibility      string                   `json:"visibility"`
	WorkspaceURI    string                   `json:"workspaceURI,omitempty"`
	Spec            map[string]any           `json:"spec"`
	Members         map[string]ProjectMember `json:"members"`
	CreatedAt       time.Time                `json:"createdAt"`
	UpdatedAt       time.Time                `json:"updatedAt"`
}

type ProjectRevision struct {
	ProjectID string        `json:"projectId"`
	Revision  int           `json:"revision"`
	Snapshot  SharedProject `json:"snapshot"`
	CreatedBy string        `json:"createdBy"`
	CreatedAt time.Time     `json:"createdAt"`
}

func ProjectRevisionKey(projectID string, revision int) string {
	return fmt.Sprintf("%s@r%d", projectID, revision)
}
