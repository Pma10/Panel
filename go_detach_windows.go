//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"strconv"
	"syscall"
)

const (
	createNewProcessGroup = 0x00000200
	processDupHandle      = 0x0040
	processQueryLimited   = 0x1000
	stillActive           = 259
)

// prepareDetached starts the server in its own process group (a Ctrl+C or a
// closing console of the panel does not reach it) and lets it inherit its own
// stdin write handle, so the pipe never reaches EOF when the panel exits.
// Inherited handles keep the same value in the child; the marker records it
// so a later panel can duplicate it back with DuplicateHandle.
func prepareDetached(cmd *exec.Cmd, stdinWrite *os.File) {
	handle := syscall.Handle(stdinWrite.Fd())
	_ = syscall.SetHandleInformation(handle, syscall.HANDLE_FLAG_INHERIT, syscall.HANDLE_FLAG_INHERIT)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags:              createNewProcessGroup,
		AdditionalInheritedHandles: []syscall.Handle{handle},
	}
}

// afterDetachedStart stops later children from inheriting the handle and
// returns its value for the marker.
func afterDetachedStart(stdinWrite *os.File) uint64 {
	handle := syscall.Handle(stdinWrite.Fd())
	_ = syscall.SetHandleInformation(handle, syscall.HANDLE_FLAG_INHERIT, 0)
	return uint64(handle)
}

// processIdentity is the process creation time, which changes on PID reuse.
func processIdentity(pid int) (string, bool) {
	handle, err := syscall.OpenProcess(processQueryLimited, false, uint32(pid))
	if err != nil {
		return "", false
	}
	defer syscall.CloseHandle(handle)
	var code uint32
	if syscall.GetExitCodeProcess(handle, &code) != nil || code != stillActive {
		return "", false
	}
	var creation, exit, kernel, user syscall.Filetime
	if syscall.GetProcessTimes(handle, &creation, &exit, &kernel, &user) != nil {
		return "", false
	}
	return strconv.FormatUint(uint64(creation.HighDateTime)<<32|uint64(creation.LowDateTime), 10), true
}

// reopenStdin duplicates the server's own stdin write handle into the panel.
func reopenStdin(marker processMarker) (*os.File, error) {
	if marker.Stdin == 0 {
		return nil, errors.New("no stdin handle recorded")
	}
	source, err := syscall.OpenProcess(processDupHandle, false, uint32(marker.PID))
	if err != nil {
		return nil, err
	}
	defer syscall.CloseHandle(source)
	current, err := syscall.GetCurrentProcess()
	if err != nil {
		return nil, err
	}
	var duplicate syscall.Handle
	if err := syscall.DuplicateHandle(source, syscall.Handle(marker.Stdin), current, &duplicate, 0, false, syscall.DUPLICATE_SAME_ACCESS); err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(duplicate), "server-stdin"), nil
}

func legacyProcessAlive(folder string, pid int) bool { return false }
