//go:build !linux

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// A portable exclusive lock marker on non-Linux platforms. It records the
// owner's PID and start identity, so a lock left by a killed panel is
// reclaimed instead of blocking the next start.
func lockPanelData(root string) (func(), error) {
	path := filepath.Join(root, ".panel-instance.lock")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil && os.IsExist(err) && staleLock(path) {
		_ = os.Remove(path)
		file, err = os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	}
	if err != nil {
		return nil, fmt.Errorf("another panel is using this data folder (%s): %w", path, err)
	}
	identity, _ := processIdentity(os.Getpid())
	if _, err = file.WriteString(fmt.Sprintf("%d %s\n", os.Getpid(), identity)); err != nil {
		file.Close()
		os.Remove(path)
		return nil, err
	}
	return func() { _ = file.Close(); _ = os.Remove(path) }, nil
}

func staleLock(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 256 {
		return false
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return false
	}
	pid, err := strconv.Atoi(fields[0])
	if err != nil {
		return false
	}
	identity, alive := processIdentity(pid)
	if !alive {
		return true
	}
	// Same PID now belongs to another program.
	return len(fields) > 1 && fields[1] != identity
}
