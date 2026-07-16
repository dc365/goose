package skillpkg

import (
	"io/fs"
	"regexp"
)

const (
	DefaultMaxArchiveBytes  int64 = 64 << 20
	DefaultMaxExpandedBytes int64 = 128 << 20
	DefaultMaxEntryBytes    int64 = 32 << 20
	DefaultMaxEntries             = 2000
	DefaultMaxDepth               = 24
)

type Limits struct {
	MaxArchiveBytes  int64
	MaxExpandedBytes int64
	MaxEntryBytes    int64
	MaxEntries       int
	MaxDepth         int
}

func DefaultLimits() Limits {
	return Limits{
		MaxArchiveBytes:  DefaultMaxArchiveBytes,
		MaxExpandedBytes: DefaultMaxExpandedBytes,
		MaxEntryBytes:    DefaultMaxEntryBytes,
		MaxEntries:       DefaultMaxEntries,
		MaxDepth:         DefaultMaxDepth,
	}
}

type FileRecord struct {
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	SHA256     string `json:"sha256"`
	Executable bool   `json:"executable"`
}
type Finding struct {
	Level   string `json:"level"`
	File    string `json:"file,omitempty"`
	Message string `json:"message"`
}
type Permissions struct {
	FilesystemRead  bool `json:"filesystemRead"`
	FilesystemWrite bool `json:"filesystemWrite"`
	Shell           bool `json:"shell"`
	Network         bool `json:"network"`
	Hooks           bool `json:"hooks"`
}
type RiskReport struct {
	Level       string      `json:"level"`
	Findings    []Finding   `json:"findings"`
	Permissions Permissions `json:"permissions"`
}
type Skill struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	DisplayName   string            `json:"displayName"`
	Description   string            `json:"description"`
	Version       string            `json:"version"`
	License       string            `json:"license,omitempty"`
	Compatibility string            `json:"compatibility,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}
type Report struct {
	APIVersion          string         `json:"apiVersion"`
	Kind                string         `json:"kind"`
	Skill               Skill          `json:"skill"`
	Files               []FileRecord   `json:"files"`
	TotalBytes          int64          `json:"totalBytes"`
	ArchiveBytes        int64          `json:"archiveBytes"`
	Integrity           string         `json:"integrity"`
	PackageDigest       string         `json:"packageDigest"`
	Risk                RiskReport     `json:"risk"`
	Warnings            []string       `json:"warnings"`
	Sidecar             map[string]any `json:"sidecar,omitempty"`
	AutoInstallEligible bool           `json:"autoInstallEligible"`
}
type inspectedFile struct {
	relative string
	mode     fs.FileMode
	data     []byte
}

var skillNamePattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

var dangerousRules = []struct {
	level   string
	pattern *regexp.Regexp
	message string
	network bool
	shell   bool
}{
	{"critical", regexp.MustCompile(`(?i)\b(?:sudo|doas)\b`), "提权命令", false, true},
	{"critical", regexp.MustCompile(`(?i)rm\s+-rf\s+(?:/|~|\$HOME)`), "高风险递归删除", false, true},
	{"critical", regexp.MustCompile(`(?i)(?:curl|wget)[^\n|]*\|\s*(?:sh|bash|zsh)`), "下载并直接执行脚本", true, true},
	{"high", regexp.MustCompile(`(?i)\b(?:child_process|os\.system|subprocess\.(?:run|Popen|call)|Invoke-Expression|Start-Process)\b`), "执行外部命令", false, true},
	{"high", regexp.MustCompile(`(?i)\b(?:curl|wget|fetch\(|axios\.|requests\.|http\.request|https\.request)\b`), "访问网络", true, false},
	{"high", regexp.MustCompile(`(?i)(?:\.ssh|id_rsa|id_ed25519|keychain|credential|password|api[_-]?key|secret)`), "可能访问凭据", false, false},
}

var textExtensions = map[string]bool{
	".md": true, ".txt": true, ".json": true, ".yaml": true, ".yml": true,
	".toml": true, ".xml": true, ".csv": true, ".tsv": true, ".js": true,
	".cjs": true, ".mjs": true, ".ts": true, ".tsx": true, ".jsx": true,
	".py": true, ".sh": true, ".bash": true, ".zsh": true, ".ps1": true,
	".bat": true, ".cmd": true, ".go": true, ".rs": true, ".java": true,
	".kt": true, ".rb": true, ".php": true, ".sql": true,
}

var scriptExtensions = map[string]bool{
	".sh": true, ".bash": true, ".zsh": true, ".ps1": true, ".bat": true,
	".cmd": true, ".py": true, ".js": true, ".cjs": true, ".mjs": true,
	".ts": true, ".rb": true, ".php": true,
}

var executableExtensions = map[string]bool{
	".exe": true, ".dll": true, ".dylib": true, ".so": true, ".app": true,
	".msi": true, ".pkg": true, ".deb": true, ".rpm": true,
}
