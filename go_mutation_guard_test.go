package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func regressionManager(t *testing.T) (*manager, string) {
	t.Helper()
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		if err := m.shutdown(ctx); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	created, err := m.create(serverConfig{Name: "regression", Port: 28503, MemoryMb: 1024, EulaAccepted: true})
	if err != nil {
		t.Fatal(err)
	}
	return m, created["id"].(string)
}

func wantAPIStatus(t *testing.T, err error, want int) {
	t.Helper()
	var api apiError
	if !errors.As(err, &api) || api.Status != want {
		t.Fatalf("expected HTTP %d; got %v", want, err)
	}
}

func TestRegressionShutdownRejectsNewDiskMutations(t *testing.T) {
	for _, operation := range []string{"upload", "mkdir", "config", "backup", "install", "rollback", "addSchedule", "deleteSchedule", "deleteBackup"} {
		t.Run(operation, func(t *testing.T) {
			m, id := regressionManager(t)
			previous, err := m.backup(context.Background(), id)
			if err != nil {
				t.Fatal(err)
			}
			job, err := m.addSchedule(id, schedule{Name: "later", Cron: "0 3 * * *", Type: "backup"})
			if err != nil {
				t.Fatal(err)
			}
			if err := m.shutdown(context.Background()); err != nil {
				t.Fatal(err)
			}
			switch operation {
			case "upload":
				_, err = m.uploadFile(id, "new.txt", strings.NewReader("no"))
			case "mkdir":
				err = m.mkdirFile(id, "new-folder")
			case "config":
				_, err = m.update(id, map[string]json.RawMessage{"name": json.RawMessage(`"changed"`)})
			case "backup":
				_, err = m.backup(context.Background(), id)
			case "install":
				// A closed manager must reject this before any upstream network call.
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				_, err = m.installTemplate(ctx, id, "paper", "1.21.11", false)
			case "rollback":
				_, err = m.rollbackJar(id)
			case "addSchedule":
				_, err = m.addSchedule(id, schedule{Name: "new", Cron: "0 4 * * *", Type: "backup"})
			case "deleteSchedule":
				err = m.deleteSchedule(id, job.ID)
			case "deleteBackup":
				err = m.deleteBackup(id, previous.ID)
			}
			wantAPIStatus(t, err, 503)
		})
	}
}

func TestRegressionUnmanagedProcessBlocksWorldChanges(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux PID/working-directory ownership check")
	}
	m, id := regressionManager(t)
	cmd := exec.Command("sleep", "20")
	cmd.Dir = m.dir(id)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	if err := os.WriteFile(filepath.Join(m.dir(id), ".panel-process"), []byte(strconv.Itoa(cmd.Process.Pid)), 0600); err != nil {
		t.Fatal(err)
	}
	if !orphanJavaRunning(m.dir(id)) {
		t.Fatal("fixture did not produce a real unmanaged process")
	}
	t.Run("file upload", func(t *testing.T) {
		_, err := m.uploadFile(id, "level.dat", strings.NewReader("must not change world"))
		wantAPIStatus(t, err, 409)
	})
	t.Run("backup", func(t *testing.T) {
		_, err := m.backup(context.Background(), id)
		wantAPIStatus(t, err, 409)
	})
	t.Run("configuration", func(t *testing.T) {
		_, err := m.update(id, map[string]json.RawMessage{"memoryMb": json.RawMessage(`2048`)})
		wantAPIStatus(t, err, 409)
	})
	t.Run("jar install", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := m.installTemplate(ctx, id, "paper", "1.21.11", false)
		wantAPIStatus(t, err, 409)
	})
}

func TestRegressionRootAliasCannotDeleteServerDirectory(t *testing.T) {
	m, id := regressionManager(t)
	entries, err := os.ReadDir(m.dir(id))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if err := os.RemoveAll(filepath.Join(m.dir(id), e.Name())); err != nil {
			t.Fatal(err)
		}
	}
	wantAPIStatus(t, m.deleteFile(id, "."), 400)
	info, err := os.Stat(m.dir(id))
	if err != nil || !info.IsDir() {
		t.Fatalf("server root was removed: %v", err)
	}
}

func TestRegressionInternalOperationFilesAreNotListed(t *testing.T) {
	m, id := regressionManager(t)
	for _, name := range []string{".panel-previous.jar", ".panel-process", ".panel-temp.upload", "normal.txt"} {
		if err := os.WriteFile(filepath.Join(m.dir(id), name), []byte("x"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := m.listFiles(id, "")
	if err != nil {
		t.Fatal(err)
	}
	foundNormal := false
	for _, item := range entries {
		name := item["name"].(string)
		if strings.HasPrefix(name, ".panel-") {
			t.Errorf("private operation file leaked into file browser: %s", name)
		}
		if name == "normal.txt" {
			foundNormal = true
		}
	}
	if !foundNormal {
		t.Fatal("ordinary file hidden")
	}
}

func TestRegressionStartupReturnsIndependentScheduleSnapshot(t *testing.T) {
	m, id := regressionManager(t)
	_, err := m.addSchedule(id, schedule{Name: "original", Cron: "0 3 * * *", Type: "backup"})
	if err != nil {
		t.Fatal(err)
	}
	copy, err := m.startup(id)
	if err != nil {
		t.Fatal(err)
	}
	copy.Schedules[0].Name = "modified outside manager lock"
	actual, err := m.schedules(id)
	if err != nil {
		t.Fatal(err)
	}
	if actual[0].Name != "original" {
		t.Fatal("startup response aliases mutable manager schedule storage")
	}
}

func TestRegressionSchedulePersistenceFailureKeepsLiveState(t *testing.T) {
	for _, operation := range []string{"add", "delete"} {
		t.Run(operation, func(t *testing.T) {
			m, id := regressionManager(t)
			job, err := m.addSchedule(id, schedule{Name: "keep", Cron: "0 3 * * *", Type: "backup"})
			if err != nil {
				t.Fatal(err)
			}
			config := filepath.Join(m.root, "config.json")
			if err := os.Remove(config); err != nil {
				t.Fatal(err)
			}
			// Atomic rename to a directory fails even when the test runs as root.
			if err := os.Mkdir(config, 0700); err != nil {
				t.Fatal(err)
			}
			if operation == "add" {
				_, err = m.addSchedule(id, schedule{Name: "must-not-appear", Cron: "0 4 * * *", Type: "backup"})
			} else {
				err = m.deleteSchedule(id, job.ID)
			}
			if err == nil {
				t.Fatal("fixture did not force a persistence failure")
			}
			current, e := m.schedules(id)
			if e != nil {
				t.Fatal(e)
			}
			if len(current) != 1 || current[0].ID != job.ID {
				t.Fatalf("failed %s changed active schedules: %+v", operation, current)
			}
		})
	}
}
