package main

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// readProperties parses a Java .properties file (key=value, # comments).
func readProperties(path string) (map[string]string, bool) {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return nil, false
	}
	buf, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(buf), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || line[0] == '#' || line[0] == '!' {
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			values[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return values, true
}

// setProperty rewrites one key in place, appending it when missing.
func setProperty(path, key, value string) error {
	buf, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	lines := []string{}
	if len(buf) > 0 {
		lines = strings.Split(strings.TrimRight(string(buf), "\n"), "\n")
	}
	found := false
	for i, line := range lines {
		k, _, ok := strings.Cut(strings.TrimSpace(line), "=")
		if ok && strings.TrimSpace(k) == key {
			lines[i] = key + "=" + value
			found = true
		}
	}
	if !found {
		lines = append(lines, key+"="+value)
	}
	tmp := path + ".panel-" + makeID() + ".tmp"
	if err := os.WriteFile(tmp, []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

var _, cgnat, _ = net.ParseCIDR("100.64.0.0/10")

func tcpListening(port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), 300*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// hostAddresses lists this machine's non-loopback IPs players could use.
func hostAddresses() []map[string]any {
	result := []map[string]any{}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return result
	}
	for _, a := range addrs {
		ipnet, ok := a.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() || ipnet.IP.IsLinkLocalUnicast() {
			continue
		}
		kind := "public"
		if ipnet.IP.IsPrivate() {
			kind = "lan"
		} else if cgnat.Contains(ipnet.IP) {
			kind = "vpn" // 100.64.0.0/10: carrier NAT or Tailscale, not reachable from the internet
		}
		result = append(result, map[string]any{"ip": ipnet.IP.String(), "ipv6": ipnet.IP.To4() == nil, "kind": kind})
		if len(result) >= 16 {
			break
		}
	}
	return result
}

func (m *manager) networkInfo(id string) (map[string]any, error) {
	m.mu.Lock()
	s, err := m.get(id)
	if err != nil {
		m.mu.Unlock()
		return nil, err
	}
	cfg := s.cfg
	running := s.process != nil
	var status map[string]any
	if s.mcStatus != nil && time.Since(s.mcStatus.CheckedAt) < 60*time.Second {
		status = map[string]any{"players": s.mcStatus.Players, "maxPlayers": s.mcStatus.MaxPlayers,
			"version": s.mcStatus.Version, "latencyMs": s.mcStatus.LatencyMs, "checkedAt": s.mcStatus.CheckedAt.UTC().Format(time.RFC3339)}
	}
	owners := map[int]string{}
	for _, other := range m.servers {
		if other.cfg.ID != id {
			owners[other.cfg.Port] = other.cfg.Name
		}
	}
	m.mu.Unlock()

	props, hasProps := readProperties(filepath.Join(m.dir(id), "server.properties"))
	warnings := []string{}
	type portRow = map[string]any
	ports := []portRow{}
	addPort := func(port int, protocol, purpose string, checkable bool) {
		row := portRow{"port": port, "protocol": protocol, "description": purpose}
		if checkable {
			listening := tcpListening(port)
			row["listening"] = listening
			switch {
			case listening && running:
				row["state"] = "open"
			case listening:
				row["state"] = "occupied" // something else holds the port
			case running:
				row["state"] = "waiting"
			default:
				row["state"] = "closed"
			}
		} else {
			row["state"] = "unknown"
		}
		if name, clash := owners[port]; clash {
			row["conflict"] = name
			warnings = append(warnings, fmt.Sprintf("%d 포트를 '%s' 서버도 사용합니다.", port, name))
		}
		ports = append(ports, row)
	}
	addPort(cfg.Port, "TCP", "Minecraft 접속", true)
	if hasProps && cfg.Template != "velocity" {
		if p, err := strconv.Atoi(props["server-port"]); err == nil && p != cfg.Port {
			warnings = append(warnings, fmt.Sprintf("server.properties의 server-port(%d)가 패널 포트(%d)와 다릅니다. 포트 변경으로 맞추세요.", p, cfg.Port))
		}
		if props["enable-query"] == "true" {
			p, err := strconv.Atoi(props["query.port"])
			if err != nil {
				p = cfg.Port
			}
			addPort(p, "UDP", "Query (서버 목록 조회)", false)
		}
		if props["enable-rcon"] == "true" {
			p, err := strconv.Atoi(props["rcon.port"])
			if err != nil {
				p = 25575
			}
			addPort(p, "TCP", "RCON (원격 콘솔)", true)
			warnings = append(warnings, "RCON이 켜져 있습니다. 방화벽에서 외부 접근을 막고 강한 rcon.password를 쓰세요.")
		}
	}
	if !running && tcpListening(cfg.Port) {
		warnings = append(warnings, fmt.Sprintf("서버가 꺼져 있는데 %d 포트를 다른 프로그램이 쓰고 있습니다. 이대로는 서버를 시작할 수 없습니다.", cfg.Port))
	}
	return map[string]any{
		"ports": ports, "addresses": hostAddresses(), "running": running, "status": status,
		"warnings": warnings, "template": cfg.Template,
		"serverIp": props["server-ip"], "onlineMode": map[bool]string{true: "", false: props["online-mode"]}[cfg.Template == "velocity"],
	}, nil
}

// setPort changes the game port; it applies on the next start, so the server
// must be stopped to keep the running process and the panel in agreement.
func (m *manager) setPort(id string, port int) (map[string]any, error) {
	if port < 1024 || port > 65535 {
		return nil, apiError{400, "포트 범위는 1024~65535입니다."}
	}
	s, release, err := m.acquireMutation(id, true)
	if err != nil {
		return nil, err
	}
	defer release()
	m.mu.Lock()
	for _, other := range m.servers {
		if other != s && other.cfg.Port == port {
			m.mu.Unlock()
			return nil, apiError{409, "'" + other.cfg.Name + "' 서버가 이미 이 포트를 사용합니다."}
		}
	}
	m.mu.Unlock()
	if tcpListening(port) {
		return nil, apiError{409, "다른 프로그램이 이미 이 포트를 사용 중입니다."}
	}
	if s.cfg.Template != "velocity" {
		if err := setProperty(filepath.Join(m.dir(id), "server.properties"), "server-port", strconv.Itoa(port)); err != nil {
			return nil, err
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	old := s.cfg.Port
	s.cfg.Port = port
	if err := m.saveLocked(); err != nil {
		s.cfg.Port = old
		if s.cfg.Template != "velocity" {
			_ = setProperty(filepath.Join(m.dir(id), "server.properties"), "server-port", strconv.Itoa(old))
		}
		return nil, err
	}
	return m.describe(s), nil
}
