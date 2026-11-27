package main

import (
	"context"
	"time"
)

type scheduledJob struct {
	id     string
	action string
}

func (m *manager) scheduledWorker() {
	for {
		select {
		case <-m.stopScheduler:
			return
		case work := <-m.jobQueue:
			m.mu.Lock()
			closed := m.closing
			m.mu.Unlock()
			if closed {
				return
			}
			m.runScheduledJob(work)
		}
	}
}

func (m *manager) runScheduledJob(work scheduledJob) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	// Abort cold backups if the panel is shutting down rather than racing a JVM restart.
	stopped := make(chan struct{})
	go func() {
		select {
		case <-m.stopScheduler:
			cancel()
		case <-stopped:
		}
	}()
	defer close(stopped)
	if work.action == "restart" {
		if _, err := m.restart(work.id); err != nil {
			m.log(work.id, "WARN", "예약 재시작 실패: "+err.Error())
		}
		return
	}
	// Running servers are backed up live (save-off/save-all), so no downtime.
	if _, err := m.backup(ctx, work.id); err != nil {
		m.log(work.id, "WARN", "예약 백업 실패: "+err.Error())
	}
}
