package skillpkg

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

func InspectZIP(data []byte, limits Limits) (Report, error) {
	limits = normalizeLimits(limits)
	if int64(len(data)) > limits.MaxArchiveBytes {
		return Report{}, fmt.Errorf("ZIP archive exceeds %d bytes", limits.MaxArchiveBytes)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return Report{}, fmt.Errorf("open ZIP: %w", err)
	}
	if len(zr.File) > limits.MaxEntries {
		return Report{}, fmt.Errorf("ZIP contains too many entries: %d", len(zr.File))
	}

	rootPrefix, err := detectRoot(zr.File)
	if err != nil {
		return Report{}, err
	}
	files := make([]inspectedFile, 0, len(zr.File))
	var total int64
	for _, f := range zr.File {
		name, err := normalizeArchiveName(f.Name, limits.MaxDepth)
		if err != nil {
			return Report{}, err
		}
		if name == "" || strings.HasSuffix(name, "/") {
			continue
		}
		if rootPrefix != "" {
			if !strings.HasPrefix(name, rootPrefix+"/") {
				return Report{}, fmt.Errorf("package contains files outside skill root: %s", name)
			}
			name = strings.TrimPrefix(name, rootPrefix+"/")
		}
		mode := f.Mode()
		if mode&os.ModeSymlink != 0 {
			return Report{}, fmt.Errorf("symbolic links are not allowed: %s", name)
		}
		if mode&os.ModeType != 0 && !mode.IsRegular() {
			return Report{}, fmt.Errorf("unsupported file type: %s", name)
		}
		if int64(f.UncompressedSize64) > limits.MaxEntryBytes {
			return Report{}, fmt.Errorf("file exceeds size limit: %s", name)
		}
		total += int64(f.UncompressedSize64)
		if total > limits.MaxExpandedBytes {
			return Report{}, fmt.Errorf("expanded package exceeds %d bytes", limits.MaxExpandedBytes)
		}
		rc, err := f.Open()
		if err != nil {
			return Report{}, fmt.Errorf("open %s: %w", name, err)
		}
		content, readErr := io.ReadAll(io.LimitReader(rc, limits.MaxEntryBytes+1))
		closeErr := rc.Close()
		if readErr != nil {
			return Report{}, fmt.Errorf("read %s: %w", name, readErr)
		}
		if closeErr != nil {
			return Report{}, fmt.Errorf("close %s: %w", name, closeErr)
		}
		if int64(len(content)) > limits.MaxEntryBytes {
			return Report{}, fmt.Errorf("file exceeds size limit after decompression: %s", name)
		}
		files = append(files, inspectedFile{relative: path.Clean(name), mode: mode, data: content})
	}
	if len(files) == 0 {
		return Report{}, errors.New("ZIP does not contain files")
	}
	report, err := inspectFiles(files)
	if err != nil {
		return Report{}, err
	}
	report.ArchiveBytes = int64(len(data))
	report.PackageDigest = digest(data)
	return report, nil
}
func InspectDirectory(root string, limits Limits) (Report, error) {
	limits = normalizeLimits(limits)
	root, err := filepath.Abs(root)
	if err != nil {
		return Report{}, err
	}
	st, err := os.Lstat(root)
	if err != nil {
		return Report{}, err
	}
	if st.Mode()&os.ModeSymlink != 0 || !st.IsDir() {
		return Report{}, errors.New("skill source must be a real directory")
	}
	var total int64
	files := make([]inspectedFile, 0)
	err = filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(root, current)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if depth := len(strings.Split(rel, "/")); depth > limits.MaxDepth {
			return fmt.Errorf("path is nested too deeply: %s", rel)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symbolic links are not allowed: %s", rel)
		}
		if entry.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported file type: %s", rel)
		}
		if len(files)+1 > limits.MaxEntries {
			return fmt.Errorf("skill contains too many files")
		}
		if info.Size() > limits.MaxEntryBytes {
			return fmt.Errorf("file exceeds size limit: %s", rel)
		}
		total += info.Size()
		if total > limits.MaxExpandedBytes {
			return fmt.Errorf("skill directory exceeds size limit")
		}
		content, err := os.ReadFile(current)
		if err != nil {
			return err
		}
		files = append(files, inspectedFile{relative: rel, mode: info.Mode(), data: content})
		return nil
	})
	if err != nil {
		return Report{}, err
	}
	return inspectFiles(files)
}
func ZipDirectory(root string) ([]byte, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	st, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !st.IsDir() {
		return nil, errors.New("source is not a directory")
	}
	prefix := filepath.Base(root)
	var buffer bytes.Buffer
	zw := zip.NewWriter(&buffer)
	err = filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if current == root {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symbolic links are not allowed: %s", current)
		}
		rel, err := filepath.Rel(root, current)
		if err != nil {
			return err
		}
		name := path.Join(prefix, filepath.ToSlash(rel))
		if entry.IsDir() {
			_, err = zw.Create(name + "/")
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported file type: %s", current)
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = name
		header.Method = zip.Deflate
		writer, err := zw.CreateHeader(header)
		if err != nil {
			return err
		}
		file, err := os.Open(current)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(writer, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
	if err != nil {
		_ = zw.Close()
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
func detectRoot(files []*zip.File) (string, error) {
	skillRoots := make(map[string]struct{})
	for _, file := range files {
		name, err := normalizeArchiveName(file.Name, DefaultMaxDepth)
		if err != nil {
			return "", err
		}
		if name == "SKILL.md" {
			skillRoots[""] = struct{}{}
		}
		if strings.HasSuffix(name, "/SKILL.md") {
			root := strings.TrimSuffix(name, "/SKILL.md")
			if !strings.Contains(root, "/") {
				skillRoots[root] = struct{}{}
			}
		}
	}
	if len(skillRoots) == 0 {
		return "", errors.New("ZIP must contain one SKILL.md")
	}
	if len(skillRoots) > 1 {
		return "", errors.New("ZIP contains multiple Skill roots; upload one Skill per package")
	}
	for root := range skillRoots {
		return root, nil
	}
	return "", nil
}
func normalizeArchiveName(name string, maxDepth int) (string, error) {
	if strings.ContainsRune(name, '\x00') {
		return "", errors.New("archive entry contains NUL")
	}
	name = strings.ReplaceAll(name, "\\", "/")
	if strings.HasPrefix(name, "/") || regexp.MustCompile(`^[A-Za-z]:/`).MatchString(name) {
		return "", fmt.Errorf("archive entry uses absolute path: %s", name)
	}
	parts := make([]string, 0)
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			return "", fmt.Errorf("archive entry escapes package root: %s", name)
		}
		parts = append(parts, part)
	}
	if len(parts) > maxDepth {
		return "", fmt.Errorf("archive entry nested too deeply: %s", name)
	}
	clean := strings.Join(parts, "/")
	if strings.HasSuffix(name, "/") && clean != "" {
		clean += "/"
	}
	return clean, nil
}
