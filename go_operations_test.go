package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManualJarUploadInvalidatesPaperUpdateMetadata(t *testing.T) {
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	created, err := m.create(serverConfig{Name: "Paper", Port: 27121, MemoryMb: 2048, EulaAccepted: true, Template: "paper"})
	if err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)
	m.mu.Lock()
	state := m.servers[id]
	state.cfg.InstalledVersion = "1.21.11"
	state.cfg.RollbackVersion = "1.21.10"
	err = m.saveLocked()
	m.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.uploadFile(id, "server.jar", strings.NewReader("manual custom JAR")); err != nil {
		t.Fatal(err)
	}
	cfg, err := m.startup(id)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Template != "manual" || cfg.InstalledVersion != "" || cfg.RollbackVersion != "" {
		t.Fatalf("manual upload retained inaccurate official update metadata: %+v", cfg)
	}
	payload, err := os.ReadFile(filepath.Join(m.dir(id), "server.jar"))
	if err != nil || string(payload) != "manual custom JAR" {
		t.Fatalf("uploaded JAR missing: %v", err)
	}
}

func TestResumeManifestDoesNotAutostartManuallyStoppedServers(t *testing.T) {
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	running, err := m.create(serverConfig{Name: "running before restart", Port: 27122, MemoryMb: 1024, EulaAccepted: true})
	if err != nil {
		t.Fatal(err)
	}
	_, err = m.create(serverConfig{Name: "manually stopped", Port: 27123, MemoryMb: 1024, EulaAccepted: true})
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{running["id"].(string)}
	if err := m.saveResumeList(ids); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(m.root, ".panel-resume.json"))
	if err != nil {
		t.Fatal(err)
	}
	var restored []string
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	if len(restored) != 1 || restored[0] != ids[0] {
		t.Fatalf("resume plan should contain only previously running server: %#v", restored)
	}
}

func TestMemoryDiagnosticsAreBoundedAndAvoidJavaPlaceholder(t *testing.T) {
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	report := m.diagnostics()
	if report["backend"] != "go" {
		t.Fatal("unexpected backend")
	}
	if report["serverCount"] != 0 || report["logEntries"] != 0 {
		t.Fatalf("unexpected counters: %#v", report)
	}
	if report["goHeapBytes"] == nil || report["goroutines"] == nil {
		t.Fatal("missing runtime diagnostics")
	}
	if cap(m.jobQueue) != 128 {
		t.Fatalf("scheduler work queue is not capped: %d", cap(m.jobQueue))
	}
}
