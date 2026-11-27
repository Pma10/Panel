package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPluginInstallVerifiesSourceAndChecksum(t *testing.T) {
	jar := bytes.Repeat([]byte("plugin"), 400)
	s512 := sha512.Sum512(jar)
	s256 := sha256.Sum256(jar)
	modrinthHost, hangarExternal := "cdn.modrinth.com", false
	original := officialClient
	officialClient = &http.Client{CheckRedirect: original.CheckRedirect, Transport: templateRoundTrip(func(r *http.Request) (*http.Response, error) {
		switch {
		case r.URL.Host == "api.modrinth.com" && strings.HasPrefix(r.URL.Path, "/v2/project/luckperms/version"):
			if !strings.Contains(r.URL.RawQuery, "1.21.4") {
				t.Errorf("game version not requested: %s", r.URL.RawQuery)
			}
			body, _ := json.Marshal([]map[string]any{{"version_number": "5.5", "version_type": "release", "files": []map[string]any{{
				"url": "https://" + modrinthHost + "/data/x/LuckPerms.jar", "filename": "LuckPerms-Bukkit-5.5.jar", "size": len(jar), "primary": true,
				"hashes": map[string]string{"sha512": hex.EncodeToString(s512[:])}}}}})
			return jsonUpstream(200, body), nil
		case r.URL.Host == "cdn.modrinth.com" || r.URL.Host == "hangarcdn.papermc.io":
			return jsonUpstream(200, jar), nil
		case r.URL.Host == "hangar.papermc.io":
			download := map[string]any{"externalUrl": nil, "downloadUrl": "https://hangarcdn.papermc.io/plugins/ViaVersion.jar",
				"fileInfo": map[string]any{"name": "ViaVersion-5.jar", "sizeBytes": len(jar), "sha256Hash": hex.EncodeToString(s256[:])}}
			if hangarExternal {
				download = map[string]any{"externalUrl": "https://example.com/v.jar", "downloadUrl": ""}
			}
			body, _ := json.Marshal(map[string]any{"result": []map[string]any{{"name": "5.0", "channel": map[string]string{"name": "Release"},
				"downloads": map[string]any{"PAPER": download}}}})
			return jsonUpstream(200, body), nil
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
	created, err := m.create(serverConfig{Name: "p", Port: 27991, MemoryMb: 1024, EulaAccepted: true, Template: "purpur"})
	if err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)
	m.mu.Lock()
	m.servers[id].cfg.InstalledVersion = "1.21.4"
	m.mu.Unlock()

	if _, err := m.installPlugin(context.Background(), id, "modrinth", "luckperms"); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(m.dir(id), "plugins", "LuckPerms-Bukkit-5.5.jar"))
	if !bytes.Equal(got, jar) {
		t.Fatal("modrinth jar not installed")
	}
	if _, err := m.installPlugin(context.Background(), id, "modrinth", "luckperms"); err == nil {
		t.Fatal("existing plugin file was overwritten")
	}
	if _, err := m.installPlugin(context.Background(), id, "hangar", "ViaVersion/ViaVersion"); err != nil {
		t.Fatal(err)
	}
	modrinthHost = "evil.example"
	_ = os.Remove(filepath.Join(m.dir(id), "plugins", "LuckPerms-Bukkit-5.5.jar"))
	if _, err := m.installPlugin(context.Background(), id, "modrinth", "luckperms"); err == nil {
		t.Fatal("download from a non-Modrinth host was accepted")
	}
	_ = os.Remove(filepath.Join(m.dir(id), "plugins", "ViaVersion-5.jar"))
	for _, bad := range []string{"../x", "../..", "a/b/c", "", "/x"} {
		if _, err := m.installPlugin(context.Background(), id, "hangar", bad); err == nil {
			t.Fatalf("bad id %q accepted", bad)
		}
	}
	hangarExternal = true
	if _, err := m.installPlugin(context.Background(), id, "hangar", "ViaVersion/ViaVersion"); err == nil {
		t.Fatal("externally hosted plugin was installed")
	}
}
