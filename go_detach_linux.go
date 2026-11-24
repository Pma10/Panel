//go:build linux

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// processIdentity is the process start time in clock ticks since boot
// (field 22 of /proc/<pid>/stat), which changes if the PID is reused.
func processIdentity(pid int) (string, bool) {
	buf, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return "", false
	}
	text := string(buf)
	end := strings.LastIndexByte(text, ')')
	if end < 0 {
		return "", false
	}
	fields := strings.Fields(text[end+1:])
	if len(fields) < 20 || fields[0] == "Z" {
		return "", false
	}
	return fields[19], true
}

// reopenStdin opens the server's stdin pipe for writing through /proc.
func reopenStdin(marker processMarker) (*os.File, error) {
	if marker.Identity == "" {
		return nil, errors.New("no identity")
	}
	return os.OpenFile("/proc/"+strconv.Itoa(marker.PID)+"/fd/0", os.O_WRONLY, 0)
}

// legacyProcessAlive handles markers written by older panels (PID only).
func legacyProcessAlive(folder string, pid int) bool {
	cwd, err := os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "cwd"))
	return err == nil && filepath.Clean(cwd) == filepath.Clean(folder)
}
