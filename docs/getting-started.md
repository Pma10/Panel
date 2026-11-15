# Panel 시작 가이드

[← README](../README.md) · [운영 및 배포](go-backend.md) · [구조 및 유지보수](architecture.md)

Panel을 **테스트용 Minecraft Java 서버**에서 처음 사용하는 절차입니다. 현재 프로젝트는 **개발 Preview**입니다. 백엔드 로컬 검사의 범위와 결과는 [검증 보고서](verification-2026-11-16.md)에 있으며, 전체 UI와 실제 Minecraft 서버의 장기 운영 검증을 대신하지 않습니다. 중요한 월드는 외부에도 백업하고 별도 테스트 환경에서 먼저 확인하세요.

## 1. 시작 전 확인

| 항목 | 필요 조건 |
|---|---|
| 운영체제 | Linux 또는 Windows. 실제 운영 시 Linux + systemd 권장 |
| 빌드 환경 | Go 1.23 이상 (소스 빌드 시) |
| 게임 서버 | 해당 Minecraft 버전에 맞는 Java |
| 네트워크 | 관리 UI는 기본값으로 `127.0.0.1:4173`에서만 접속 가능 |
| 권한 | 패널이 관리할 서버 데이터 폴더의 읽기·쓰기 권한 |
| 보안 | 신뢰하는 JAR/플러그인만 사용. 서버별 OS 격리 미지원 |

### Linux · Bash 로컬 실행

```bash
git clone --branch main https://github.com/Pma10/Panel.git
cd Panel

go version
java -version

# 전체 소스와 웹 자산을 받은 환경에서 검사합니다.
go vet ./...
go test -count=1 ./...

go build -trimpath -o panel .

read -rsp 'Admin password (12+ chars): ' PANEL_ADMIN_PASSWORD && echo
export PANEL_ADMIN_PASSWORD

./panel
```

**브라우저 주소:** `http://127.0.0.1:4173`

검사가 실패하면 운영에 적용하지 말고 오류와 실행 환경을 확인하세요. README의 기능 목록은 구현 범위를 설명하며, 모든 배포 환경에서의 정상 동작을 보증하지 않습니다.

### Windows · PowerShell 로컬 실행

```powershell
git clone --branch main https://github.com/Pma10/Panel.git
cd Panel

go version
java -version

go build -o panel.exe .
$password = Read-Host "Admin password (12+ characters)" -AsSecureString
$env:PANEL_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $password).Password
Remove-Variable password
.\panel.exe
```

비밀번호는 프로세스 환경 변수로 전달됩니다. 공개 스크립트나 Git에 저장하지 마세요. Panel을 실행한 컴퓨터에서 브라우저를 열어 같은 주소로 접속합니다.

## 2. 첫 서버 등록과 실행

