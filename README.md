<div align="center">

# Panel

**A lightweight control panel for Minecraft Java servers.**

마인크래프트 서버 운영에 필요한 기능을 한 화면에.  
단일 Go 실행 파일 · 별도 데이터베이스 불필요 · 한국어 인터페이스

[시작하기](#빠른-시작) · [기능](#주요-기능) · [운영 및 업데이트](#운영-및-업데이트) · [구조](#구조와-설계-원칙)

</div>

<p align="center">
  <img src="docs/assets/dashboard-preview.svg" alt="Panel 대시보드의 UI 프리뷰. 서버 목록, 접속 인원, 메모리, 최근 활동을 표시한 예시 화면." width="100%" />
</p>
<p align="center"><sub>대시보드 구성과 실제 데모 데이터를 바탕으로 만든 UI 프리뷰입니다. 운영 서버에서 캡처한 스크린샷은 아닙니다.</sub></p>

---

## Panel 소개

**Panel은 Minecraft Java 서버를 직접 운영하는 사람을 위한 경량 웹 관리 도구**입니다. 브라우저에서 서버의 실행 상태를 확인하고, 콘솔 명령을 전송하고, 파일과 백업을 관리할 수 있도록 설계했습니다.

Go 표준 라이브러리 기반 백엔드에 웹 UI를 내장하므로, 배포 시 **Node.js 서버나 별도 데이터베이스를 상시 실행할 필요가 없습니다.** 다중 노드 호스팅 플랫폼보다는 **한 대의 호스트에서 신뢰할 수 있는 서버를 편리하게 관리하는 용도**를 우선합니다.

> **개발 상태 — Preview**  
> 주요 기능의 코드와 테스트를 개발 중인 [PR #1](https://github.com/Pma10/Panel/pull/1)에 반영했습니다. 현재 **Go 빌드·통합 테스트의 성공을 확인하지 못했고 CI도 실패 중**입니다. 공식 릴리스는 아직 없으며, 중요한 운영 서버에 바로 적용하는 것은 권장하지 않습니다.

## 주요 기능

| 기능 | 내용 |
|---|---|
| **서버 관리** | 서버 등록, Java 시작·정지·재시작, 선택적 비정상 종료 후 재시작 |
| **실시간 콘솔** | stdout/stderr 로그 스트리밍(SSE), 로그 검색·필터, 명령어 전송 |
| **서버 설치** | Paper/Folia 공식 안정 빌드 자동 설치 및 SHA-256 검증, 커스텀 JAR 업로드 |
| **JAR 관리** | 서버를 중지한 상태에서 공식 JAR 교체 및 직전 JAR 롤백 |
| **파일 관리** | 서버 폴더 탐색, 업로드·다운로드, UTF-8 텍스트 편집, 이름 변경·삭제 |
| **백업 및 예약 작업** | 중지 상태의 파일 백업·복원, 지정 시각 백업 및 재시작 |
| **상태 확인** | Minecraft 상태 핑의 접속 인원·버전, Linux의 프로세스 RSS |
| **관리 및 진단** | 관리자 세션, 감사 로그, Go 힙·RSS·GC·실시간 로그 연결 수 진단 |

**실제 서버 제어와 데모 데이터는 구분됩니다.** 데모 화면의 TPS·MSPT·CPU 및 활동 내역은 예시일 수 있으며, 현재 Go 백엔드는 TPS·MSPT를 자동 수집하지 않습니다.

## 빠른 시작

### 필요한 환경

- **Go 1.23 이상** — 소스에서 빌드할 때만 필요
- **Java** — 실행할 Minecraft 서버 버전에 맞는 런타임(예: Java 21)
- Linux / Windows — Linux에서는 비권한 사용자 + systemd 구성을 우선 권장

현재 공식 릴리스가 없으므로 **소스 빌드 방식**을 안내합니다.

<details open>
<summary><strong>Linux / macOS · 로컬 테스트</strong></summary>

~~~bash
git clone --branch feat/unslop-panel-foundation https://github.com/Pma10/Panel.git
cd Panel

go build -trimpath -ldflags="-s -w" -o panel .

# 안전하게 관리자 비밀번호 입력 (12자 이상)
read -rsp 'Admin password: ' PANEL_ADMIN_PASSWORD && echo
export PANEL_ADMIN_PASSWORD

./panel
~~~

브라우저에서 **http://127.0.0.1:4173**에 접속합니다. 서버를 등록한 뒤 공식 Paper/Folia 버전을 선택하거나 신뢰하는 `server.jar`을 업로드하여 실행할 수 있습니다.

</details>

<details>
<summary><strong>Windows · 로컬 테스트</strong></summary>

~~~powershell
git clone --branch feat/unslop-panel-foundation https://github.com/Pma10/Panel.git
cd Panel

go build -o panel.exe .
$env:PANEL_ADMIN_PASSWORD = Read-Host "Administrator password"
.\panel.exe
~~~

기본 접속 주소는 **http://127.0.0.1:4173**입니다.

</details>

> **Minecraft EULA:** 서버 시작 전 [Minecraft End User License Agreement](https://aka.ms/MinecraftEULA)를 읽고 동의해야 합니다. Panel은 기본 서버 설정에서 RCON을 비활성화합니다.

## 운영 및 업데이트

### Linux · systemd 기반 설치

Panel은 웹 UI와 백엔드가 **하나의 Go 바이너리**로 실행됩니다. 개발 의존성을 운영 서버에 남기지 않아도 되도록 배포 스크립트를 포함했습니다.

~~~bash
# 소스 검사 → 테스트 → 바이너리 빌드 → systemd 설치/갱신
bash scripts/build-install-linux.sh

# 서비스 상태 확인
sudo systemctl status pconn

# 문제 조사
sudo journalctl -u pconn -n 100 --no-pager
~~~

이 스크립트는 검사 또는 테스트가 실패하면 설치를 중단하도록 작성되었습니다. 현재 배포 스크립트와 실제 서비스 구동의 **완전한 검증은 끝나지 않았습니다.** 먼저 테스트 서버에서 실행하세요.

**릴리스 발행 이후**에는 GitHub Releases의 다운로드 파일과 `SHA256SUMS`를 확인한 뒤 실행 파일을 교체하고, 이상이 있으면 이전 바이너리로 되돌리도록 다음 명령을 제공합니다.

~~~bash
sudo bash scripts/pconnctl-linux.sh update vX.Y.Z
sudo bash scripts/pconnctl-linux.sh rollback
~~~

`vX.Y.Z`는 실제 게시된 릴리스 태그로 바꿔야 합니다. **아직 정식 릴리스가 없어 현재는 다운로드 방식으로 설치할 수 없습니다.**

Panel을 정상 종료하여 업데이트하면 실행 중이던 Java 서버는 잠시 정지합니다. 재시작 후 이전에 실행 중이던 서버만 다시 시작하도록 설계했지만, **JVM의 완전한 기동까지 자동으로 보장하지는 않습니다.** 업데이트 이후 콘솔과 접속 상태를 확인해야 합니다.

### 설정

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PANEL_ADMIN_PASSWORD` | **필수** | 관리자 비밀번호, 최소 12자 |
| `PANEL_BIND_HOST` | `127.0.0.1` | 패널 리스닝 주소 |
| `PANEL_PORT` | `4173` | 웹 관리 포트 |
| `PANEL_PUBLIC_ORIGIN` | `http://127.0.0.1:4173` | 브라우저가 접속하는 정확한 Origin |
| `PANEL_DATA_DIR` | `./.panel-data` | 서버·백업·설정·감사 로그 저장 위치 |
| `PANEL_JAVA_BIN` | `java` | Java 실행 파일 |
| `GOMEMLIMIT` | 미설정 | Go 런타임의 **소프트** 메모리 목표값(예: `256MiB`) |

`GOMEMLIMIT`는 OS가 강제하는 메모리 제한이 아니며 **Minecraft Java 프로세스에 적용되지 않습니다**. Java의 `-Xmx` 또한 힙 한도일 뿐 서버 전체 메모리의 절대 상한이 아닙니다.

자세한 systemd·Docker 구성은 [Go 운영 가이드](docs/go-backend.md)를 참고하세요. Docker 예제는 **패널 전체를 한 컨테이너에 넣는 구성**이며 서버별 격리는 제공하지 않습니다.

## 구조와 설계 원칙

~~~text
Browser
  └─ Panel Web UI (HTML / CSS / JavaScript)
        │  /api/v1 · SSE
        ▼
     Panel (Go)
        ├─ Authentication & audit
        ├─ Java process lifecycle
        ├─ Console & file streaming
        ├─ Backups & scheduler
        └─ Minecraft status ping
              └─ Minecraft Java server(s)

Data: PANEL_DATA_DIR / servers · backups · config.json · audit.jsonl
~~~

Panel은 **가벼움뿐 아니라 단순한 유지보수와 데이터 안전성**을 우선합니다.

- **의존성 최소화:** Go 표준 라이브러리 중심, 별도 DB·상시 Node 런타임 없음
- **메모리 사용 제어:** 서버당 콘솔 로그 400개 순환 버퍼, 제한된 SSE 구독, 예약 작업 2개 워커
- **업데이트와 데이터 분리:** 실행 파일을 교체해도 월드·설정·백업은 별도 디렉터리에 보관
- **보수적인 변경:** 서버 중지 상태에서 JAR 교체·백업·복원, 공식 JAR 체크섬 검증
- **명확한 관측:** Go 힙과 Linux RSS를 구분해 확인하며, 측정하지 않은 성능 수치를 제시하지 않음

세부 모듈과 유지보수 절차는 [아키텍처 문서](docs/architecture.md)에 정리했습니다.

## 보안 및 현재 제한 사항

Panel은 **단일 호스트·단일 관리자·신뢰 가능한 서버 JAR**을 기본 전제로 합니다.

- **HTTPS가 없는 공개 관리자 접속은 권장하지 않습니다.** 기본적으로 `127.0.0.1`에서만 실행하고, 외부 관리가 필요하면 인증과 HTTPS 리버스 프록시를 구성하세요.
- 각 Minecraft JVM은 **Panel과 동일한 OS 사용자 권한**으로 실행됩니다. Pterodactyl Wings처럼 서버별 Docker/cgroup 파일 시스템·CPU·RAM 격리가 **없습니다**. 신뢰할 수 없는 JAR·플러그인을 실행하지 마세요.
- 백업은 서버가 중지된 상태에서 수행합니다. 예약 백업은 **다운타임**이 있으며, 패널 외부에도 별도 월드 백업을 유지해야 합니다.
- **아직 제공하지 않는 기능:** 다중 사용자 RBAC, 2FA, SFTP, 멀티노드, 원격 백업, 무중단 백업, TPS/MSPT 수집, OS 수준 서버별 리소스 격리.
- `LICENSE` 파일은 아직 포함되지 않았습니다. 외부 재배포·기여 정책은 별도 확정이 필요합니다.

## 개발 및 검증

~~~bash
go vet ./...
go test -count=1 ./...
go test -race -count=1 ./...
go build -trimpath -o panel .

# Linux: 로컬 HTTP·인증 경계까지 확인하는 검증 스크립트
bash scripts/verify-go.sh
~~~

레이스 검사는 환경에 따라 CGO와 C 컴파일러가 필요합니다. 실제 서버 적용 전에는 별도 테스트 월드에서 **시작 → 콘솔 → 종료 → 백업 → 복원 → 업데이트**를 확인하세요.

기존 Node 프로토타입도 마이그레이션·비교를 위해 남겨 두었습니다. `npm run dev`는 **예시 데이터가 표시되는 UI 개발 모드**이며 Go 백엔드와 별개입니다.

---

<sub>Panel은 Mojang Studios 또는 Microsoft의 공식 제품이 아닙니다. UI는 Paperlogy를 사용하며 [Unslop](https://github.com/heydamir/unslop)의 디자인 지침을 참고했습니다. PufferPanel·Pterodactyl과는 별개의 프로젝트입니다.</sub>
