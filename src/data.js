
export const DEMO_SERVERS = [
  { id: "pvpconnect", name: "PvPConnect Main", kind: "마인크래프트 · 기본 서버", status: "running", players: 38, maxPlayers: 100, memoryGb: 6.2, memoryLimitGb: 10, cpu: 32.4, tps: 20.0, mspt: 3.8, port: 25565, uptime: "12일 4시간", version: "1.21.x · Java 21", directory: "/srv/minecraft/main" },
  { id: "staging", name: "Practice Staging", kind: "마인크래프트 · 테스트", status: "running", players: 4, maxPlayers: 32, memoryGb: 2.4, memoryLimitGb: 6, cpu: 15.8, tps: 20.0, mspt: 2.1, port: 25566, uptime: "3일 1시간", version: "1.21.x · Java 21", directory: "/srv/minecraft/staging" },
  { id: "proxy", name: "Proxy Gateway", kind: "네트워크 프록시", status: "running", players: 0, maxPlayers: 0, memoryGb: 0.4, memoryLimitGb: 2, cpu: 5.1, tps: null, mspt: null, port: 25577, uptime: "6일 3시간", version: "Velocity", directory: "/srv/proxy" },
  { id: "archive", name: "Event Archive", kind: "보관 서버", status: "stopped", players: 0, maxPlayers: 0, memoryGb: 0, memoryLimitGb: 4, cpu: 0, tps: null, mspt: null, port: 25568, uptime: "—", version: "1.21.x", directory: "/srv/minecraft/archive" }
];
export const DEMO_LOGS = [
  { time: "22:28:14", level: "INFO", message: "서버가 정상적으로 실행되었습니다." },
  { time: "22:28:17", level: "INFO", message: "[PConnCore] 경기장 28개를 불러왔습니다." },
  { time: "22:28:20", level: "INFO", message: "[GrimAC] 시뮬레이션 검사 활성화" },
  { time: "22:28:23", level: "INFO", message: "Pma 님이 접속했습니다." },
  { time: "22:28:31", level: "INFO", message: "랭크 대기열: 2명 대기 중" },
  { time: "22:28:35", level: "INFO", message: "경기 시작: SWORD / 경기장 04" },
  { time: "22:28:39", level: "INFO", message: "현재 접속 인원: 38 / 100" },
  { time: "22:29:01", level: "WARN", message: "30분 뒤 자동 백업 예정" },
  { time: "22:29:08", level: "INFO", message: "경기가 종료되었습니다. (63.5초)" },
  { time: "22:29:14", level: "INFO", message: "TPS 20.0 | MSPT 3.8" }
];
export const DEMO_ACTIVITY = [
  { time: "22:26", title: "백업 완료", detail: "PvPConnect Main", type: "ok" },
  { time: "21:52", title: "서버 시작", detail: "Practice Staging", type: "normal" },
  { time: "20:14", title: "설정 변경", detail: "PvPConnect Main", type: "normal" },
  { time: "19:40", title: "서버 점검", detail: "Proxy Gateway", type: "normal" }
];
export const DEMO_FILES = [
  { name: "world", type: "folder", size: "—", modified: "오늘" },
  { name: "plugins", type: "folder", size: "—", modified: "오늘" },
  { name: "logs", type: "folder", size: "—", modified: "오늘" },
  { name: "config", type: "folder", size: "—", modified: "어제" },
  { name: "server.properties", type: "file", size: "1.2 KB", modified: "어제" },
  { name: "paper-global.yml", type: "file", size: "9.8 KB", modified: "11월 11일" },
  { name: "pma-paper.jar", type: "file", size: "58.4 MB", modified: "11월 9일" },
  { name: "ops.json", type: "file", size: "3.1 KB", modified: "11월 8일" }
];
export const DEMO_BACKUPS = [
  { id: "203", title: "야간 자동 백업 #203", when: "오늘 22:26", size: "1.82 GB", status: "정상 완료" },
  { id: "202", title: "수동 백업 #202", when: "오늘 18:04", size: "1.80 GB", status: "정상 완료" },
  { id: "201", title: "야간 자동 백업 #201", when: "어제 03:00", size: "1.76 GB", status: "정상 완료" },
  { id: "200", title: "야간 자동 백업 #200", when: "11월 10일 03:00", size: "1.74 GB", status: "정상 완료" }
];
export const DEMO_SCHEDULES = [
  { id: "nightly", name: "매일 월드 백업", when: "매일 03:00 · 한국 시간", type: "백업", active: true },
  { id: "maintenance", name: "주간 점검", when: "매주 일요일 05:00", type: "서버 점검", active: true },
  { id: "export", name: "보관 파일 내보내기", when: "사용자 일시 중지", type: "내보내기", active: false }
];
export const DEMO_USERS = [
  { id: "pma", name: "Pma", role: "소유자", scope: "전체 서버" },
  { id: "hypadev11", name: "hypadev11", role: "운영자", scope: "할당 서버" },
  { id: "moderator", name: "moderator", role: "열람자", scope: "읽기 전용" }
];
export const DEMO_AUDIT = [
  { time: "22:26", action: "백업 생성", actor: "Pma", target: "PvPConnect Main" },
  { time: "21:52", action: "서버 시작", actor: "hypadev11", target: "Practice Staging" },
  { time: "20:14", action: "설정 변경", actor: "Pma", target: "PvPConnect Main" },
  { time: "19:40", action: "접속 성공", actor: "Pma", target: "Panel" }
];
export const ROUTE_INFO = [
  { route: "dashboard", label: "대시보드", icon: "grid", section: "workspace" },
  { route: "servers", label: "서버", icon: "server", section: "workspace" },
  { route: "overview", label: "개요", icon: "grid", section: "server" },
  { route: "console", label: "콘솔", icon: "terminal", section: "server" },
  { route: "files", label: "파일", icon: "folder", section: "server" },
  { route: "plugins", label: "플러그인", icon: "puzzle", section: "server" },
  { route: "backups", label: "백업", icon: "database", section: "server" },
  { route: "startup", label: "시작 설정", icon: "settings", section: "server" },
  { route: "network", label: "네트워크", icon: "network", section: "server" },
  { route: "schedules", label: "예약 작업", icon: "clock", section: "server" },
  { route: "health", label: "상태 확인", icon: "heart", section: "server" },
  { route: "users", label: "사용자", icon: "users", section: "admin" },
  { route: "audit", label: "감사 로그", icon: "shield", section: "admin" },
  { route: "settings", label: "설정", icon: "gear", section: "admin" }
];
