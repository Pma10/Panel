# Panel · Go 백엔드 운영 가이드

[← README](../README.md) · [첫 서버 시작 가이드](getting-started.md) · [보안 정책](../SECURITY.md) · [아키텍처](architecture.md)

**추천 런타임은 Go 단일 실행 파일 + 내장 웹 UI**입니다. Node.js는 Go 운영 환경에서 필요하지 않습니다. 기존 Node 서버는 비교·전환 목적으로 유지합니다.

> **이름 구분:** 제품명은 **Panel**입니다. 기존 설치 스크립트와 systemd 서비스 이름은 호환성을 위해 `pconn`을 유지하므로, 서비스 관리 명령은 `systemctl status pconn`입니다.

## 설치

Go 1.24 이상과 서버 버전에 맞는 Java를 설치합니다. 아래는 Bash 로컬 실행 예제입니다.

```bash
git clone --branch main https://github.com/Pma10/Panel.git
cd Panel
go build -trimpath -ldflags="-s -w" -o pconn .

./pconn
```

Windows는 `go build -o pconn.exe .`로 빌드합니다. 접속 주소는 `http://127.0.0.1:4173`이며 처음 접속하면 첫 계정을 만듭니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PANEL_ADMIN_PASSWORD` | 선택 | 계정이 없을 때 `admin` 계정을 만들 비밀번호(12자 이상). 로컬 전용이 아니면 첫 실행에 필수. 계정은 `PANEL_DATA_DIR/users.json`에 PBKDF2 해시로 저장 |
| `PANEL_PORT` | `4173` | 패널 접속 포트 |
| `PANEL_BIND_HOST` | `127.0.0.1` | 바인딩 주소 |
| `PANEL_PUBLIC_ORIGIN` | `http://127.0.0.1:4173` | 관리자 브라우저의 실제 출처 |
| `PANEL_DATA_DIR` | `./.panel-data` | 서버 월드·백업·설정 저장소 |
| `PANEL_JAVA_BIN` | `java` | Java 바이너리 |

실제 Linux 운영은 **전용 비권한 계정**과 `/var/lib/pconn` 데이터 폴더를 권장합니다. `deploy/pconn.service`는 `/etc/pconn/panel.env` 환경 파일, `/opt/pconn/pconn` 바이너리, `PANEL_DATA_DIR=/var/lib/pconn` 설정을 전제로 합니다. 비밀번호 환경 파일은 다른 사용자가 읽지 못하게 `0600` 권한을 부여하세요. 관리자 UI는 로컬 바인딩 상태에서 HTTPS 리버스 프록시로 제공합니다.

## 제공 기능

- **Paper/Folia 템플릿**: PaperMC 공식 안정 빌드를 내려받고 파일 크기와 SHA-256으로 검증합니다.
- **커스텀 JAR**: Leaf, PmaPaper 등은 직접 업로드해 실행합니다.
- **서버 제어**: Java 실행, 정상 종료, 재시작 및 선택적 비정상 종료 후 재시작 정책
- **실시간 콘솔**: SSE 구독, 표준 출력·오류 로그 수집, 명령어 전송
- **파일 관리**: 탐색, 편집, 업로드, 다운로드, 이름 변경, 폴더 생성 및 삭제
- **백업**: 최대 8GiB 및 10만 파일. 실행 중에는 save-off/save-all로 저장을 멈추고 복사, 복원은 정지 상태에서
- **예약 작업**: 한국 시간 기준 일별·요일별 백업과 재시작
- **관리자 인증**: HttpOnly 세션, SameSite, Origin/CSRF 검사 및 로그인 시도 제한
- **모니터링**: Java 프로세스의 Linux RSS, Minecraft Java 상태 핑의 온라인 인원·버전

서버 생성 시 [Minecraft EULA](https://aka.ms/MinecraftEULA)를 확인하고 동의해야 합니다. 기본 RCON은 비활성입니다.

## PufferPanel / Pterodactyl과의 차이

현재 Go 구현은 **단일 호스트의 Java 프로세스 관리자**입니다. Pterodactyl Wings 같은 Docker·cgroup 격리를 제공하지 않습니다. 관리하는 Minecraft JAR과 플러그인은 모두 패널을 실행하는 **동일 OS 계정 권한**을 갖고, 그 계정의 파일과 다른 월드에 접근할 수 있습니다. **신뢰하지 않는 서버 JAR이나 플러그인을 이 방식으로 실행하지 마세요.**

Java `-Xmx`는 힙 메모리 상한일 뿐 **실제 RSS·CPU·디스크 제한**을 강제하지 않습니다. 멀티테넌트 환경에서는 Docker 기반 노드 에이전트, 서버별 격리, RBAC, SFTP와 별도 인증 체계를 추가해야 합니다.

백업은 서버 중지 후 수행하며 예약 백업은 접속 중단을 일으킵니다. 원격 백업·핫백업·기존 외부 프로세스 재연결·TPS/MSPT 자동 수집·2FA·다중 노드·SFTP는 미구현입니다.

## 검증

```bash
go vet ./...
go test -race -count=1 ./...
go build -trimpath -o pconn .
```

주요 서버를 전환하기 전에 테스트 서버에서 실제 JAR 실행, 백업·복원과 운영 환경을 먼저 확인하세요.
