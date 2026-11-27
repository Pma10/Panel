//go:build unix && !linux

package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func processIdentity(pid int) (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ps", "-o", "lstart=", "-p", strconv.Itoa(pid)).Output()
	identity := strings.TrimSpace(string(out))
	return identity, err == nil && identity != ""
}

// shortcut: macOS/BSD have no /proc to reopen another process's pipe, so a
// server found after a panel restart shows output but takes no commands
// until it is restarted from the panel. A named FIFO would lift this.
func reopenStdin(marker processMarker) (*os.File, error) {
	return nil, errors.New("console input cannot be reattached on this OS")
}

func legacyProcessAlive(folder string, pid int) bool { return false }
