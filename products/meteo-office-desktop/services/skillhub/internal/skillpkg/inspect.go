package skillpkg

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

func inspectFiles(files []inspectedFile) (Report, error) {
	byPath := make(map[string]inspectedFile, len(files))
	for _, f := range files {
		clean := path.Clean(strings.TrimPrefix(f.relative, "./"))
		if clean == "." || strings.HasPrefix(clean, "../") || path.IsAbs(clean) {
			return Report{}, fmt.Errorf("invalid package path: %s", f.relative)
		}
		if _, exists := byPath[clean]; exists {
			return Report{}, fmt.Errorf("duplicate package path: %s", clean)
		}
		f.relative = clean
		byPath[clean] = f
	}
	skillFile, ok := byPath["SKILL.md"]
	if !ok {
		return Report{}, errors.New("skill root does not contain SKILL.md")
	}
	frontmatter, body, err := parseFrontmatter(string(skillFile.data))
	if err != nil {
		return Report{}, err
	}
	name := strings.TrimSpace(frontmatter["name"])
	description := strings.TrimSpace(frontmatter["description"])
	if name == "" || !skillNamePattern.MatchString(name) || len(name) > 64 {
		return Report{}, errors.New("Skill name must use lowercase letters, numbers and hyphens and be at most 64 characters")
	}
	if description == "" || len(description) > 1024 {
		return Report{}, errors.New("Skill description is required and must be at most 1024 characters")
	}
	metadata := parseNestedMetadata(string(skillFile.data), "metadata")
	var sidecar map[string]any
	if sidecarFile, exists := byPath["meteomate.json"]; exists {
		if err := json.Unmarshal(sidecarFile.data, &sidecar); err != nil {
			return Report{}, fmt.Errorf("meteomate.json is invalid: %w", err)
		}
	}
	version := firstString(sidecar, "version")
	if version == "" {
		version = metadata["version"]
	}
	if version == "" {
		version = strings.TrimSpace(frontmatter["version"])
	}
	if version == "" {
		version = "0.1.0"
	}
	displayName := firstString(sidecar, "displayName")
	if displayName == "" {
		displayName = name
	}

	warnings := make([]string, 0)
	if strings.TrimSpace(body) == "" {
		warnings = append(warnings, "SKILL.md contains no instructions after frontmatter")
	}
	if !regexp.MustCompile(`(?i)(验证|检查|verify|validation|test)`).MatchString(body) {
		warnings = append(warnings, "Skill should include verifiable completion criteria")
	}

	fileRecords := make([]FileRecord, 0, len(files))
	findings := make([]Finding, 0)
	risk := "low"
	permissions := Permissions{FilesystemRead: true}
	var total int64
	for _, f := range files {
		total += int64(len(f.data))
		ext := strings.ToLower(path.Ext(f.relative))
		executable := executableExtensions[ext] || f.mode&0o111 != 0
		if executableExtensions[ext] {
			findings = append(findings, Finding{Level: "critical", File: f.relative, Message: "contains native executable or library"})
			risk = maxRisk(risk, "critical")
		}
		if scriptExtensions[ext] || executable {
			permissions.Shell = true
			risk = maxRisk(risk, "medium")
		}
		lowerPath := strings.ToLower(f.relative)
		if strings.HasPrefix(lowerPath, "hooks/") || strings.Contains(lowerPath, "/hooks/") {
			permissions.Hooks = true
			findings = append(findings, Finding{Level: "high", File: f.relative, Message: "contains lifecycle hook"})
			risk = maxRisk(risk, "high")
		}
		if textExtensions[ext] && len(f.data) <= 1<<20 {
			text := string(f.data)
			for _, rule := range dangerousRules {
				if !rule.pattern.MatchString(text) {
					continue
				}
				findings = append(findings, Finding{Level: rule.level, File: f.relative, Message: rule.message})
				permissions.Network = permissions.Network || rule.network
				permissions.Shell = permissions.Shell || rule.shell
				risk = maxRisk(risk, rule.level)
			}
		}
		fileRecords = append(fileRecords, FileRecord{Path: f.relative, Size: int64(len(f.data)), SHA256: digest(f.data), Executable: executable})
	}
	permissions.FilesystemWrite = sidecarContainsWrite(sidecar)
	if permissions.FilesystemWrite {
		risk = maxRisk(risk, "medium")
	}
	sort.Slice(fileRecords, func(i, j int) bool { return fileRecords[i].Path < fileRecords[j].Path })
	integrityInput, _ := json.Marshal(fileRecords)
	return Report{
		APIVersion: "meteomate.ai/v1",
		Kind:       "SkillInspection",
		Skill: Skill{
			ID:            name,
			Name:          name,
			DisplayName:   displayName,
			Description:   description,
			Version:       version,
			License:       strings.TrimSpace(frontmatter["license"]),
			Compatibility: strings.TrimSpace(frontmatter["compatibility"]),
			Metadata:      metadata,
		},
		Files:      fileRecords,
		TotalBytes: total,
		Integrity:  digest(integrityInput),
		Risk: RiskReport{
			Level:       risk,
			Findings:    findings,
			Permissions: permissions,
		},
		Warnings:            warnings,
		Sidecar:             sidecar,
		AutoInstallEligible: risk == "low" && !permissions.Shell && !permissions.Network && !permissions.Hooks,
	}, nil
}
func parseFrontmatter(source string) (map[string]string, string, error) {
	source = strings.TrimPrefix(source, "\ufeff")
	lines := strings.Split(strings.ReplaceAll(source, "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return nil, "", errors.New("SKILL.md is missing YAML frontmatter")
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return nil, "", errors.New("SKILL.md frontmatter is not closed")
	}
	metadata := make(map[string]string)
	for _, line := range lines[1:end] {
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") || strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			metadata[strings.TrimSpace(parts[0])] = trimQuotes(strings.TrimSpace(parts[1]))
		}
	}
	return metadata, strings.Join(lines[end+1:], "\n"), nil
}
func parseNestedMetadata(source, section string) map[string]string {
	lines := strings.Split(strings.ReplaceAll(source, "\r\n", "\n"), "\n")
	result := make(map[string]string)
	active := false
	for _, line := range lines {
		if strings.TrimSpace(line) == "---" {
			continue
		}
		if !strings.HasPrefix(line, " ") && strings.HasSuffix(strings.TrimSpace(line), ":") {
			active = strings.TrimSuffix(strings.TrimSpace(line), ":") == section
			continue
		}
		if !active {
			continue
		}
		if !strings.HasPrefix(line, " ") && strings.TrimSpace(line) != "" {
			break
		}
		trimmed := strings.TrimSpace(line)
		parts := strings.SplitN(trimmed, ":", 2)
		if len(parts) == 2 {
			result[strings.TrimSpace(parts[0])] = trimQuotes(strings.TrimSpace(parts[1]))
		}
	}
	return result
}
func firstString(object map[string]any, key string) string {
	if value, ok := object[key]; ok {
		return strings.TrimSpace(fmt.Sprint(value))
	}
	return ""
}
func sidecarContainsWrite(sidecar map[string]any) bool {
	if sidecar == nil {
		return false
	}
	permissions, _ := sidecar["permissions"].(map[string]any)
	filesystem, _ := permissions["filesystem"].(map[string]any)
	value, exists := filesystem["write"]
	if !exists {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.TrimSpace(typed) != ""
	case []string:
		return len(typed) > 0
	case []any:
		return len(typed) > 0
	default:
		return value != nil
	}
}
func normalizeLimits(limits Limits) Limits {
	defaults := DefaultLimits()
	if limits.MaxArchiveBytes <= 0 {
		limits.MaxArchiveBytes = defaults.MaxArchiveBytes
	}
	if limits.MaxExpandedBytes <= 0 {
		limits.MaxExpandedBytes = defaults.MaxExpandedBytes
	}
	if limits.MaxEntryBytes <= 0 {
		limits.MaxEntryBytes = defaults.MaxEntryBytes
	}
	if limits.MaxEntries <= 0 {
		limits.MaxEntries = defaults.MaxEntries
	}
	if limits.MaxDepth <= 0 {
		limits.MaxDepth = defaults.MaxDepth
	}
	return limits
}
func maxRisk(left, right string) string {
	rank := map[string]int{"low": 0, "medium": 1, "high": 2, "critical": 3}
	if rank[right] > rank[left] {
		return right
	}
	return left
}
func trimQuotes(value string) string {
	if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'')) {
		return value[1 : len(value)-1]
	}
	return value
}
func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
