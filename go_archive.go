package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// Archive limits match backups; vars so tests can lower them.
var maxArchiveBytes int64 = maxBackupBytes
var maxArchiveFiles = maxBackupFiles

func joinRel(folder, name string) string {
	if folder == "" {
		return name
	}
	return folder + "/" + name
}

// ensureDir creates every missing directory of rel, refusing symlinked parents.
func (m *manager) ensureDir(id, rel string) error {
	parts := strings.Split(rel, "/")
	for i := range parts {
		full, err := m.filePath(id, strings.Join(parts[:i+1], "/"), true)
		if err != nil {
			return err
		}
		info, err := os.Lstat(full)
		if errors.Is(err, os.ErrNotExist) {
			if err := os.Mkdir(full, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return apiError{409, "같은 이름의 파일이 있어 폴더를 만들 수 없습니다: " + strings.Join(parts[:i+1], "/")}
		}
	}
	return nil
}

// extractZip unpacks a .zip inside the server folder into the folder that
// holds it, overwriting existing files. Entry names are validated like any
// panel path (no "..", absolute paths, backslashes or .panel- names), so an
// archive cannot write outside the server; sizes are counted from the bytes
// actually written, so a lying header cannot exceed the limits.
func (m *manager) extractZip(id, rel string) (int, error) {
	release, err := m.beginMutation(id)
	if err != nil {
		return 0, err
	}
	defer release()
	if !strings.HasSuffix(strings.ToLower(rel), ".zip") {
		return 0, apiError{400, "zip 파일만 압축을 풀 수 있습니다."}
	}
	source, _, err := m.getFile(id, rel)
	if err != nil {
		return 0, err
	}
	reader, err := zip.OpenReader(source)
	if err != nil {
		return 0, apiError{400, "zip 파일을 읽을 수 없습니다."}
	}
	defer reader.Close()
	if len(reader.File) > maxArchiveFiles {
		return 0, apiError{413, fmt.Sprintf("압축 파일 안의 항목이 너무 많습니다 (최대 %d개).", maxArchiveFiles)}
	}
	folder := path.Dir(rel)
	if folder == "." {
		folder = ""
	}
	var total int64
	count := 0
	for _, file := range reader.File {
		name := strings.TrimSuffix(file.Name, "/")
		if name == "" {
			continue
		}
		if _, err := safeRelativePath(name); err != nil {
			return count, apiError{400, "안전하지 않은 경로가 들어 있어 압축 풀기를 중단했습니다: " + file.Name}
		}
		target := joinRel(folder, name)
		if file.FileInfo().IsDir() {
			if err := m.ensureDir(id, target); err != nil {
				return count, err
			}
			continue
		}
		if !file.Mode().IsRegular() {
			continue // symlinks and devices are never created
		}
		if parent := path.Dir(target); parent != "." {
			if err := m.ensureDir(id, parent); err != nil {
				return count, err
			}
		}
		full, err := m.filePath(id, target, true)
		if err != nil {
			return count, err
		}
		if info, err := os.Lstat(full); err == nil && !info.Mode().IsRegular() {
			return count, apiError{409, "폴더를 파일로 덮어쓸 수 없습니다: " + target}
		}
		written, err := writeZipEntry(file, full, maxArchiveBytes-total)
		if err != nil {
			return count, err
		}
		total += written
		count++
	}
	return count, nil
}

func writeZipEntry(file *zip.File, full string, budget int64) (int64, error) {
	in, err := file.Open()
	if err != nil {
		return 0, apiError{400, "zip 항목을 읽을 수 없습니다: " + file.Name}
	}
	defer in.Close()
	tmp := filepath.Join(filepath.Dir(full), ".panel-"+makeID()+".extract")
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return 0, err
	}
	defer os.Remove(tmp)
	n, copyErr := io.Copy(out, io.LimitReader(in, budget+1))
	closeErr := out.Close()
	if copyErr != nil {
		return 0, apiError{400, "zip 항목이 손상되었습니다: " + file.Name}
	}
	if closeErr != nil {
		return 0, closeErr
	}
	if n > budget {
		return 0, apiError{413, "압축을 풀면 크기 제한(8GiB)을 넘습니다."}
	}
	if err := os.Rename(tmp, full); err != nil {
		return 0, err
	}
	return n, nil
}

// compressPaths writes the given files/folders (relative to the server) into
// a new zip in folder. Symlinks and panel bookkeeping files are skipped.
func (m *manager) compressPaths(id, folder string, items []string, name string) (string, error) {
	release, err := m.beginMutation(id)
	if err != nil {
		return "", err
	}
	defer release()
	if len(items) == 0 || len(items) > 1000 {
		return "", apiError{400, "압축할 항목을 선택하세요."}
	}
	if name == "" {
		name = "archive-" + time.Now().Format("20060102-150405")
		if len(items) == 1 {
			name = path.Base(items[0])
		}
	}
	name = strings.TrimSuffix(name, ".zip") + ".zip"
	if strings.ContainsAny(name, "/\\") {
		return "", apiError{400, "파일 이름이 올바르지 않습니다."}
	}
	output := joinRel(folder, name)
	full, err := m.filePath(id, output, true)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(full); err == nil {
		return "", apiError{409, "같은 이름의 파일이 이미 있습니다: " + name}
	}
	tmp := filepath.Join(filepath.Dir(full), ".panel-"+makeID()+".zip")
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp)
	writer := zip.NewWriter(out)
	var total int64
	count := 0
	add := func(root, prefix string) error {
		return filepath.WalkDir(root, func(p string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			// session.lock is held by a running server (unreadable on Windows) and recreated on start.
			if strings.HasPrefix(entry.Name(), ".panel-") || entry.Name() == "session.lock" || entry.Type()&fs.ModeSymlink != 0 {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			rel, err := filepath.Rel(root, p)
			if err != nil {
				return err
			}
			zipName := path.Join(prefix, filepath.ToSlash(rel))
			if entry.IsDir() {
				_, err := writer.Create(zipName + "/")
				return err
			}
			info, err := entry.Info()
			if err != nil || !info.Mode().IsRegular() {
				return err
			}
			count++
			total += info.Size()
			if count > maxArchiveFiles || total > maxArchiveBytes {
				return apiError{413, "압축할 파일이 너무 많거나 큽니다 (최대 8GiB)."}
			}
			header, err := zip.FileInfoHeader(info)
			if err != nil {
				return err
			}
			header.Name, header.Method = zipName, zip.Deflate
			dest, err := writer.CreateHeader(header)
			if err != nil {
				return err
			}
			in, err := os.Open(p)
			if err != nil {
				return apiError{409, "파일을 읽을 수 없습니다 (서버가 사용 중인 파일일 수 있습니다): " + zipName}
			}
			_, err = io.Copy(dest, io.LimitReader(in, info.Size()))
			in.Close()
			return err
		})
	}
	for _, item := range items {
		source, err := m.filePath(id, item, false)
		if err != nil {
			out.Close()
			return "", err
		}
		if err := add(source, path.Base(item)); err != nil {
			out.Close()
			return "", err
		}
	}
	if err := writer.Close(); err != nil {
		out.Close()
		return "", err
	}
	if err := out.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, full); err != nil {
		return "", err
	}
	return output, nil
}
