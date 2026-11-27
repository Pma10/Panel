package main

import (
	"context"
	"crypto/md5"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const paperAPI = "https://fill.papermc.io"
const paperDownloadHost = "fill-data.papermc.io"
const purpurAPI = "https://api.purpurmc.org"
const leafReleasesAPI = "https://api.github.com/repos/Winds-Studio/Leaf/releases?per_page=100"

var versionPattern = regexp.MustCompile("^[0-9]+(?:\\.[0-9]+){1,3}(?:-[a-zA-Z0-9._-]+)?$")
var shaPattern = regexp.MustCompile("^[0-9a-f]{64}$")
var md5Pattern = regexp.MustCompile("^[0-9a-f]{32}$")
var sha512Pattern = regexp.MustCompile("^[0-9a-f]{128}$")
var buildPattern = regexp.MustCompile("^[0-9]{1,9}$")
var officialClient = &http.Client{Timeout: 3 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

// fillProjects are served by PaperMC Fill v3 with SHA-256 checksums.
var fillProjects = map[string]bool{"paper": true, "folia": true, "velocity": true}

func templateCatalogue() []map[string]any {
	return []map[string]any{
		{"id": "manual", "name": "직접 JAR 업로드", "automatic": false},
		{"id": "paper", "name": "Paper", "automatic": true},
		{"id": "folia", "name": "Folia", "automatic": true},
		{"id": "purpur", "name": "Purpur", "automatic": true},
		{"id": "leaf", "name": "Leaf", "automatic": true},
		{"id": "velocity", "name": "Velocity (프록시)", "automatic": true},
	}
}
func templateOK(project string) bool {
	return fillProjects[project] || project == "purpur" || project == "leaf"
}
func templateName(project string) string {
	for _, t := range templateCatalogue() {
		if t["id"] == project {
			return t["name"].(string)
		}
	}
	return project
}
func officialGET(ctx context.Context, uri string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "PConnPanel/0.2 (https://github.com/Pma10/Panel)")
	req.Header.Set("Accept", "application/json")
	res, err := officialClient.Do(req)
	if err != nil {
		return nil, apiError{502, "공식 다운로드 API 연결 실패"}
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, apiError{502, "공식 다운로드 API 응답 오류"}
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, apiError{502, "공식 API 응답 크기 제한 초과"}
	}
	return data, nil
}
func sortVersions(versions []string) []string {
	sort.Slice(versions, func(i, j int) bool {
		left, right := strings.Split(versions[i], "-")[0], strings.Split(versions[j], "-")[0]
		a, b := strings.Split(left, "."), strings.Split(right, ".")
		for k := 0; k < len(a) || k < len(b); k++ {
			var x, y int
			if k < len(a) {
				x, _ = strconv.Atoi(a[k])
			}
			if k < len(b) {
				y, _ = strconv.Atoi(b[k])
			}
			if x != y {
				return x > y
			}
		}
		return versions[i] > versions[j]
	})
	if len(versions) > 120 {
		versions = versions[:120]
	}
	return versions
}

type leafRelease struct {
	Tag        string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name   string `json:"name"`
		Size   int64  `json:"size"`
		Digest string `json:"digest"`
		URL    string `json:"browser_download_url"`
	} `json:"assets"`
}

