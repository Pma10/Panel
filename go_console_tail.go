package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// maxConsoleLog bounds .panel-console.log; Minecraft keeps its own logs/.
const maxConsoleLog = 32 << 20

// stopServersOnShutdown restores the old "panel exit stops every server"
// behavior. Only tests set it, so they do not leave processes behind.
var stopServersOnShutdown = false

func newProcess(pid int, stdin *os.File, state string, started time.Time) *managedProcess {
	p := &managedProcess{pid: pid, state: state, started: started,
		done: make(chan struct{}), exited: make(chan struct{}), tailDone: make(chan struct{}), detach: make(chan struct{})}
	if stdin != nil {
		p.stdin = stdin
	}
	return p
}

// tailConsole follows the server's console file and feeds it into the ring.
func (m *manager) tailConsole(id string, p *managedProcess, path string, offset int64) {
	defer close(p.tailDone)
	writer := &boundedConsoleWriter{writeLog: func(line string) { m.log(id, "INFO", line) }}
	file, err := os.Open(path)
	if err != nil {
		m.log(id, "WARN", "콘솔 로그를 열 수 없습니다: "+err.Error())
		return
	}
	defer file.Close()
	buf := make([]byte, 32*1024)
	drain := func() {
		info, err := file.Stat()
		if err != nil {
			return
		}
		if info.Size() < offset {
			offset = 0 // truncated
		}
		for offset < info.Size() {
			n, err := file.ReadAt(buf, offset)
			if n > 0 {
				_, _ = writer.Write(buf[:n])
				offset += int64(n)
			}
			if err != nil && err != io.EOF || n == 0 {
				break
			}
		}
		if info.Size() > maxConsoleLog {
			// shortcut: a line written between the read above and this truncate
			// is lost from the panel view (it is still in logs/latest.log).
			if os.Truncate(path, 0) == nil {
				offset = 0
			}
		}
	}
	tick := time.NewTicker(150 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-p.exited:
			drain()
			writer.Flush()
			return
		case <-p.detach:
			return
		case <-tick.C:
			drain()
		}
	}
}

// processExited runs once when the server process is gone, whether it was
// our child (exitErr from Wait) or adopted after a panel restart (unknown).
func (m *manager) processExited(id string, p *managedProcess, exitErr error, known bool) {
	close(p.exited)
	select {
	case <-p.tailDone:
	case <-time.After(2 * time.Second):
	}
	if p.stdin != nil {
		_ = p.stdin.Close()
	}
	_ = os.Remove(filepath.Join(m.dir(id), processMarkerFile))
	m.mu.Lock()
	s := m.servers[id]
	restart := false
	if s != nil {
		if s.process == p {
			s.process = nil
			s.mcStatus = nil
			s.memoryValid = false
			s.cpuValid = false
		}
		// Any exit the panel did not request (crash or in-game /stop) restarts when enabled.
		restart = !p.expectedStop && s.cfg.AutoRestart && !m.closing
	}
	m.mu.Unlock()
	switch {
	case !known:
		m.log(id, "INFO", "서버 프로세스가 종료되었습니다.")
	case exitErr != nil:
		m.log(id, "WARN", "Java 종료: "+exitErr.Error())
	default:
		m.log(id, "INFO", "Java 정상 종료")
	}
	close(p.done)
	if restart {
		m.scheduleCrashRestart(id, p.started)
	}
}

// adoptRunning reconnects to servers left running by a previous panel.
// Called from newManager before any other goroutine touches the servers.
func (m *manager) adoptRunning() {
	for id, s := range m.servers {
		folder := m.dir(id)
		marker, ok := readProcessMarker(folder)
		if !ok {
			continue
		}
		if !markerAlive(folder, marker) {
			_ = os.Remove(filepath.Join(folder, processMarkerFile))
			continue
		}
		if marker.Identity == "" {
			continue // started by an older panel: shown as "unmanaged"
		}
		stdin, stdinErr := reopenStdin(marker)
		if stdinErr != nil {
			stdin = nil
		}
		p := newProcess(marker.PID, stdin, "running", parseMarkerTime(marker.Started))
		p.adopted = true
		s.process = p
		path := filepath.Join(folder, consoleLogFile)
		s.logs, s.logHead = consoleTail(path), 0
		offset := int64(0)
		if info, err := os.Stat(path); err == nil {
			offset = info.Size()
		}
		go m.tailConsole(id, p, path, offset)
		go m.watchAdopted(id, p, folder, marker)
		m.log(id, "INFO", fmt.Sprintf("패널 재시작 후 실행 중인 서버에 다시 연결했습니다 (PID %d).", marker.PID))
		if stdinErr != nil {
			m.log(id, "WARN", "콘솔 입력을 다시 연결하지 못했습니다. 서버를 재시작하면 복구됩니다.")
		}
	}
}

// watchAdopted polls a non-child process; it cannot be waited on directly.
func (m *manager) watchAdopted(id string, p *managedProcess, folder string, marker processMarker) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-p.detach:
			return
		case <-tick.C:
			if !markerAlive(folder, marker) {
				m.processExited(id, p, nil, false)
				return
			}
		}
	}
}

// consoleTail returns the last lines of the console file as history.
func consoleTail(path string) []logEntry {
	file, err := os.Open(path)
	if err != nil {
		return []logEntry{}
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return []logEntry{}
	}
	const maxTail = 256 * 1024
	offset := int64(0)
	if info.Size() > maxTail {
		offset = info.Size() - maxTail
	}
	buf := make([]byte, info.Size()-offset)
	n, _ := file.ReadAt(buf, offset)
	lines := strings.Split(strings.ReplaceAll(string(buf[:n]), "\r\n", "\n"), "\n")
	if offset > 0 && len(lines) > 0 {
		lines = lines[1:]
	}
	result := []logEntry{}
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if len(line) > 2048 {
			line = line[:2048]
		}
		level := "INFO"
		if m := levelPattern.FindStringSubmatch(ansiPattern.ReplaceAllString(line, "")); m != nil {
			level = m[1]
		}
		result = append(result, logEntry{Time: "이전", Level: level, Message: line})
	}
	if len(result) > maxLogEntries {
		result = result[len(result)-maxLogEntries:]
	}
	return result
}

// terminate asks a process to exit when its console cannot be reached.
func terminate(pid int) {
	if process, err := os.FindProcess(pid); err == nil {
		if process.Signal(syscall.SIGTERM) != nil {
			_ = process.Kill()
		}
	}
}
