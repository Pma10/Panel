<div align="center">

# Panel

### Minecraft 서버 운영, 하나의 실행 파일로.

서버 실행부터 콘솔, 파일, 백업까지.  
**가벼운 구성과 간단한 유지보수를 지향하는 Minecraft Java 관리 패널입니다.**

<p>
  <img src="https://img.shields.io/badge/Go-1.24%2B-00ADD8?style=flat-square&amp;logo=go&amp;logoColor=white" alt="Go 1.24 이상" />
  <img src="https://img.shields.io/badge/Deploy-Single_binary-243247?style=flat-square" alt="단일 실행 파일" />
  <img src="https://img.shields.io/badge/Database-Not_required-243247?style=flat-square" alt="별도 데이터베이스 불필요" />
  <img src="https://img.shields.io/badge/Status-Development_preview-B5812A?style=flat-square" alt="개발 프리뷰" />
</p>

[빠른 시작](#quick-start) · [주요 기능](#features) · [설치·업데이트](#operations) · [문서](#documentation) · [검증 범위](#verification)

</div>

<p align="center">
  <a href="docs/assets/dashboard-preview.svg">
    <img src="docs/assets/dashboard-preview.svg" width="1120" alt="Panel 대시보드 디자인 프리뷰 — 서버 목록, 상태, 접속 인원과 최근 활동" />
  </a>
</p>
<p align="center"><sub>인터페이스 구성과 데모 데이터를 바탕으로 만든 SVG 프리뷰입니다. 실제 운영 서버의 캡처가 아니며, 표시된 수치는 성능 측정 결과가 아닙니다.</sub></p>

> [!NOTE]
> **Development preview.** 소스는 `main`에서 확인할 수 있습니다. 백엔드 로컬 검사 결과는 [검증 보고서](docs/verification-2026-11-16.md)에 공개했으며, 전체 UI·실제 Minecraft 서버의 장기 운영 검증과 정식 릴리스는 별도 단계입니다. 중요한 월드를 이전하기 전에 테스트용 서버에서 확인하세요.

## 간단하게 시작하고, 필요한 만큼 관리하세요

| 가벼운 구성 | 한곳에서 운영 | 데이터 보존 중심 |
| :--- | :--- | :--- |
| 웹 UI와 API를 Go 실행 파일에 포함합니다. 운영에 Node.js나 별도 DB가 필요하지 않습니다. | Java 프로세스, 실시간 콘솔, 파일과 백업을 브라우저에서 관리합니다. | 서버 중지 상태에서 파일·월드·JAR을 변경하고, 공식 다운로드의 무결성을 확인합니다. |

Panel은 **본인이 신뢰하는 Minecraft 서버들을 한 호스트에서 관리하는 도구**입니다. 다중 고객용 호스팅 플랫폼이나 서버별 컨테이너 격리 시스템은 아닙니다.

<a id="features"></a>
## 주요 기능

| 기능 | 제공 내용 |
| :--- | :--- |
| **서버 제어** | 서버 생성, 시작·정지·재시작, 시작 중/실행 중/종료 중/재시작 대기 상태 표시, 종료 시 자동 재시작 켜기·끄기 |
| **시작 설정** | 호스트에 설치된 Java 자동 검색·선택, `{java} {memory} {jar} {port}` 자리표시자를 쓰는 실행 명령어 편집 |
| **실시간 콘솔** | stdout/stderr 스트리밍, ANSI·§ 색상 표시와 수준별 색 구분, 최근 1000줄 스크롤 기록, 수준별 필터, 명령 전송·↑/↓ 명령 기록 |
| **JAR 설치·업데이트** | Paper·Folia·Velocity(PaperMC 공식, SHA-256), Purpur(공식 API, MD5), Leaf(GitHub 릴리스, SHA-256) 자동 설치·업데이트, 이전 JAR로 롤백. 커스텀 JAR 수동 업로드 |
| **파일 관리** | 서버 실행 중에도 편집·업로드, 더블클릭 열기, Monaco 편집기 팝업(문법 강조, Ctrl+S), 드래그 앤 드롭 업로드·이동, 다중 선택, 폴더 업로드, 단축키 |
| **백업·예약 작업** | 정지된 서버의 파일 백업·복원·백업 삭제, 한국 시간 기준 예약 백업·재시작 |
| **상태·진단** | 서버 프로세스 CPU·메모리 (Linux·Windows·macOS), Minecraft 접속 인원·버전·응답 시간, Go 힙·GC·콘솔 연결 수 |
| **네트워크** | 포트별 실제 열림 여부·충돌·RCON 경고, 접속 주소(LAN/공인/VPN) 복사, 게임 포트 변경 |
| **언어** | 한국어·English (설정 → 언어, 브라우저 언어로 자동 선택). 번역은 `src/i18n-en.js` 사전 하나에 모여 있어 언어 추가가 쉽습니다 |
| **계정·보안** | 여러 계정(PBKDF2 해시), 계정별 감사 기록, Origin/CSRF 검사, 계정 삭제·비밀번호 변경 시 세션 종료 |

**메모리 사용을 예측 가능하게:** 서버별 최근 로그 400개를 순환 버퍼에 보관하고, 예약 작업은 2개 워커와 제한된 대기열로 처리합니다. 이는 구현상 제한이며 RAM 사용량·처리 속도에 대한 벤치마크 보증은 아닙니다.

<a id="quick-start"></a>
## 빠른 시작

**준비물:** Git, Go 1.24 이상, 사용할 Minecraft 버전에 맞는 Java. Go는 소스 빌드에 필요하며, 빌드한 Panel 실행 파일의 운영에는 Node.js가 필요하지 않습니다.

### Linux · Bash 로컬 실행

```bash
git clone --branch main https://github.com/Pma10/Panel.git
cd Panel

go build -trimpath -ldflags="-s -w" -o panel .

./panel
```

브라우저에서 **http://127.0.0.1:4173**에 접속하면 **첫 계정 만들기** 화면이 나옵니다. 아이디와 12자 이상 비밀번호로 계정을 만들고, 이후 계정은 로그인 후 **계정** 메뉴에서 추가·삭제합니다. 기본 설정에서는 Panel을 실행한 컴퓨터에서만 관리자 화면을 열 수 있습니다.

> 다른 컴퓨터에서 접속하는 구성(공개 바인딩·리버스 프록시)에서는 첫 계정 화면을 열어 두지 않도록, 처음 한 번 `PANEL_ADMIN_PASSWORD`를 지정해 `admin` 계정을 만들어야 시작됩니다. 기존 설치도 같은 방식으로 `admin` / 기존 비밀번호로 로그인됩니다.

<details>
<summary><strong>Windows · PowerShell 실행 방법</strong></summary>

```powershell
git clone --branch main https://github.com/Pma10/Panel.git
cd Panel
go build -o panel.exe .
.\panel.exe
```

브라우저에서 첫 계정을 만듭니다. Windows 대상 교차 컴파일과 Windows 실기기 운영 검증은 서로 다릅니다.

</details>

### 첫 서버까지 네 단계

**로그인 → 서버 생성 → JAR 설치 → 시작 및 콘솔 확인**

서버 이름·포트·Java 메모리를 정하고 [Minecraft EULA](https://aka.ms/MinecraftEULA)를 확인합니다. **Paper/Folia**는 공식 안정 빌드를 선택하고, **Leaf/PmaPaper 등 커스텀 서버**는 신뢰하는 JAR을 `server.jar`로 업로드하세요.

화면별 절차와 오류 해결은 [첫 서버 시작 가이드](docs/getting-started.md)에 정리되어 있습니다.

<a id="operations"></a>
## 설치와 업데이트

### 소스에서 Linux 서비스로 설치

```bash
# 검사 → 테스트 → 빌드 → systemd 설치 또는 기존 설치 업데이트
bash scripts/build-install-linux.sh

# 서비스 상태와 최근 로그
sudo systemctl status pconn
sudo journalctl -u pconn -n 100 --no-pager
```

제품명은 **Panel**이며, 기존 설치와의 호환성을 위해 서비스·관리 스크립트 이름은 `pconn`을 유지합니다. 설치 스크립트는 테스트 실패 시 중단하도록 작성되어 있습니다. 먼저 별도 테스트 호스트에서 실행하세요.

<details>
<summary><strong>릴리스 기반 업데이트 및 롤백</strong></summary>

릴리스 배포 자동화는 준비되어 있지만, 아래 명령은 **해당 버전의 GitHub Release가 실제 게시된 후**에만 사용할 수 있습니다.

```bash
# vX.Y.Z를 실제 게시된 버전 태그로 교체하세요.
sudo bash scripts/pconnctl-linux.sh update vX.Y.Z
sudo bash scripts/pconnctl-linux.sh rollback
```

업데이터는 다운로드 체크섬과 바이너리 버전을 확인하고 이전 실행 파일을 보관합니다. 패널 교체 중에는 실행 중인 Minecraft 서버가 잠시 정지할 수 있습니다. 이전 실행 서버의 재시작을 시도하지만, 게임 서버의 준비 완료는 콘솔과 실제 접속으로 확인해야 합니다.

**Panel 바이너리 롤백, Minecraft JAR 롤백, 월드 백업 복원은 서로 다른 작업입니다.**

</details>

### 설정

| 환경 변수 | 기본값 | 역할 |
| :--- | :--- | :--- |
| `PANEL_ADMIN_PASSWORD` | 선택 | 계정이 하나도 없을 때 `admin` 계정을 만들 비밀번호(12자 이상). 외부에서 접속 가능한 구성의 첫 실행에는 필수 |
| `PANEL_BIND_HOST` | `127.0.0.1` | 관리자 패널 수신 주소 |
| `PANEL_PORT` | `4173` | 관리자 HTTP 포트 |
| `PANEL_PUBLIC_ORIGIN` | `http://127.0.0.1:4173` | 실제 관리자 브라우저의 정확한 출처 |
| `PANEL_DATA_DIR` | `./.panel-data` | 서버·월드·백업·설정·감사 기록 저장 위치 |
| `PANEL_JAVA_BIN` | `java` | 서버별 Java를 지정하지 않았을 때 쓰는 기본 Java |
| `GOMEMLIMIT` | 미설정 | Go 런타임의 선택적 소프트 메모리 목표 |

`GOMEMLIMIT`는 JVM 메모리와 별개입니다. Java `-Xmx`도 힙 크기만 제한하며 프로세스 전체 RSS를 강제 제한하지 않습니다.

<a id="documentation"></a>
## 문서

| 가이드 | 내용 |
| :--- | :--- |
| [시작하기](docs/getting-started.md) | 첫 서버 생성, JAR 업로드, 콘솔, 백업, 문제 해결 |
| [운영·배포](docs/go-backend.md) | 환경 변수, 비권한 계정, systemd와 네트워크 구성 |
| [구조·유지보수](docs/architecture.md) | 모듈별 책임, 메모리 정책, 업데이트·복구 흐름 |
| [보안 정책](SECURITY.md) | 신뢰 경계, 운영 주의사항, 취약점 제보 |
| [기여 안내](CONTRIBUTING.md) | 개발 원칙과 변경 검증 기준 |
| [검증 보고서](docs/verification-2026-11-16.md) | 실제 실행한 백엔드 검사와 제외·미검증 항목 |

<a id="verification"></a>
## 검증 상태

[2026-11-16 백엔드 검증 기록](docs/verification-2026-11-16.md)에는 `go vet`, 백엔드 레이스 검사, 순서를 섞은 반복 검사와 Linux/Windows 대상 교차 컴파일 성공이 기록되어 있습니다. 당시 로컬 스냅샷에는 웹 자산 일부가 없어 정적 프런트엔드 테스트 한 개를 제외했습니다.

**이 기록은 전체 웹 UI·GitHub CI·실제 Paper/Leaf 장시간 운영의 성공을 의미하지 않습니다.** `main` 반영과 정식 배포 인증도 구분합니다.

```bash
# 전체 저장소를 받은 환경에서 실행
go vet ./...
go test -count=1 ./...
go test -race -count=1 ./...

# Linux: 빌드 및 로컬 HTTP 인증 경계까지 검사
bash scripts/verify-go.sh
```

레이스 검사는 CGO와 C 컴파일러가 필요할 수 있습니다. 기존 Node 코드는 데모·마이그레이션용이며 `npm run dev`는 실제 Minecraft 서버 운영 모드가 아닙니다.

## 운영 범위와 주의사항

> [!WARNING]
> **신뢰할 수 없는 JAR·플러그인을 실행하지 마세요.** Java 서버는 Panel과 같은 OS 계정 권한을 공유합니다. 서버별 Docker/cgroup 격리, 다중 사용자 RBAC·2FA, SFTP·멀티노드, 원격·무중단 백업, TPS/MSPT 자동 수집은 아직 제공하지 않습니다.

전용 비권한 OS 계정으로 실행하고, 외부 관리에는 HTTPS 리버스 프록시를 사용하세요. 관리자 포트와 Minecraft 게임 포트는 별개입니다. 일반 백업·복원은 서버를 중지한 상태에서 수행하며, 중요한 월드는 Panel 데이터 폴더 밖에도 보관해야 합니다.

---

<div align="center">
<sub>Panel은 Mojang Studios·Microsoft의 공식 제품이 아니며, PufferPanel·Pterodactyl과 별개의 프로젝트입니다.</sub><br />
<sub><a href="https://github.com/fonts-archive/Paperlogy">Paperlogy</a> · <a href="https://github.com/heydamir/unslop">Unslop</a> by Damir Sokolovsky · <a href="CONTRIBUTING.md">기여 안내</a></sub><br />
<sub>프로젝트의 별도 LICENSE는 아직 없습니다. 제3자의 사용·수정·재배포 조건을 임의로 가정하지 마세요.</sub>
</div>
