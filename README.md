# 피컨 (PConn Panel)

Minecraft 서버를 위한 한국어 운영 패널 프런트엔드. **Paperlogy + Unslop** 디자인을 기반으로 만들었습니다.

> **현재 상태: 동작하는 프런트엔드 미리보기 + 선택적 API 연결 구조.** 이 저장소만 실행해도 실제 Minecraft 프로세스가 시작되거나 파일이 변경되지는 않습니다. 저장소에 서버 관리 백엔드가 없어서 기본 실행은 **예시 데이터 모드**입니다.

## 시작하기

Node.js 20 이상:

```bash
git clone https://github.com/Pma10/Panel.git
cd Panel
npm run dev
```

브라우저에서 **http://127.0.0.1:4173**에 접속합니다. 패키지 설치가 필요하지 않습니다.

```bash
npm run check  # 정적 JavaScript 문법 검사
npm test       # 내장 node:test 단위 테스트
```

```bash
PORT=5173 npm run dev
```

정적 파일(index.html, src/)을 웹 서버에서 제공해도 됩니다. hash 라우팅(#/console)을 사용하므로 GitHub Pages와도 호환되는 구조입니다.

## 구현한 화면

대시보드, 서버 목록, 서버 개요, 콘솔, 파일 관리, 백업, 시작 설정, 네트워크, 예약 작업, 상태 확인, 사용자, 감사 로그, 설정 — **13개 화면**.

### 미리보기에서 실제로 동작하는 것

- 좌측 내비게이션, 모바일 하단 탭과 서버 선택
- `Ctrl+K` / `⌘K` 기능 검색
- **콘솔**: 로그 텍스트 검색, INFO/WARN/ERROR 필터, 자동 스크롤, UTF-8 로그 파일 다운로드
- 콘솔 명령 입력: 예시 로그로만 기록하고 **실제 서버 전송 여부를 명확히 표시**
- 서버 상태/이름 검색, 샘플 상태 변경 시뮬레이션
- 파일 목록 항목 선택 및 예시 폴더 열기
- 모달 확인창, 다크 모드
- 예시 서버 추가, 예시 스케줄 등록, 시작 설정 및 개인 화면 설정의 브라우저 저장(localStorage)

백업 복원·파일 업로드·서버 프로세스 제어는 실제 API가 연결되기 전에는 **실행되지 않습니다**. 위험 작업의 확인 화면은 구현되어 있지만 임의로 실제 작업을 수행하지 않습니다.

## API 연결

기본값은 API 미연결입니다. 실제 데이터 연결은 인증된 백엔드 준비 후, **앱 모듈이 실행되기 전에** 다음 설정을 주입할 수 있습니다.

```html
<script>window.PCONN_API_BASE = "";</script>
<script type="module" src="./src/app.js"></script>
```

빈 문자열이면 미리보기 모드이고, 실제 API 기본 주소를 설정하면 API를 사용합니다. 이 저장소는 백엔드를 포함하지 않습니다.

필요한 엔드포인트 개요:

| 메서드 | 경로 | 목적 |
|---|---|---|
| GET | `/api/v1/servers` | 서버 목록 / 상태 / 리소스 |
| POST | `/api/v1/servers` | 새 서버 등록 |
| GET | `/api/v1/servers/:id/logs` | 최근 로그 |
| GET (SSE) | `/api/v1/servers/:id/logs/stream` | 실시간 로그 구독 |
| POST | `/api/v1/servers/:id/commands` | 명령어 전송 |
| POST | `/api/v1/servers/:id/actions/:action` | 시작, 중지, 재시작 |
| POST | `/api/v1/servers/:id/backups` | 백업 생성 |
| POST | `/api/v1/servers/:id/backups/:backupId/restore` | 백업 복원 |
| PATCH | `/api/v1/servers/:id/startup` | 시작 설정 저장 |
| POST | `/api/v1/servers/:id/schedules` | 예약 작업 등록 |

GET 서버 목록은 배열 또는 `{ "servers": [...] }` 형식을 허용합니다. 로그는 배열 또는 `{ "entries": [...] }`을 지원합니다. 로그 엔트리 구조는 `{ "time":"22:28:14", "level":"INFO", "message":"서버 시작" }`입니다.

**보안 요구사항:** 실제 백엔드에서는 안전한 세션·권한 확인(RBAC), CSRF 보호, 감사 기록, 명령어 실행 제한, 경로 정규화와 서버별 파일 영역 분리, 요청 제한, TLS, 적절한 CORS/SSE 인증이 필요합니다. **브라우저에 관리자 토큰이나 Minecraft 서버 콘솔 자격 증명을 하드코딩하지 마세요.** 현재 API 계약은 프런트엔드 측 초안이며 서버 구현 시 검증이 필요합니다.

## 디자인과 기술

- Paperlogy: [웹폰트 배포](https://github.com/fonts-archive/Paperlogy) / [원저작자 라이선스](https://github.com/Freesentation/paperlogy/blob/main/OFL%20license.txt). 브라우저에서 CDN을 통해 로드하므로 글꼴 파일을 저장소에 포함하지 않습니다. 오프라인에서는 시스템 폰트로 대체됩니다.
- Unslop 방법론: [Damir Sokolovsky / heydamir](https://github.com/heydamir/unslop), CC BY 4.0. 디자인 점검 기준을 참고했으며 원본 자동화 스크립트는 포함하지 않습니다.
- Figma [전체 대시보드](https://www.figma.com/design/wJgjNvtFDPTscqKWzV6J5h?node-id=63-529), [개선된 데스크톱 콘솔](https://www.figma.com/design/wJgjNvtFDPTscqKWzV6J5h?node-id=63-949), [모바일 콘솔](https://www.figma.com/design/wJgjNvtFDPTscqKWzV6J5h?node-id=63-1958)
- 프런트엔드: HTML / CSS / 표준 JavaScript ES 모듈, 빌드·런타임 의존성 0개
- 테스트: Node.js 내장 `node:test`
- 색상: 차분한 중성 계열과 단일 파란색 강조, 실제 상태 표현용 녹색·주황·빨간색
- 아이콘: 원본 Figma 아이콘과 같은 선형 SVG 경로
- 접근성: 키보드 탐색, focus-visible, 한국어 레이블, prefers-reduced-motion, 모바일 390px 대응

## 향후 작업

1. 안전한 세션 인증/권한 API와 실제 서버 관리 에이전트 구현
2. 서버 파일 작업, 백업 및 예약 작업을 백엔드에 연결
3. 서버 연결 및 권한 부족/장애 시 통합 테스트
4. 배포 환경의 CSP, HTTPS, 폰트 CDN 및 성능 점검

GitHub의 저장소 작업 브랜치에서 디자인 구현을 검토한 뒤 머지하는 것을 권장합니다.

## 성능 및 안정성 설계

- **Paperlogy 스타일시트:** 1,080개의 `@font-face` 규칙을 포함한 서브셋 CSS 대신 Regular(400)와 SemiBold(600) WOFF2 두 굵기를 직접 지정합니다. 글꼴 파일은 저장소에 포함하지 않습니다.
- **로그 메모리 상한:** 최근 최대 1,200개 로그만 보유, 개별 로그 메시지는 최대 4,096자입니다. `appendBoundedLog`는 로그마다 배열 전체를 복사하지 않습니다.
- **콘솔 DOM 상한:** 최신 120행만 렌더링합니다. 서버에서 많은 로그가 수신되어도 약 130ms 단위로 묶어 화면을 갱신하고, 비활성 탭에서는 DOM 업데이트를 생략합니다.
- **서버 목록:** 화면당 60대 페이지 처리, 대시보드 8대 미리보기로 대량 서버의 DOM 생성을 제한합니다.
- **서버 전환:** 이전 서버 SSE를 종료하고, 로그 로딩 중 서버를 재전환하면 늦게 도착한 응답은 폐기하여 서버 간 기록 혼합을 방지합니다.
- **개발 서버:** 정적 자산은 32KiB 스트림으로 응답하며 `.env`, `.git`, 소스 외 내부 경로, 루트 외부로 이어지는 심볼릭 링크를 제공하지 않습니다.
- **안전한 표시:** 로그 수준에 임의 HTML 클래스가 들어가지 않도록 제한하며, API에서 받은 메시지와 대부분의 사용자 입력은 HTML 이스케이프 처리합니다.
- **중복 방지:** 명령 전송 중 전송 버튼을 비활성화합니다.
- **실제 API 모드:** 백업/상태 확인/감사 등 아직 데이터 조회가 구현되지 않은 메뉴는 예시 데이터를 실제 정보인 것처럼 보여주지 않고 미연결 상태로 표시합니다.

**테스트:** `npm run check`와 `npm test`로 정적 구문, 로그 10만 건 스트레스, 13개 라우트 렌더링, 서버 로그 전환 경쟁 상태, 정적 서버 파일 접근 제한 등을 점검합니다.

**성능 수치의 한계:** 위의 1,200/120/60은 구현된 상한이며 브라우저의 실제 RSS, 초기 로딩 시간, CPU 사용률을 측정한 값이 아닙니다. 배포 전 실제 Chrome Performance/Memory 프로파일링이 추가로 필요합니다. API 백엔드 자체의 메모리 사용량이나 TPS에는 이 프런트엔드 작업이 직접적인 영향을 주지 않습니다.

실제 API를 사용할 때에는 현재 **서버 목록·개요·콘솔에 우선 연결**되며, 다른 운영 메뉴는 정식 엔드포인트가 개발되기 전까지 미연결 안내를 표시합니다. 클라이언트의 데모 모드 UI 동작과 서버 측 작업 권한 확인은 별개입니다.
