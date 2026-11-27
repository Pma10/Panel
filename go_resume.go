package main

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"time"
)

// Panels before server reattachment stopped servers on shutdown and listed
// them in .panel-resume.json; this starts those once after an upgrade.
// Invoked only after the HTTP listener has successfully bound. A corrupt or
// outdated resume file is not trusted; errors leave servers stopped.
func (m *manager) resumePending() {
	target := filepath.Join(m.root, ".panel-resume.json")
	data, err := os.ReadFile(target)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		log.Printf("Cannot read panel resume list: %v", err)
		return
	}
	if len(data) > 8192 {
		log.Print("Resume file is oversized; refusing startup")
		return
	}
	var ids []string
	if err := json.Unmarshal(data, &ids); err != nil {
		log.Printf("Invalid resume list: %v", err)
		return
	}
	if len(ids) > 100 {
		log.Print("Resume file has too many servers; refusing startup")
		return
	}
	for _, id := range ids {
		if len(id) != 16 || !isHex(id) {
			log.Print("Invalid server ID in resume list")
			return
		}
	}
	if err := os.Remove(target); err != nil {
		log.Printf("Cannot clear resume list: %v", err)
		return
	}
	// Give a previously stopped JVM its final socket and PID cleanup time.
	time.Sleep(400 * time.Millisecond)
	for _, id := range ids {
		m.mu.Lock()
		closed := m.closing
		_, known := m.servers[id]
		m.mu.Unlock()
		if closed {
			return
		}
		if !known {
			continue
		}
		if _, err := m.start(id); err != nil {
			m.log(id, "WARN", "패널 업데이트 이후 서버 재시작 실패: "+err.Error())
			log.Printf("Resume server %s: %v", id, err)
		} else {
			m.log(id, "INFO", "패널 업데이트 이후 이전 실행 상태 복구")
		}
		// Stagger server startups to avoid a sudden disk/CPU spike.
		time.Sleep(350 * time.Millisecond)
	}
}
