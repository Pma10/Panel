package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestAccountSetupLoginAndManagement(t *testing.T) {
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	api, err := newPanelAPI(m, "http://placeholder", "")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(api)
	defer srv.Close()
	api.auth.origin = srv.URL
	call := func(method, path, body string, cookie *http.Cookie, csrf string) (int, map[string]any, *http.Response) {
		resp := req(t, srv, method, path, []byte(body), cookie, csrf)
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		out := map[string]any{}
		_ = json.Unmarshal(data, &out)
		return resp.StatusCode, out, resp
	}
	if code, out, _ := call("GET", "/api/v1/auth/setup", "", nil, ""); code != 200 || out["required"] != true {
		t.Fatalf("setup should be required: %d %v", code, out)
	}
	code, out, resp := call("POST", "/api/v1/auth/setup", `{"username":"owner","password":"owner-password-123"}`, nil, "")
	if code != 200 {
		t.Fatalf("setup: %d %v", code, out)
	}
	cookie, csrf := resp.Cookies()[0], out["csrf"].(string)
	if code, _, _ := call("POST", "/api/v1/auth/setup", `{"username":"intruder","password":"intruder-password-1"}`, nil, ""); code != 409 {
		t.Fatalf("second setup must be refused, got %d", code)
	}
	if code, out, _ := call("POST", "/api/v1/users", `{"username":"friend","password":"short"}`, cookie, csrf); code != 400 {
		t.Fatalf("weak password accepted: %d %v", code, out)
	}
	if code, out, _ := call("POST", "/api/v1/users", `{"username":"friend","password":"friend-password-12"}`, cookie, csrf); code != 201 {
		t.Fatalf("create user: %d %v", code, out)
	}
	if code, _, _ := call("POST", "/api/v1/auth/login", `{"username":"friend","password":"wrong-password-000"}`, nil, ""); code != 401 {
		t.Fatalf("wrong password: %d", code)
	}
	code, out, resp = call("POST", "/api/v1/auth/login", `{"username":"friend","password":"friend-password-12"}`, nil, "")
	if code != 200 || out["username"] != "friend" {
		t.Fatalf("friend login: %d %v", code, out)
	}
	friendCookie := resp.Cookies()[0]
	if code, _, _ := call("DELETE", "/api/v1/users/owner", "", cookie, csrf); code != 409 {
		t.Fatalf("self delete must be refused, got %d", code)
	}
	if code, _, _ := call("DELETE", "/api/v1/users/friend", "", cookie, csrf); code != 200 {
		t.Fatalf("delete friend: %d", code)
	}
	if code, _, _ := call("GET", "/api/v1/servers", "", friendCookie, ""); code != 401 {
		t.Fatalf("deleted user's session must be revoked, got %d", code)
	}
	// Accounts persist across restarts.
	again, err := newAuthenticator(api.auth.usersPath, "", srv.URL)
	if err != nil || again.setupRequired() {
		t.Fatalf("accounts not persisted: %v", err)
	}
}

func TestLegacyPasswordBecomesAdminAccount(t *testing.T) {
	a := mustAuthenticator("legacy-password-123", "http://panel.test")
	r := httptest.NewRequest(http.MethodPost, "http://panel.test/api/v1/auth/login", nil)
	r.Header.Set("Origin", "http://panel.test")
	if _, _, err := a.login(r, "", "legacy-password-123"); err != nil {
		t.Fatalf("legacy password-only login failed: %v", err)
	}
}

func TestBuildStartArgsTemplate(t *testing.T) {
	cfg := serverConfig{MemoryMb: 4096, Jar: "paper.jar", Port: 25570}
	got := strings.Join(buildStartArgs(cfg, "java"), "|")
	if got != "java|-Xms512M|-Xmx4096M|-jar|paper.jar|nogui" {
		t.Fatalf("default command: %s", got)
	}
	cfg.JavaBin = `C:\Program Files\Java\jdk-21\bin\java.exe`
	cfg.StartCommand = "{java} -XX:+UseG1GC -Xmx{memory}M -jar {jar} --port {port} nogui"
	args := buildStartArgs(cfg, "java")
	if args[0] != cfg.JavaBin || args[2] != "-Xmx4096M" || args[6] != "25570" {
		t.Fatalf("custom command: %q", args)
	}
	if got := splitCommand(`"C:My Javajava.exe" -jar  x.jar`); len(got) != 3 || got[0] != `C:My Javajava.exe` {
		t.Fatalf("quoted split: %q", got)
	}
	if usesJar(serverConfig{StartCommand: "bash start.sh"}) {
		t.Fatal("script command should not require the jar")
	}
}

func TestStatusTransitionsAndAutoRestartToggle(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("needs sh")
	}
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	created, err := m.create(serverConfig{Name: "auto", Port: 27311, MemoryMb: 1024, EulaAccepted: true})
	if err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)
	raw := func(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
	// sleep keeps the process alive long enough to observe "starting".
	if _, err := m.update(id, map[string]json.RawMessage{"autoRestart": raw(true), "startCommand": raw(`"` + sh + `" -c "sleep 1"`)}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.start(id); err != nil {
		t.Fatal(err)
	}
	status := func() string { s, _ := m.summary(id); return s["status"].(string) }
	if got := status(); got != "starting" {
		t.Fatalf("expected starting, got %s", got)
	}
	m.log(id, "INFO", `[Server thread/INFO]: Done (3.2s)! For help, type "help"`)
	if got := status(); got != "running" {
		t.Fatalf("Done line should mark running, got %s", got)
	}
	deadline := time.Now().Add(5 * time.Second)
	for status() != "restarting" {
		if time.Now().After(deadline) {
			t.Fatalf("clean exit with auto restart should schedule a restart, got %s", status())
		}
		time.Sleep(50 * time.Millisecond)
	}
	if _, err := m.update(id, map[string]json.RawMessage{"autoRestart": raw(false)}); err != nil {
		t.Fatal(err)
	}
	if got := status(); got != "stopped" {
		t.Fatalf("turning auto restart off should cancel the pending restart, got %s", got)
	}
}
