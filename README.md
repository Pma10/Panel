# 피컨 · PConn Panel

**가벼운 Minecraft Java 서버 관리 패널** — Go 백엔드 + Paperlogy 기반 한국어 웹 UI. PufferPanel의 템플릿 설치와 Pterodactyl의 콘솔·파일·서버 관리 흐름을 참고했습니다.

> **개발 중 / 운영 안정성 미검증**: 기본 Java 실행 방식은 Docker로 격리되지 않습니다. 관리자 패널을 인터넷에 바로 공개하거나 신뢰하지 않는 JAR을 실행하지 마세요. 서버 월드의 단일 백업 저장소로 사용해서도 안 됩니다.

## 운영용 설치·업데이트 (Linux)

운영 패널은 Go 단일 실행 파일을 기본으로 합니다. Docker를 사용하지 않는 구성이 가장 단순하며, 운영 서버를 맡긴다면 `pconn` 전용 비특권 사용자와 systemd를 권장합니다.

**첫 릴리스 이전에도 소스 체크아웃에서 다음 명령으로 설치·업데이트를 시도할 수 있어.** Go 1.23+, Java 21, systemd, sudo가 필요하며, Go 테스트에 실패하면 설치를 중단합니다.

```bash
# 소스에서 검사 → 빌드 → systemd 설치/교체
bash scripts/build-install-linux.sh

# 파일로 직접 설치·교체하는 방식도 지원
go build -o ./pconn .
sudo bash scripts/pconnctl-linux.sh install-local ./pconn
sudo bash scripts/pconnctl-linux.sh update-local ./pconn
```

**중요:** 현재 GitHub에는 아직 릴리스가 게시되지 않았습니다. 따라서 아래 다운로드 설치 명령은 첫 버전 태그와 GitHub Release가 정상 발행된 **이후에만** 사용할 수 있습니다.

```bash
# GitHub에 vX.Y.Z 릴리스가 실제로 올라온 뒤
sudo bash scripts/pconnctl-linux.sh install vX.Y.Z

# 새 릴리스가 나오면
sudo bash scripts/pconnctl-linux.sh update vX.Y.Z

# 실행 파일 교체 후 문제가 생기면
sudo bash scripts/pconnctl-linux.sh rollback

# 상태 확인
bash scripts/pconnctl-linux.sh status
```

설치·업데이트 과정에서는 릴리스 `SHA256SUMS`를 검사하고 새 바이너리의 버전을 확인합니다. 기존 바이너리를 보관하며, 변경 후 로컬 인증 API의 HTTP 401 응답을 확인합니다. 시작에 실패하면 이전 바이너리로 되돌립니다. **월드·설정·백업 폴더는 업데이터가 삭제하거나 덮어쓰지 않습니다.**

현재 릴리스가 없거나 직접 개발 중이라면 아래 **Go 소스 빌드** 방법으로 시험해 주세요. 운영 서버에 적용하기 전에 `bash scripts/verify-go.sh` 및 테스트용 Minecraft 서버 실행·복원 검증이 필요합니다.

### 메모리 사용량 정책

- 상시 운영에는 **Go 단일 바이너리 + systemd**를 기본으로 권장합니다. Node.js나 별도 DB 프로세스는 필요하지 않습니다.
- 서버별 콘솔 로그는 최대 **400건**의 고정 크기 순환 버퍼로 보관합니다. 이전 방식처럼 로그가 들어올 때마다 전체 기록을 복사하지 않습니다.
- 예약 백업·재시작은 **2개 작업자와 128개 대기열**로 처리해 동시에 수십 개의 작업이 실행되지 않도록 제한합니다.
- `GOMEMLIMIT=256MiB`는 **Go 런타임의 소프트 메모리 제한**입니다. JVM 메모리와는 별개이며 OS가 강제하는 절대 상한이 아닙니다.
- 관리자 **설정 → Go 메모리·성능 진단**에서 힙, Linux RSS, GC 횟수, 로그 연결 수를 직접 확인할 수 있습니다.

