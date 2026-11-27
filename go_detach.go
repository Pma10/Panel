package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Servers run detached from the panel so a panel restart, update or crash
// does not take Minecraft down. Everything needed to find a server again is
// on disk:
//   - .panel-process: PID, a start-time identity (guards against PID reuse)
//     and, on Windows, the child's own handle to its stdin pipe;
//   - .panel-console.log: the server's stdout/stderr, which the panel tails.
//
// The child also holds a write end of its stdin pipe, so the pipe never hits
// EOF when the panel goes away and the console keeps accepting commands.
const processMarkerFile = ".panel-process"
const consoleLogFile = ".panel-console.log"

type processMarker struct {
	PID      int    `json:"pid"`
	Identity string `json:"identity"`
	Stdin    uint64 `json:"stdin,omitempty"`
	Started  string `json:"started"`
}

func writeProcessMarker(folder string, marker processMarker) error {
	data, err := json.Marshal(marker)
	if err != nil {
		return err
	}
	tmp := filepath.Join(folder, ".panel-process-"+makeID()+".tmp")
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, filepath.Join(folder, processMarkerFile)); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// readProcessMarker also accepts the old plain "PID\n" format.
func readProcessMarker(folder string) (processMarker, bool) {
	data, err := os.ReadFile(filepath.Join(folder, processMarkerFile))
	if err != nil || len(data) > 4096 {
		return processMarker{}, false
	}
	var marker processMarker
	if json.Unmarshal(data, &marker) == nil && marker.PID > 0 {
		return marker, true
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid < 1 {
		return processMarker{}, false
	}
	return processMarker{PID: pid}, true
}

// markerAlive reports whether the recorded process is still the one we started.
func markerAlive(folder string, marker processMarker) bool {
	if marker.Identity == "" {
		return legacyProcessAlive(folder, marker.PID)
	}
	identity, ok := processIdentity(marker.PID)
	return ok && identity == marker.Identity
}

func orphanJavaRunning(folder string) bool {
	marker, ok := readProcessMarker(folder)
	return ok && markerAlive(folder, marker)
}

func killPID(pid int) {
	if process, err := os.FindProcess(pid); err == nil {
		_ = process.Kill()
	}
}

func parseMarkerTime(value string) time.Time {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Now()
	}
	return t
}
