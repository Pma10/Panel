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

// A running server must survive the panel going away and be fully usable
// (status, console history, commands, stop) from the next panel.
func TestRunningServerSurvivesPanelRestart(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("needs sh")
	}
	root := t.TempDir()
	script := filepath.Join(root, "fake-server.sh")
	body := "echo 'Starting fake server'\necho 'Done (0.10s)! For help, type \"help\"'\n" +
		"while IFS= read -r line; do\n  echo \"CONSOLE: $line\"\n  if [ \"$line\" = stop ]; then echo stopping; exit 0; fi\ndone\n"
	if err := os.WriteFile(script, []byte(body), 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "data")
	first, err := newManager(data, "java")
	if err != nil {
		t.Fatal(err)
	}
	created, err := first.create(serverConfig{Name: "survivor", Port: 27811, MemoryMb: 1024, EulaAccepted: true})
	if err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)
	raw := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
	if _, err := first.update(id, map[string]json.RawMessage{"startCommand": raw(`"` + sh + `" "` + script + `"`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := first.start(id); err != nil {
		t.Fatal(err)
	}
	waitFor := func(m *manager, what string, ok func() bool) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for !ok() {
			if time.Now().After(deadline) {
				history, _ := m.history(id)
				t.Fatalf("timed out waiting for %s; log: %+v", what, history)
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	logged := func(m *manager, text string) func() bool {
		return func() bool {
			history, _ := m.history(id)
			for _, e := range history {
				if strings.Contains(e.Message, text) {
					return true
				}
			}
			return false
		}
	}
	waitFor(first, "first console output", logged(first, "Done (0.10s)"))

	// The panel exits the normal way (also what an update does)...
	stopServersOnShutdown = false
	err = first.shutdown(context.Background())
	stopServersOnShutdown = true
	if err != nil {
		t.Fatal(err)
	}
	if !orphanJavaRunning(first.dir(id)) {
		t.Fatal("server process did not outlive the panel")
	}

	// ...and the next panel picks the server up again.
	second, err := newManager(data, "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = second.shutdown(context.Background()) })
	summary, _ := second.summary(id)
	if summary["status"] != "running" {
		t.Fatalf("reattached status = %v", summary["status"])
	}
	if !logged(second, "Done (0.10s)")() {
		t.Fatal("console history from before the restart is missing")
	}
	if err := second.command(id, "say hello again"); err != nil {
		t.Fatalf("command after reattach: %v", err)
	}
	waitFor(second, "command echo after reattach", logged(second, "CONSOLE: say hello again"))
	if err := second.stop(id); err != nil {
		t.Fatal(err)
	}
	waitFor(second, "stop after reattach", func() bool { s, _ := second.summary(id); return s["status"] == "stopped" })
	if orphanJavaRunning(second.dir(id)) {
		t.Fatal("process marker still points at a live process after stop")
	}
}