### Minecraft 서버 JAR 업데이트

공식 Paper/Folia 서버는 **시작 설정** 화면에서 버전을 선택하고 안정 빌드를 내려받아 SHA-256 검증 후 교체할 수 있습니다. 현재 서버를 중지해야 하며 이전 JAR 한 개를 롤백용으로 보관합니다. 직접 업로드하는 Leaf·PmaPaper·커스텀 JAR은 자동 업데이트하지 않습니다.

**주의:** 이전 JAR로 되돌리는 기능은 JAR 파일만 되돌리며 월드 데이터를 되돌리지 않습니다. 다운그레이드 전에는 반드시 별도 월드 백업을 준비하세요.

### 패널 재시작 후 서버 복원

Go 패널이 정상적으로 종료되면 **그때 실행 중이던 Minecraft 서버 ID만** 내부 재시작 목록에 저장합니다. 새 패널이 정상적으로 HTTP 포트를 열면 해당 서버를 순차적으로 재시작합니다. 수동 중지한 서버는 자동으로 시작하지 않습니다. 강제 종료나 정전 후의 복원까지 보장하는 것은 아니므로, 복구 후 상태를 확인하세요.

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

## 실제 운영 전 검증

Linux에서 Go 1.23+, Java, gcc(CGO/race), curl, Python 3를 설치한 다음:

```bash
bash scripts/verify-go.sh
```

이 검사는 Go 코드를 정리하고 `go vet`, `go test -race`, 최적화 빌드, 실제 로컬 HTTP 구동, 관리자 미인증 API의 HTTP 401, 내부 파일 접근의 HTTP 404를 차례로 확인합니다. 실행 중인 Minecraft 서버 파일에는 접근하지 않고 임시 데이터 디렉터리에서 실행합니다.

**이 저장소의 GitHub Actions는 현재 실행 단계가 나타나지 않고 실패하고 있어, CI가 정상 실행됐다고 주장할 수 없습니다.** 실제 배포 전에 위 검사를 직접 통과시키고 별도 테스트 세계에서 Java 시작·종료·복원까지 검증해야 합니다.

## Linux / Docker 배포

서버 직접 설치는 [Go 운영 가이드](docs/go-backend.md)와 `deploy/pconn.service`를 참고하세요.

Docker에서는 `.env.example`을 `.env`로 복사한 뒤 강력한 관리자 비밀번호와 **실제로 적용된 HTTPS 관리 패널 주소**를 지정합니다.

```bash
docker compose build
docker compose up -d
docker compose logs -f pconn
```

기본 Compose 구성은 관리자 포트 4173을 **호스트 127.0.0.1에만 바인딩**하고, Minecraft 접속 포트 25565만 외부로 엽니다. HTTPS 리버스 프록시와 도메인 설정이 별도로 필요합니다. 서버를 추가하여 다른 게임 포트를 사용한다면 Compose 포트 매핑도 직접 추가해야 합니다.

**Docker의 10GiB 제한은 패널과 모든 JVM의 합계입니다.** 서버별 격리가 아니며, 각 서버의 Java 힙 설정을 합산했을 때 컨테이너 상한을 넘지 않도록 주의하세요.

### 장애 복구와 데이터 보존

- Linux의 패널 데이터 폴더는 단일 실행 잠금을 사용합니다. 서버가 이미 존재하는 경우 두 번째 패널 실행을 거부합니다.
- 이전 Java PID가 살아 있는 것으로 감지되면 UI에서 경고하며 중복 시작을 차단합니다. **기존 프로세스가 정상 종료됐는지 확인한 뒤** 다시 시작하세요.
- Windows 등 비-Linux의 데이터 잠금 마커가 비정상 종료 후 남았다면, 기존 패널이 종료됐는지 반드시 확인한 뒤 잠금 파일을 수동으로 정리해야 합니다.
- 관리자 패널 데이터 폴더 밖에도 중요한 월드 백업을 보관하세요. 실행 중인 월드의 무중단 백업은 아직 지원하지 않습니다.
