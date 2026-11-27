package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDeleteServerRemovesFilesAndBackups(t *testing.T) {
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	created, err := m.create(serverConfig{Name: "doomed", Port: 27901, MemoryMb: 1024, EulaAccepted: true})
	if err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)
	if _, err := m.backup(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if err := m.deleteServer(id); err != nil {
		t.Fatal(err)
	}
	if _, err := m.summary(id); err == nil {
		t.Fatal("deleted server still listed")
	}
	for _, dir := range []string{m.dir(id), filepath.Join(m.root, "backups", id)} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("%s still exists: %v", dir, err)
		}
	}
	again, err := newManager(m.root, "java")
	if err != nil {
		t.Fatal(err)
	}
	defer again.shutdown(context.Background())
	if len(again.list()) != 0 {
		t.Fatal("deleted server came back after reload")
	}
}

// A running server is backed up without stopping it: save-off, save-all
// flush, wait for "Saved the game", copy, save-on. Its log keeps growing
// during the copy, which must not fail the backup.
func TestLiveBackupPausesSavingWithoutStopping(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("needs sh")
	}
	root := t.TempDir()
	script := filepath.Join(root, "fake-server.sh")
	body := "mkdir -p world logs; echo seed > world/level.dat; echo lock > world/session.lock\n" +
		"echo 'Done (0.10s)! For help, type \"help\"'\n" +
		"while IFS= read -r line; do\n" +
		"  echo \"CONSOLE: $line\"; echo \"$line\" >> logs/latest.log\n" +
		"  if [ \"$line\" = 'save-all flush' ]; then echo saved > world/level.dat; echo 'Saved the game'; fi\n" +
		"  if [ \"$line\" = stop ]; then exit 0; fi\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	m, err := newManager(filepath.Join(root, "data"), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	created, err := m.create(serverConfig{Name: "live", Port: 27902, MemoryMb: 1024, EulaAccepted: true})
	if err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)
	raw, _ := json.Marshal(`"` + sh + `" "` + script + `"`)
	if _, err := m.update(id, map[string]json.RawMessage{"startCommand": raw}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.start(id); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		s, _ := m.summary(id)
		if s["status"] == "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("fake server never reported Done")
		}
		time.Sleep(50 * time.Millisecond)
	}
	meta, err := m.backup(context.Background(), id)
	if err != nil {
		t.Fatalf("live backup: %v", err)
	}
	if s, _ := m.summary(id); s["status"] != "running" {
		t.Fatalf("server stopped by backup: %v", s["status"])
	}
	saved, err := os.ReadFile(filepath.Join(m.root, "backups", id, meta.ID, "files", "world", "level.dat"))
	if err != nil || strings.TrimSpace(string(saved)) != "saved" {
		t.Fatalf("backup missed the flushed world: %q %v", saved, err)
	}
	for _, skipped := range []string{processMarkerFile, "world/session.lock"} {
		if _, err := os.Stat(filepath.Join(m.root, "backups", id, meta.ID, "files", skipped)); !os.IsNotExist(err) {
			t.Fatalf("%s was copied into the backup", skipped)
		}
	}
	deadline = time.Now().Add(3 * time.Second)
	for {
		history, _ := m.history(id)
		var sent []string
		for _, e := range history {
			if strings.HasPrefix(e.Message, "CONSOLE: save-") {
				sent = append(sent, strings.TrimPrefix(e.Message, "CONSOLE: "))
			}
		}
		if strings.Join(sent, ",") == "save-off,save-all flush,save-on" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("save commands sent: %v", sent)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
