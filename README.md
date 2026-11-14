# 피컨 · PConn Panel

**Minecraft Java 서버를 직접 생성하고 운영하는 한국어 패널.** Paperlogy + [Unslop](https://github.com/heydamir/unslop) 디자인.

> 개발 단계입니다. 전용 OS 사용자, HTTPS 리버스 프록시, 실서버 장시간 테스트 없이 인터넷에 직접 노출하지 마세요.

## 1. 설치 및 서버 실행

**필요 환경:** Node.js 22+, 서버 버전에 맞는 Java (Minecraft 1.21.x는 일반적으로 Java 21), Minecraft 서버 JAR.

Linux/macOS:

```bash
git clone --branch feat/unslop-panel-foundation https://github.com/Pma10/Panel.git
cd Panel
export PANEL_ADMIN_PASSWORD='12자-이상의-안전한-관리자-비밀번호'
npm run panel
```

Windows PowerShell:

```powershell
git clone --branch feat/unslop-panel-foundation https://github.com/Pma10/Panel.git
cd Panel
$env:PANEL_ADMIN_PASSWORD = "12자-이상의-안전한-관리자-비밀번호"
npm run panel
```

브라우저에서 **http://127.0.0.1:4173** 접속 후 비밀번호로 로그인합니다.

1. 서버 추가에서 이름, 포트(1024~65535), 메모리(512~32768MiB)를 지정합니다.
2. [Minecraft EULA](https://aka.ms/MinecraftEULA)에 동의한 경우 체크합니다.
3. 서버 파일 화면에 서버 JAR을 `server.jar` 이름으로 업로드합니다.
4. 서버 개요에서 **시작**을 클릭하면 패널이 Java 프로세스를 직접 실행합니다.
5. 콘솔에서 서버 로그를 확인하고 명령을 전송합니다. 중지 시 Minecraft의 정상 종료 명령을 먼저 전송합니다.

서버 파일과 관리 설정은 `.panel-data/servers/<서버ID>/` 및 `.panel-data/config.json`에 저장됩니다. 백업과 감사 기록도 `.panel-data/`에 저장됩니다. 이 폴더는 Git에 커밋되지 않습니다.

| 환경 변수 | 기본값 | 목적 |
|---|---|---|
| `PANEL_ADMIN_PASSWORD` | **필수** | 12자 이상의 관리자 비밀번호 |
| `PANEL_PORT` | `4173` | 패널 접속 포트 |
| `PANEL_BIND_HOST` | `127.0.0.1` | 기본 로컬 전용 바인딩 |
| `PANEL_PUBLIC_ORIGIN` | `http://127.0.0.1:4173` | 브라우저의 정확한 출처(CSRF 검사) |
| `PANEL_DATA_DIR` | `./.panel-data` | 서버·백업·설정 저장 경로 |
| `PANEL_JAVA_BIN` | `java` | Minecraft 실행 Java 바이너리 |

원격 접속 시에는 HTTPS 프록시 뒤에 패널을 두고 `PANEL_PUBLIC_ORIGIN=https://panel.example.com`처럼 설정하세요. 패널을 평문 HTTP로 인터넷에 직접 노출하지 마세요. SSE 연결에는 프록시 버퍼링 비활성화가 필요할 수 있습니다.

## 2. 실제 기능

- **인증:** 단일 관리자 로그인, HttpOnly·SameSite=Strict 세션 쿠키, CSRF/Origin 검사, 로그인 시도 제한
- **서버:** Java 시작/중지/재시작, 서버 JAR, 메모리 제한, EULA, 포트·서버 설정
- **콘솔:** 실제 서버 프로세스의 stdout/stderr 로그를 SSE로 전송하고 stdin으로 명령 실행
- **서버 현황:** Java 프로세스 상태·RSS 메모리와 Minecraft Java TCP 핑을 통한 플레이어 수·버전 조회
- **파일:** 폴더 조회·생성, 파일 업로드(최대 256MiB), 다운로드, UTF-8 미리보기·수정(최대 1MiB), 이름 변경·삭제
- **백업/복원:** 서버 파일·월드 폴더 스냅샷(최대 8GiB/100,000개 파일), 복원은 서버 중지 시에만 가능
- **예약 작업:** 한국 시간 기준 매일/요일별 백업 또는 재시작
- **감사:** 관리자 작업 메타데이터를 디스크에 기록(비밀번호와 콘솔 명령 본문 제외)

**주의:** 일반 백업은 세계 데이터 일관성을 위해 서버를 중지한 뒤에만 가능하며, 예약 백업은 **중지 → 백업 → 재시작**하므로 일시적인 접속 중단이 있습니다. 중요한 세계는 패널 폴더 밖에도 별도로 백업해 두세요.

### 지원 범위와 한계

현재는 OS의 Java 프로세스를 패널에서 직접 관리합니다. 다른 위치에서 실행된 기존 서버 프로세스에 자동 재연결하지 않으며, 패널 재시작 시 자동 서버 실행은 아직 없습니다. 다중 사용자/RBAC, 2FA, TPS·MSPT 수집, 원격 백업 저장소, 무중단 백업, 자동 서버 JAR 다운로드는 미구현입니다. 서버 상태 핑이 응답하지 않을 때 접속 인원은 임의로 표시하지 않습니다.

패널을 **root가 아닌 전용 OS 계정**으로 실행하세요. 서버용 포트 외에 관리자 패널 포트의 외부 노출을 최소화하고 HTTPS와 방화벽을 사용하세요.

## 3. UI 데모 및 테스트

실제 프로세스를 만들지 않는 UI만 확인하려면:

```bash
npm run dev
```

검증 명령:

```bash
npm run check
npm test
```

테스트는 관리자 인증, CSRF, 파일 경로 격리, 서버 생성·백업·복원, 가짜 Java 프로세스의 stdin/종료, Minecraft 상태 핑, HTTP API와 대량 콘솔 로그를 대상으로 작성되었습니다. **실제 Minecraft 서버 JAR을 실행한 장시간 통합 테스트는 아직 수행하지 않았습니다.**

디자인 원본: [Figma 대시보드](https://www.figma.com/design/wJgjNvtFDPTscqKWzV6J5h?node-id=63-529) / [콘솔](https://www.figma.com/design/wJgjNvtFDPTscqKWzV6J5h?node-id=63-949). Unslop by Damir Sokolovsky(CC BY 4.0), Paperlogy 웹폰트를 사용하며 원저작자의 라이선스를 따릅니다.
