package main

import (
    "bytes"
    "strings"
    "sync"
)

// Go exec.Cmd streams into boundedConsoleWriter without retaining the entire
// stdout/stderr output. In particular, long plugin lines cannot grow memory.
// Leave space for the truncation marker before manager.log enforces 2048 bytes.
const maxConsoleLineBytes = 1984

type boundedConsoleWriter struct {
    mu        sync.Mutex
    writeLog  func(string)
    pending   []byte
    truncated bool
}

func (w *boundedConsoleWriter) flushLocked() {
    if len(w.pending) == 0 && !w.truncated { return }
    message := strings.TrimSuffix(string(w.pending), "\r")
    if w.truncated { message += " [로그 행 길이 제한으로 생략됨]" }
    w.writeLog(message)
    w.pending = w.pending[:0]
    w.truncated = false
}

func (w *boundedConsoleWriter) Write(p []byte) (int, error) {
    w.mu.Lock()
    defer w.mu.Unlock()
    total := len(p)
    for len(p) > 0 {
        newline := bytes.IndexByte(p, '\n')
        fragment := p
        if newline >= 0 { fragment = p[:newline] }
        available := maxConsoleLineBytes - len(w.pending)
        if len(fragment) > available {
            w.truncated = true
            fragment = fragment[:available]
        }
        w.pending = append(w.pending, fragment...)
        if newline < 0 { break }
        w.flushLocked()
        p = p[newline+1:]
    }
    return total, nil
}

func (w *boundedConsoleWriter) Flush() {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.flushLocked()
}
