# Panel — Go 백엔드 검증 보고서 (2026-11-16)

## 변경 범위

기준 커밋: `87b5067f3e0931aee0762972341c2e19dbbb1fcd`  
대상: PR #1 / `feat/unslop-panel-foundation`  
검사 환경: `go version go1.23.2 linux/amd64`

- 종료 중인 패널과 기존 관리 밖 JVM이 있는 서버의 파일·백업·설정·JAR 변경을 공통 진입 검사로 차단했습니다.
- `.` 경로로 서버 루트 디렉터리를 삭제하거나 변경하는 요청을 거부합니다. `.panel-` 내부 파일은 파일 목록에 표시하지 않습니다.
- 예약 작업 추가/삭제의 디스크 저장이 실패하면 기존 메모리 상태를 복구합니다. 설정 응답의 예약 목록도 독립 복사본으로 반환합니다.
- 로그아웃 또는 세션 만료 시 기존 SSE 콘솔 구독을 종료합니다. 각 쓰기는 최대 5초의 기한을 가지며 세션의 남은 수명이 더 짧으면 이를 따릅니다.
- 실패한 로그인 추적은 1,024개 클라이언트로 제한하고 만료 항목 정리는 매 요청 대신 1분 간격으로 제한합니다.
- 중복 로그 파서를 공용 boundedConsoleWriter 경로로 통합해 빈 줄/마지막 줄 처리의 불일치를 제거했습니다.

## 실행한 검증과 결과

```bash
go vet ./...
go test -race -skip '^TestGoStaticFrontendAndConfig$' -count=1 -timeout=90s -json ./...
go test -race -skip '^TestGoStaticFrontendAndConfig$' -count=5 -shuffle=on -timeout=90s ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o /tmp/panel-linux-amd64 .
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o /tmp/panel-linux-arm64 .
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -o /tmp/panel-windows-amd64.exe .
```

- `go vet`: 성공.
- 레이스 검사: 최상위 테스트 34개 및 하위 사례 17개 성공, 실패 0개.
- 순서를 섞은 5회 반복 검사: 성공.
- Linux amd64 / Linux arm64 / Windows amd64 대상 백엔드 교차 컴파일: 모두 성공.
- 신규 회귀 검사는 수정 전 코드에서 실제로 실패하는 것을 확인한 후 수정했습니다.

## 정확한 한계 — 전체 저장소/실서버 인증이 아님

실행 환경에서 GitHub로 직접 네트워크 접속할 수 없어 커넥터로 읽은 Go 소스와 기존 Go 테스트를 로컬 스냅샷으로 옮겼습니다. 기존 소스의 Git blob 해시를 기준 커밋과 대조했습니다. 웹 자산은 원본 `index.html`과 `src/api.js`만 가져왔으며, 원본 `src/app.js`와 `src/styles.css`는 이번 실행 스냅샷에 포함되지 않았습니다.

필터 없는 원본 Go 테스트 실행에서는 **TestGoStaticFrontendAndConfig 한 개**가 위 두 파일의 HTTP 404 때문에 실패했습니다. 백엔드 검사에서는 이 한 개를 명시적으로 제외했습니다. 저장소의 해당 테스트를 삭제하거나 완화하지 않았고, 가짜 프런트엔드 파일로 통과시키지 않았습니다.

따라서 이 결과는 **Go 백엔드 코드와 백엔드 테스트의 성공**이며, 전체 웹 UI/전체 저장소 CI/배포 아티팩트 성공을 의미하지 않습니다. 교차 컴파일 결과도 웹 자산이 불완전한 스냅샷이므로 서비스 배포용 바이너리로 배포하지 않았습니다.

프로세스 검사는 로컬 모의 Java 프로세스로, PaperMC 네트워크 검사는 테스트 응답으로 수행했습니다. 실제 Paper/Leaf JAR, 운영 월드, 원격 HTTPS 프록시, Windows/ARM 실기기 실행, 장시간 RAM/CPU 측정은 수행하지 않았습니다. Linux PID 기반 관리 밖 JVM 감지는 비-Linux 환경에 동일하게 적용되지 않습니다. 서버별 컨테이너 격리는 여전히 없습니다.
