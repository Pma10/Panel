package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Purpur publishes MD5; Leaf ships through GitHub releases that redirect to
// the asset CDN. Both must verify bytes and refuse foreign hosts.
func TestPurpurAndLeafInstallVerifyChecksums(t *testing.T) {
	jar := bytes.Repeat([]byte("purpur-jar"), 300)
	md5sum := md5.Sum(jar)
	leafJar := bytes.Repeat([]byte("leaf-jar"), 400)
	shasum := sha256.Sum256(leafJar)
	leafDigest := hex.EncodeToString(shasum[:])
	tamper := false
	original := officialClient
	officialClient = &http.Client{CheckRedirect: original.CheckRedirect, Transport: templateRoundTrip(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.URL.Host == "api.purpurmc.org" && r.URL.Path == "/v2/purpur/1.21.4/latest":
			body, _ := json.Marshal(map[string]string{"build": "2416", "result": "SUCCESS", "md5": hex.EncodeToString(md5sum[:])})
			return jsonUpstream(200, body), nil
		case r.URL.Host == "api.purpurmc.org" && r.URL.Path == "/v2/purpur/1.21.4/2416/download":
			if tamper {
				return jsonUpstream(200, append([]byte("x"), jar[1:]...)), nil
			}
			return jsonUpstream(200, jar), nil
		case r.URL.Host == "api.github.com":
			body, _ := json.Marshal([]map[string]any{{"tag_name": "ver-1.21.4", "assets": []map[string]any{{
				"name": "leaf-1.21.4-1.jar", "size": len(leafJar), "digest": "sha256:" + leafDigest,
				"browser_download_url": "https://github.com/Winds-Studio/Leaf/releases/download/ver-1.21.4/leaf-1.21.4-1.jar"}}}})
			return jsonUpstream(200, body), nil
		case r.URL.Host == "github.com":
			res := jsonUpstream(302, nil)
			target := "https://release-assets.githubusercontent.com/leaf.jar"
			if tamper {
				target = "https://evil.example/leaf.jar"
			}
			res.Header.Set("Location", target)
			return res, nil
		case r.URL.Host == "release-assets.githubusercontent.com":
			return jsonUpstream(200, leafJar), nil
		}
		t.Fatalf("unexpected request: %s", r.URL)
		return nil, nil
	})}
	defer func() { officialClient = original }()
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	install := func(project string, port int) (string, error) {
		created, err := m.create(serverConfig{Name: project, Port: port, MemoryMb: 1024, EulaAccepted: true, Template: project})
		if err != nil {
			t.Fatal(err)
		}
		id := created["id"].(string)
		_, err = m.installTemplate(context.Background(), id, project, "1.21.4", false)
		return id, err
	}
	id, err := install("purpur", 27501)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(m.dir(id), "server.jar"))
	if !bytes.Equal(got, jar) {
		t.Fatal("purpur jar mismatch")
	}
	id, err = install("leaf", 27502)
	if err != nil {
		t.Fatal(err)
	}
	got, _ = os.ReadFile(filepath.Join(m.dir(id), "server.jar"))
	if !bytes.Equal(got, leafJar) {
		t.Fatal("leaf jar mismatch")
	}
	tamper = true
	if _, err := install("purpur", 27503); err == nil || !strings.Contains(err.Error(), "체크섬") {
		t.Fatalf("tampered purpur jar accepted: %v", err)
	}
	if _, err := install("leaf", 27504); err == nil {
		t.Fatal("redirect to a foreign host was followed")
	}
}

func TestVelocityCreateUsesProxyCommand(t *testing.T) {
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	created, err := m.create(serverConfig{Name: "proxy", Port: 27600, EulaAccepted: true, Template: "velocity", StartCommand: "rm -rf /"})
	if err != nil {
		t.Fatal(err)
	}
	cfg, _ := m.startup(created["id"].(string))
	args := strings.Join(buildStartArgs(cfg, "java"), " ")
	if !strings.HasSuffix(args, "-jar server.jar --port 27600") {
		t.Fatalf("velocity command: %s", args)
	}
}

func TestNetworkInfoAndPortChange(t *testing.T) {
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.shutdown(context.Background()) })
	a, _ := m.create(serverConfig{Name: "a", Port: 27700, EulaAccepted: true})
	_, _ = m.create(serverConfig{Name: "b", Port: 27701, EulaAccepted: true})
	id := a["id"].(string)
	props := filepath.Join(m.dir(id), "server.properties")
	_ = os.WriteFile(props, []byte("# comment\nserver-port=27700\nenable-rcon=true\nrcon.port=27710\nmotd=hi\n"), 0600)
	info, err := m.networkInfo(id)
	if err != nil {
		t.Fatal(err)
	}
	ports := info["ports"].([]map[string]any)
	if len(ports) != 2 || ports[0]["state"] != "closed" || ports[1]["port"] != 27710 {
		t.Fatalf("ports: %#v", ports)
	}
	if _, err := m.setPort(id, 27701); err == nil {
		t.Fatal("duplicate port accepted")
	}
	if _, err := m.setPort(id, 27705); err != nil {
		t.Fatal(err)
	}
	values, _ := readProperties(props)
	if values["server-port"] != "27705" || values["motd"] != "hi" {
		t.Fatalf("server.properties not updated in place: %v", values)
	}
}

func TestProcessUsageReadsOwnProcess(t *testing.T) {
	rss, cpu, ok := processUsage(os.Getpid())
	if !ok || rss < 1<<20 || cpu < 0 || cpu > time.Hour {
		t.Fatalf("processUsage(self) = %d bytes, %v, %v", rss, cpu, ok)
	}
}

func TestLogLevelAndReadinessFromColoredOutput(t *testing.T) {
	m, id := regressionManager(t)
	m.log(id, "INFO", "\x1b[33m[12:00:00 WARN]: Can't keep up!\x1b[0m")
	history, _ := m.history(id)
	if history[len(history)-1].Level != "WARN" {
		t.Fatalf("level from line prefix: %+v", history[len(history)-1])
	}
	if !donePattern.MatchString(ansiPattern.ReplaceAllString("\x1b[32m[INFO]: Done (1.23s)!\x1b[0m", "")) {
		t.Fatal("velocity Done line not recognised")
	}
}
