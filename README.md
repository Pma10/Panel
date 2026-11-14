# 피컨 · PConn Panel

**가벼운 Minecraft Java 서버 관리 패널** — Go 백엔드 + Paperlogy 기반 한국어 웹 UI. PufferPanel의 템플릿 설치와 Pterodactyl의 콘솔·파일·서버 관리 흐름을 참고했습니다.

> **개발 중 / 운영 안정성 미검증**: 기본 Java 실행 방식은 Docker로 격리되지 않습니다. 관리자 패널을 인터넷에 바로 공개하거나 신뢰하지 않는 JAR을 실행하지 마세요. 서버 월드의 단일 백업 저장소로 사용해서도 안 됩니다.

## Go 운영 모드 (권장 개발 경로)

Go 1.23 이상과 서버 버전에 맞는 Java가 필요합니다. Node.js는 실행에 필요하지 않습니다.

```bash
git clone --branch feat/unslop-panel-foundation https://github.com/Pma10/Panel.git
cd Panel
gofmt -w *.go
go build -trimpath -ldflags="-s -w" -o pconn .
export PANEL_ADMIN_PASSWORD='12자 이상의 강력한 무작위 비밀번호'
./pconn
```

브라우저에서 `http://127.0.0.1:4173`으로 접속합니다. Windows는 `go build -o pconn.exe .` 및 PowerShell 환경 변수 설정으로 실행합니다.

### 주요 기능

| 영역 | 지원 내용 |
|---|---|
| 서버 생성 | 포트, 메모리, EULA 설정, 수동 JAR 및 Paper/Folia 안정 빌드 템플릿 |
| 서버 제어 | Java 시작·중지·재시작, 비정상 종료 시 선택적 제한적 재시작 |
| 콘솔 | 실제 Java stdout/stderr, SSE 실시간 로그, 명령어 입력 |
| 파일 | 탐색, 업로드·다운로드, 텍스트 편집, 이동 없이 이름 변경·삭제 |
| 백업 | 중지 상태 월드 백업·복원, 예약 백업 및 재시작 |
| 상태 조회 | Java 프로세스 상태와 Linux RSS, Minecraft 상태 핑의 접속 인원·버전 |
| 보안 | 관리자 세션·HttpOnly 쿠키, CSRF/Origin 검사, 로그인 시도 제한, 경로 격리 |
| 감사 | 서버 관리 작업 내역 저장 |

Paper/Folia는 공식 PaperMC Fill v3 API의 안정 빌드를 받고 SHA-256을 검사합니다. Leaf·PmaPaper 등 기타 서버는 `server.jar`을 수동으로 업로드하면 됩니다. 서버 시작 전 [Minecraft EULA](https://aka.ms/MinecraftEULA)를 확인해야 합니다.

### 설정

| 환경 변수 | 기본값 |
|---|---|
| `PANEL_ADMIN_PASSWORD` | 필수, 12자 이상 |
| `PANEL_PORT` | `4173` |
| `PANEL_BIND_HOST` | `127.0.0.1` |
| `PANEL_PUBLIC_ORIGIN` | `http://127.0.0.1:4173` |
| `PANEL_DATA_DIR` | `./.panel-data` |
| `PANEL_JAVA_BIN` | `java` |

서버 폴더, 설정, 백업과 감사 로그는 `PANEL_DATA_DIR` 아래에 저장됩니다. Linux 서버용 서비스 예제는 `deploy/pconn.service`에 있습니다.

**설계·보안·설치 가이드:** [docs/go-backend.md](docs/go-backend.md)

## 테스트

```bash
gofmt -w *.go
go vet ./...
go test -race -count=1 ./...
go build -o pconn .
```

전용 GitHub Actions 검사도 추가했습니다. 하지만 **현재 저장소의 Actions 작업이 러너에 진입하지 못하고 있어 CI 통과를 확인하지 못했습니다.** Windows·Linux 실환경에서 별도로 빌드와 실제 Minecraft 서버 실행을 확인해야 합니다.

## 기존 Node.js 코드

이전 구현은 비교·마이그레이션용으로 유지하고 있습니다. `npm run dev`는 **데모 UI**, `npm run panel`은 **기존 Node 프로토타입 백엔드**입니다. Go와 Node 서버를 동일한 포트에서 동시에 실행하지 마세요. 새 기능은 Go 경로를 우선 개발합니다.

## 알려진 한계

현재 구조는 **Go가 동일 OS 계정으로 여러 Java 프로세스를 직접 실행**합니다. 서버별 컨테이너 격리, 노드 간 분산 운영, SFTP, 다중 사용자 RBAC, 2FA, CPU·디스크·실제 메모리 제한, TPS/MSPT 플러그인 연동, 무중단 백업, 외부 프로세스 자동 복구는 아직 지원하지 않습니다.

Java `-Xmx`는 힙 크기만 제한합니다. Pterodactyl Wings처럼 Docker 및 cgroup으로 서버 자원과 파일 시스템을 실제로 격리하는 기능과 혼동하지 마세요.

디자인 참고: [Figma 대시보드](https://www.figma.com/design/wJgjNvtFDPTscqKWzV6J5h?node-id=63-529), [Figma 콘솔](https://www.figma.com/design/wJgjNvtFDPTscqKWzV6J5h?node-id=63-949). [Unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky(CC BY 4.0), Paperlogy 웹폰트를 사용합니다.
