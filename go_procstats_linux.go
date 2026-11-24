//go:build linux

package main

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Linux reports USER_HZ = 100 for /proc/<pid>/stat on every mainstream arch.
const clockTicks = 100

type procStat struct {
	ppid      int
	cpuTicks  uint64
	rssPages  uint64
}

func readProcStat(pid int) (procStat, bool) {
	buf, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return procStat{}, false
	}
	// The command name may contain spaces; fields start after the last ')'.
	text := string(buf)
	end := strings.LastIndexByte(text, ')')
	if end < 0 {
		return procStat{}, false
	}
	f := strings.Fields(text[end+1:])
	if len(f) < 22 {
		return procStat{}, false
	}
	ppid, _ := strconv.Atoi(f[1])
	utime, _ := strconv.ParseUint(f[11], 10, 64)
	stime, _ := strconv.ParseUint(f[12], 10, 64)
	rss, _ := strconv.ParseUint(f[21], 10, 64)
	return procStat{ppid: ppid, cpuTicks: utime + stime, rssPages: rss}, true
}

// processUsage sums the process and its descendants, so a launch command
// that runs a shell script still reports the Java child it started.
func processUsage(pid int) (uint64, time.Duration, bool) {
	root, ok := readProcStat(pid)
	if !ok {
		return 0, 0, false
	}
	children := map[int][]int{}
	stats := map[int]procStat{pid: root}
	if entries, err := os.ReadDir("/proc"); err == nil {
		for _, e := range entries {
			child, err := strconv.Atoi(e.Name())
			if err != nil || child == pid {
				continue
			}
			if st, ok := readProcStat(child); ok {
				stats[child] = st
				children[st.ppid] = append(children[st.ppid], child)
			}
		}
	}
	var rss, ticks uint64
	queue := []int{pid}
	for len(queue) > 0 && len(queue) < 4096 {
		current := queue[0]
		queue = queue[1:]
		st := stats[current]
		rss += st.rssPages
		ticks += st.cpuTicks
		queue = append(queue, children[current]...)
	}
	return rss * uint64(os.Getpagesize()), time.Duration(ticks) * time.Second / clockTicks, true
}
