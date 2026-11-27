//go:build !linux && !windows

package main

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// processUsage asks ps(1) on macOS/BSD: resident size in KiB and CPU time.
func processUsage(pid int) (uint64, time.Duration, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ps", "-o", "rss=,time=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return 0, 0, false
	}
	f := strings.Fields(string(out))
	if len(f) < 2 {
		return 0, 0, false
	}
	rss, err := strconv.ParseUint(f[0], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	return rss * 1024, parseCPUTime(f[1]), true
}

// parseCPUTime reads ps "[[dd-]hh:]mm:ss[.ss]".
func parseCPUTime(value string) time.Duration {
	days := 0.0
	if d, rest, ok := strings.Cut(value, "-"); ok {
		days, _ = strconv.ParseFloat(d, 64)
		value = rest
	}
	total := 0.0
	for _, part := range strings.Split(value, ":") {
		n, _ := strconv.ParseFloat(part, 64)
		total = total*60 + n
	}
	return time.Duration((total + days*86400) * float64(time.Second))
}
