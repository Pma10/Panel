package main

import (
	"context"
	"strings"
	"time"
)

// pauseSaving makes a running Minecraft server flush the world and stop
// writing it, so a backup copies a consistent world without downtime.
// The returned function turns saving back on; callers must always run it.
func (m *manager) pauseSaving(ctx context.Context, id string) (func(), error) {
	logs, unsubscribe, err := m.subscribe(id)
	if err != nil {
		return nil, err
	}
	defer unsubscribe()
	resume := func() {
		if err := m.command(id, "save-on"); err != nil {
			m.log(id, "ERROR", "백업 후 save-on 전송 실패: 콘솔에서 save-on을 직접 입력하세요. "+err.Error())
		}
	}
	if err := m.command(id, "save-off"); err != nil {
		return nil, err
	}
	if err := m.command(id, "save-all flush"); err != nil {
		resume()
		return nil, err
	}
	timeout := time.NewTimer(90 * time.Second)
	defer timeout.Stop()
	for {
		select {
		case entry, ok := <-logs:
			if !ok {
				resume()
				return nil, apiError{409, "백업 준비 중 서버 로그 연결이 끊겼습니다."}
			}
			// Vanilla, Paper and its forks all print this once save-all finishes.
			if strings.Contains(entry.Message, "Saved the game") {
				return resume, nil
			}
		case <-timeout.C:
			resume()
			return nil, apiError{504, "서버가 월드 저장을 끝내지 않아 백업을 취소했습니다."}
		case <-ctx.Done():
			resume()
			return nil, ctx.Err()
		}
	}
}
