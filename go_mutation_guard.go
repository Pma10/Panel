package main

import "sync"

// checkMutationLocked is the shared gate for every server mutation. Callers
// hold m.mu so a concurrent start, shutdown or operation cannot pass between
// the state check and acquiring the busy flag. An orphaned JVM still owns its
// world even though it is not represented by managedServer.process.
func (m *manager) checkMutationLocked(s *managedServer, requireStopped bool) error {
	if m.closing {
		return apiError{503, "패널 종료 중에는 변경 작업을 시작할 수 없습니다."}
	}
	if s.busy {
		return apiError{409, "다른 서버 작업이 진행 중입니다."}
	}
	if requireStopped && (s.process != nil || orphanJavaRunning(m.dir(s.cfg.ID))) {
		return apiError{409, "실행 중인 Java 프로세스를 완전히 종료한 뒤 변경하세요."}
	}
	return nil
}

// acquireMutation owns the per-server disk-operation flag. The release
// function is idempotent: accidental duplicate cleanup must not unlock a
// later operation that acquired the same server.
func (m *manager) acquireMutation(id string, requireStopped bool) (*managedServer, func(), error) {
	m.mu.Lock()
	s, err := m.get(id)
	if err == nil {
		err = m.checkMutationLocked(s, requireStopped)
	}
	if err != nil {
		m.mu.Unlock()
		return nil, nil, err
	}
	s.busy = true
	m.mu.Unlock()
	var once sync.Once
	return s, func() {
		once.Do(func() {
			m.mu.Lock()
			s.busy = false
			m.mu.Unlock()
		})
	}, nil
}
