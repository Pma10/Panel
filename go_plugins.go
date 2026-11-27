package main

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Plugins come from Modrinth (cdn.modrinth.com, SHA-512) and Hangar,
// Paper's repository (hangarcdn.papermc.io, SHA-256). Externally hosted
// downloads are refused because their bytes cannot be verified.
const modrinthAPI = "https://api.modrinth.com/v2"
const hangarAPI = "https://hangar.papermc.io/api/v1"

var mcVersionPattern = regexp.MustCompile(`\d+\.\d+(?:\.\d+)?`)
var pluginIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(/[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$`)
var pluginFilePattern = regexp.MustCompile(`^[A-Za-z0-9._+-]{1,120}\.jar$`)

type pluginTarget struct {
	modrinthLoaders []string // Modrinth loader names that run on this server
	hangarPlatform  string   // PAPER or VELOCITY
	gameVersion     string   // "" when unknown or irrelevant (proxies)
}

func (m *manager) pluginTarget(id string) (pluginTarget, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, err := m.get(id)
	if err != nil {
		return pluginTarget{}, err
	}
	t := pluginTarget{modrinthLoaders: []string{"paper", "purpur", "spigot", "bukkit"}, hangarPlatform: "PAPER"}
	switch s.cfg.Template {
	case "velocity":
		return pluginTarget{modrinthLoaders: []string{"velocity"}, hangarPlatform: "VELOCITY"}, nil
	case "folia":
		t.modrinthLoaders = []string{"folia"}
	}
	switch {
	case s.cfg.Template != "manual" && mcVersionPattern.MatchString(s.cfg.InstalledVersion):
		t.gameVersion = s.cfg.InstalledVersion
	case s.mcStatus != nil:
		t.gameVersion = mcVersionPattern.FindString(s.mcStatus.Version)
	}
	return t, nil
}

func jsonList(values []string) string { b, _ := json.Marshal(values); return string(b) }

func (m *manager) searchPlugins(ctx context.Context, id, source, query string) ([]map[string]any, error) {
	t, err := m.pluginTarget(id)
	if err != nil {
		return nil, err
	}
	if len(query) > 100 {
		return nil, apiError{400, "검색어가 너무 깁니다."}
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	results := []map[string]any{}
	switch source {
	case "modrinth":
		categories := []string{}
		for _, l := range t.modrinthLoaders {
			categories = append(categories, "categories:"+l)
		}
		facets := [][]string{{"project_type:plugin"}, categories}
		if t.gameVersion != "" {
			facets = append(facets, []string{"versions:" + t.gameVersion})
		}
		raw, _ := json.Marshal(facets)
		data, err := officialGET(ctx, modrinthAPI+"/search?limit=20&query="+url.QueryEscape(query)+"&facets="+url.QueryEscape(string(raw)), 2<<20)
		if err != nil {
			return nil, err
		}
		var hits struct {
			Hits []map[string]any `json:"hits"`
		}
		if json.Unmarshal(data, &hits) != nil {
			return nil, apiError{502, "Modrinth 응답을 해석할 수 없습니다."}
		}
		for _, h := range hits.Hits {
			results = append(results, map[string]any{"source": "modrinth", "id": h["slug"], "name": h["title"],
				"description": h["description"], "author": h["author"], "downloads": h["downloads"], "icon": h["icon_url"]})
		}
	case "hangar":
		data, err := officialGET(ctx, hangarAPI+"/projects?limit=20&sort=-downloads&platform="+t.hangarPlatform+"&query="+url.QueryEscape(query), 2<<20)
		if err != nil {
			return nil, err
		}
		var res struct {
			Result []struct {
				Name        string                       `json:"name"`
				Description string                       `json:"description"`
				AvatarURL   string                       `json:"avatarUrl"`
				Namespace   struct{ Owner, Slug string } `json:"namespace"`
				Stats       struct{ Downloads int }      `json:"stats"`
			} `json:"result"`
		}
		if json.Unmarshal(data, &res) != nil {
			return nil, apiError{502, "Hangar 응답을 해석할 수 없습니다."}
		}
		for _, p := range res.Result {
			results = append(results, map[string]any{"source": "hangar", "id": p.Namespace.Owner + "/" + p.Namespace.Slug, "name": p.Name,
				"description": p.Description, "author": p.Namespace.Owner, "downloads": p.Stats.Downloads, "icon": p.AvatarURL})
		}
	default:
		return nil, apiError{400, "지원하지 않는 플러그인 저장소입니다."}
	}
	return results, nil
}

// resolvePlugin finds the newest release that runs on this server.
func resolvePlugin(ctx context.Context, t pluginTarget, source, id string) (resolvedJar, string, error) {
	notFound := apiError{404, "이 서버 버전에서 쓸 수 있는 플러그인 파일이 없습니다."}
	switch source {
	case "modrinth":
		query := "?loaders=" + url.QueryEscape(jsonList(t.modrinthLoaders))
		if t.gameVersion != "" {
			query += "&game_versions=" + url.QueryEscape(jsonList([]string{t.gameVersion}))
		}
		data, err := officialGET(ctx, modrinthAPI+"/project/"+url.PathEscape(id)+"/version"+query, 4<<20)
		if err != nil {
			return resolvedJar{}, "", err
		}
		var versions []struct {
			Version string `json:"version_number"`
			Type    string `json:"version_type"`
			Files   []struct {
				URL      string            `json:"url"`
				Filename string            `json:"filename"`
				Size     int64             `json:"size"`
				Primary  bool              `json:"primary"`
				Hashes   map[string]string `json:"hashes"`
			} `json:"files"`
		}
		if json.Unmarshal(data, &versions) != nil {
			return resolvedJar{}, "", apiError{502, "Modrinth 응답을 해석할 수 없습니다."}
		}
		pick := -1
		for i, v := range versions {
			if v.Type == "release" {
				pick = i
				break
			}
		}
		if pick < 0 && len(versions) > 0 {
			pick = 0
		}
		if pick < 0 || len(versions[pick].Files) == 0 {
			return resolvedJar{}, "", notFound
		}
		file := versions[pick].Files[0]
		for _, f := range versions[pick].Files {
			if f.Primary {
				file = f
			}
		}
		return resolvedJar{URL: file.URL, Size: file.Size, Algorithm: "sha512", Hash: strings.ToLower(file.Hashes["sha512"]), BuildID: versions[pick].Version}, file.Filename, nil
	case "hangar":
		query := "?limit=10&platform=" + t.hangarPlatform
		if t.gameVersion != "" {
			query += "&platformVersion=" + url.QueryEscape(t.gameVersion)
		}
		owner, slug, _ := strings.Cut(id, "/")
		data, err := officialGET(ctx, hangarAPI+"/projects/"+url.PathEscape(owner)+"/"+url.PathEscape(slug)+"/versions"+query, 4<<20)
		if err != nil {
			return resolvedJar{}, "", err
		}
		var res struct {
			Result []struct {
				Name      string                `json:"name"`
				Channel   struct{ Name string } `json:"channel"`
				Downloads map[string]struct {
					ExternalURL *string `json:"externalUrl"`
					DownloadURL string  `json:"downloadUrl"`
					FileInfo    struct {
						Name   string `json:"name"`
						Size   int64  `json:"sizeBytes"`
						SHA256 string `json:"sha256Hash"`
					} `json:"fileInfo"`
				} `json:"downloads"`
			} `json:"result"`
		}
		if json.Unmarshal(data, &res) != nil {
			return resolvedJar{}, "", apiError{502, "Hangar 응답을 해석할 수 없습니다."}
		}
		pick := -1
		for i, v := range res.Result {
			if strings.EqualFold(v.Channel.Name, "Release") {
				pick = i
				break
			}
		}
		if pick < 0 && len(res.Result) > 0 {
			pick = 0
		}
		if pick < 0 {
			return resolvedJar{}, "", notFound
		}
		d, ok := res.Result[pick].Downloads[t.hangarPlatform]
		if !ok {
			return resolvedJar{}, "", notFound
		}
		if d.ExternalURL != nil && d.DownloadURL == "" {
			return resolvedJar{}, "", apiError{409, "외부 사이트에서만 받을 수 있는 플러그인이라 검증할 수 없어 설치하지 않습니다."}
		}
		return resolvedJar{URL: d.DownloadURL, Size: d.FileInfo.Size, Algorithm: "sha256", Hash: strings.ToLower(d.FileInfo.SHA256), BuildID: res.Result[pick].Name}, d.FileInfo.Name, nil
	}
	return resolvedJar{}, "", apiError{400, "지원하지 않는 플러그인 저장소입니다."}
}

func pluginDownloadAllowed(source string) func(*url.URL, bool) bool {
	return func(u *url.URL, _ bool) bool {
		if u.Scheme != "https" || u.User != nil || u.Fragment != "" {
			return false
		}
		if source == "modrinth" {
			return u.Host == "cdn.modrinth.com"
		}
		return u.Host == "hangarcdn.papermc.io"
	}
}

// installPlugin downloads, verifies and places a plugin in plugins/.
// It never overwrites: an existing file means it is already installed.
func (m *manager) installPlugin(ctx context.Context, id, source, project string) (map[string]any, error) {
	if !pluginIDPattern.MatchString(project) || (source == "modrinth") == strings.Contains(project, "/") {
		return nil, apiError{400, "플러그인 ID가 올바르지 않습니다."}
	}
	t, err := m.pluginTarget(id)
	if err != nil {
		return nil, err
	}
	release, err := m.beginMutation(id)
	if err != nil {
		return nil, err
	}
	defer release()
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	jar, filename, err := resolvePlugin(ctx, t, source, project)
	if err != nil {
		return nil, err
	}
	filename = path.Base(filename)
	if !pluginFilePattern.MatchString(filename) {
		filename = strings.ReplaceAll(path.Base(project), "/", "-") + ".jar"
	}
	if err := m.ensureDir(id, "plugins"); err != nil {
		return nil, err
	}
	dest, err := m.filePath(id, "plugins/"+filename, true)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(dest); err == nil {
		return nil, apiError{409, "이미 같은 파일이 있습니다: plugins/" + filename}
	}
	tmp, size, err := fetchVerified(ctx, jar, pluginDownloadAllowed(source), filepath.Dir(dest))
	if tmp != "" {
		defer os.Remove(tmp)
	}
	if err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, dest); err != nil {
		return nil, err
	}
	m.log(id, "INFO", "플러그인 설치: plugins/"+filename+" ("+source+", "+jar.Algorithm+" 검증) — 서버를 재시작하면 적용됩니다.")
	return map[string]any{"file": "plugins/" + filename, "version": jar.BuildID, "size": size}, nil
}
