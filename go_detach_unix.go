//go:build unix

package main

import (
	"os"
	"os/exec"
	"syscall"
)

// prepareDetached puts the server in its own process group (Ctrl+C and
// service signals to the panel do not reach it) and hands it a copy of its
// own stdin write end as fd 3, so its stdin never reaches EOF.
func prepareDetached(cmd *exec.Cmd, stdinWrite *os.File) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.ExtraFiles = []*os.File{stdinWrite}
}

func afterDetachedStart(stdinWrite *os.File) uint64 { return 0 }
