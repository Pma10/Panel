package main

import (
	"archive/zip"
	"bytes"
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func archiveServer(t *testing.T) (*manager, string) {
	t.Helper()
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	created, err := m.create(serverConfig{Name: "zip", Port: 27951, MemoryMb: 1024, EulaAccepted: true})
	if err != nil {
		t.Fatal(err)
	}
	return m, created["id"].(string)
}

func writeZip(t *testing.T, path string, entries map[string]string) {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, body := range entries {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.Write([]byte(body))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestCompressThenExtractRoundTrip(t *testing.T) {
	m, id := archiveServer(t)
	dir := m.dir(id)
	_ = os.MkdirAll(filepath.Join(dir, "world", "region"), 0700)
	_ = os.WriteFile(filepath.Join(dir, "world", "level.dat"), []byte("level"), 0600)
	_ = os.WriteFile(filepath.Join(dir, "world", "region", "r.0.0.mca"), bytes.Repeat([]byte("x"), 5000), 0600)
	_ = os.WriteFile(filepath.Join(dir, "world", ".panel-temp"), []byte("never zipped"), 0600)
	out, err := m.compressPaths(id, "", []string{"world"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if out != "world.zip" {
		t.Fatalf("archive name = %q", out)
	}
	if _, err := m.compressPaths(id, "", []string{"world"}, ""); err == nil {
		t.Fatal("existing archive was overwritten")
	}
	if err := os.RemoveAll(filepath.Join(dir, "world")); err != nil {
		t.Fatal(err)
	}
	count, err := m.extractZip(id, "world.zip")
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("extracted %d files, want 2", count)
	}
	got, _ := os.ReadFile(filepath.Join(dir, "world", "region", "r.0.0.mca"))
	if len(got) != 5000 {
		t.Fatalf("region file has %d bytes", len(got))
	}
	if _, err := os.Stat(filepath.Join(dir, "world", ".panel-temp")); !os.IsNotExist(err) {
		t.Fatal("panel file was included in the archive")
	}
}

func TestExtractRejectsPathsOutsideTheServer(t *testing.T) {
	m, id := archiveServer(t)
	for _, name := range []string{"../escape.txt", "plugins/../../escape.txt", "/abs.txt", "C:/abs.txt", `win\evil.txt`, ".panel-process"} {
		writeZip(t, filepath.Join(m.dir(id), "bad.zip"), map[string]string{name: "x"})
		if _, err := m.extractZip(id, "bad.zip"); err == nil {
			t.Fatalf("entry %q was accepted", name)
		}
	}
	err := filepath.WalkDir(filepath.Dir(m.dir(id)), func(p string, d fs.DirEntry, err error) error {
		if err == nil && strings.Contains(d.Name(), "escape") || strings.Contains(d.Name(), "abs.txt") || strings.Contains(d.Name(), "evil") {
			t.Fatalf("file written outside the archive rules: %s", p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestExtractStopsAtSizeLimitAndSkipsSymlinks(t *testing.T) {
	m, id := archiveServer(t)
	old := maxArchiveBytes
	maxArchiveBytes = 1000
	defer func() { maxArchiveBytes = old }()
	writeZip(t, filepath.Join(m.dir(id), "bomb.zip"), map[string]string{"big.bin": strings.Repeat("0", 5000)})
	if _, err := m.extractZip(id, "bomb.zip"); err == nil {
		t.Fatal("archive over the size limit was extracted")
	}
	if _, err := os.Stat(filepath.Join(m.dir(id), "big.bin")); !os.IsNotExist(err) {
		t.Fatal("partial file left behind")
	}
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	h := &zip.FileHeader{Name: "link"}
	h.SetMode(fs.ModeSymlink | 0777)
	f, _ := w.CreateHeader(h)
	_, _ = f.Write([]byte("/etc/passwd"))
	_ = w.Close()
	_ = os.WriteFile(filepath.Join(m.dir(id), "link.zip"), buf.Bytes(), 0600)
	if _, err := m.extractZip(id, "link.zip"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(m.dir(id), "link")); !os.IsNotExist(err) {
		t.Fatal("symlink entry was created")
	}
}
