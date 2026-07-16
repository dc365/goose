package skillpkg

import (
	"archive/zip"
	"bytes"
	"testing"
)

func makeZIP(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestInspectZIP(t *testing.T) {
	data := makeZIP(t, map[string]string{
		"weather-review/SKILL.md":       "---\nname: weather-review\ndescription: Review meteorological evidence when users ask for a weather report\nmetadata:\n  version: \"1.2.0\"\n---\n\n# Workflow\n\n1. Inspect evidence.\n2. Validate the output.\n",
		"weather-review/meteomate.json": `{"displayName":"天气复盘","version":"1.2.0","requires":{"connectors":["weather-data"]},"permissions":{"filesystem":{"write":[]},"shell":false}}`,
	})
	report, err := InspectZIP(data, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	if report.Skill.ID != "weather-review" || report.Skill.Version != "1.2.0" {
		t.Fatalf("unexpected skill: %+v", report.Skill)
	}
	if report.PackageDigest == "" || report.Integrity == "" {
		t.Fatal("expected digests")
	}
	if report.Risk.Level != "low" {
		t.Fatalf("unexpected risk: %+v", report.Risk)
	}
}

func TestInspectZIPRejectsTraversal(t *testing.T) {
	data := makeZIP(t, map[string]string{
		"skill/SKILL.md": "---\nname: skill\ndescription: Safe skill for tests\n---\n# Validate\n",
		"../escape.txt":  "no",
	})
	if _, err := InspectZIP(data, DefaultLimits()); err == nil {
		t.Fatal("expected traversal rejection")
	}
}

func TestInspectZIPRejectsMultipleRoots(t *testing.T) {
	data := makeZIP(t, map[string]string{
		"one/SKILL.md": "---\nname: one\ndescription: First skill\n---\n# Verify\n",
		"two/SKILL.md": "---\nname: two\ndescription: Second skill\n---\n# Verify\n",
	})
	if _, err := InspectZIP(data, DefaultLimits()); err == nil {
		t.Fatal("expected multiple root rejection")
	}
}