func leafReleases(ctx context.Context) ([]leafRelease, error) {
	data, err := officialGET(ctx, leafReleasesAPI, 8<<20)
	if err != nil {
		return nil, err
	}
	var list []leafRelease
	if json.Unmarshal(data, &list) != nil {
		return nil, apiError{502, "Leaf 릴리스 목록 해석 실패"}
	}
	return list, nil
}
func templateVersions(ctx context.Context, project string) ([]string, error) {
	if !templateOK(project) {
		return nil, apiError{400, "지원하지 않는 서버 종류입니다."}
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	versions := []string{}
	seen := map[string]bool{}
	add := func(v string) {
		// Snapshot proxies have no stable builds; listing them would only fail later.
		if !seen[v] && len(versions) < 4096 && len(v) <= 48 && versionPattern.MatchString(v) && !strings.Contains(v, "SNAPSHOT") {
			seen[v] = true
			versions = append(versions, v)
		}
	}
	switch {
	case fillProjects[project]:
		data, err := officialGET(ctx, paperAPI+"/v3/projects/"+project, 1<<20)
		if err != nil {
			return nil, err
		}
		var result struct {
			Versions map[string][]string `json:"versions"`
		}
		if json.Unmarshal(data, &result) != nil {
			return nil, apiError{502, "버전 목록 해석 실패"}
		}
		for _, list := range result.Versions {
			for _, v := range list {
				add(v)
			}
		}
	case project == "purpur":
		data, err := officialGET(ctx, purpurAPI+"/v2/purpur", 1<<20)
		if err != nil {
			return nil, err
		}
		var result struct {
			Versions []string `json:"versions"`
		}
		if json.Unmarshal(data, &result) != nil {
			return nil, apiError{502, "버전 목록 해석 실패"}
		}
		for _, v := range result.Versions {
			add(v)
		}
	case project == "leaf":
		list, err := leafReleases(ctx)
		if err != nil {
			return nil, err
		}
		for _, r := range list {
			if !r.Draft && !r.Prerelease && strings.HasPrefix(r.Tag, "ver-") {
				add(strings.TrimPrefix(r.Tag, "ver-"))
			}
		}
	}
	return sortVersions(versions), nil
}

type officialBuild struct {
	ID        int    `json:"id"`
	Channel   string `json:"channel"`
	Downloads map[string]struct {
		URL       string `json:"url"`
		Size      int64  `json:"size"`
		Checksums struct {
			SHA256 string `json:"sha256"`
		} `json:"checksums"`
	} `json:"downloads"`
}

// resolvedJar is what each upstream API yields: where to download and the
// checksum the bytes must match. Size is 0 when the API does not publish it.
type resolvedJar struct {
	URL       string
	Size      int64
	Algorithm string // "sha256" or "md5"
	Hash      string
	BuildID   any
}

func resolveJar(ctx context.Context, project, version string) (resolvedJar, error) {
	switch {
	case fillProjects[project]:
		uri := fmt.Sprintf("%s/v3/projects/%s/versions/%s/builds", paperAPI, project, url.PathEscape(version))
		raw, err := officialGET(ctx, uri, 1<<20)
		if err != nil {
			return resolvedJar{}, err
		}
		var builds []officialBuild
		if json.Unmarshal(raw, &builds) != nil {
			return resolvedJar{}, apiError{502, "빌드 목록을 확인할 수 없습니다."}
		}
		var selected *officialBuild
		for i := range builds {
			if builds[i].Channel == "STABLE" && builds[i].Downloads["server:default"].Size > 0 &&
				(selected == nil || builds[i].ID > selected.ID) {
				selected = &builds[i]
			}
		}
		if selected == nil {
			return resolvedJar{}, apiError{404, "선택한 버전에 안정 빌드가 없습니다."}
		}
		jar := selected.Downloads["server:default"]
		return resolvedJar{URL: jar.URL, Size: jar.Size, Algorithm: "sha256", Hash: strings.ToLower(jar.Checksums.SHA256), BuildID: selected.ID}, nil
	case project == "purpur":
		raw, err := officialGET(ctx, purpurAPI+"/v2/purpur/"+url.PathEscape(version)+"/latest", 1<<20)
		if err != nil {
			return resolvedJar{}, err
		}
		var build struct {
			Build  string `json:"build"`
			Result string `json:"result"`
			MD5    string `json:"md5"`
		}
		if json.Unmarshal(raw, &build) != nil || !buildPattern.MatchString(build.Build) {
			return resolvedJar{}, apiError{502, "Purpur 빌드 정보를 확인할 수 없습니다."}
		}
		if build.Result != "SUCCESS" {
			return resolvedJar{}, apiError{404, "선택한 버전의 최신 Purpur 빌드가 성공 빌드가 아닙니다."}
		}
		return resolvedJar{URL: purpurAPI + "/v2/purpur/" + url.PathEscape(version) + "/" + build.Build + "/download",
			Algorithm: "md5", Hash: strings.ToLower(build.MD5), BuildID: build.Build}, nil
	case project == "leaf":
		list, err := leafReleases(ctx)
		if err != nil {
			return resolvedJar{}, err
		}
		for _, r := range list {
			if r.Tag != "ver-"+version || r.Draft || r.Prerelease {
				continue
			}
			for _, a := range r.Assets {
				if strings.HasSuffix(a.Name, ".jar") && strings.HasPrefix(a.Digest, "sha256:") {
					return resolvedJar{URL: a.URL, Size: a.Size, Algorithm: "sha256", Hash: strings.ToLower(strings.TrimPrefix(a.Digest, "sha256:")), BuildID: a.Name}, nil
				}
			}
			return resolvedJar{}, apiError{404, "이 Leaf 릴리스에는 SHA-256이 공개된 JAR이 없습니다."}
		}
		return resolvedJar{}, apiError{404, "선택한 Leaf 버전을 찾을 수 없습니다."}
	}
	return resolvedJar{}, apiError{400, "지원하지 않는 서버 종류입니다."}
}

// downloadAllowed pins each project to its official download host. GitHub
// release downloads redirect to its asset CDN, which is allowed only there.
func downloadAllowed(project string, u *url.URL, first bool) bool {
	if u.Scheme != "https" || u.User != nil || u.Fragment != "" {
		return false
	}
	switch {
	case fillProjects[project]:
		return u.Host == paperDownloadHost && u.RawQuery == "" && strings.HasPrefix(u.Path, "/v1/objects/") && strings.HasSuffix(u.Path, ".jar")
	case project == "purpur":
		return u.Host == "api.purpurmc.org" && u.RawQuery == "" && strings.HasPrefix(u.Path, "/v2/purpur/")
	case project == "leaf":
		if first {
			return u.Host == "github.com" && u.RawQuery == "" && strings.HasPrefix(u.Path, "/Winds-Studio/Leaf/releases/download/")
		}
		return u.Host == "objects.githubusercontent.com" || u.Host == "release-assets.githubusercontent.com"
	}
	return false
}

// fetchVerified downloads jar.URL into a temp file in dir, following
// redirects only to hosts allow accepts, and checks size and checksum.
// The caller removes the returned temp file once it has moved or used it.
func fetchVerified(ctx context.Context, jar resolvedJar, allow func(*url.URL, bool) bool, dir string) (string, int64, error) {
	validHash := (jar.Algorithm == "sha256" && shaPattern.MatchString(jar.Hash)) || (jar.Algorithm == "md5" && md5Pattern.MatchString(jar.Hash)) ||
		(jar.Algorithm == "sha512" && sha512Pattern.MatchString(jar.Hash))
	if !validHash || jar.Size < 0 || jar.Size > 256<<20 || (jar.Size > 0 && jar.Size < 1024) {
		return "", 0, apiError{502, "공식 빌드 메타데이터가 올바르지 않습니다."}
	}
	download, err := url.Parse(jar.URL)
	if err != nil || !allow(download, true) {
		return "", 0, apiError{502, "공식 다운로드 주소가 아닙니다."}
	}
	var response *http.Response
	for hop := 0; ; hop++ {
		req, err := http.NewRequestWithContext(ctx, "GET", download.String(), nil)
		if err != nil {
			return "", 0, err
		}
		req.Header.Set("User-Agent", "PConnPanel/0.2 (https://github.com/Pma10/Panel)")
		response, err = officialClient.Do(req)
		if err != nil {
			return "", 0, apiError{502, "JAR 다운로드에 실패했습니다."}
		}
		if response.StatusCode < 300 || response.StatusCode >= 400 {
			break
		}
		location, err := download.Parse(response.Header.Get("Location"))
		response.Body.Close()
		if err != nil || hop >= 4 || !allow(location, false) {
			return "", 0, apiError{502, "허용되지 않은 다운로드 리디렉션입니다."}
		}
		download = location
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", 0, apiError{502, "JAR 응답 오류"}
	}
	tmp := filepath.Join(dir, ".panel-"+makeID()+".download")
	out, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", 0, err
	}
	var digest hash.Hash = sha256.New()
	switch jar.Algorithm {
	case "md5":
		digest = md5.New()
	case "sha512":
		digest = sha512.New()
	}
	limit := jar.Size
	if limit == 0 {
		limit = 256 << 20
	}
	size, copyErr := io.Copy(io.MultiWriter(out, digest), io.LimitReader(response.Body, limit+1))
	syncErr := out.Sync()
	closeErr := out.Close()
	if copyErr == nil {
		copyErr = syncErr
	}
	if copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		return tmp, 0, copyErr
	}
	if size > limit || (jar.Size > 0 && size != jar.Size) || size < 1024 || hex.EncodeToString(digest.Sum(nil)) != jar.Hash {
		return tmp, 0, apiError{502, "다운로드한 JAR의 체크섬 또는 크기가 일치하지 않습니다."}
	}
	return tmp, size, nil
}
func (m *manager) installTemplate(ctx context.Context, id, project, version string, updating bool) (map[string]any, error) {
	if !templateOK(project) || len(version) > 48 || !versionPattern.MatchString(version) {
		return nil, apiError{400, "프로젝트 또는 버전이 올바르지 않습니다."}
	}
	m.mu.Lock()
	s, err := m.get(id)
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}
	if err := m.checkMutationLocked(s, true); err != nil {
		m.mu.Unlock()
		return nil, err
	}
	if updating && (s.cfg.Template != project || s.cfg.InstalledVersion == "") {
		m.mu.Unlock()
		return nil, apiError{409, "다른 종류의 서버 JAR은 자동 업데이트하지 않습니다. 수동으로 교체하세요."}
	}
	s.busy = true
	m.mu.Unlock()
	defer func() { m.mu.Lock(); s.busy = false; m.mu.Unlock() }()
	dest := filepath.Join(m.dir(id), "server.jar")
	info, jarErr := os.Lstat(dest)
	if updating {
		if jarErr != nil || !info.Mode().IsRegular() {
			return nil, apiError{409, "업데이트할 server.jar이 없습니다."}
		}
	} else {
		if jarErr == nil {
			return nil, apiError{409, "server.jar 파일이 이미 있습니다. 기존 파일은 덮어쓰지 않습니다."}
		}
		if !os.IsNotExist(jarErr) {
			return nil, jarErr
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	jar, err := resolveJar(ctx, project, version)
	if err != nil {
		return nil, err
	}
	tmp, size, err := fetchVerified(ctx, jar, func(u *url.URL, first bool) bool { return downloadAllowed(project, u, first) }, m.dir(id))
	if tmp != "" {
		defer os.Remove(tmp)
	}
	if err != nil {
		return nil, err
	}
	// This mutation happens only after the complete JAR is hash-verified.
	// Keep one previous JAR on disk so an operator can roll back safely.
	previous := filepath.Join(m.dir(id), ".panel-previous.jar")
	oldBackup := previous + ".older-" + makeID()
	movedOld := false
	if updating {
		if _, statErr := os.Lstat(previous); statErr == nil {
			if err := os.Rename(previous, oldBackup); err != nil {
				return nil, err
			}
			movedOld = true
		} else if !os.IsNotExist(statErr) {
			return nil, statErr
		}
		if err := os.Rename(dest, previous); err != nil {
			if movedOld {
				_ = os.Rename(oldBackup, previous)
			}
			return nil, err
		}
		if err := os.Rename(tmp, dest); err != nil {
			_ = os.Rename(previous, dest)
			if movedOld {
				_ = os.Rename(oldBackup, previous)
			}
			return nil, err
		}
		// Keep the former rollback slot until the version metadata is durably
		// persisted. Removing it here would lose rollback history on disk errors.
	} else {
		if _, err := os.Lstat(dest); err == nil {
			return nil, apiError{409, "설치 중 JAR이 생성되었습니다."}
		}
		if err := os.Rename(tmp, dest); err != nil {
			return nil, err
		}
	}
	m.mu.Lock()
	oldCfg := s.cfg
	s.cfg.Template = project
	s.cfg.RollbackVersion = ""
	if updating {
		s.cfg.RollbackVersion = oldCfg.InstalledVersion
	}
	s.cfg.InstalledVersion = version
	err = m.saveLocked()
	if err != nil {
		s.cfg = oldCfg
		if updating {
			failed := dest + ".failed-" + makeID()
			if os.Rename(dest, failed) == nil {
				if restoreErr := os.Rename(previous, dest); restoreErr == nil {
					_ = os.Remove(failed)
					// Restore the previous rollback slot as well.
					if movedOld {
						_ = os.Rename(oldBackup, previous)
					}
				} else {
					// Keep the newly installed JAR rather than deleting both copies.
					_ = os.Rename(failed, dest)
				}
			}
		} else {
			_ = os.Remove(dest)
		}
	}
	m.mu.Unlock()
	if err != nil {
		return nil, err
	}
	if movedOld {
		_ = os.Remove(oldBackup)
	}
	verb := "설치"
	if updating {
		verb = "업데이트"
	}
	m.log(id, "INFO", "공식 "+templateName(project)+" "+version+" "+verb+" 완료 ("+jar.Algorithm+" 검증)")
	return map[string]any{"project": project, "version": version, "size": size, "checksum": jar.Algorithm + ":" + jar.Hash, "buildId": jar.BuildID, "updated": updating}, nil
}

/** Switch the verified JAR back to the previous known version; never run while
 *  a Minecraft process or another file/backup operation is active. */
func (m *manager) rollbackJar(id string) (map[string]any, error) {
	m.mu.Lock()
	state, err := m.get(id)
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}
	if err := m.checkMutationLocked(state, true); err != nil {
		m.mu.Unlock()
		return nil, err
	}
	if state.cfg.RollbackVersion == "" {
		m.mu.Unlock()
		return nil, apiError{404, "롤백할 이전 버전이 없습니다."}
	}
	state.busy = true
	m.mu.Unlock()
	defer func() { m.mu.Lock(); state.busy = false; m.mu.Unlock() }()
	dir := m.dir(id)
	current := filepath.Join(dir, "server.jar")
	previous := filepath.Join(dir, ".panel-previous.jar")
	for _, name := range []string{current, previous} {
		info, err := os.Lstat(name)
		if err != nil || !info.Mode().IsRegular() {
			return nil, apiError{409, "이전 버전 JAR이 없거나 안전한 파일이 아닙니다."}
		}
	}
	temporary := filepath.Join(dir, ".panel-"+makeID()+".swap")
	if err := os.Rename(current, temporary); err != nil {
		return nil, err
	}
	if err := os.Rename(previous, current); err != nil {
		_ = os.Rename(temporary, current)
		return nil, err
	}
	if err := os.Rename(temporary, previous); err != nil {
		// The old JAR remains intact in temporary; do not delete it.
		m.log(id, "WARN", "JAR 롤백 후 이전 파일 정리 실패: "+temporary)
		return nil, fmt.Errorf("JAR swap incomplete: %w", err)
	}
	m.mu.Lock()
	oldCfg := state.cfg
	state.cfg.InstalledVersion, state.cfg.RollbackVersion = oldCfg.RollbackVersion, oldCfg.InstalledVersion
	err = m.saveLocked()
	if err != nil {
		state.cfg = oldCfg
		// Best-effort rollback to the previous disk state. Retain files on error.
		tmp2 := filepath.Join(dir, ".panel-"+makeID()+".swap-failed")
		if os.Rename(current, tmp2) == nil {
			if os.Rename(previous, current) == nil {
				_ = os.Rename(tmp2, previous)
			} else {
				_ = os.Rename(tmp2, current)
			}
		}
	}
	newVersion := state.cfg.InstalledVersion
	m.mu.Unlock()
	if err != nil {
		return nil, err
	}
	m.log(id, "WARN", "서버 JAR 롤백 완료: "+newVersion)
	return map[string]any{"restored": true, "version": newVersion}, nil
}
