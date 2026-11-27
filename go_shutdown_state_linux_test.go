//go:build linux

package main

import (
	"context"
	"net"
	"os"
	"os/exec"
	"testing"
	"time"
)

// A successful Minecraft status ping must never turn an operator's
// stop-in-progress back into "running".
func TestStatusPingPreservesStoppingState(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		received := make([]byte, 256)
		_, _ = conn.Read(received)
		payload := []byte(`{"version":{"name":"Mock Paper"},"players":{"online":3,"max":20}}`)
		response := append([]byte{0}, writeVarint(len(payload))...)
		response = append(response, payload...)
		frame := append(writeVarint(len(response)), response...)
		_, _ = conn.Write(frame)
	}()
	m, err := newManager(t.TempDir(), "java")
	if err != nil {
		t.Fatal(err)
	}
	defer m.shutdown(context.Background())
	created, err := m.create(serverConfig{Name: "status-test", Port: port, MemoryMb: 1024, EulaAccepted: true})
	if err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)
	process, err := os.FindProcess(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	m.mu.Lock()
	s := m.servers[id]
	s.process = &managedProcess{cmd: &exec.Cmd{Process: process}, pid: os.Getpid(), state: "stopping", started: time.Now()}
	m.mu.Unlock()
	m.pollStatuses()
	m.mu.Lock()
	state := s.process.state
	players := -1
	if s.mcStatus != nil {
		players = s.mcStatus.Players
	}
	s.process = nil // synthetic process: never signal the current test process
	m.mu.Unlock()
	if state != "stopping" {
		t.Fatalf("ping changed stopping to %q", state)
	}
	if players != 3 {
		t.Fatalf("mock status ping not processed: players=%d", players)
	}
}
