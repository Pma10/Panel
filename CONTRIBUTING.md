# Contributing to Panel

[← README](README.md) · [Architecture](docs/architecture.md) · [Security](SECURITY.md)

Panel은 **경량 Go 기반 단일 호스트 Minecraft 서버 패널**을 목표로 개발 중입니다. 사용자 데이터 보호, 예측 가능한 동작, 단순한 배포를 새로운 기능보다 우선합니다.

> **현재 저장소에는 별도의 LICENSE 파일이 없습니다.** 이 문서는 외부 사용·복제·수정·재배포 허가를 부여하지 않습니다. 기여와 코드 재사용 전에 저장소 소유자의 조건을 확인하세요.

## 설계 원칙

- 상시 실행되는 **단일 Go 바이너리**를 기본으로 합니다. 불필요한 런타임·DB 의존성 추가를 피합니다.
- 메모리를 제한 없이 사용하는 캐시, 무한 로그 보관, 무제한 작업 고루틴을 도입하지 않습니다.
- 파일·월드·JAR 변경은 서버 종료 상태와 해당 서버 작업 잠금을 확인해야 합니다.
- **신뢰할 수 없는 다운로드 URL이나 셸 명령을 서버 설치 API에서 받아들이지 않습니다.**
- UI는 기존 한국어 문구, 반응형 구조와 Panel 브랜딩을 유지합니다.
- 구현하지 않은 기능을 README나 프리뷰에서 완료된 것처럼 표시하지 않습니다.

## 로컬 검증

Go 1.24 이상과 Git이 필요합니다. Minecraft 서버 통합 테스트에는 Java가 별도로 필요합니다.

~~~bash
gofmt -w *.go
go vet ./...
go test -count=1 ./...
go test -race -count=1 ./...
go build -trimpath -o panel .
~~~

CGO 기반 레이스 검사에는 C 컴파일러가 필요할 수 있습니다.

- `go_manager.go`: Java 프로세스·서버 수명 주기·로그 관리
- `go_http.go`: HTTP API·SSE·정적 UI
- `go_auth.go`: 세션 및 CSRF
- `go_files.go` / `go_backups.go`: 서버 파일과 월드 데이터
- `go_templates.go`: 공식 서버 JAR 다운로드·무결성 검증
- `src/`: HTML/CSS/JavaScript 인터페이스

더 자세한 모듈 경계는 [아키텍처 문서](docs/architecture.md)에 있습니다.

## 변경 제안

PR에는 **변경 목적, 기존 동작과 달라지는 점, 데이터/보안 영향, 검증 방법 및 검증 결과**를 포함하는 것을 권장합니다. 서버 파일·프로세스·백업·로그를 수정했다면 오류와 취소/재시작 시나리오에 대한 테스트도 추가하세요.

화면 변경은 데모 모드와 Go API 모드의 차이를 확인해야 합니다. Go 소스 테스트와 실제 Paper/Leaf 서버 테스트는 별개이므로 **실행하지 않은 테스트를 통과했다고 표시하지 마세요**.

취약점 제보는 [SECURITY.md](SECURITY.md)의 안내를 따르세요.