1. 관리자 비밀번호로 로그인합니다.
2. **서버 생성**을 열고 이름, 서버 접속 포트, Java 메모리(MiB)를 지정합니다. 포트는 다른 서버와 중복되면 안 됩니다.
3. [Minecraft EULA](https://aka.ms/MinecraftEULA)를 읽고 동의합니다. 패널이 설정한 `eula.txt`와 `server.properties`는 서버의 작업 폴더에 저장됩니다.
4. 설치 방법을 선택합니다.
   - **Paper/Folia**: 공식 안정 빌드의 Minecraft 버전을 선택하고 서버 JAR 다운로드·검증을 진행합니다. 사용하는 플러그인의 호환성도 확인하세요.
   - **Leaf/PmaPaper/기타 JAR**: 서버를 만든 뒤 **파일** 화면에서 신뢰하는 파일을 `server.jar` 이름으로 업로드합니다.
5. **서버 시작**을 누른 다음 **콘솔**에서 구동 완료 메시지를 확인합니다.
6. Minecraft 클라이언트에서 서버 IP와 지정한 게임 포트로 접속합니다.

서버의 기본 설정은 Java 프로세스를 패널의 OS 사용자 권한으로 실행하며 RCON을 비활성화합니다. 서버를 시작하려면 `server.jar`이 실제로 존재해야 합니다.

### 서버 메모리 설정

화면에서 설정하는 메모리는 Java `-Xmx`의 힙 상한입니다. Java 자체의 메모리, OS, 다른 JVM, 플러그인 등이 추가 RAM을 사용하므로 **호스트 RAM 전체를 힙으로 할당하지 마세요**. 현재 Panel은 JVM별 cgroup RAM·CPU 제한을 제공하지 않습니다.

## 3. 콘솔과 파일 관리

**콘솔**에서 최근 로그를 보거나 Minecraft 명령을 입력할 수 있습니다. 브라우저에 표시하는 로그는 메모리 부담을 줄이기 위해 제한돼 있습니다. 서버의 장기 로그는 Minecraft 데이터 폴더 내 `logs/latest.log`를 참고하세요.

**파일** 화면에서는 폴더 탐색, 파일 업로드·다운로드, UTF-8 텍스트 수정, 생성·이름 변경·삭제를 할 수 있습니다.

| 항목 | 현재 제한 |
|---|---|
| 업로드 1개 | 최대 256MiB |
| 브라우저 텍스트 편집 | 최대 1MiB UTF-8 파일 |
| 서버별 메모리 로그 | 최근 400개 |
| 실행 중인 서버 | 파일 수정·백업·복원 거부 |

세계 파일·플러그인 JAR·설정 파일을 수정할 때는 반드시 서버를 정상 종료하세요. 삭제·덮어쓰기를 하기 전에 외부 사본을 보관하는 것을 권장합니다.

## 4. 백업과 복원

Panel의 백업은 **실행 중인 월드를 무중단 복사하는 방식이 아닙니다**.

1. 콘솔에서 먼저 플레이어에게 점검을 알립니다.
2. 서버를 **중지**하고 Java 프로세스 종료를 확인합니다.
3. **백업** 화면에서 백업을 생성합니다. 백업은 패널 데이터 폴더의 `backups/` 아래에 저장됩니다.
4. 복원하려면 서버를 중지한 상태에서 백업을 선택하고 실행합니다.
5. 서버를 재시작한 뒤 실제 월드·플레이어 데이터가 정상인지 확인합니다.

현재 백업에는 최대 **8GiB / 100,000개 파일**의 코드상 제한이 있습니다. 예약 백업은 서버를 **중지 → 백업 → 재시작**하는 방식이라 플레이어가 일시적으로 접속할 수 없습니다.

**중요:** 패널 데이터 디렉터리 하나만 저장하면 디스크 장애·데이터 손실을 막을 수 없습니다. 정기적으로 다른 디스크 또는 외부 백업 저장소에 세계 데이터 사본을 보관하세요.

## 5. 업데이트

### Panel 자체 업데이트

Linux용 `scripts/build-install-linux.sh`는 소스 코드 검사·테스트·빌드 후 systemd 서비스를 설치하거나 교체하도록 설계돼 있습니다.

```bash
bash scripts/build-install-linux.sh
sudo systemctl status pconn
sudo journalctl -u pconn -n 100 --no-pager
```

실제 배포·업데이트 성공이 검증되지 않았으므로 **테스트 호스트에서 먼저 실행**하세요. 해당 버전의 정식 릴리스가 발행되면 `scripts/pconnctl-linux.sh`를 통해 다운로드·SHA-256 검증·이전 바이너리 복귀 절차를 사용할 수 있습니다.

패널을 정상적으로 재시작할 때는 실행 중이던 JVM들을 잠시 종료한 뒤 이전 실행 상태에 따라 순차적으로 다시 실행하려고 합니다. 재시작 후 모든 서버가 정상적으로 열렸는지는 별도로 확인해야 합니다.

### Paper/Folia JAR 업데이트

1. 서버를 중지하고 중요한 세계 데이터를 외부 백업합니다.
2. **시작 설정**에서 공식 버전 목록을 확인합니다.
3. 설치할 안정 빌드를 선택해 다운로드 및 SHA-256 검증을 진행합니다.
4. Java 서버를 실행하고 플러그인·월드 호환성을 확인합니다.
5. 문제가 생기면 이전 JAR로 롤백할 수 있지만 **이 기능은 월드를 이전 상태로 되돌리지 않습니다**.

Leaf, PmaPaper 등 수동 업로드 JAR에는 공식 자동 업데이트가 적용되지 않습니다.

## 6. 외부에서 관리자 패널에 접속하기

기본 접속 주소 `127.0.0.1`은 **Panel이 실행된 컴퓨터 내부에서만** 접근할 수 있습니다. 외부 관리가 필요하면 HTTPS 리버스 프록시를 설치하고 `PANEL_PUBLIC_ORIGIN`을 실제 사용 도메인으로 지정하세요.

- 관리자 패널 HTTP 포트(기본 4173)는 직접 인터넷에 공개하지 마세요.
- Minecraft 게임 포트와 관리자 패널 포트는 다릅니다. 방화벽에서 필요한 게임 포트만 외부에 노출하세요.
- 비밀번호와 월드 데이터는 저장소에 업로드하지 마세요.
- 패널은 신뢰하지 않는 플러그인을 격리하지 못합니다. 여러 사람의 서버를 임대 운영하기 위한 구조가 아닙니다.

## 문제 해결

| 증상 | 먼저 확인할 항목 |
|---|---|
| `http://127.0.0.1:4173` 접속 불가 | 패널 프로세스 실행 여부, 포트 4173 점유 여부, 로그 |
| 로그인 불가 / 요청 출처 오류 | `PANEL_ADMIN_PASSWORD`, `PANEL_PUBLIC_ORIGIN`과 실제 브라우저 주소 일치 여부 |
| 서버 시작 실패 | `java -version`, `server.jar` 유무, EULA 동의, 서버 포트 중복 |
| 서버가 곧바로 종료됨 | 콘솔 및 `logs/latest.log`의 실제 오류 메시지 |
| 파일 수정 또는 복원 거부 | 해당 서버가 완전히 중지됐는지, 다른 백업 작업이 없는지 확인 |
| Paper/Folia 자동 설치 실패 | 공식 안정 빌드 제공 여부, 외부 네트워크 및 API 응답 |
| 패널 재시작 후 서버 접속 불가 | 서버 상태/콘솔을 확인. 자동 복구는 서버 준비 완료를 보장하지 않음 |

문제를 보고할 때 **`go vet ./...` 및 `go test -count=1 ./...`의 결과**와 실행 환경을 함께 남겨 주세요. 로컬 백엔드 검사, GitHub CI, 실제 Minecraft 서버 검증의 범위는 [검증 보고서](verification-2026-11-16.md)에서 구분합니다.

---

[README로 돌아가기](../README.md) · [운영 가이드](go-backend.md) · [아키텍처](architecture.md)
