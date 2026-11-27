package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"runtime"
	"strconv"
	"sync"
	"time"
)

type minecraftStatus struct {
	Players    int
	MaxPlayers int
	Version    string
	LatencyMs  int64
	CheckedAt  time.Time
}

func writeVarint(value int) []byte {
	result := []byte{}
	for {
		b := byte(value & 0x7f)
		value >>= 7
		if value == 0 {
			return append(result, b)
		}
		result = append(result, b|0x80)
	}
}
func readVarint(reader *bufio.Reader) (int, error) {
	result := 0
	for shift := 0; shift < 35; shift += 7 {
		b, err := reader.ReadByte()
		if err != nil {
			return 0, err
		}
		result |= int(b&0x7f) << shift
		if b&0x80 == 0 {
			return result, nil
		}
	}
	return 0, errors.New("invalid varint")
}
func pingMinecraft(ctx context.Context, port int) (*minecraftStatus, error) {
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	dialer := net.Dialer{Timeout: 900 * time.Millisecond}
	socket, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	defer socket.Close()
	started := time.Now()
	if err := socket.SetDeadline(time.Now().Add(1100 * time.Millisecond)); err != nil {
		return nil, err
	}
	hostname := []byte("localhost")
	packet := []byte{0} // handshake packet id
	packet = append(packet, writeVarint(0)...)
	packet = append(packet, writeVarint(len(hostname))...)
	packet = append(packet, hostname...)
	portField := make([]byte, 2)
	binary.BigEndian.PutUint16(portField, uint16(port))
	packet = append(packet, portField...)
	packet = append(packet, 1) // next state: status
	frame := append(writeVarint(len(packet)), packet...)
	frame = append(frame, 1, 0) // status request: length=1, packetId=0
	if _, err = socket.Write(frame); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(socket)
	packetSize, err := readVarint(reader)
	if err != nil || packetSize < 2 || packetSize > 128<<10 {
		return nil, errors.New("invalid status packet")
	}
	data := make([]byte, packetSize)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}
	payload := bufio.NewReader(bytes.NewReader(data))
	packetID, err := readVarint(payload)
	if err != nil || packetID != 0 {
		return nil, errors.New("invalid status response")
	}
	length, err := readVarint(payload)
	if err != nil || length < 0 || length > 1<<20 {
		return nil, errors.New("invalid response length")
	}
	jsonData := make([]byte, length)
	if _, err := io.ReadFull(payload, jsonData); err != nil {
		return nil, err
	}
	var content struct {
		Version struct {
			Name string `json:"name"`
		} `json:"version"`
		Players struct {
			Online int `json:"online"`
			Max    int `json:"max"`
		} `json:"players"`
	}
	if err := json.Unmarshal(jsonData, &content); err != nil {
		return nil, err
	}
	if content.Players.Online < 0 || content.Players.Max < 0 {
		return nil, errors.New("invalid players")
	}
	version := content.Version.Name
	if len(version) > 100 {
		version = version[:100]
	}
	return &minecraftStatus{
		Players: content.Players.Online, MaxPlayers: content.Players.Max,
		Version: version, LatencyMs: time.Since(started).Milliseconds(), CheckedAt: time.Now(),
	}, nil
}
func (m *manager) pollStatuses() {
	m.mu.Lock()
	type item struct {
		id      string
		port    int
		pid     int
		process *managedProcess
	}
	current := []item{}
	for id, s := range m.servers {
		if s.process != nil && s.process.pid > 0 {
			current = append(current, item{id, s.cfg.Port, s.process.pid, s.process})
		}
	}
	m.mu.Unlock()
	guard := make(chan struct{}, 4)
	var workers sync.WaitGroup
	for _, server := range current {
		guard <- struct{}{}
		workers.Add(1)
		go func(x item) {
			defer workers.Done()
			defer func() { <-guard }()
			ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
			defer cancel()
			result, err := pingMinecraft(ctx, x.port)
			rss, cpuTime, exists := processUsage(x.pid)
			sampled := time.Now()
			m.mu.Lock()
			if state := m.servers[x.id]; state != nil && state.process == x.process {
				if err == nil {
					state.mcStatus = result
					// A successful ping must never undo an operator-requested stop.
					if state.process.state == "starting" {
						state.process.state = "running"
					}
				} else {
					state.mcStatus = nil
				}
				state.memoryGB = float64(rss) / (1 << 30)
				state.memoryValid = exists
				// CPU % needs two samples of the same process; 100% means every core busy.
				if exists && state.cpuProcess == x.process && sampled.After(state.cpuAt) {
					state.cpuPercent = 100 * float64(cpuTime-state.cpuLast) / float64(sampled.Sub(state.cpuAt)) / float64(runtime.NumCPU())
					state.cpuValid = state.cpuPercent >= 0
				} else {
					state.cpuValid = false
				}
				state.cpuProcess, state.cpuLast, state.cpuAt = x.process, cpuTime, sampled
			}
			m.mu.Unlock()
		}(server)
	}
	workers.Wait()
}
func (m *manager) statusLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.stopScheduler:
			return
		case <-ticker.C:
			m.pollStatuses()
		}
	}
}
