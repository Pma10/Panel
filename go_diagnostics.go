package main

import (
 "os"
 "runtime"
 "runtime/debug"
 "time"
)

// Diagnostics is admin-only; it uses no external metrics service or polling.
func (m *manager) diagnostics()map[string]any{
 var mem runtime.MemStats
 runtime.ReadMemStats(&mem)
 m.mu.Lock()
 serverCount:=len(m.servers)
 running:=0
 logEntries:=0
 subscribers:=0
 for _,s:=range m.servers{
  if s.process!=nil{running++}
  logEntries+=len(s.logs)
  subscribers+=len(s.subscribers)
 }
 m.mu.Unlock()
 var panelRSS any
 if value,ok:=linuxRSS(os.Getpid());ok{panelRSS=value}
 return map[string]any{
  "processRSSGb":panelRSS,
  "backend":"go",
  "serverCount":serverCount,
  "managedProcesses":running,
  "logEntries":logEntries,
  "logSubscribers":subscribers,
  "goHeapBytes":mem.HeapAlloc,
  "goHeapReservedBytes":mem.HeapSys,
  "goTotalSysBytes":mem.Sys,
  "goGCCycles":mem.NumGC,
  "goroutines":runtime.NumGoroutine(),
  "memoryLimitBytes":debug.SetMemoryLimit(-1),
  "memoryLimitEnv":os.Getenv("GOMEMLIMIT"),
  "timestamp":time.Now().UTC().Format(time.RFC3339),
 }
}
