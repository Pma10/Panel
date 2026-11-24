
import { DEMO_SERVERS, DEMO_LOGS, DEMO_ACTIVITY, DEMO_FILES, DEMO_BACKUPS, DEMO_SCHEDULES, DEMO_USERS, DEMO_AUDIT, ROUTE_INFO } from "./data.js";
import { escapeHtml as h, filterLogs, serverSummary, formatMemory, validateCommand, routeFromHash, appendBoundedLog, replaceLogHistory, recentLogs } from "./utils.mjs";
import { apiEnabled, apiRequest, streamLogs, getSession, signIn, signOut, setupAccount, uploadFile, fileDownloadUrl } from "./api.js";

const $ = (selector) => document.querySelector(selector);
const safe = (value) => h(value);
const routeMap = Object.fromEntries(ROUTE_INFO.map((item) => [item.route, item]));
const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.2"/><rect x="14" y="3" width="7" height="7" rx="1.2"/><rect x="3" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>',
  server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>',
  terminal: '<rect x="2.5" y="3.5" width="19" height="17" rx="2"/><path d="m6 9 3 3-3 3m6 1h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
  file: '<path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v6h5"/>',
  database: '<ellipse cx="12" cy="5.5" rx="9" ry="3"/><path d="M3 5.5v13c0 4 18 4 18 0v-13M3 12c0 4 18 4 18 0"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  network: '<rect x="2" y="3" width="8" height="7" rx="1.2"/><rect x="14" y="14" width="8" height="7" rx="1.2"/><path d="M6 10v6h8M18 14V8h-8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  heart: '<path d="M20.5 11.5c0 5-8.5 9.5-8.5 9.5S3.5 16.5 3.5 11.5A5 5 0 0 1 12 8a5 5 0 0 1 8.5 3.5"/><path d="M3 13h5l2-3 3 6 2-3h6"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
  shield: '<path d="M12 2 20 5v6c0 5-3 8-8 11-5-3-8-6-8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  gear: '<circle cx="12" cy="12" r="3.5"/><path d="M10 2h4l.7 2.4 2 .9 2.2-1.2 2.3 2.3-1.2 2.2.9 2L23 11v2l-2.1.7-.9 2 1.2 2.2-2.3 2.3-2.2-1.2-2 .9L14 22h-4l-.7-2.1-2-.9-2.2 1.2-2.3-2.3L4 15.7l-.9-2-1.2-2.2 2.3-2.3 2.2 1.2 2-.9z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 5 5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 10h18c0-2-3-3-3-10m-8 13h4"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 12-2.1l2.5 5.1M18.5 15a7 7 0 0 1-12 2.1L4 12"/>',
  power: '<path d="M12 3v9M5.8 6.3a9 9 0 1 0 12.4 0"/>',
  check: '<path d="m4 12 5 5 11-11"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  upload: '<path d="M12 17V3m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  download: '<path d="M12 4v14m-5-5 5 5 5-5M4 19v2h16v-2"/>',
  filter: '<path d="M4 5h16l-6 7v5l-4 2v-7z"/>',
  close: '<path d="M5 5 19 19M19 5 5 19"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.2 15.6A8.5 8.5 0 0 1 8.4 3.8 8.5 8.5 0 1 0 20.2 15.6z"/>',
  alert: '<path d="M12 3 2 21h20L12 3zM12 9v5m0 3h.01"/>'
};
const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.more}</svg>`;
const getStore = (key, fallback) => {
  try { const found = localStorage.getItem(key); return found ? JSON.parse(found) : fallback; } catch { return fallback; }
};
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const state = {
  route: routeFromHash(location.hash), selectedId: "pvpconnect",
  servers: structuredClone(DEMO_SERVERS), logs: replaceLogHistory(DEMO_LOGS), activity: [...DEMO_ACTIVITY],
  schedules: [...DEMO_SCHEDULES], mode: apiEnabled ? "live" : "demo",
  loading: apiEnabled, apiError: "", logError: "", logLoading: false,
  authenticated: !apiEnabled, authLoading: apiEnabled, authError: "", username:"", setupRequired:false, users:[],
  javaInstalls:null, javaLoading:false, fileSelection:new Set(), fileAnchor:-1, stickLogs:true,
  commandHistory:getStore("pconn-command-history",[]), commandIndex:-1,
  query: "", serverQuery: "", serverPage: 0, serverStatus: "all", fileQuery: "", filePath: apiEnabled?"":"/home/minecraft/server", selectedFile: "",
  fileEntries: [], fileLoading:false, fileText:"", backups:[], backupLoading:false, viewRequest:0, viewError:"",
  network:[], startupLive:null, health:null, audit:[], diagnostics:null, viewLoading:false,
  level: "all", autoScroll: true, command: "", theme: getStore("pconn-theme", "light"),
  modal: null, paletteQuery: "", mobileMenu: false,
  startup: getStore("pconn-startup", { executable: "java", directory: "/srv/minecraft/main", memory: "10240", timeout: "30", arguments: "-Xms4G -Xmx10G -jar pma-paper.jar nogui", autoRestart: true }),
  settings: getStore("pconn-settings", { panelName: "Panel", timezone: "Asia/Seoul", sessionHours: "24", retention: "7", audit: true })
};
document.documentElement.dataset.theme = state.theme === "dark" ? "dark" : "light";
let toastTimer = null, logClose = null, logRenderTimer = null;
let logFetchVersion = 0, loadVersion = 0, commandPending = false;
let statusRefreshTimer=null, statusPolling=false;
const LOG_FLUSH_MS = 130;
const SERVER_PAGE_SIZE = 60;
const server = () => state.servers.find((s) => s.id === state.selectedId) || state.servers[0] || null;
const routeTitle = () => routeMap[state.route]?.label || "대시보드";
const selectedName = () => server()?.name || "서버 없음";
const statusText = (status) => ({
  running:"실행 중",stopped:"중지됨",starting:"시작 중",
  stopping:"종료 중",restarting:"재시작 대기",unmanaged:"기존 Java 감지"
})[status] || "상태 알 수 없음";
const TRANSITIONAL = ["starting","stopping","restarting"];
const badge = (status) => `<span class="status ${status === "running" ? "running" : status === "stopped" ? "stopped" : "warning"} ${TRANSITIONAL.includes(status) ? "busy" : ""}"><i class="indicator"></i>${statusText(status)}</span>`;
const fmtPlayers = (s) => s.maxPlayers ? `${s.players ?? 0} / ${s.maxPlayers}` : "—";
const sectionNav = (section) => ROUTE_INFO.filter((item) => item.section === section).map((item) =>
  `<a href="#/${item.route}" class="nav-link ${state.route === item.route ? "active" : ""}" data-action="navigate" aria-current="${state.route === item.route ? "page" : "false"}">${icon(item.icon)}<span>${h(item.label)}</span></a>`
).join("");
function renderSidebar() {
  const s = server();
  return `<aside class="sidebar ${state.mobileMenu ? "open" : ""}" id="sidebar" aria-label="탐색">
    <div class="brand-block"><a class="brand" href="#/dashboard">Panel</a><span class="brand-description">서버 관리</span></div>
    <div class="side-caption">작업 공간</div><nav class="nav-group">${sectionNav("workspace")}</nav>
    <hr class="side-rule" /><div class="side-caption">현재 서버</div>
    <button class="server-selector" data-action="server-switcher" aria-label="현재 서버 변경">
      <span><span class="selector-title">${h(s?.name || "선택된 서버 없음")}</span>
      <span class="selector-state ${s?.status === "stopped" ? "stopped" : ""}"><i class="indicator"></i>${statusText(s?.status)}</span></span>${icon("chevron", "small")}
    </button>
    <nav class="nav-group" style="margin-top:15px">${sectionNav("server")}</nav>
    <hr class="side-rule" /><div class="side-caption">관리</div>
    <nav class="nav-group">${sectionNav("admin")}</nav>
    <div class="user-summary"><span class="avatar">${h((state.mode==="demo"?"P":state.username||"?").slice(0,1).toUpperCase())}</span><span><strong>${state.mode==="demo"?"Pma":h(state.username)}</strong><small>${state.mode==="demo"?"소유자 · 미리보기":"로그인 계정"}</small></span>${apiEnabled?`<button class="icon-button" data-action="logout" title="로그아웃" aria-label="로그아웃">${icon("power","small")}</button>`:""}</div>
  </aside>`;
}
function renderChrome() {
  return `<div class="mobile-overlay ${state.mobileMenu ? "open" : ""}" data-action="close-menu"></div>
    <header class="mobile-top"><button class="icon-button" data-action="open-menu" aria-label="메뉴 열기">${icon("menu")}</button>
      <a class="brand" href="#/dashboard">Panel</a><span class="demo-ribbon">${state.mode === "demo" ? "예시 모드" : "API 연결"}</span></header>
    <header class="topbar"><div class="crumbs"><a href="#/dashboard">Panel</a><span>/</span><span class="current">${h(routeTitle())}</span></div>
      <div class="top-actions"><span class="demo-ribbon">${state.mode === "demo" ? "예시 데이터" : "실제 API"}</span>
      <button class="global-search" data-action="palette" aria-label="기능 검색">${icon("search", "small")}<span>기능 검색</span><kbd class="keycap">⌘ K</kbd></button>
      <button class="icon-button" data-action="show-notifications" aria-label="알림">${icon("bell")}</button><span class="top-avatar" title="${state.mode==="demo"?"예시 계정":"연결된 계정"}">P</span></div>
    </header>
    <nav class="mobile-tabbar" aria-label="모바일 주요 탐색">
      ${[["dashboard","대시보드","grid"],["servers","서버","server"],["console","콘솔","terminal"],["settings","설정","gear"]].map(([route,title,glyph]) =>
        `<a href="#/${route}" class="${state.route === route ? "active" : ""}" aria-label="${title}">${icon(glyph)}<span>${title}</span></a>`).join("")}
    </nav>`;
}
const button = (label, action, kind = "", extra = "") => `<button type="button" class="btn ${kind}" data-action="${h(action)}" ${extra}>${label}</button>`;
const header = (title, description, actions = "") => `<div class="page-heading"><div><h1>${h(title)}</h1><p>${h(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
const card = (title, body, action = "") => `<section class="card"><div class="card-title"><h2>${h(title)}</h2>${action}</div>${body}</section>`;
const demoNote = () => `<div class="demo-note">${icon("alert","small")} ${state.mode === "demo" ? "표시된 수치는 디자인 검토용 예시입니다. 실제 서버는 제어되지 않습니다." : "표시된 정보는 연결된 API를 기반으로 합니다."}</div>`;
function renderServerRows(servers, withOpen = false) {
  if (!servers.length) return `<tr><td colspan="${withOpen ? 5 : 4}"><div class="empty-state">${icon("server")}<strong>표시할 서버가 없습니다</strong><p>검색 조건을 변경하거나 연결 상태를 확인하세요.</p></div></td></tr>`;
  return servers.map((s) => `<tr data-server-row="${h(s.id)}" data-filter-text="${h((s.name+" "+s.kind).toLowerCase())}" data-status="${h(s.status)}">
    <td><strong class="server-name">${h(s.name)}</strong><span class="server-desc">${h(s.kind)}</span></td>
    <td>${badge(s.status)}</td>
    <td class="numeric">${fmtPlayers(s)}</td><td class="numeric">${formatMemory(s.memoryGb)}</td>
    ${withOpen ? `<td><button class="table-link" data-action="select-server" data-id="${h(s.id)}">열기 →</button></td>` : ""}</tr>`).join("");
}
function renderDashboard() {
  const sum = serverSummary(state.servers);
  const activities = (state.mode === "demo" ? state.activity : []).map((a) => `<div class="activity-row"><div class="activity-spot ${a.type === "ok" ? "ok" : ""}">${icon(a.type === "ok" ? "check" : "clock","small")}</div>
     <div class="activity-info"><strong>${h(a.title)}</strong><small>${h(a.detail)}</small></div><time>${h(a.time)}</time></div>`).join("");
  return `${header("대시보드","서버 상태와 최근 작업",button(`${icon("plus","small")} 서버 추가`,"server-create","primary"))}
    <section class="card summary-strip" aria-label="운영 현황">
      <div class="summary-primary"><strong><i class="indicator" style="color:var(--success)"></i>${sum.running}대 서버가 실행 중</strong>
        <small>전체 ${sum.total}대 중 중지 ${sum.total-sum.running}대 · 서버 상태 확인</small>
        <span class="fine-print">최근 확인 · ${state.mode === "demo" ? "예시 데이터" : "연결된 API"}</span></div>
      <div class="summary-secondary"><span>현재 접속 인원</span><strong>${state.mode==="live" && !state.servers.some(x=>x.players!=null)?"측정 중":sum.players+"명"}</strong></div>
      <div class="summary-secondary"><span>전체 메모리 사용량</span><strong>${state.mode==="live" && !state.servers.some(x=>x.memoryGb!=null)?"측정 불가":sum.memoryGb.toFixed(1)+" GB"}</strong></div>
    </section>
    <div class="dashboard-layout">
      ${card("내 서버",`<div class="table-scroll"><table class="data-table">
        <thead><tr><th>서버 이름</th><th>상태</th><th class="numeric">플레이어</th><th class="numeric">메모리</th></tr></thead>
        <tbody>${renderServerRows(state.servers.slice(0,8))}</tbody></table></div>`,`<a href="#/servers">전체 서버 보기 →</a>`)}
      ${card("최근 활동",`<div class="activity-list">${activities || '<div class="empty-state"><strong>활동 내역 API 미연결</strong><p>실제 서버 활동 기록을 불러올 수 없습니다.</p></div>'}</div>`,state.mode==="demo"?`<a href="#/audit">전체 보기</a>`:"")}
    </div>${demoNote()}`;
}
function renderServers() {
  return `${header("서버","등록된 인스턴스를 검색하고 제어합니다",button(`${icon("plus","small")} 서버 추가`,"server-create","primary"))}
    <div class="toolbar"><label class="search-field">${icon("search")}<input class="field" id="server-search" placeholder="서버 이름 또는 ID로 검색" autocomplete="off" value="${h(state.serverQuery)}" aria-label="서버 검색"></label>
      <select id="server-status" class="select" aria-label="서버 상태">
        <option value="all" ${state.serverStatus === "all" ? "selected":""}>전체 상태</option>
        <option value="running" ${state.serverStatus === "running" ? "selected":""}>실행 중</option>
        <option value="stopped" ${state.serverStatus === "stopped" ? "selected":""}>중지됨</option>
        <option value="unmanaged" ${state.serverStatus === "unmanaged" ? "selected":""}>기존 Java 감지</option></select>
      <div class="toolbar-spacer"></div><span class="demo-ribbon">${state.servers.length}대 등록</span></div>
    ${card("서버 목록",`<div class="table-scroll"><table class="data-table">
      <thead><tr><th>서버 이름</th><th>상태</th><th class="numeric">접속 인원</th><th class="numeric">메모리</th><th>관리</th></tr></thead>
      <tbody id="server-results">${renderServerRows(state.servers.slice(0,SERVER_PAGE_SIZE),true)}</tbody></table></div><div class="server-pagination" id="server-pagination"></div>`)}
    ${demoNote()}`;
}
function powerButtons(s) {
  if (!s || s.status === "unmanaged") return "";
  if (s.status === "stopping") return button("종료 중…","noop","","disabled");
  if (s.status === "stopped") return button(`${icon("power","small")} 서버 시작`,"power-confirm","primary",`data-power="start"`);
  if (s.status === "restarting") return button(`${icon("power","small")} 지금 시작`,"power-confirm","primary",`data-power="start"`)+
    button("자동 재시작 취소","power-confirm","danger",`data-power="stop"`);
  return `${button(`${icon("refresh","small")} 재시작`,"power-confirm","",`data-power="restart"`)}
    ${button(`${icon("power","small")} 서버 중지`,"power-confirm","danger",`data-power="stop"`)}`;
}
const statusDetail = (s) => ({
  starting:"Java 프로세스가 실행됐고 서버 준비(Done) 메시지를 기다리는 중입니다.",
  running:"서버가 접속을 받을 수 있는 상태입니다.",
  stopping:"stop 명령을 보냈습니다. 월드 저장 후 종료됩니다 (최대 25초 후 강제 종료).",
  restarting:"서버가 종료되어 잠시 후 자동으로 다시 시작합니다.",
  stopped:"서버 프로세스가 실행 중이 아닙니다.",
  unmanaged:"이전 패널이 실행한 Java 프로세스가 남아 있습니다."
})[s?.status] || "";
function renderOverview() {
  const s = server();
  if (!s) return emptyServer();
  const action = s.status==="unmanaged" ?
    '<div class="notice">이전 패널이 실행한 Java 프로세스가 남아 있습니다. PID와 서버 상태를 확인하고 기존 프로세스를 안전하게 종료한 후 패널에서 다시 시작하세요.</div>' :
    powerButtons(s);
  const metrics = [
    ["접속 인원",fmtPlayers(s),"현재 플레이어"],
    ["TPS",s.tps == null ? "—" : s.tps.toFixed(1),"틱 처리율"],
    ["MSPT",s.mspt == null ? "—" : s.mspt.toFixed(1),"평균 처리 시간"],
    ["가동 시간",s.uptime,"마지막 시작 이후"]
  ].map(([title,value,note]) => `<div class="card stat-card"><span>${h(title)}</span><strong>${h(value)}</strong><small>${h(note)}</small></div>`).join("");
  const resources = [
    ["CPU 사용량",s.cpu==null?(s.status==="stopped"?"—":"측정 중"):Number(s.cpu).toFixed(1)+"%","서버 프로세스 · 전체 코어 대비",s.cpu==null?0:s.cpu/100],
    ["메모리 사용량",formatMemory(s.memoryGb)+" / "+s.memoryLimitGb+" GB","할당 메모리 대비 사용량",s.memoryGb==null?0:s.memoryGb/s.memoryLimitGb]
  ].map(([title,value,note,percent],index) => `<div class="card resource-card"><h2>${h(title)}</h2>
    <strong>${h(value)}</strong><p>${h(note)}</p><div class="progress-track"><div class="progress-fill ${index ? "green" : ""}" style="width:${Math.min(100,Math.max(0,percent*100))}%"></div></div></div>`).join("");
  return `${header("서버 개요","서버 상태와 자원 사용량을 확인합니다")}
    <div class="card overview-head"><div class="server-glyph">${icon("server","large")}</div><div class="overview-title">
    <h2>${h(s.name)}</h2><p>${h(s.version)} · 가동 ${h(s.uptime)}</p><p class="status-detail">${h(statusDetail(s))}</p></div>${badge(s.status)}<div class="page-actions">${action}</div></div>
    <div class="card info-line auto-restart-line"><div><strong>종료 시 자동 재시작</strong><p>패널에서 중지하지 않았는데 서버가 꺼지면 다시 켭니다 (10분에 최대 3회).</p></div>
      <button class="switch ${s.autoRestart?"on":""}" role="switch" type="button" aria-checked="${Boolean(s.autoRestart)}" aria-label="종료 시 자동 재시작" data-action="auto-restart-toggle"></button></div>
    <div class="grid-stats">${metrics}</div><div class="two-col">${resources}</div>
    ${card("실행 환경",`<div class="info-list"><div class="info-line"><strong>실행 경로</strong><span class="right mono">${h(s.directory)}</span></div>
    <div class="info-line"><strong>접속 포트</strong><span class="right mono">${h(s.port)}</span></div></div>`)}
    ${demoNote()}`;
}
const emptyServer = () => `<div class="card empty-state">${icon("server","large")}<strong>선택된 서버가 없습니다</strong><p>서버 목록에서 서버를 선택하세요.</p><a class="btn" href="#/servers">서버 목록 열기</a></div>`;
// Console color: ANSI SGR codes (Paper with -Dterminal.ansi=true) and
// Minecraft § codes become spans; plain lines get prefix/keyword tints.
// Only fixed palette entries or validated #rrggbb values reach style="".
const MC_COLORS = {"0":"#3a3a3a","1":"#4f6bd8","2":"#3fb950","3":"#39c5cf","4":"#e5534b","5":"#c06ff2","6":"#e3b341","7":"#b8c3d1",
  "8":"#7d8590","9":"#79a8ff","a":"#7ee787","b":"#76e3ea","c":"#ff7b72","d":"#f2a5ff","e":"#f8e36b","f":"#f0f6fc"};
const ANSI_COLORS = ["#3a3a3a","#e5534b","#3fb950","#e3b341","#4f8ff7","#c06ff2","#39c5cf","#b8c3d1",
  "#7d8590","#ff7b72","#7ee787","#f8e36b","#79a8ff","#f2a5ff","#76e3ea","#f0f6fc"];
function styledSpan(text, style) {
  if (!text) return "";
  const css = (style.color ? "color:"+style.color+";" : "") + (style.bold ? "font-weight:700;" : "") + (style.italic ? "font-style:italic;" : "");
  return css ? '<span style="'+css+'">'+h(text)+'</span>' : h(text);
}
function applyAnsi(codes, style) {
  const list = codes === "" ? [0] : codes.split(";").map(Number);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === 0) { style.color = ""; style.bold = false; style.italic = false; }
    else if (c === 1) style.bold = true;
    else if (c === 3) style.italic = true;
    else if (c === 22) style.bold = false;
    else if (c === 23) style.italic = false;
    else if (c === 39) style.color = "";
    else if (c >= 30 && c <= 37) style.color = ANSI_COLORS[c-30];
    else if (c >= 90 && c <= 97) style.color = ANSI_COLORS[c-82];
    else if (c === 38 && list[i+1] === 5) { const n = list[i+2]; if (n >= 0 && n < 16) style.color = ANSI_COLORS[n]; i += 2; }
    else if (c === 38 && list[i+1] === 2) {
      const rgb = list.slice(i+2, i+5);
      if (rgb.length === 3 && rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
        style.color = "#" + rgb.map((v) => v.toString(16).padStart(2,"0")).join("");
      i += 4;
    }
  }
}
function renderColored(message) {
  const style = {color:"",bold:false,italic:false};
  let out = "", text = "";
  const flush = () => { out += styledSpan(text, style); text = ""; };
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch === "\x1b" && message[i+1] === "[") {
      const end = message.slice(i+2).search(/[A-Za-z]/);
      if (end < 0) break;
      flush();
      if (message[i+2+end] === "m") applyAnsi(message.slice(i+2, i+2+end), style);
      i += 2 + end;
    } else if (ch === "§" && i+1 < message.length) {
      const code = message[i+1].toLowerCase();
      flush();
      if (code === "x" && /^(§[0-9a-f]){6}$/i.test(message.slice(i+2, i+14))) {
        style.color = "#" + message.slice(i+2, i+14).replace(/§/g,"").toLowerCase(); i += 13; continue;
      }
      if (MC_COLORS[code]) { style.color = MC_COLORS[code]; style.bold = false; style.italic = false; }
      else if (code === "l") style.bold = true;
      else if (code === "o") style.italic = true;
      else if (code === "r") { style.color = ""; style.bold = false; style.italic = false; }
      i += 1;
    } else text += ch;
  }
  flush();
  return out;
}
const LOG_HIGHLIGHTS = [
  [/\b(joined the game|logged in with entity id)\b/, "log-join"],
  [/\b(left the game|lost connection|Disconnected)\b/, "log-leave"],
  [/\bDone \([0-9.,]+m?s\)!/, "log-done"],
  [/^\s*(at |Caused by:|\.\.\. \d+ more)/, "log-trace"],
  [/(Exception|Error:)/, "log-exception"]
];
function renderLogMessage(message) {
  if (/\x1b\[|§/.test(message)) return renderColored(message);
  // "[12:00:00 INFO]: " or "[Server thread/INFO]: " prefixes are dimmed.
  const prefix = message.match(/^(\[[^\]]{1,60}\]:?\s*)+/)?.[0] || "";
  const body = message.slice(prefix.length);
  const tag = LOG_HIGHLIGHTS.find(([pattern]) => pattern.test(body))?.[1];
  return (prefix ? '<span class="log-prefix">'+h(prefix)+'</span>' : "") + (tag ? '<span class="'+tag+'">'+h(body)+'</span>' : h(body));
}
const renderLogRow = (row) => `<div class="log-line ${/^(INFO|WARN|ERROR)$/i.test(row.level) ? row.level.toLowerCase() : "other"}" role="row">
    <span class="log-time mono">${h(row.time)}</span>
    <span class="log-level mono">${h(row.level)}</span>
    <span class="log-message mono">${renderLogMessage(row.message)}</span></div>`;
// What the console DOM currently shows, so updates can append instead of
// re-parsing up to 1000 rows (measured ~136ms per full redraw in Chrome).
let shownLogs = { key: "", rows: [] };
function renderLogRows() {
  const rows = recentLogs(state.logs,state.query,state.level);
  shownLogs = { key: state.query + "\n" + state.level, rows };
  if (!rows.length) return `<div class="log-empty">조건에 맞는 로그가 없습니다.</div>`;
  return rows.map(renderLogRow).join("");
}
const consoleStatus = () => { const s = server(); return s ? badge(s.status) + powerButtons(s) : ""; };
function renderConsole() {
  const s = server();
  return `<div class="console-page">${header("콘솔",(s?.name || "서버 없음")+" · 로그 확인 및 명령어 실행",`<span class="console-power" id="console-status-host">${consoleStatus()}</span>`)}
    <div class="toolbar console-toolbar">
      <label class="search-field">${icon("search")}<input class="field" id="log-search" placeholder="로그 검색" aria-label="로그 검색" value="${h(state.query)}"></label>
      <div class="filter-tabs" role="group" aria-label="로그 수준">
      ${[["all","전체"],["info","정보"],["warn","경고"],["error","오류"]].map(([key,label]) =>
        `<button class="filter-tab ${state.level === key ? "active" : ""}" data-action="log-level" data-level="${key}" aria-pressed="${state.level===key}">${label}</button>`).join("")}</div>
      <div class="toolbar-spacer"></div>
      <label class="checkbox-label"><input type="checkbox" id="log-autoscroll" ${state.autoScroll ? "checked":""}>최신 로그 따라가기</label>
      ${state.mode==="live"?button(`${icon("folder","small")} 로그 파일`,"open-log-folder","small"):""}
      ${button(`${icon("download","small")} 내보내기`,"download-logs","small export-btn")}
    </div>
    <section class="console-panel" aria-label="실시간 서버 로그">
      <header class="console-statusbar">
        <span class="console-status ${!s || s.status !== "running" ? "offline" : ""}"><i class="indicator"></i>${state.mode==="demo" ? "예시 로그" : state.logError ? "연결 오류" : "연결됨"}</span>
        <span class="console-grow"></span>
        <span class="console-muted" id="log-count">${recentLogs(state.logs,state.query,state.level).length}줄 · 위로 스크롤해 이전 기록 보기</span>
      </header>
      <div class="log-viewport" id="log-viewport" role="log" aria-live="off"><div class="log-rows" id="log-rows">${renderLogRows()}</div></div>
      <form class="console-composer" id="console-form"><label class="command-field"><span>›</span>
        <input id="console-command" aria-label="서버 명령어" autocomplete="off" maxlength="512" placeholder="서버 명령어 입력 (↑/↓ 이전 명령)" value="${h(state.command)}"></label>
        <button class="btn primary command-send" type="submit">전송</button></form>
    </section>
    <p class="console-help">${state.mode === "demo" ? "예시 모드: 입력한 명령은 실제 서버에 전송되지 않습니다." : "명령어는 현재 선택된 서버에 전송됩니다. 콘솔에서 stop을 입력하면 자동 재시작 없이 종료합니다. 더 오래된 기록은 '로그 파일'의 logs 폴더에서 확인하세요."}</p></div>`;
}
function rememberCommand(value) {
  const list = state.commandHistory.filter((item) => item !== value);
  list.push(value);
  state.commandHistory = list.slice(-50);
  state.commandIndex = -1;
  store("pconn-command-history", state.commandHistory);
}

function renderUnconnected(title, details) {
  return header(title, details) +
    '<section class="card empty-state">' +
      icon("alert","large") +
      '<strong>실제 데이터 API가 연결되지 않았습니다</strong>' +
      '<p>이 화면은 연결된 서버에서 정보를 가져오는 기능이 준비되면 사용할 수 있습니다. 임의의 예시 값을 실제 운영 정보로 표시하지 않습니다.</p>' +
    '</section>';
}

const fileSize = (bytes) => {
  if(typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
  if(bytes<1024)return bytes+" B";
  if(bytes<1024*1024)return (bytes/1024).toFixed(1)+" KB";
  if(bytes<1024*1024*1024)return (bytes/(1024*1024)).toFixed(1)+" MB";
  return (bytes/(1024*1024*1024)).toFixed(2)+" GB";
};
const joinPath = (folder,name) => (folder?folder+"/":"")+name;
const parentPath = (path) => path.includes("/") ? path.slice(0,path.lastIndexOf("/")) : "";
const relativeFile = (name) => joinPath(state.filePath,name);
const fileApi = (suffix) => "/servers/"+encodeURIComponent(state.selectedId)+"/files"+suffix;
// Opening these as text would only show garbage; double-click downloads them instead.
const BINARY_FILE = /\.(jar|zip|gz|tgz|tar|7z|rar|png|jpe?g|gif|webp|ico|dat|dat_old|mca|mcr|nbt|db|sqlite|class|so|dll|exe|bin)$/i;
async function loadFiles({quiet=false}={}){
  if(state.mode!=="live" || !state.selectedId)return;
  const id=state.selectedId,folder=state.filePath,seq=++state.viewRequest;
  state.fileLoading=true;state.viewError="";
  try{
    const result=await apiRequest(fileApi("?path="+encodeURIComponent(folder)));
    if(seq!==state.viewRequest || state.selectedId!==id || state.filePath!==folder)return;
    state.fileEntries=Array.isArray(result.entries)?result.entries:[];
    const names=new Set(state.fileEntries.map(f=>f.name));
    state.fileSelection=new Set([...state.fileSelection].filter(n=>names.has(n)));
  }catch(e){if(seq===state.viewRequest){state.viewError=e.message;state.fileEntries=[];}}
  finally{
    if(seq===state.viewRequest){
      state.fileLoading=false;
      const body=$("#file-tbody");
      if(quiet && body){body.innerHTML=renderFileRows();refreshFileSelection();}
      else if(state.route==="files")render();
    }
  }
}
function visibleFiles(){
  const term=state.fileQuery.trim().toLocaleLowerCase("ko");
  return state.fileEntries.filter(f=>!term||f.name.toLocaleLowerCase("ko").includes(term)).slice(0,2000);
}
function renderFileRows(){
  const list=visibleFiles();
  const up=state.filePath?'<tr class="file-row file-up" data-file-up="1" data-drop-folder="'+h(parentPath(state.filePath))+'" title="상위 폴더 (Backspace)">'+
    '<td class="file-check"></td><td colspan="4"><span class="file-name">'+icon("folder")+'<span>..</span></span></td></tr>':'';
  if(!list.length)return up+'<tr><td colspan="5" class="file-empty">'+
    (state.fileLoading?"불러오는 중…":state.fileQuery?"검색 결과가 없습니다.":"비어 있는 폴더입니다. 파일이나 폴더를 여기로 끌어다 놓으면 업로드됩니다.")+'</td></tr>';
  return up+list.map((f)=>{
    const folder=f.type==="folder",sel=state.fileSelection.has(f.name),name=h(f.name);
    return '<tr class="file-row'+(sel?' active':'')+'" draggable="true" data-file="'+name+'"'+(folder?' data-drop-folder="'+h(relativeFile(f.name))+'"':'')+'>'+
      '<td class="file-check"><input type="checkbox" data-file-check="'+name+'" '+(sel?'checked':'')+' aria-label="'+name+' 선택"></td>'+
      '<td><span class="file-name">'+icon(folder?"folder":"file")+'<span>'+name+'</span></span></td>'+
      '<td class="numeric">'+(folder?"—":fileSize(f.size))+'</td>'+
      '<td class="numeric">'+h(new Date(f.modified).toLocaleString("ko-KR",{dateStyle:"short",timeStyle:"short"}))+'</td>'+
      '<td class="file-row-actions">'+
        (folder?'':'<button class="mini-btn" data-action="file-edit" data-name="'+name+'">편집</button>'+
          '<button class="mini-btn" data-action="file-download" data-name="'+name+'">받기</button>')+
        '<button class="mini-btn" data-action="file-rename" data-name="'+name+'">이름</button>'+
        '<button class="mini-btn danger" data-action="file-delete" data-name="'+name+'">삭제</button></td></tr>';
  }).join("");
}
function renderFileSelectionBar(){
  const n=state.fileSelection.size;
  if(!n)return '<span class="hint">'+state.fileEntries.length+'개 항목</span>';
  return '<strong>'+n+'개 선택</strong>'+button("다운로드","file-download-selected","small")+
    button("삭제","file-delete-selected","small danger")+button("선택 해제","file-clear-selection","small");
}
// Selection changes only toggle classes so an in-progress drag is not torn down.
function refreshFileSelection(){
  document.querySelectorAll("[data-file]").forEach((row)=>{
    const on=state.fileSelection.has(row.dataset.file);
    row.classList.toggle("active",on);
    const box=row.querySelector("[data-file-check]");if(box)box.checked=on;
  });
  const bar=$("#file-selbar");if(bar)bar.innerHTML=renderFileSelectionBar();
  const all=$("#file-check-all");
  if(all){const list=visibleFiles();all.checked=list.length>0&&list.every(f=>state.fileSelection.has(f.name));}
}
function selectFile(name,event){
  const list=visibleFiles(),index=list.findIndex(f=>f.name===name);
  const additive=event?.ctrlKey||event?.metaKey;
  if(event?.shiftKey && state.fileAnchor>=0){
    if(!additive)state.fileSelection.clear();
    const [a,b]=[Math.min(state.fileAnchor,index),Math.max(state.fileAnchor,index)];
    list.slice(a,b+1).forEach(f=>state.fileSelection.add(f.name));
  }else if(additive){
    if(state.fileSelection.has(name))state.fileSelection.delete(name);else state.fileSelection.add(name);
    state.fileAnchor=index;
  }else{state.fileSelection=new Set([name]);state.fileAnchor=index;}
  refreshFileSelection();
}
async function openFolder(path){
  state.filePath=path;state.fileSelection=new Set();state.fileAnchor=-1;state.fileQuery="";
  await loadFiles();
}
async function openFileEntry(name){
  const entry=state.fileEntries.find(f=>f.name===name);if(!entry)return;
  if(entry.type==="folder")return openFolder(relativeFile(name));
  if(BINARY_FILE.test(name))return downloadEntry(name);
  await openTextFile(name);
}
function downloadEntry(name){
  const a=document.createElement("a");
  a.href=fileDownloadUrl(state.selectedId,relativeFile(name));
  a.download=name;document.body.appendChild(a);a.click();a.remove();
}
function confirmDelete(names){
  if(!names.length)return;
  const folders=names.filter(n=>state.fileEntries.find(f=>f.name===n)?.type==="folder").length;
  setModal({kind:"confirm",title:names.length===1?"'"+names[0]+"'을(를) 삭제할까요?":names.length+"개 항목을 삭제할까요?",
    description:(folders?"폴더는 안의 모든 내용과 함께 삭제됩니다. ":"")+"삭제한 파일은 복구할 수 없습니다."+
      (names.length>1?" 대상: "+names.slice(0,8).join(", ")+(names.length>8?" 외 "+(names.length-8)+"개":""):""),
    paths:names.map(relativeFile),confirmLabel:"삭제",confirmAction:"file-delete-run",danger:true});
}
async function movePaths(names,dest){
  let moved=0;
  for(const name of names){
    const from=relativeFile(name),to=joinPath(dest,name);
    if(from===to||dest===from||dest.startsWith(from+"/"))continue;
    await apiRequest(fileApi("/rename"),{method:"PATCH",body:{from,to}});moved++;
  }
  return moved;
}
// items: [{path, file}] or [{path, dir:true}], paths relative to dest.
async function uploadItems(items,dest){
  const files=items.filter(i=>i.file);
  if(!items.length)return;
  if(dest===state.filePath){
    const existing=new Set(state.fileEntries.map(f=>f.name));
    const conflicts=files.filter(i=>!i.path.includes("/")&&existing.has(i.path)).map(i=>i.path);
    if(conflicts.length&&!confirm(conflicts.length+"개 파일을 덮어씁니다. 계속할까요?\n"+conflicts.slice(0,8).join("\n")))return;
  }
  const dirs=new Set();
  for(const item of items){
    const parts=item.path.split("/");
    for(let k=1;k<parts.length;k++)dirs.add(parts.slice(0,k).join("/"));
    if(item.dir)dirs.add(item.path);
  }
  for(const dir of [...dirs].sort((a,b)=>a.split("/").length-b.split("/").length)){
    try{await apiRequest(fileApi("/mkdir"),{method:"POST",body:{path:joinPath(dest,dir)}});}
    catch(e){if(e.status!==409)throw e;}
  }
  let done=0;
  for(const item of files){
    toast("업로드 중 "+(++done)+"/"+files.length+" · "+item.path);
    await uploadFile(state.selectedId,joinPath(dest,item.path),item.file);
  }
  toast(files.length+"개 파일 업로드 완료");
}
async function collectDropped(transfer){
  // webkitGetAsEntry must be read synchronously, before the first await.
  const entries=[...(transfer.items||[])].map(it=>it.webkitGetAsEntry?.()).filter(Boolean);
  if(!entries.length)return [...(transfer.files||[])].map(file=>({file,path:file.name}));
  const out=[];
  const walk=async(entry,prefix)=>{
    if(entry.isFile){out.push({path:prefix+entry.name,file:await new Promise((ok,fail)=>entry.file(ok,fail))});return;}
    if(!entry.isDirectory)return;
    out.push({path:prefix+entry.name,dir:true});
    const reader=entry.createReader();
    for(;;){
      const batch=await new Promise((ok,fail)=>reader.readEntries(ok,fail));
      if(!batch.length)break;
      for(const child of batch)await walk(child,prefix+entry.name+"/");
    }
  };
  for(const entry of entries)await walk(entry,"");
  return out;
}
function renderLiveFiles(){
  if(!server())return header("파일","실제 서버 파일 시스템")+
    '<div class="card empty-state"><strong>먼저 서버를 생성하세요.</strong><p>서버 생성 후 JAR 파일을 업로드할 수 있습니다.</p><a class="btn" href="#/servers">서버 목록</a></div>';
  const segments=state.filePath?state.filePath.split("/"):[];
  const crumbs='<button class="crumb" data-action="file-goto" data-path="" data-drop-folder="">'+icon("folder","small")+' 서버 루트</button>'+
    segments.map((seg,i)=>{const path=h(segments.slice(0,i+1).join("/"));
      return '<span class="crumb-sep">/</span><button class="crumb" data-action="file-goto" data-path="'+path+'" data-drop-folder="'+path+'">'+h(seg)+'</button>';}).join("");
  const list=visibleFiles();
  const allChecked=list.length>0&&list.every(f=>state.fileSelection.has(f.name));
  return header("파일","서버 폴더 내부 · 서버가 실행 중이어도 편집·업로드할 수 있습니다")+
    '<div class="toolbar file-toolbar"><div class="crumb-path">'+crumbs+'</div><div class="toolbar-spacer"></div>'+
      '<label class="search-field file-search">'+icon("search")+'<input class="field" id="file-search" placeholder="이 폴더에서 찾기" autocomplete="off" value="'+h(state.fileQuery)+'" aria-label="파일 찾기"></label>'+
      button("새 파일","file-new-file","small")+button("새 폴더","file-new-folder","small")+
      button(icon("refresh","small"),"file-refresh","small",'title="새로고침" aria-label="새로고침"')+
      button("폴더 업로드","folder-upload","small")+
      button(icon("upload","small")+" 파일 업로드","file-upload","small primary")+
      '<input id="file-upload-input" type="file" multiple hidden><input id="folder-upload-input" type="file" webkitdirectory multiple hidden></div>'+
    (state.viewError?'<div class="notice">'+h(state.viewError)+'</div>':'')+
    '<section class="card file-card" id="file-dropzone"><div class="file-selbar" id="file-selbar">'+renderFileSelectionBar()+'</div>'+
      '<div class="table-scroll"><table class="data-table file-table"><thead><tr>'+
      '<th class="file-check"><input type="checkbox" id="file-check-all" aria-label="전체 선택" '+(allChecked?'checked':'')+'></th>'+
      '<th>이름</th><th class="numeric">크기</th><th class="numeric">수정</th><th></th></tr></thead>'+
      '<tbody id="file-tbody">'+renderFileRows()+'</tbody></table></div>'+
      '<div class="drop-hint">놓으면 이 폴더에 업로드합니다</div></section>'+
    (state.fileEntries.length>2000?'<p class="hint">처음 2000개 항목만 표시합니다. 찾기로 범위를 좁히세요.</p>':'')+
    '<p class="hint">더블클릭으로 열기·편집 · Enter 열기 · F2 이름 변경 · Delete 삭제 · Backspace 상위 폴더 · Ctrl/Shift+클릭 다중 선택 · Ctrl+A 전체 선택 · 항목을 폴더나 경로로 끌어 이동 · 바탕화면에서 파일·폴더를 끌어와 업로드</p>';
}

function renderFiles() {
  if (state.mode === "live") return renderLiveFiles();
  const viewingRoot = state.filePath === "/home/minecraft/server";
  const files = viewingRoot ? DEMO_FILES : [];
  const active = files.find((item) => item.name === state.selectedFile);
  return `${header("파일","서버의 파일과 폴더를 안전하게 관리합니다",button(`${icon("upload","small")} 업로드`,"file-upload","primary"))}
  <div class="toolbar"><div class="crumb-path"><button data-action="file-root">/home › minecraft › server</button>${!viewingRoot ? `<span>›</span><span>${h(state.filePath.split("/").pop())}</span>` : ""}</div>
    <div class="toolbar-spacer"></div>${button("새 폴더","file-new-folder")}</div>
  <div class="file-layout">
    ${card("파일 목록",`<div class="table-scroll"><table class="data-table"><thead><tr><th>이름</th><th>종류</th><th class="numeric">크기</th><th class="numeric">수정</th></tr></thead>
      <tbody>${files.length ? files.map((f) => `<tr class="file-row ${state.selectedFile===f.name?"active":""}" data-action="file-select" data-name="${h(f.name)}">
      <td><span class="file-name">${icon(f.type==="folder"?"folder":"file")}<span>${h(f.name)}</span></span></td>
      <td>${f.type==="folder"?"폴더":"파일"}</td><td class="numeric">${h(f.size)}</td><td class="numeric">${h(f.modified)}</td></tr>`).join("") : `<tr><td colspan="4"><div class="empty-state"><strong>이 폴더는 비어 있습니다</strong><p>${state.mode==="demo"?"예시 데이터에는 하위 폴더 내용이 포함되지 않습니다.":"파일 목록을 새로고침해 주세요."}</p></div></td></tr>`}</tbody></table></div>`)}
    <aside class="card file-inspector"><h3>${active ? h(active.name) : "선택한 파일"}</h3>
      ${active ? `<dl><dt>종류</dt><dd>${active.type==="folder"?"폴더":"파일"}</dd>
        <dt>크기</dt><dd>${h(active.size)}</dd><dt>마지막 수정</dt><dd>${h(active.modified)}</dd></dl>
        ${button(active.type==="folder"?"폴더 열기":"파일 보기","file-open","",`data-name="${h(active.name)}"`)}` :
        `<p style="color:var(--secondary);line-height:1.7">목록에서 파일을 선택하면 세부 정보와 작업 메뉴가 표시됩니다.</p>`}
    </aside></div>${demoNote()}`;
}

async function refreshRouteData(){
  if(state.mode!=="live" || !state.authenticated)return;
  if(!state.selectedId && !["audit","settings","users"].includes(state.route))return;
  if(state.route==="files"){await loadFiles();return;}
  const route=state.route;
  const endpoints={backups:"backups",startup:"startup",network:"network",schedules:"schedules",health:"health",audit:"audit",settings:"diagnostics",users:"users"};
  if(!endpoints[route])return;
  const id=state.selectedId,seq=++state.viewRequest;
  state.viewError="";state.viewLoading=true;render();
  try{
    const path=route==="audit"?"/audit":route==="settings"?"/diagnostics":route==="users"?"/users":"/servers/"+encodeURIComponent(id)+"/"+endpoints[route];
    const response=await apiRequest(path);
    if(seq!==state.viewRequest || id!==state.selectedId || route!==state.route)return;
    if(route==="backups")state.backups=Array.isArray(response.backups)?response.backups:[];
    if(route==="startup"){state.startupLive=response;if(state.javaInstalls===null)detectJavaInstalls();}
    if(route==="users")state.users=Array.isArray(response.users)?response.users:[];
    if(route==="network")state.network=response;
    if(route==="schedules")state.schedules=Array.isArray(response.schedules)?response.schedules:[];
    if(route==="health")state.health=response;
    if(route==="audit")state.audit=Array.isArray(response.entries)?response.entries:[];
    if(route==="settings")state.diagnostics=response;
  }catch(e){if(seq===state.viewRequest)state.viewError=e.message;}
  finally{if(seq===state.viewRequest){state.viewLoading=false;if(route===state.route)render();}}
}
function liveViewStatus(){
  if(state.viewLoading)return '<div class="card empty-state"><strong>정보를 불러오는 중입니다.</strong></div>';
  return state.viewError?'<div class="notice" role="alert">'+h(state.viewError)+'</div>':'';
}
function renderLiveBackups(){
  const list=state.backups;
  const stopped=server()?.status==="stopped";
  const total=list.reduce((sum,x)=>sum+(Number(x.size)||0),0);
  return header("백업","서버 월드와 파일을 실제 폴더 스냅샷으로 보관합니다",
    button(icon("plus","small")+" 새 백업","backup-create","primary",stopped?"":"disabled"))+
    liveViewStatus()+
    '<div class="grid-stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">'+
      '<div class="card stat-card"><span>백업 개수</span><strong>'+list.length+'</strong></div>'+
      '<div class="card stat-card"><span>총 백업 크기</span><strong>'+fileSize(total)+'</strong></div></div>'+
    card("백업 목록",'<div class="info-list">'+(list.map(b=>
      '<div class="info-line"><div><strong>'+h(b.id)+'</strong><p>'+h(new Date(b.createdAt).toLocaleString("ko-KR"))+
      ' · '+h(b.files)+'개 파일</p></div><span class="right">'+fileSize(b.size)+'</span>'+
      button("복원","backup-restore","small",'data-id="'+h(b.id)+'" '+(stopped?'':'disabled'))+
      button("삭제","backup-delete","danger",'data-id="'+h(b.id)+'"')+'</div>').join("")||
      '<div class="empty-state"><strong>백업이 없습니다.</strong><p>새 백업을 생성해 보세요.</p></div>')+'</div>')+
    '<div class="notice">백업 생성과 복원은 서버가 중지된 상태에서만 가능합니다. 예약 백업은 자동으로 서버를 중지·재시작하므로 접속 중단이 발생할 수 있습니다.</div>';
}
function renderJarUpgrade(st){
  if(!st || !["paper","folia","purpur","leaf","velocity"].includes(st.template))return "";
  const stopped=server()?.status==="stopped";
  const disabled=stopped?"":"disabled";
  return card("공식 서버 JAR 업데이트",
    '<p class="hint">현재 '+h(st.template)+' '+h(st.installedVersion||"버전 정보 없음")+
    ' · 업데이트는 서버를 중지한 뒤 진행하며, 이전 JAR은 롤백용으로 보관됩니다.</p>'+
    '<form id="jar-upgrade-form" class="stack" style="margin-top:18px">'+
      '<div class="form-group"><label for="jar-upgrade-version">설치할 안정 버전</label>'+
      '<select id="jar-upgrade-version" name="version" class="select" required '+disabled+'>'+
        '<option value="">버전 목록을 불러오세요</option></select></div>'+
      '<div class="page-actions">'+
        button("공식 버전 확인","jar-versions-load","",disabled)+
        '<button class="btn primary" type="submit" '+disabled+'>검증 후 JAR 교체</button>'+
      '</div></form>'+
    (st.rollbackVersion?'<div class="info-line" style="margin-top:16px"><span>이전 버전: '+h(st.rollbackVersion)+
      '</span>'+button("이전 JAR로 롤백","jar-rollback","danger",disabled)+'</div>':"")+
    '<p class="hint">Java 프로세스를 자동으로 재시작하지 않습니다. 월드 호환성을 확인하고 중요한 데이터는 별도 백업하세요.</p>');
}
// Mirrors defaultStartCommand and splitCommand in go_java.go.
const DEFAULT_START_COMMAND = "{java} -Xms512M -Xmx{memory}M -Dterminal.jline=false -Dterminal.ansi=true -jar {jar} nogui";
function previewCommand(values){
  const template=String(values.command||"").trim()||DEFAULT_START_COMMAND;
  const java=values.java||"java";
  const fill={"{java}":java,"{memory}":String(values.memory||""),"{jar}":values.jar||"server.jar","{port}":String(values.port||"")};
  const args=[];let current="",quoted=false,inArg=false;
  for(const ch of template){
    if(ch==='"'){quoted=!quoted;inArg=true;}
    else if(!quoted&&(ch===" "||ch==="\t")){if(inArg){args.push(current);current="";inArg=false;}}
    else{current+=ch;inArg=true;}
  }
  if(inArg)args.push(current);
  return args.map(arg=>arg.replace(/\{java\}|\{memory\}|\{jar\}|\{port\}/g,(k)=>fill[k]))
    .map(arg=>/\s/.test(arg)?'"'+arg+'"':arg).join(" ");
}
function startupFormValues(){
  const st=state.startupLive||{};
  return {java:$("#live-java")?.value??st.javaBin,command:$("#live-command")?.value??st.startCommand,
    memory:$("#live-memory")?.value??st.memoryMb,jar:$("#live-jar")?.value??st.jar,port:st.port};
}
async function detectJavaInstalls(){
  if(state.mode!=="live"||state.javaLoading)return;
  state.javaLoading=true;
  const list=$("#java-list");if(list)list.innerHTML='<p class="hint">설치된 Java를 찾는 중입니다…</p>';
  try{
    const result=await apiRequest("/java",{timeoutMs:30000});
    state.javaInstalls=Array.isArray(result.installations)?result.installations:[];
  }catch(e){state.javaInstalls=[];toast(e.message);}
  finally{
    state.javaLoading=false;
    const host=$("#java-list");if(host)host.innerHTML=renderJavaList();
  }
}
function renderJavaList(){
  const list=state.javaInstalls;
  if(list===null||state.javaLoading)return '<p class="hint">설치된 Java를 찾는 중입니다…</p>';
  if(!list.length)return '<p class="hint">설치된 Java를 찾지 못했습니다. 실행 파일 경로를 직접 입력하세요.</p>';
  const current=$("#live-java")?.value??state.startupLive?.javaBin??"";
  return list.map(j=>'<button type="button" class="java-option '+(current===j.path?'active':'')+'" data-action="java-pick" data-path="'+h(j.path)+'">'+
    '<span class="java-head"><strong>Java '+h(j.version||"?")+'</strong><small>'+h(j.source==="검색"?"자동 검색":j.source)+'</small></span>'+
    '<span class="mono java-path" title="'+h(j.path)+'">'+h(j.path)+'</span></button>').join("");
}
function renderLiveStartup(){
  const st=state.startupLive;
  if(!st)return header("시작 설정","Java, 실행 명령어, 메모리, 자동 재시작")+liveViewStatus()+'<div class="card empty-state">서버 설정을 불러올 수 없습니다.</div>';
  return header("시작 설정","Java, 실행 명령어, 메모리, 자동 재시작 · 변경 사항은 다음 시작부터 적용됩니다")+liveViewStatus()+
    '<form id="startup-form" class="stack">'+
    '<section class="card settings-card"><h2>기본</h2><div class="field-grid">'+
      inputRow("live-name","서버 이름",st.name)+
      inputRow("live-memory","최대 메모리 (MiB) · {memory}",st.memoryMb,"number")+
      inputRow("live-jar","서버 JAR 이름 · {jar}",st.jar)+
      '<div class="form-group"><label for="live-port">접속 포트 · {port}</label><input id="live-port" class="field" type="number" value="'+h(st.port)+'" readonly></div>'+
    '</div></section>'+
    '<section class="card settings-card"><div class="card-title"><h2>Java 런타임 · {java}</h2>'+button("다시 찾기","java-detect","small")+'</div>'+
      '<div class="form-group"><label for="live-java">Java 실행 파일 경로</label>'+
      '<input class="field mono" id="live-java" name="live-java" value="'+h(st.javaBin||"")+'" placeholder="비워 두면 패널 기본 Java 사용" autocomplete="off"></div>'+
      '<div class="java-list" id="java-list">'+renderJavaList()+'</div></section>'+
    '<section class="card settings-card"><div class="card-title"><h2>실행 명령어</h2>'+button("기본값으로","startup-command-reset","small")+'</div>'+
      '<div class="form-group"><label for="live-command">명령어 (비워 두면 기본값)</label>'+
      '<input class="field mono" id="live-command" name="live-command" value="'+h(st.startCommand||"")+'" placeholder="'+h(DEFAULT_START_COMMAND)+'" autocomplete="off" spellcheck="false"></div>'+
      '<p class="hint">{java} {memory} {jar} {port} 값이 자동으로 채워집니다. 공백이 들어간 인자는 "큰따옴표"로 감싸세요. 셸을 거치지 않으므로 &amp;&amp;, | 같은 셸 문법은 쓸 수 없습니다 (필요하면 bash start.sh 처럼 스크립트를 실행하세요).</p>'+
      '<div class="form-group"><label>실제 실행될 명령</label><div class="command-preview mono" id="command-preview">'+h(previewCommand(startupFormValues()))+'</div></div></section>'+
    '<section class="card settings-card"><h2>동작</h2>'+
      '<label class="checkbox-label"><input name="live-eula" type="checkbox" '+(st.eulaAccepted?'checked':'')+'> Minecraft EULA 동의</label>'+
      '<label class="checkbox-label" style="margin-top:12px"><input name="live-auto-restart" type="checkbox" '+(st.autoRestart?'checked':'')+'> 서버가 종료되면 자동으로 다시 시작</label>'+
      '<p class="hint">패널의 중지 버튼이나 콘솔의 stop 명령으로 멈춘 경우는 다시 시작하지 않습니다. 10분 안에 3번 연속 종료되면 자동 재시작을 멈춥니다.</p></section>'+
    '<div class="page-actions"><button class="btn primary" type="submit">시작 설정 저장</button></div></form>'+
    renderJarUpgrade(st);
}
const PORT_STATES = {
  open:["running","열림 · 응답 중"], waiting:["warning","서버 시작 대기"], closed:["stopped","닫힘 (서버 꺼짐)"],
  occupied:["danger","다른 프로그램이 사용 중"], unknown:["stopped","확인 불가 (UDP)"]
};
function renderLiveNetwork(){
  const net=Array.isArray(state.network)?null:state.network;
  const s=server();
  if(!net)return header("네트워크","포트, 접속 주소, 연결 상태")+liveViewStatus();
  const main=net.ports?.[0];
  const addresses=(net.addresses||[]).filter(a=>!a.ipv6);
  const connect=[["127.0.0.1","이 컴퓨터"],...addresses.map(a=>[a.ip,a.kind==="lan"?"같은 네트워크(LAN)":a.kind==="vpn"?"VPN·CGNAT (Tailscale 등)":"공인 IP"])]
    .map(([ip,label])=>{const value=ip+(main&&main.port!==25565?":"+main.port:"");
      return '<div class="info-line"><div><strong class="mono">'+h(value)+'</strong><p>'+h(label)+'</p></div>'+
        button("복사","copy-text","small",'data-text="'+h(value)+'"')+'</div>';}).join("");
  const rows=(net.ports||[]).map(p=>{const [cls,label]=PORT_STATES[p.state]||PORT_STATES.unknown;
    return '<tr><td class="mono">'+h(p.port)+'</td><td>'+h(p.protocol)+'</td><td>'+h(p.description)+
      (p.conflict?'<p class="hint">\''+h(p.conflict)+'\' 서버와 겹침</p>':'')+'</td>'+
      '<td><span class="status '+cls+'"><i class="indicator"></i>'+h(label)+'</span></td></tr>';}).join("");
  const st=net.status;
  const live=st?'<div class="grid-stats net-stats">'+
      [["응답 시간",st.latencyMs+" ms","로컬 상태 조회"],["접속 인원",st.players+" / "+st.maxPlayers,"현재 플레이어"],
       ["버전",st.version||"—","서버가 알린 버전"],...(net.onlineMode?[["정품 인증",net.onlineMode==="false"?"꺼짐":"켜짐","online-mode"]]:[])]
      .map(([t,v,n])=>'<div class="card stat-card"><span>'+h(t)+'</span><strong>'+h(v)+'</strong><small>'+h(n)+'</small></div>').join("")+'</div>':
    '<div class="notice">'+(net.running?"서버가 아직 상태 조회(핑)에 응답하지 않았습니다. 시작이 끝나면 표시됩니다.":"서버가 꺼져 있어 접속 상태를 확인할 수 없습니다.")+'</div>';
  return header("네트워크","포트, 접속 주소, 연결 상태",button(icon("refresh","small")+" 새로고침","network-refresh"))+
    liveViewStatus()+
    (net.warnings||[]).map(w=>'<div class="notice" role="alert">'+h(w)+'</div>').join("")+
    live+
    '<div class="two-col net-layout">'+
      card("포트",'<div class="table-scroll"><table class="data-table compact-table"><thead><tr><th>포트</th><th>프로토콜</th><th>용도</th><th>상태</th></tr></thead><tbody>'+rows+'</tbody></table></div>')+
      card("접속 주소",'<div class="info-list">'+connect+'</div>')+
    '</div>'+
    '<form class="card settings-card net-port-form" id="port-form"><h2>게임 포트 변경</h2><div class="inline-form">'+
      '<input class="field" id="new-port" name="port" type="number" min="1024" max="65535" required value="'+h(main?.port||"")+'">'+
      '<button class="btn primary" type="submit" '+(s?.status==="stopped"?'':'disabled')+'>포트 변경</button></div>'+
      '<p class="hint">'+(s?.status==="stopped"?'':'서버를 중지해야 변경할 수 있습니다. ')+
      (s?.template==="velocity"?'Velocity는 실행 명령어의 --port {port} 로 적용됩니다.':'server.properties의 server-port도 함께 바뀝니다.')+
      ' 외부 접속에는 공유기 포트 포워딩과 방화벽 허용이 필요합니다.</p></form>';
}
function renderLiveSchedules(){
  return header("예약 작업","한국 시간 기준 매일 또는 지정 요일에 백업·재시작")+liveViewStatus()+
    '<div class="two-col" style="grid-template-columns:minmax(0,1.5fr) minmax(285px,1fr)">'+
    card("예약 목록",'<div class="info-list">'+(state.schedules.map(item=>
      '<div class="info-line"><div><strong>'+h(item.name)+'</strong><p>'+
      h(item.cron)+' · '+h(item.type==="backup"?"백업":"재시작")+
      '</p></div>'+button("삭제","schedule-delete","small",'data-id="'+h(item.id)+'"')+
      '</div>').join("")||'<div class="empty-state">예약 작업이 없습니다.</div>')+'</div>')+
    '<form class="card settings-card" id="schedule-form"><h2>새 예약 작업</h2><div class="stack">'+
      inputRow("schedule-name","작업 이름","야간 백업")+
      inputRow("schedule-cron","실행식 (예: 매일 오전 3시)","0 3 * * *")+
      '<div class="form-group"><label>작업</label><select class="select" name="schedule-type" id="schedule-type">'+
      '<option value="backup">백업</option><option value="restart">재시작</option></select></div>'+
      '<button class="btn primary" type="submit">예약 추가</button></div></form></div>'+
    '<p class="hint">지원 형식: 분 시 * * * 또는 분 시 * * 요일(0=일요일). 패널 프로세스가 실행 중이어야 예약이 실행됩니다.</p>';
}
function renderLiveHealth(){
  const status=state.health;
  return header("상태 확인","관리 프로세스에서 확인한 실제 Java 프로세스 상태",
    button(icon("refresh","small")+" 새로고침","health-check"))+
    liveViewStatus()+
    (!status?'<div class="card empty-state">상태 정보를 확인할 수 없습니다.</div>':
      card("실행 상태",'<div class="info-list">'+
        '<div class="info-line"><strong>Java 프로세스</strong><span class="right">'+h(status.status||"unknown")+'</span></div>'+
        '<div class="info-line"><strong>CPU (전체 코어 대비)</strong><span class="right">'+
          (status.cpu==null?'측정 중':Number(status.cpu).toFixed(1)+' %')+'</span></div>'+
        '<div class="info-line"><strong>메모리 (RSS)</strong><span class="right">'+
          (status.memoryGb==null?'측정 중':Number(status.memoryGb).toFixed(2)+' GB')+'</span></div>'+
        '<div class="info-line"><strong>실행 시간</strong><span class="right">'+h(status.uptime||"—")+'</span></div>'+
      '</div>'))+
    '<p class="hint">TPS, MSPT, 플레이어 수는 서버용 데이터 수집 플러그인 또는 별도 API가 연결되어야 실제 측정할 수 있습니다.</p>';
}
function passwordRow(name,label,autocomplete="new-password"){
  return '<div class="form-group"><label for="'+h(name)+'">'+h(label)+'</label>'+
    '<input class="field" id="'+h(name)+'" name="'+h(name)+'" type="password" maxlength="4096" autocomplete="'+autocomplete+'" required></div>';
}
function renderLiveUsers(){
  const list=state.users||[];
  return header("계정","패널에 로그인할 수 있는 계정을 관리합니다")+liveViewStatus()+
    '<div class="two-col users-layout">'+
    card("계정 목록",'<div class="info-list">'+(list.map(u=>
      '<div class="info-line"><div><strong>'+h(u.username)+(u.username===state.username?' <span class="status running">현재 계정</span>':'')+'</strong>'+
      '<p>생성 '+h(u.created?new Date(u.created).toLocaleString("ko-KR"):"—")+'</p></div>'+
      (u.username===state.username?'':button("삭제","user-delete","small danger",'data-name="'+h(u.username)+'"'))+'</div>').join("")||
      '<div class="empty-state">계정 목록을 불러오는 중입니다.</div>')+'</div>')+
    '<div class="stack">'+
      '<form class="card settings-card" id="user-create-form"><h2>새 계정</h2><div class="stack">'+
        '<div class="form-group"><label for="new-username">아이디 (영문·숫자·_ - . 3~32자)</label><input class="field" id="new-username" name="new-username" minlength="3" maxlength="32" autocomplete="off" required></div>'+
        passwordRow("new-user-password","비밀번호 (12자 이상)")+
        '<button class="btn primary" type="submit">계정 만들기</button></div></form>'+
      '<form class="card settings-card" id="password-form"><h2>내 비밀번호 변경</h2><div class="stack">'+
        passwordRow("current-password","현재 비밀번호","current-password")+
        passwordRow("next-password","새 비밀번호 (12자 이상)")+
        '<button class="btn" type="submit">비밀번호 변경</button></div></form>'+
    '</div></div>'+
    '<p class="hint">모든 계정은 같은 관리 권한을 가집니다. 계정을 삭제하면 그 계정의 로그인 세션도 즉시 끊어집니다.</p>';
}
function renderLiveAudit(){
  const entries=state.audit||[];
  return header("감사 로그","실제 관리자 작업 기록")+liveViewStatus()+
  card("최근 작업",'<div class="table-scroll"><table class="data-table"><thead><tr><th>시각</th><th>작업</th><th>대상</th></tr></thead><tbody>'+
    (entries.map(x=>'<tr><td>'+h(new Date(x.time).toLocaleString("ko-KR"))+'</td><td>'+h(x.action)+'</td>'+
      '<td>'+h(x.serverId||"패널")+'</td></tr>').join("")||
      '<tr><td colspan="3" class="empty-state">아직 기록된 작업이 없습니다.</td></tr>')+
    '</tbody></table></div>');
}

function renderBackups() {
  if (state.mode === "live") return renderLiveBackups();
  const stats = [["복구 가능한 백업","8개","전체 백업 기록"],["전체 보관 크기","14.8 GB","백업 파일 합계"],["마지막 백업","3분 전","정상 완료"]];
  return `${header("백업","백업을 생성하고 원하는 시점으로 서버를 복구합니다",button(`${icon("plus","small")} 새 백업`,"backup-create","primary"))}
    <div class="grid-stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">${stats.map(([label,value,desc]) =>
    `<div class="card stat-card"><span>${label}</span><strong>${value}</strong><small>${desc}</small></div>`).join("")}</div>
    ${card("백업 기록",`<div class="info-list">${DEMO_BACKUPS.map((b) => `<div class="info-line">
      <div><strong>${h(b.title)}</strong><p><span style="color:var(--success)">${h(b.status)}</span> · ${h(b.when)}</p></div>
      <span class="right">${h(b.size)}</span>
      ${button("복원","backup-restore","small",`data-id="${h(b.id)}"`)}</div>`).join("")}</div>`)}
    <div class="notice">백업 복원은 현재 월드 데이터를 이전 시점으로 바꿀 수 있는 작업입니다. 실제 연결 시 작업 전 확인 절차가 필요합니다.</div>
    ${demoNote()}`;
}
function inputRow(name,label,value,type="text") {
  return `<div class="form-group"><label for="${h(name)}">${h(label)}</label>
    <input class="field" id="${h(name)}" name="${h(name)}" type="${type}" value="${h(value)}" autocomplete="off"></div>`;
}
function renderStartup() {
  if (state.mode === "live") return renderLiveStartup();
  const st = state.startup;
  return `${header("시작 설정","실행 파일과 시작 옵션을 변경합니다")}
  <form id="startup-form" class="stack">
    <div class="card settings-card"><h2>프로세스 실행 설정</h2>
      <div class="field-grid">
        ${inputRow("executable","실행 프로그램",st.executable)}
        ${inputRow("directory","작업 디렉터리",st.directory)}
        ${inputRow("memory","메모리 제한 (MiB)",st.memory,"number")}
        ${inputRow("timeout","종료 대기 시간 (초)",st.timeout,"number")}
        ${inputRow("arguments","실행 인자",st.arguments)}
      </div></div>
    <div class="card settings-card"><h2>프로세스 정책</h2>
      <div class="info-line"><div><strong>자동 재시작</strong><p>서버 프로세스가 비정상 종료된 경우 다시 시작합니다.</p></div>
        <label class="checkbox-label"><input type="checkbox" name="autoRestart" ${st.autoRestart?"checked":""}>사용</label></div></div>
    <div class="page-actions" style="justify-content:flex-end">${button("변경 사항 저장","startup-save","primary",`type="submit"`)}</div>
  </form>${demoNote()}`;
}
function renderNetwork() {
  if (state.mode === "live") return renderLiveNetwork();
  const rows = [
    ["25565","TCP","마인크래프트 기본 접속 포트","사용 중"],
    ["8123","TCP","Dynmap 웹 접속 주소","사용 중"]
  ];
  return `${header("네트워크","서버에 할당된 포트를 관리하고 충돌을 확인합니다",button(`${icon("plus","small")} 포트 추가`,"network-add","primary"))}
    ${card("포트 할당",`<div class="table-scroll"><table class="data-table">
      <thead><tr><th>포트</th><th>프로토콜</th><th>설명</th><th>상태</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="mono">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td><span class="status running">${r[3]}</span></td></tr>`).join("")}
      </tbody></table></div>`)}
    <div style="margin-top:22px">${card("충돌 검사",`<div class="info-list"><div class="info-line"><div><strong style="color:var(--success)">${icon("check","small")} 포트 충돌 없음</strong>
      <p>등록된 서버 사이에서 포트가 중복되지 않는지 검사합니다.</p></div>
      ${button("다시 검사","health-check")}</div></div>`)}</div>${demoNote()}`;
}
function renderSchedules() {
  if (state.mode === "live") return renderLiveSchedules();
  return `${header("예약 작업","백업과 유지보수 작업을 예약해 자동 실행합니다")}
    <div class="two-col" style="grid-template-columns:minmax(0,1.5fr) minmax(285px,1fr)">
      ${card("예약된 작업",`<div class="info-list">
        ${state.schedules.map((s) => `<div class="info-line"><div><strong>${h(s.name)}</strong><p>${h(s.when)} · ${h(s.type)}</p></div>
          <span class="status ${s.active?"running":"stopped"}">${s.active?"사용":"일시 중지"}</span></div>`).join("")}
        </div>`)}
      <form class="card settings-card" id="schedule-form"><h2>새 예약 작업</h2>
        <div class="stack">
          ${inputRow("schedule-name","작업 이름","야간 자동 백업")}
          ${inputRow("schedule-cron","예약 실행식","0 3 * * *")}
          <div class="form-group"><label for="schedule-type">작업 유형</label><select class="select" id="schedule-type" name="schedule-type">
            <option>백업</option><option>재시작</option><option>명령 전송</option></select></div>
          <div class="page-actions" style="justify-content:flex-end"><button type="submit" class="btn primary">예약 추가</button></div>
        </div></form></div>${demoNote()}`;
}
function renderHealth() {
  if (state.mode === "live") return renderLiveHealth();
  return `${header("상태 확인","프로세스와 자동 복구 정책을 확인합니다",button(`${icon("refresh","small")} 다시 검사`,"health-check"))}
    <section class="card overview-head"><span class="server-glyph" style="background:var(--success-soft);color:var(--success)">${icon("check","large")}</span>
      <div class="overview-title"><h2>모든 검사 정상</h2><p>마지막 검사 11초 전 · 상태 감시 사용 중 (예시)</p></div><span class="status running">정상</span></section>
    <div class="grid-stats">
      ${[["프로세스","실행 중","상태 정상"],["TCP 연결","정상","25565 포트 응답"],["연속 실패","0회","최근 오류 없음"],["자동 재시작","사용","충돌 발생 시 복구"]].map(([title,value,detail]) =>
        `<div class="card stat-card"><span>${title}</span><strong>${value}</strong><small>${detail}</small></div>`).join("")}
    </div>${card("감시 정책",`<div class="info-list">
      ${[["상태 감시","서버 프로세스를 주기적으로 확인","사용 중"],["TCP 검사 포트","25565","정상"],["검사 간격","30초","자동"],["자동 재시작","비정상 종료 시 복구","사용 중"]].map(([label,detail,stateName]) =>
        `<div class="info-line"><div><strong>${label}</strong><p>${detail}</p></div><span class="right">${stateName}</span></div>`).join("")}
      </div>`)}${demoNote()}`;
}
function renderUsers() {
  if (state.mode === "live") return renderLiveUsers();
  return `${header("사용자","사용자와 서버별 권한을 확인합니다",button(`${icon("plus","small")} 사용자 초대`,"user-invite","primary"))}
    ${card("워크스페이스 사용자",`<div class="table-scroll"><table class="data-table"><thead><tr>
      <th>사용자</th><th>권한</th><th>접근 범위</th></tr></thead><tbody>
      ${DEMO_USERS.map((u) => `<tr><td><strong>${h(u.name)}</strong></td><td>${h(u.role)}</td><td>${h(u.scope)}</td></tr>`).join("")}
      </tbody></table></div>`)}${demoNote()}`;
}
function renderAudit() {
  if (state.mode === "live") return renderLiveAudit();
  return `${header("감사 로그","서버와 패널의 주요 작업 기록을 확인합니다",button(`${icon("download","small")} 내보내기`,"audit-export"))}
    ${card("최근 감사 기록",`<div class="table-scroll"><table class="data-table"><thead><tr>
      <th>시각</th><th>작업</th><th>사용자</th><th>대상</th></tr></thead><tbody>
      ${DEMO_AUDIT.map((entry) => `<tr><td class="mono">${h(entry.time)}</td><td>${h(entry.action)}</td>
        <td>${h(entry.actor)}</td><td>${h(entry.target)}</td></tr>`).join("")}
      </tbody></table></div>`)}${demoNote()}`;
}
function renderSettings() {
  if(state.mode==="live")return header("패널 설정","브라우저에 적용되는 표시 옵션과 보안 안내",button("메모리 상태 새로고침","diagnostics-refresh"))+
    card("화면 설정",'<div class="info-list"><div class="info-line"><div><strong>어두운 테마</strong>'+
      '<p>브라우저에만 저장되는 화면 설정입니다.</p></div>'+
      '<button class="switch '+(state.theme==="dark"?"on":"")+'" role="switch" type="button" aria-checked="'+(state.theme==="dark")+'" aria-label="다크 모드" data-action="theme-toggle"></button></div></div>')+
    card("계정 보안",'<div class="info-list"><div class="info-line"><div><strong>'+h(state.username)+' 계정으로 로그인됨</strong>'+
      '<p>세션 만료 시간은 8시간입니다. 계정 추가·삭제와 비밀번호 변경은 계정 메뉴에서 할 수 있습니다.</p></div>'+
      button("로그아웃","logout")+'</div></div>')+
    (state.diagnostics?card("Go 패널 메모리·성능 진단",
      '<div class="info-list">'+
      '<div class="info-line"><strong>패널 프로세스 메모리 (RSS)</strong><span class="right">'+
        (state.diagnostics.processRSSGb==null?"측정 불가":(Number(state.diagnostics.processRSSGb)*1024).toFixed(1)+" MB")+'</span></div>'+
      '<div class="info-line"><strong>Go 힙 사용량</strong><span class="right">'+fileSize(state.diagnostics.goHeapBytes)+'</span></div>'+
      '<div class="info-line"><strong>Go 런타임 전체 예약</strong><span class="right">'+fileSize(state.diagnostics.goTotalSysBytes)+'</span></div>'+
      '<div class="info-line"><strong>메모리 소프트 제한</strong><span class="right">'+
        (Number(state.diagnostics.memoryLimitBytes)>1e15?"미설정":fileSize(state.diagnostics.memoryLimitBytes))+'</span></div>'+
      '<div class="info-line"><strong>관리 중인 Java 프로세스</strong><span class="right">'+h(state.diagnostics.managedProcesses)+'</span></div>'+
      '<div class="info-line"><strong>메모리 로그 수</strong><span class="right">'+h(state.diagnostics.logEntries)+'</span></div>'+
      '<div class="info-line"><strong>실시간 로그 연결</strong><span class="right">'+h(state.diagnostics.logSubscribers)+'</span></div>'+
      '<div class="info-line"><strong>GC 실행 횟수</strong><span class="right">'+h(state.diagnostics.goGCCycles)+'</span></div>'+
      '</div>'):'')+
    '<p class="hint">Go 런타임 통계는 Java RSS와 다른 값입니다. 서버별 격리 및 실제 Java 전체 메모리 제한은 아직 제공하지 않습니다.</p>';
  const st = state.settings;
  return `${header("설정","브라우저 화면 설정을 관리합니다. 서버 정책은 변경되지 않습니다")}
    <form id="settings-form" class="stack"><section class="card settings-card"><h2>기본 설정</h2>
      <div class="field-grid">
        ${inputRow("panelName","패널 이름",st.panelName)}
        ${inputRow("timezone","시간대",st.timezone)}
        ${inputRow("sessionHours","세션 유효 시간 (시간)",st.sessionHours,"number")}
        ${inputRow("retention","백업 보관 기간 (일)",st.retention,"number")}
      </div></section>
      <section class="card settings-card"><h2>화면 표시</h2>
        <div class="info-line"><div><strong>어두운 테마</strong><p>패널 전체에 차분한 다크 모드를 적용합니다.</p></div>
          <button class="switch ${state.theme==="dark"?"on":""}" role="switch" type="button" aria-checked="${state.theme==="dark"}" aria-label="다크 모드" data-action="theme-toggle"></button></div>
        <div class="info-line"><div><strong>감사 기록</strong><p>관리 작업을 추적하기 위한 기록입니다. 실제 기록은 서버에서 관리해야 합니다.</p></div>
          <span class="right">백엔드 연결 필요</span></div>
      </section><div class="page-actions" style="justify-content:flex-end"><button type="submit" class="btn primary">설정 저장</button></div>
    </form>${demoNote()}`;
}
function renderPage() {
  switch (state.route) {
    case "dashboard": return renderDashboard();
    case "servers": return renderServers();
    case "overview": return renderOverview();
    case "console": return renderConsole();
    case "files": return renderFiles();
    case "backups": return renderBackups();
    case "startup": return renderStartup();
    case "network": return renderNetwork();
    case "schedules": return renderSchedules();
    case "health": return renderHealth();
    case "users": return renderUsers();
    case "audit": return renderAudit();
    case "settings": return renderSettings();
    default: return renderDashboard();
  }
}

function modalBody() {
  if (!state.modal) return "";
  const m = state.modal;
  const actions = (primaryLabel, action, variant = "primary") => `<div class="modal-actions">
    <button class="btn" data-action="modal-close">취소</button>
    <button class="btn ${variant}" data-action="${action}">${primaryLabel}</button></div>`;
  if (m.kind === "switcher") return `<div class="modal-scrim" data-action="modal-background">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">서버 선택</h2><p>관리할 서버를 선택하세요.</p>
      <div class="stack">${state.servers.map((s) => `<button class="btn" style="justify-content:space-between;width:100%;min-height:48px" data-action="choose-server" data-id="${h(s.id)}">
      <span>${h(s.name)}</span>${badge(s.status)}</button>`).join("")}</div>
      <div class="modal-actions" style="margin-top:22px"><button class="btn" data-action="modal-close">닫기</button></div>
    </div></div>`;
  if (m.kind === "palette") return `<div class="modal-scrim" data-action="modal-background"><div class="modal command-palette" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <h2 id="modal-title">기능 검색</h2>
    <input id="palette-search" class="field" placeholder="메뉴 검색" autocomplete="off" aria-label="기능 검색" value="${h(state.paletteQuery)}">
    <div id="palette-results" class="palette-results">${paletteItems()}</div>
    <div class="modal-actions"><button class="btn" data-action="modal-close">닫기</button></div>
  </div></div>`;
  if (m.kind === "create") return `<div class="modal-scrim" data-action="modal-background">
    <form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" id="create-server-form">
      <h2 id="modal-title">새 서버 추가</h2>
      <p>마인크래프트 서버의 기본 정보를 입력합니다. ${state.mode==="demo"?"추가되는 서버는 예시 목록에만 반영됩니다.":"서버 생성은 API에 요청됩니다."}</p>
      <div class="stack"><div class="form-group"><label for="new-server-name">서버 이름</label>
        <input id="new-server-name" name="server-name" class="field" maxlength="64" required placeholder="예: PvP Practice"></div>
      <div class="field-grid">
        <div class="form-group"><label for="new-server-port">접속 포트</label><input id="new-server-port" name="server-port" class="field" type="number" min="1024" max="65535" required value="25565"></div>
        <div class="form-group"><label for="new-server-memory">메모리 (MiB)</label><input id="new-server-memory" name="server-memory" class="field" type="number" min="512" max="32768" required value="2048"></div>
      </div>
      <div class="form-group"><label for="new-server-template">서버 템플릿</label>
        <select id="new-server-template" name="server-template" class="select">
          <option value="manual">직접 JAR 업로드 (Leaf · PmaPaper 등)</option>
          ${state.mode==="live"?'<option value="paper">Paper · 공식 안정 빌드</option><option value="purpur">Purpur · 공식 빌드 (MD5 검증)</option>'+
            '<option value="leaf">Leaf · GitHub 릴리스 (SHA-256 검증)</option><option value="folia">Folia · 공식 안정 빌드</option>'+
            '<option value="velocity">Velocity · 프록시 (공식 안정 빌드)</option>':''}
        </select></div>
      <div id="new-server-version-group" class="form-group" hidden>
        <label for="new-server-version">Minecraft 버전</label>
        <select id="new-server-version" name="server-version" class="select" disabled>
          <option value="">템플릿을 먼저 선택하세요</option>
        </select>
        <small class="hint" id="new-server-version-hint">PaperMC 공식 API에서 안정 빌드 버전을 확인합니다.</small>
      </div>
      <label class="checkbox-label"><input name="eula-accepted" type="checkbox" required>
        <span><a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noopener noreferrer">Minecraft EULA</a>를 읽고 동의합니다.</span></label>
      <p class="hint">Paper·Purpur·Leaf·Folia·Velocity는 공식 배포처에서 받은 JAR을 체크섬으로 검증해 자동 설치합니다. 그 밖의 서버는 생성 후 파일 화면에서 server.jar을 업로드하세요.</p></div>
      <div class="modal-actions" style="margin-top:25px"><button class="btn" type="button" data-action="modal-close">취소</button>
        <button class="btn primary" type="submit">서버 추가</button></div>
    </form></div>`;
  if (m.kind==="file-editor") return '<div class="modal-scrim" data-action="modal-background"><form class="modal file-edit-dialog" id="file-editor-form" role="dialog" aria-modal="true" aria-labelledby="modal-title">'+
    '<div class="editor-head"><h2 id="modal-title" class="mono">'+h(m.path)+'</h2><span class="editor-state '+(m.dirty?'dirty':'')+'" id="editor-state">'+(m.dirty?"수정됨":"저장됨")+'</span></div>'+
    '<div class="monaco-host" id="monaco-host" hidden></div>'+
    '<textarea class="file-editor" id="file-editor-text" name="content" spellcheck="false" wrap="off">'+h(m.content)+'</textarea>'+
    '<div class="modal-actions"><span class="hint">Ctrl+S 저장 · Tab 들여쓰기 · UTF-8 텍스트 (최대 1MiB) · 실행 중에도 저장할 수 있습니다</span><span class="toolbar-spacer"></span>'+
    '<button type="button" class="btn" data-action="modal-close">닫기</button>'+
    '<button class="btn primary" type="submit">저장</button></div></form></div>';
  if (m.kind==="file-mkdir" || m.kind==="file-rename" || m.kind==="file-new") {
    const formId={"file-mkdir":"folder-create-form","file-rename":"file-rename-form","file-new":"file-create-form"}[m.kind];
    const title={"file-mkdir":"새 폴더","file-rename":"이름 변경","file-new":"새 파일"}[m.kind];
    return '<div class="modal-scrim" data-action="modal-background">'+
    '<form class="modal" id="'+formId+'" role="dialog" aria-modal="true" aria-labelledby="modal-title">'+
    '<h2 id="modal-title">'+title+'</h2><p>'+h(state.filePath?"/"+state.filePath:"서버 루트")+' 폴더 안에 '+(m.kind==="file-rename"?"이름을 바꿉니다.":"만듭니다.")+'</p>'+
    '<div class="form-group"><label for="file-new-name">이름</label><input id="file-new-name" name="name" class="field" maxlength="100" required value="'+h(m.name||"")+'" autocomplete="off"></div>'+
    '<div class="modal-actions" style="margin-top:22px"><button type="button" class="btn" data-action="modal-close">취소</button>'+
    '<button type="submit" class="btn primary">확인</button></div></form></div>';
  }
  return `<div class="modal-scrim" data-action="modal-background"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <h2 id="modal-title">${h(m.title || "확인")}</h2><p>${h(m.description || "")}</p>
    ${state.mode==="demo" ? `<div class="demo-block" style="margin-bottom:20px">예시 모드입니다. 실제 서버나 파일은 변경되지 않습니다.</div>` : ""}
    ${actions(m.confirmLabel || "확인",m.confirmAction || "modal-close",m.danger?"danger":"primary")}
  </div></div>`;
}
function paletteItems() {
  const needle = state.paletteQuery.toLocaleLowerCase("ko").trim();
  const items = ROUTE_INFO.filter((r) => !needle || r.label.toLocaleLowerCase("ko").includes(needle));
  if (!items.length) return `<div class="empty-state">검색 결과가 없습니다.</div>`;
  return items.map((item) => `<button class="palette-item" data-action="palette-navigate" data-route="${h(item.route)}">
    ${icon(item.icon)}<span>${h(item.label)}</span>${icon("arrow","small")}</button>`).join("");
}
function renderLogin() {
  const setup = state.setupRequired;
  return '<main class="login-screen"><div class="login-brand"><strong>Panel</strong><small>마인크래프트 서버 관리</small></div>' +
    '<form class="login-card" id="'+(setup?'setup-form':'login-form')+'" autocomplete="on">' +
      (setup?'<h1>첫 계정 만들기</h1><p>아직 계정이 없습니다. 이 패널을 관리할 계정을 만드세요.</p>':
        '<h1>로그인</h1><p>패널 계정으로 로그인하세요.</p>') +
      '<div class="form-group"><label for="login-username">아이디</label>' +
        '<input class="field" id="login-username" name="username" minlength="3" maxlength="32" autocomplete="username" required autofocus></div>' +
      '<div class="form-group"><label for="login-password">비밀번호'+(setup?' (12자 이상)':'')+'</label>' +
        '<input class="field" id="login-password" name="password" type="password" maxlength="4096" '+(setup?'minlength="12" autocomplete="new-password"':'autocomplete="current-password"')+' required></div>' +
      (setup?'<div class="form-group"><label for="login-password2">비밀번호 확인</label>' +
        '<input class="field" id="login-password2" name="password2" type="password" minlength="12" maxlength="4096" autocomplete="new-password" required></div>':'') +
      (state.authError?'<div class="login-error" role="alert">'+h(state.authError)+'</div>':'') +
      '<button type="submit" class="btn primary login-submit">'+(setup?'계정 만들고 시작하기':'로그인')+'</button>' +
      '<small class="login-footnote">'+(setup?'첫 계정은 이 화면에서 한 번만 만들 수 있습니다. 이후 계정은 로그인 후 계정 메뉴에서 추가합니다.':
        'PANEL_ADMIN_PASSWORD로 운영하던 패널은 아이디 admin과 그 비밀번호로 로그인합니다.')+
      ' 이 연결은 '+(location.protocol==="https:"?"HTTPS":"로컬 접속")+'입니다.</small>' +
    '</form></main>';
}
async function bootstrapAuth() {
  if (!apiEnabled) return;
  try {
    const session=await getSession();
    state.authenticated=Boolean(session?.authenticated);
    state.username=session?.username || "";
    state.authError="";
  } catch(e) {
    state.authenticated=false;
    if(e?.status!==401) state.authError="인증 서버에 연결할 수 없습니다: "+e.message;
    else {
      try{state.setupRequired=Boolean((await apiRequest("/auth/setup"))?.required);}catch{state.setupRequired=false;}
    }
  } finally {
    state.authLoading=false;
    render();
    if(state.authenticated){startPolling();await loadFromApi();}
  }
}
function render() {
  document.title = routeTitle() + " · Panel";
  const app = $("#app");
  if (!app) return;
  if (apiEnabled && !state.authenticated) {
    app.innerHTML=state.authLoading?
      '<main class="login-screen"><div class="login-card"><h1>연결 확인 중</h1><p>관리자 세션을 확인하고 있습니다.</p></div></main>' :
      renderLogin();
    return;
  }
  let content = "";
  if (state.loading) {
    content = `<div class="card empty-state">${icon("refresh","large")}<strong>서버 정보를 불러오는 중입니다</strong><p>연결된 API에 요청하고 있습니다.</p></div>`;
  } else if (state.apiError && state.mode === "live" && !state.servers.length) {
    content = `<div class="card empty-state">${icon("alert","large")}<strong>서버 연결에 실패했습니다</strong><p>${h(state.apiError)}</p>
      <button class="btn" style="margin-top:18px" data-action="api-retry">다시 시도</button></div>`;
  } else content = renderPage();
  app.innerHTML = `<div class="app-shell">${renderSidebar()}<div class="main-shell">${renderChrome()}
    <main class="page ${state.route==="console"?"console-page":""}" id="main-content">${content}
      ${state.route!=="console"?`<div class="footer">Panel · ${state.mode==="demo"?"프런트엔드 시연":"서버 관리"} · <a href="https://github.com/Pma10/Panel" target="_blank" rel="noopener noreferrer">GitHub</a></div>`:""}
    </main></div></div><div id="modal-root">${modalBody()}</div><div id="toast-root" aria-live="polite"></div>`;
  if (state.modal?.kind === "file-editor") mountEditor();
  if (state.route === "console") scrollLogs(state.autoScroll);
  if (state.route === "servers") filterServerRows();
}
// Monaco is vendored under src/vendor/monaco and loaded only when a file is
// opened. The plain textarea stays as the form field and as a fallback.
const MONACO_BASE = "/src/vendor/monaco/vs";
let monacoPromise = null, activeEditor = null;
function loadMonaco() {
  if (window.monaco) return Promise.resolve(window.monaco);
  if (!monacoPromise) monacoPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = MONACO_BASE + "/editor/editor.main.css";
    document.head.appendChild(css);
    const script = document.createElement("script");
    script.src = MONACO_BASE + "/loader.js";
    script.onload = () => {
      window.require.config({ paths: { vs: location.origin + MONACO_BASE } });
      window.require(["vs/editor/editor.main"], () => resolve(window.monaco), reject);
    };
    script.onerror = () => reject(new Error("Monaco를 불러오지 못했습니다."));
    document.head.appendChild(script);
  }).catch((error) => { monacoPromise = null; throw error; });
  return monacoPromise;
}
const EDITOR_LANGUAGES = {
  yml:"yaml", yaml:"yaml", json:"json", json5:"json", mcmeta:"json", properties:"ini", ini:"ini", cfg:"ini", conf:"ini", toml:"ini",
  js:"javascript", mjs:"javascript", ts:"typescript", sh:"shell", bash:"shell", bat:"bat", cmd:"bat", ps1:"powershell",
  xml:"xml", html:"html", css:"css", md:"markdown", py:"python", java:"java", kt:"kotlin", lua:"lua", sql:"sql"
};
const editorLanguage = (path) => EDITOR_LANGUAGES[String(path).split(".").pop().toLowerCase()] || "plaintext";
function disposeEditor() { if (activeEditor) { activeEditor.dispose(); activeEditor = null; } }
async function mountEditor() {
  disposeEditor();
  const modal = state.modal;
  if (modal?.kind !== "file-editor" || typeof document.createElement !== "function") return;
  let monaco;
  try { monaco = await loadMonaco(); } catch (error) { toast(error.message + " 기본 편집기를 사용합니다."); return; }
  const host = $("#monaco-host"), area = $("#file-editor-text");
  if (state.modal !== modal || !host || !area) return;
  disposeEditor();
  host.hidden = false; area.hidden = true;
  activeEditor = monaco.editor.create(host, {
    value: area.value, language: editorLanguage(modal.path), theme: state.theme === "dark" ? "vs-dark" : "vs",
    automaticLayout: true, fontSize: 13, tabSize: 2, insertSpaces: true, scrollBeyondLastLine: false,
    minimap: { enabled: true }, renderWhitespace: "selection", wordWrap: "off"
  });
  // Mirror into the textarea so dirty tracking and form submit keep working.
  activeEditor.onDidChangeModelContent(() => {
    area.value = activeEditor.getValue();
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  activeEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => $("#file-editor-form")?.requestSubmit());
  activeEditor.focus();
}
function setModal(modal) {
  disposeEditor();
  state.modal = modal;
  const host = $("#modal-root");
  if (host) host.innerHTML = modalBody();
  if (modal?.kind === "file-editor") mountEditor();
  if (modal?.kind === "palette") {
    const input = $("#palette-search");
    input?.focus();
  } else if (modal?.kind === "create") $("#new-server-name")?.focus();
  else if (["file-rename","file-new","file-mkdir"].includes(modal?.kind)) $("#file-new-name")?.focus();
  else if (modal?.kind === "file-editor") $("#file-editor-text")?.focus();
  else if (modal) $("#modal-root .btn")?.focus();
}
function toast(message) {
  const host = $("#toast-root");
  if (!host) return;
  host.innerHTML = `<div class="toast" role="status">${h(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (host.isConnected) host.innerHTML = ""; }, 3500);
}
// Follow new output only while the reader is at the bottom, so scrolling up
// to read older lines is not yanked back down by the next log line.
function scrollLogs(force = false) {
  if (!force && !(state.autoScroll && state.stickLogs)) return;
  requestAnimationFrame(() => {
    const pane = $("#log-viewport");
    if (pane) pane.scrollTop = pane.scrollHeight;
  });
}
function updateLogRows() {
  const parent = $("#log-rows");
  if (!parent || state.route !== "console" || document.hidden) return;
  const rows = recentLogs(state.logs,state.query,state.level);
  const previous = shownLogs.rows;
  // Entries are objects appended at the end and dropped from the front, so the
  // last row shown before tells us exactly which rows are new.
  const last = previous.length ? rows.lastIndexOf(previous[previous.length-1]) : -1;
  const sameView = shownLogs.key === state.query + "\n" + state.level && last >= 0 &&
    parent.childElementCount === previous.length && previous.length > 0;
  if (sameView) {
    const added = rows.slice(last + 1);
    if (added.length) parent.insertAdjacentHTML("beforeend", added.map(renderLogRow).join(""));
    for (let extra = parent.childElementCount - rows.length; extra > 0; extra--) parent.firstElementChild.remove();
    shownLogs = { key: shownLogs.key, rows };
  } else parent.innerHTML = renderLogRows();
  const count = $("#log-count");
  if (count) count.textContent = rows.length + "줄 · 위로 스크롤해 이전 기록 보기";
  scrollLogs();
}
// Coalesce dense SSE traffic into at most one DOM update every 130ms.
// A background tab keeps bounded log history without touching its DOM.
function scheduleLogUpdate() {
  if (logRenderTimer !== null || state.route !== "console" || document.hidden) return;
  logRenderTimer = setTimeout(() => {
    logRenderTimer = null;
    updateLogRows();
  }, LOG_FLUSH_MS);
}
function cancelLogUpdate() {
  if (logRenderTimer !== null) clearTimeout(logRenderTimer);
  logRenderTimer = null;
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.route === "console") updateLogRows();
});
function filterServerRows() {
  const rows = $("#server-results");
  const pagination = $("#server-pagination");
  if (!rows || !pagination) return;
  const term = state.serverQuery.trim().toLocaleLowerCase("ko");
  const matches = state.servers.filter((item) =>
    (!term || (item.name + " " + item.kind + " " + item.id).toLocaleLowerCase("ko").includes(term)) &&
    (state.serverStatus === "all" || item.status === state.serverStatus)
  );
  const pageCount = Math.max(1,Math.ceil(matches.length / SERVER_PAGE_SIZE));
  state.serverPage = Math.max(0,Math.min(state.serverPage,pageCount-1));
  const start = state.serverPage * SERVER_PAGE_SIZE;
  rows.innerHTML = renderServerRows(matches.slice(start,start+SERVER_PAGE_SIZE),true);
  pagination.innerHTML = '<span>' + matches.length + '대 중 ' +
    (matches.length ? (start+1) : 0) + '–' + Math.min(start+SERVER_PAGE_SIZE,matches.length) + '대 표시</span>' +
    '<div class="pagination-buttons"><button class="btn small" data-action="server-page-prev" ' + (!state.serverPage ? 'disabled' : '') + '>이전</button>' +
    '<span>' + (state.serverPage+1) + ' / ' + pageCount + '</span>' +
    '<button class="btn small" data-action="server-page-next" ' + (state.serverPage+1>=pageCount ? 'disabled' : '') + '>다음</button></div>';
}
function navigate(route) {
  if (!routeMap[route]) return;
  state.mobileMenu = false;
  state.modal = null;
  if (location.hash !== "#/" + route) location.hash = "#/" + route;
  else { state.route = route; render();refreshRouteData(); }
}
function downloadText(filename, text) {
  const blob = new Blob([text],{ type:"text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function mockActionMessage(action) {
  const phrase = {
    "file-upload": "파일 업로드", "file-new-folder":"폴더 생성", "network-add":"포트 추가",
    "user-invite":"사용자 초대", "health-check":"상태 재검사"
  }[action] || "해당 작업";
  setModal({kind:"notice",title:phrase,description:state.mode === "demo" ?
    "이 작업은 현재 미리보기 UI에서 실제로 실행되지 않습니다. 백엔드 API 연동 후 사용할 수 있습니다." :
    "현재 작업은 연결된 백엔드에서 지원하도록 아직 구현되지 않았습니다.",
    confirmLabel:"닫기",confirmAction:"modal-close"});
}
function exportLogs() {
  const entries = filterLogs(state.logs,state.query,state.level);
  const rows = entries.map((row) => "["+row.time+" "+row.level+"] "+row.message.replace(/\x1b\[[0-9;]*[A-Za-z]/g,""));
  downloadText("pconn-"+state.selectedId+"-console.log",rows.join("\n")+"\n");
  toast("표시된 로그를 파일로 내보냈습니다.");
}
async function sendCommand() {
  const raw = $("#console-command")?.value ?? state.command;
  const command = validateCommand(raw);
  if (!command.valid) return toast(command.error);
  if (state.mode === "demo") {
    const now = new Date().toLocaleTimeString("ko-KR", { hour12:false });
    appendBoundedLog(state.logs,{time:now,level:"DEMO",message:"> "+command.value+" (실제 서버에 미전송)"});
    rememberCommand(command.value);
    state.command = "";
    const input = $("#console-command");
    if (input) input.value = "";
    updateLogRows();
    toast("예시 명령만 기록했습니다. 실제 서버에는 전송되지 않았습니다.");
    input?.focus();
    return;
  }
  if (commandPending) return;
  commandPending = true;
  const submit = $(".command-send");
  if (submit) submit.disabled = true;
  try {
    await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/commands",{method:"POST",body:{command:command.value}});
    rememberCommand(command.value);
    state.command = ""; if ($("#console-command")) $("#console-command").value = "";
    toast("명령어 전송 요청이 접수되었습니다.");
  } catch (error) { toast(error.message); }
  finally {
    commandPending = false;
    const button = $(".command-send");
    if (button) button.disabled = false;
  }
}
async function performPowerAction() {
  const action = state.modal?.power;
  if (!["stop","start","restart"].includes(action)) return;
  setModal(null);
  const s = server();if (!s) return;
  if (state.mode === "demo") {
    if (action === "stop") { s.status="stopped";s.players=0;s.memoryGb=0; }
    else { s.status="running"; }
    appendBoundedLog(state.logs,{time:new Date().toLocaleTimeString("ko-KR",{hour12:false}),level:"DEMO",
      message:"서버 "+({stop:"중지",start:"시작",restart:"재시작"}[action])+" UI 시뮬레이션 (실제 프로세스 변경 없음)"});
    toast("예시 상태만 변경했습니다. 실제 서버는 제어하지 않았습니다.");
    render(); return;
  }
  try {
    await apiRequest("/servers/"+encodeURIComponent(s.id)+"/actions/"+action,{method:"POST",timeoutMs:action==="restart"?50000:20000});
    toast("서버 작업 요청이 접수되었습니다."); await pollLiveStatus(true); schedulePoll();
  } catch (error) { toast(error.message); }
}
async function openTextFile(name){
  if(state.mode!=="live")return;
  try {
    const path=relativeFile(name);
    const result=await apiRequest(fileApi("/content?path="+encodeURIComponent(path)));
    setModal({kind:"file-editor",path,content:result.text,dirty:false});
    $("#file-editor-text")?.focus();
  } catch(e){toast(e.status===415?e.message+" 다운로드해서 확인하세요.":e.message);}
}
async function createBackup() {
  setModal(null);
  if (state.mode === "demo") return toast("예시 모드: 실제 백업을 생성하지 않았습니다.");
  toast("백업을 생성하는 중입니다. 서버 데이터 크기에 따라 시간이 걸릴 수 있습니다.");
  try {
    await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/backups",{method:"POST",timeoutMs:600000});
    toast("백업 완료");await refreshRouteData();
  }catch(e){toast(e.message);}
}
async function restoreBackup() {
  const id=state.modal?.id;setModal(null);
  if (!id)return;
  if (state.mode==="demo")return toast("예시 모드: 실제 백업 복원은 실행되지 않았습니다.");
  toast("백업을 복원하는 중입니다. 작업이 끝날 때까지 서버를 시작하지 마세요.");
  try {
    await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/backups/"+encodeURIComponent(id)+"/restore",{method:"POST",timeoutMs:600000});
    toast("백업 복원 완료");await refreshRouteData();
  }catch(e){toast(e.message);}
}
async function loadSelectedLogs() {
  const version = ++logFetchVersion;
  const selected = state.selectedId;
  state.logs = [];
  cancelLogUpdate();
  if (!selected) return;
  try {
    const response = await apiRequest("/servers/" + encodeURIComponent(selected) + "/logs");
    if (version !== logFetchVersion || selected !== state.selectedId) return;
    const entries = Array.isArray(response) ? response : response?.entries;
    state.logs = replaceLogHistory(entries);
  } catch (error) {
    if (version === logFetchVersion && selected === state.selectedId) {
      // Logs may fail independently; do not hide the working server list.
      state.logError = error?.message || "로그를 불러올 수 없습니다.";
    }
  }
}
async function switchSelectedServer(id,destination="overview") {
  if (!state.servers.some((s) => s.id === id)) return toast("해당 서버를 찾을 수 없습니다.");
  const changed = id !== state.selectedId;
  setModal(null);
  if (changed) {
    ++logFetchVersion;
    if (logClose) { logClose(); logClose = null; }
    state.selectedId = id;
    state.logs = state.mode === "demo" ? replaceLogHistory(DEMO_LOGS) : [];
    state.filePath = state.mode==="live"?"":"/home/minecraft/server";
    state.fileEntries=[];state.selectedFile="";state.backups=[];state.startupLive=null;state.network=[];state.health=null;state.schedules=[];
    state.logError = "";
    state.logLoading = state.mode === "live";
    cancelLogUpdate();
  }
  navigate(destination);
  if (changed && state.mode === "live") {
    await loadSelectedLogs();
    if (id !== state.selectedId) return;
    state.logLoading = false;
    render();
    connectLogStream();
  }
}
function normalizeLiveServer(it){
  return {...it,
    status:it.status||"unknown",
    players:it.players==null?null:Number(it.players),
    maxPlayers:it.maxPlayers==null?null:Number(it.maxPlayers),
    memoryGb:it.memoryGb==null?null:(Number(it.memoryGb)||0),
    memoryLimitGb:Number(it.memoryLimitGb)||Number(it.memoryMb||2048)/1024,
    cpu:it.cpu==null?null:Number(it.cpu),
    directory:it.directory||"—",version:it.version||"—",uptime:it.uptime||"—",
    tps:it.tps==null?null:(Number.isFinite(Number(it.tps))?Number(it.tps):null),
    mspt:it.mspt==null?null:(Number.isFinite(Number(it.mspt))?Number(it.mspt):null)
  };
}
// Status-only refresh: full re-render only on read-only pages without an open
// modal; elsewhere just the sidebar and console header so forms keep their input.
function refreshStatusChrome(){
  const side=$("#sidebar");if(side)side.outerHTML=renderSidebar();
  const host=$("#console-status-host");if(host)host.innerHTML=consoleStatus();
}
async function pollLiveStatus(force=false){
  if(!apiEnabled || !state.authenticated || state.loading)return;
  if(!force && (statusPolling || document.hidden))return;
  statusPolling=true;
  try{
    const result=await apiRequest("/servers");
    const items=Array.isArray(result)?result:result.servers;
    if(!Array.isArray(items))return;
    state.servers=items.filter(x=>x&&typeof x.id==="string"&&typeof x.name==="string").map(normalizeLiveServer);
    if(!state.modal && (["dashboard","overview"].includes(state.route) ||
       (state.route==="servers" && !["server-search","server-status"].includes(document.activeElement?.id)))){
      render();
    }else refreshStatusChrome();
  }catch(e){if(e?.status!==401)state.apiError=e.message;}
  finally{statusPolling=false;}
}
// Poll fast (2s) while any server is starting, stopping or waiting to restart.
let pollingActive=false;
function schedulePoll(){
  clearTimeout(statusRefreshTimer);
  if(!pollingActive)return;
  const busy=state.servers.some(s=>TRANSITIONAL.includes(s.status));
  statusRefreshTimer=setTimeout(async()=>{await pollLiveStatus();schedulePoll();},busy?2000:10000);
}
function startPolling(){
  if(pollingActive)return;
  pollingActive=true;schedulePoll();
}
function stopPolling(){
  pollingActive=false;
  clearTimeout(statusRefreshTimer);
  statusRefreshTimer=null;
}

async function loadFromApi() {
  if (!apiEnabled) return;
  const version = ++loadVersion;
  ++logFetchVersion;
  if (logClose) { logClose(); logClose = null; }
  cancelLogUpdate();
  state.loading = true;
  state.apiError = "";
  state.logError = "";
  state.logLoading = true;
  state.servers = [];
  state.logs = [];
  render();
  try {
    const value = await apiRequest("/servers");
    if (version !== loadVersion) return;
    const items = Array.isArray(value) ? value : value?.servers;
    if (!Array.isArray(items)) throw new Error("서버 응답 형식이 올바르지 않습니다.");
    state.servers = items.filter((it) => it && typeof it.id==="string" && typeof it.name==="string").map(normalizeLiveServer);
    if (!state.servers.some((s) => s.id === state.selectedId)) state.selectedId = state.servers[0]?.id || "";
    if (state.selectedId) await loadSelectedLogs();
  } catch (error) {
    if (version !== loadVersion) return;
    state.apiError = error?.message || "연결할 수 없습니다.";
    state.servers = [];
    state.logs = [];
  } finally {
    if (version === loadVersion) {
      state.loading = false;
      state.logLoading = false;
      render();
      connectLogStream();
      refreshRouteData();
    }
  }
}
function connectLogStream() {
  if (logClose) { logClose(); logClose = null; }
  if (!apiEnabled || !state.selectedId || state.route !== "console" ||
      state.apiError || state.loading || state.logLoading) return;
  const serverId = state.selectedId;
  logClose = streamLogs(serverId,(entry) => {
    if (state.selectedId !== serverId) return;
    if (appendBoundedLog(state.logs,entry)) scheduleLogUpdate();
  },() => {
    if (state.selectedId !== serverId) return;
    state.logError = "실시간 로그 연결이 불안정합니다.";
    const label = $(".console-status");
    if (label?.lastChild?.nodeType === 3) label.lastChild.textContent = "연결 오류";
  },async () => {
    if (state.selectedId !== serverId) return;
    // A dropped stream misses lines; reload the server-side history on reconnect.
    const resync = Boolean(state.logError);
    state.logError = "";
    const label = $(".console-status");
    if (label?.lastChild?.nodeType === 3) label.lastChild.textContent = "연결됨";
    if (resync) { await loadSelectedLogs(); updateLogRows(); }
  });
}
window.addEventListener("hashchange", async () => {
  const previous=state.route;
  state.route=routeFromHash(location.hash);state.mobileMenu=false;state.modal=null;
  cancelLogUpdate();render();
  // The stream only runs on the console page; reload what was printed meanwhile.
  if(state.route==="console" && previous!=="console" && state.mode==="live" && state.selectedId && !state.loading){
    if(logClose){logClose();logClose=null;}
    await loadSelectedLogs();
    if(state.route!=="console")return;
    state.stickLogs=true;updateLogRows();
  }
  connectLogStream();refreshRouteData(); window.scrollTo({top:0,behavior:"auto"});
});
function closeModal() {
  if (state.modal?.kind==="file-editor" && state.modal.dirty && !confirm("저장하지 않은 변경 사항이 있습니다. 닫을까요?")) return;
  setModal(null);
}
const typingTarget = (el) => el && (el.isContentEditable || ["INPUT","TEXTAREA","SELECT"].includes(el.tagName));
function fileShortcut(event) {
  if (state.route!=="files" || state.mode!=="live" || state.modal || typingTarget(event.target)) return false;
  const selected=[...state.fileSelection];
  if ((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==="a") {
    state.fileSelection=new Set(visibleFiles().map(f=>f.name));refreshFileSelection();return true;
  }
  if (event.key==="Enter" && selected.length===1) { openFileEntry(selected[0]); return true; }
  if (event.key==="F2" && selected.length===1) { setModal({kind:"file-rename",name:selected[0]}); $("#file-new-name")?.select(); return true; }
  if (event.key==="Delete" && selected.length) { confirmDelete(selected); return true; }
  if (event.key==="Backspace" && state.filePath) { openFolder(parentPath(state.filePath)); return true; }
  if (event.key==="Escape" && selected.length) { state.fileSelection=new Set();refreshFileSelection();return true; }
  return false;
}
document.addEventListener("keydown",(event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==="k") {
    event.preventDefault();state.paletteQuery="";setModal({kind:"palette"});return;
  }
  if (event.target?.id==="file-editor-text") {
    if ((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==="s") { event.preventDefault(); $("#file-editor-form")?.requestSubmit(); return; }
    if (event.key==="Tab" && !event.shiftKey) {
      event.preventDefault();
      event.target.setRangeText("  ",event.target.selectionStart,event.target.selectionEnd,"end");
      event.target.dispatchEvent(new Event("input",{bubbles:true}));
      return;
    }
  }
  // Escape inside Monaco closes its own widgets (find, suggest) first.
  if (event.key==="Escape" && state.modal && !event.target?.closest?.(".monaco-editor")) {event.preventDefault();closeModal();return;}
  if (fileShortcut(event)) { event.preventDefault(); return; }
  if (event.target?.id==="console-command" && (event.key==="ArrowUp" || event.key==="ArrowDown")) {
    const list=state.commandHistory;
    if (!list.length) return;
    event.preventDefault();
    let index=state.commandIndex<0?list.length:state.commandIndex;
    index=event.key==="ArrowUp"?Math.max(0,index-1):Math.min(list.length,index+1);
    state.commandIndex=index;
    state.command=index>=list.length?"":list[index];
    event.target.value=state.command;
    return;
  }
  if (event.key==="Enter" && event.target?.id==="console-command") {
    event.preventDefault();sendCommand();
  }
  if (event.key==="Enter" && event.target?.id==="palette-search") {
    const first = ROUTE_INFO.find((r) => r.label.toLowerCase().includes(state.paletteQuery.toLowerCase()));
    if (first) navigate(first.route);
  }
});
document.addEventListener("input",(event) => {
  if (event.target.id === "log-search") { state.query=event.target.value;scheduleLogUpdate(); }
  if (event.target.id === "server-search") { state.serverQuery=event.target.value;state.serverPage=0;filterServerRows(); }
  if (event.target.id === "console-command") { state.command=event.target.value;state.commandIndex=-1; }
  if (event.target.id === "file-search") {
    state.fileQuery=event.target.value;
    const body=$("#file-tbody");if(body){body.innerHTML=renderFileRows();refreshFileSelection();}
  }
  if (event.target.id === "file-editor-text" && state.modal?.kind==="file-editor") {
    state.modal.content=event.target.value;
    if(!state.modal.dirty){state.modal.dirty=true;const label=$("#editor-state");if(label){label.textContent="수정됨";label.classList.add("dirty");}}
  }
  if (["live-java","live-command","live-memory","live-jar"].includes(event.target.id)) {
    const preview=$("#command-preview");if(preview)preview.textContent=previewCommand(startupFormValues());
  }
  if (event.target.id === "palette-search") {
    state.paletteQuery=event.target.value;const root=$("#palette-results");if(root)root.innerHTML=paletteItems();
  }
});
// Log viewport: remember whether the reader is parked at the bottom.
document.addEventListener("scroll",(event) => {
  if (event.target?.id!=="log-viewport") return;
  const pane=event.target;
  state.stickLogs=pane.scrollHeight-pane.scrollTop-pane.clientHeight<48;
},true);
document.addEventListener("dblclick",async(event) => {
  if (state.route!=="files" || state.mode!=="live" || event.target.closest("button,input")) return;
  if (event.target.closest("[data-file-up]")) { await openFolder(parentPath(state.filePath)); return; }
  const row=event.target.closest("[data-file]");
  if (row) await openFileEntry(row.dataset.file);
});
// Drag and drop: rows move onto folders / ".." / breadcrumbs; desktop files upload.
const PANEL_DRAG="application/x-panel-files";
function clearDropMarks(){
  document.querySelectorAll(".drop-target").forEach(el=>el.classList.remove("drop-target"));
  $("#file-dropzone")?.classList.remove("dragging");
}
document.addEventListener("dragstart",(event) => {
  const row=event.target.closest?.("[data-file]");
  if (!row || state.route!=="files") return;
  const name=row.dataset.file;
  if (!state.fileSelection.has(name)) { state.fileSelection=new Set([name]); refreshFileSelection(); }
  event.dataTransfer.setData(PANEL_DRAG,JSON.stringify([...state.fileSelection]));
  event.dataTransfer.effectAllowed="move";
});
document.addEventListener("dragover",(event) => {
  if (state.route!=="files" || state.mode!=="live") return;
  const zone=event.target.closest?.("[data-drop-folder], #file-dropzone");
  if (!zone) return;
  event.preventDefault();
  const internal=event.dataTransfer.types.includes(PANEL_DRAG);
  event.dataTransfer.dropEffect=internal?"move":"copy";
  const folder=event.target.closest("[data-drop-folder]");
  document.querySelectorAll(".drop-target").forEach(el=>{if(el!==folder)el.classList.remove("drop-target");});
  folder?.classList.add("drop-target");
  if (!internal) $("#file-dropzone")?.classList.add("dragging");
});
document.addEventListener("dragleave",(event) => {
  if (!event.relatedTarget || !$("#file-dropzone")?.contains(event.relatedTarget)) clearDropMarks();
});
document.addEventListener("dragend",clearDropMarks);
document.addEventListener("drop",async(event) => {
  if (state.route!=="files" || state.mode!=="live") return;
  const zone=event.target.closest?.("[data-drop-folder], #file-dropzone");
  if (!zone) return;
  event.preventDefault();clearDropMarks();
  const folder=event.target.closest("[data-drop-folder]");
  const dest=folder ? folder.dataset.dropFolder : state.filePath;
  const internal=event.dataTransfer.getData(PANEL_DRAG);
  try {
    if (internal) {
      if (dest===state.filePath) return;
      const moved=await movePaths(JSON.parse(internal),dest);
      if (moved) toast(moved+"개 항목을 /"+(dest||"")+" 로 옮겼습니다.");
      state.fileSelection=new Set();
    } else {
      await uploadItems(await collectDropped(event.dataTransfer),dest);
    }
  } catch(e) { toast(e.message); }
  await loadFiles();
});
document.addEventListener("change",async(event) => {
  if(event.target.id==="new-server-template" && state.mode==="live"){
    const kind=event.target.value;
    const group=$("#new-server-version-group"),select=$("#new-server-version"),hint=$("#new-server-version-hint");
    if(!group||!select)return;
    group.hidden=kind==="manual";
    select.disabled=true;
    select.replaceChildren(new Option("버전 목록을 불러오는 중…",""));
    if(kind==="manual")return;
    try{
      const result=await apiRequest("/templates/"+encodeURIComponent(kind)+"/versions");
      if($("#new-server-template")?.value!==kind)return;
      const values=Array.isArray(result.versions)?result.versions:[];
      select.replaceChildren(new Option("버전 선택",""),
        ...values.map(v=>new Option(v,v)));
      select.disabled=values.length===0;
      if(hint)hint.textContent=values.length?values.length+"개 버전 중 선택 · 안정 빌드가 없으면 설치가 거절됩니다.":"제공되는 버전이 없습니다.";
    }catch(error){
      select.replaceChildren(new Option("버전을 불러오지 못했습니다",""));
      if(hint)hint.textContent=error.message;
    }
    return;
  }
  if (event.target.id==="log-autoscroll") {state.autoScroll=event.target.checked;state.stickLogs=true;scrollLogs();}
  if (event.target.id==="server-status"){state.serverStatus=event.target.value;state.serverPage=0;filterServerRows();}
  if (["file-upload-input","folder-upload-input"].includes(event.target.id) && state.mode==="live"){
    // webkitRelativePath keeps the chosen folder's structure.
    const items=[...(event.target.files||[])].map(file=>({file,path:file.webkitRelativePath||file.name}));
    try{await uploadItems(items,state.filePath);}
    catch(e){toast(e.message);}finally{event.target.value="";await loadFiles();}
  }
  if (event.target.dataset?.fileCheck!==undefined){
    const name=event.target.dataset.fileCheck;
    if(event.target.checked)state.fileSelection.add(name);else state.fileSelection.delete(name);
    refreshFileSelection();
  }
  if (event.target.id==="file-check-all"){
    state.fileSelection=event.target.checked?new Set(visibleFiles().map(f=>f.name)):new Set();
    refreshFileSelection();
  }
});
document.addEventListener("click",async(event) => {
  const row = event.target.closest("[data-file]");
  if (row && state.route==="files" && !event.target.closest("button,input,a")) { selectFile(row.dataset.file,event); return; }
  const target = event.target.closest("[data-action]");if (!target) return;
  const action=target.dataset.action;
  if (action==="navigate") {state.mobileMenu=false;return;}
  if (action==="modal-background" && event.target===target){closeModal();return;}
  if (action==="modal-close"){closeModal();return;}
  if (action==="open-menu" || action==="close-menu"){
    state.mobileMenu = action === "open-menu";
    $("#sidebar")?.classList.toggle("open",state.mobileMenu);
    $(".mobile-overlay")?.classList.toggle("open",state.mobileMenu);
    return;
  }
  if (action==="palette"){state.paletteQuery="";setModal({kind:"palette"});return;}
  if (action==="palette-navigate"){navigate(target.dataset.route);return;}
  if (action==="server-switcher"){setModal({kind:"switcher"});return;}
  if (action==="choose-server"){
    await switchSelectedServer(target.dataset.id,state.route==="dashboard"?"dashboard":"overview");
    return;
  }
  if (action==="select-server"){
    await switchSelectedServer(target.dataset.id,"overview");
    return;
  }
  if (action==="server-create"){setModal({kind:"create"});return;}
  if (action==="server-page-prev"){state.serverPage=Math.max(0,state.serverPage-1);filterServerRows();return;}
  if (action==="server-page-next"){state.serverPage++;filterServerRows();return;}
  if (action==="power-confirm"){
    const power=target.dataset.power || "restart";
    if (power==="start") { state.modal={power}; await performPowerAction(); return; }
    const title=power==="stop"?"서버를 중지할까요?":power==="restart"?"서버를 재시작할까요?":"서버를 시작할까요?";
    setModal({kind:"confirm",title,description: selectedName()+" 서버에서 실행 중인 작업과 플레이어 연결에 영향을 줄 수 있습니다.",
      power,confirmLabel: power==="stop"?"서버 중지":power==="restart"?"재시작":"시작",confirmAction:"power-run",danger:power==="stop"});return;
  }
  if (action==="power-run"){await performPowerAction();return;}
  if (action==="download-logs"){exportLogs();return;}
  if (action==="file-select"){state.selectedFile=target.dataset.name;render();return;}
  if (action==="file-root"){
    state.filePath=state.mode==="live"?"":"/home/minecraft/server";state.selectedFile="";
    if(state.mode==="live")await loadFiles();else render();return;
  }
  if (action==="file-upload"){
    if(state.mode==="live")$("#file-upload-input")?.click();else mockActionMessage(action);return;
  }
  if (action==="file-new-folder"){
    if(state.mode==="live")setModal({kind:"file-mkdir"});else mockActionMessage(action);return;
  }
  if (action==="file-open"){
    const value=(state.mode==="live"?state.fileEntries:DEMO_FILES).find(x=>x.name===target.dataset.name);
    if(value?.type==="folder"){
      state.filePath=state.mode==="live"?relativeFile(value.name):"/home/minecraft/server/"+value.name;
      state.selectedFile="";if(state.mode==="live")await loadFiles();else render();
    } else if(state.mode==="live")await openTextFile(target.dataset.name);
    else mockActionMessage("파일 미리보기");
    return;
  }
  if (action==="file-preview"){await openTextFile(target.dataset.name);return;}
  if (action==="file-download" && state.mode==="live"){downloadEntry(target.dataset.name);return;}
  if (action==="file-edit"){await openTextFile(target.dataset.name);return;}
  if (action==="file-rename"){setModal({kind:"file-rename",name:target.dataset.name});$("#file-new-name")?.select();return;}
  if (action==="file-delete"){
    if(state.mode!=="live")return mockActionMessage(action);
    confirmDelete([target.dataset.name]);return;
  }
  if (action==="file-delete-selected"){confirmDelete([...state.fileSelection]);return;}
  if (action==="file-download-selected"){
    const files=[...state.fileSelection].filter(n=>state.fileEntries.find(f=>f.name===n)?.type==="file");
    if(!files.length)return toast("폴더는 다운로드할 수 없습니다. 파일을 선택하세요.");
    files.forEach((name,i)=>setTimeout(()=>downloadEntry(name),i*400));return;
  }
  if (action==="file-clear-selection"){state.fileSelection=new Set();refreshFileSelection();return;}
  if (action==="file-goto"){await openFolder(target.dataset.path||"");return;}
  if (action==="file-refresh"){await loadFiles();return;}
  if (action==="folder-upload"){$("#folder-upload-input")?.click();return;}
  if (action==="file-new-file"){setModal({kind:"file-new"});return;}
  if (action==="file-delete-run"){
    const paths=state.modal?.paths||(state.modal?.path?[state.modal.path]:[]);setModal(null);
    if(!paths.length)return;
    try{
      for(const path of paths)await apiRequest(fileApi("?path="+encodeURIComponent(path)),{method:"DELETE"});
      toast(paths.length+"개 항목을 삭제했습니다.");state.fileSelection=new Set();
    }catch(e){toast(e.message);}
    await loadFiles();return;
  }
  if (action==="open-log-folder"){state.filePath="logs";state.fileSelection=new Set();state.fileQuery="";navigate("files");return;}
  if (action==="auto-restart-toggle" && state.mode==="live"){
    const s=server();if(!s)return;
    try{
      await apiRequest("/servers/"+encodeURIComponent(s.id)+"/startup",{method:"PATCH",body:{autoRestart:!s.autoRestart}});
      toast("자동 재시작을 "+(s.autoRestart?"껐습니다.":"켰습니다."));await pollLiveStatus(true);
    }catch(e){toast(e.message);}
    return;
  }
  if (action==="network-refresh"){await refreshRouteData();return;}
  if (action==="copy-text"){
    try{await navigator.clipboard.writeText(target.dataset.text);toast("복사했습니다: "+target.dataset.text);}catch{toast(target.dataset.text);}
    return;
  }
  if (action==="java-detect"){state.javaInstalls=null;await detectJavaInstalls();return;}
  if (action==="java-pick"){
    const input=$("#live-java");if(input){input.value=target.dataset.path;input.dispatchEvent(new Event("input",{bubbles:true}));}
    const host=$("#java-list");if(host)host.innerHTML=renderJavaList();return;
  }
  if (action==="startup-command-reset"){
    const input=$("#live-command");if(input){input.value="";input.dispatchEvent(new Event("input",{bubbles:true}));}return;
  }
  if (action==="user-delete"){
    const name=target.dataset.name;
    setModal({kind:"confirm",title:"'"+name+"' 계정을 삭제할까요?",description:"이 계정으로 로그인한 세션이 즉시 끊어지며 되돌릴 수 없습니다.",
      name,confirmLabel:"계정 삭제",confirmAction:"user-delete-run",danger:true});return;
  }
  if (action==="user-delete-run"){
    const name=state.modal?.name;setModal(null);if(!name)return;
    try{await apiRequest("/users/"+encodeURIComponent(name),{method:"DELETE"});toast("계정을 삭제했습니다.");await refreshRouteData();}
    catch(e){toast(e.message);}return;
  }
  if (action==="backup-create"){setModal({kind:"confirm",title:"새 백업을 생성할까요?",description:"현재 월드 상태를 백업합니다.",
    confirmLabel:"백업 생성",confirmAction:"backup-run"});return;}
  if (action==="backup-run"){await createBackup();return;}
  if (action==="backup-restore"){
    const id=target.dataset.id;setModal({kind:"confirm",title:"백업을 복원할까요?",
      description:"백업 #"+id+"으로 복원하면 현재 월드 데이터가 바뀔 수 있습니다. 복원 전에 별도 백업을 권장합니다.",
      id,confirmLabel:"복원",confirmAction:"restore-run",danger:true});return;}
  if (action==="restore-run"){await restoreBackup();return;}
  if (action==="backup-delete"){
    const id=target.dataset.id;
    setModal({kind:"confirm",title:"백업을 영구 삭제할까요?",
      description:"백업 #"+id+"의 파일을 삭제합니다. 삭제 후에는 이 백업으로 복원할 수 없습니다.",
      id,confirmLabel:"백업 삭제",confirmAction:"backup-delete-run",danger:true});return;
  }
  if (action==="backup-delete-run"){
    const id=state.modal?.id;setModal(null);if(!id)return;
    try{
      await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/backups/"+encodeURIComponent(id),{method:"DELETE"});
      toast("백업을 삭제했습니다.");await refreshRouteData();
    }catch(e){toast(e.message);}
    return;
  }
  if (action==="audit-export"){
    const rows=state.mode==="demo"?DEMO_AUDIT.map(x=>[x.time,x.action,x.actor,x.target].join(" | ")):
      (state.audit||[]).map(x=>[x.time,x.action,x.serverId||"패널"].join(" | "));
    downloadText("pconn-audit.txt",rows.join("\n"));toast("감사 기록을 내보냈습니다.");return;
  }
  if (action==="theme-toggle"){
    state.theme=state.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=state.theme;store("pconn-theme",state.theme);render();return;
  }
  if (action==="show-notifications"){setModal({kind:"notice",title:"알림",description:"현재 확인할 새 알림이 없습니다. 실제 서버 알림은 API 연동 이후 제공됩니다.",
    confirmLabel:"닫기",confirmAction:"modal-close"});return;}
  if (action==="api-retry"){await loadFromApi();return;}
  if(action==="jar-versions-load"){
    const template=state.startupLive?.template;
    const select=$("#jar-upgrade-version");
    if(!select||!["paper","folia","purpur","leaf","velocity"].includes(template))return;
    select.disabled=true;
    select.replaceChildren(new Option("공식 버전 목록 조회 중…",""));
    try{
      const id=state.selectedId;
      const response=await apiRequest("/templates/"+template+"/versions");
      if(id!==state.selectedId || state.route!=="startup")return;
      const versions=Array.isArray(response.versions)?response.versions:[];
      select.replaceChildren(new Option("버전을 선택하세요",""),...versions.map(v=>new Option(v,v)));
      select.disabled=versions.length===0;
      if(!versions.length)toast("현재 제공되는 안정 빌드 버전이 없습니다.");
    }catch(e){select.replaceChildren(new Option("버전 조회 실패",""));toast(e.message);}
    return;
  }
  if(action==="jar-rollback"){
    const ver=state.startupLive?.rollbackVersion;
    if(!ver)return toast("롤백할 버전이 없습니다.");
    setModal({kind:"confirm",title:"서버 JAR을 이전 버전으로 되돌릴까요?",
      description:"서버가 중지되어 있어야 합니다. 이전 버전 "+ver+"으로 되돌리며 월드 데이터는 변경하지 않습니다.",
      confirmAction:"jar-rollback-run",confirmLabel:"JAR 롤백",danger:true});
    return;
  }
  if(action==="jar-rollback-run" || action==="jar-upgrade-run"){
    const modal=state.modal;
    const id=state.selectedId;
    setModal(null);
    try{
      if(action==="jar-upgrade-run"){
        toast("공식 JAR을 다운로드하여 SHA-256을 검증하고 있습니다.");
        await apiRequest("/servers/"+encodeURIComponent(id)+"/install/upgrade",{
          method:"POST",body:{template:modal.template,version:modal.version},timeoutMs:200000
        });
        toast("JAR 업데이트 완료. 서버 호환성 확인 후 시작하세요.");
      }else{
        await apiRequest("/servers/"+encodeURIComponent(id)+"/install/rollback",{method:"POST"});
        toast("이전 JAR로 롤백했습니다.");
      }
      await refreshRouteData();await loadFromApi();
    }catch(e){toast(e.message);}
    return;
  }
  if(action==="diagnostics-refresh"){await refreshRouteData();return;}
  if (action==="health-check"){
    if(state.mode==="live")await refreshRouteData();else toast("예시 데이터만 표시 중입니다.");return;
  }
  if (action==="schedule-delete" && state.mode==="live"){
    try{await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/schedules/"+encodeURIComponent(target.dataset.id),{method:"DELETE"});
      toast("예약 작업 삭제 완료");await refreshRouteData();
    }catch(e){toast(e.message);}return;
  }
  if (action==="logout"){
    try{await signOut();}catch(e){toast(e.message);}
    if(logClose){logClose();logClose=null;}
    stopPolling();state.authenticated=false;state.authError="";state.logs=[];state.servers=[];state.users=[];render();return;
  }
  if (["network-add","user-invite"].includes(action)){mockActionMessage(action);return;}
  if (action==="log-level"){
    state.level=target.dataset.level;
    document.querySelectorAll('[data-action="log-level"]').forEach((btn) => {
      const active = btn.dataset.level === state.level;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    updateLogRows();
    return;
  }
});
document.addEventListener("submit",async(event) => {
  const form=event.target;
  if(form.id==="login-form" || form.id==="setup-form"){
    event.preventDefault();
    const d=new FormData(form);
    const username=String(d.get("username")||"").trim(),password=String(d.get("password")||"");
    if(form.id==="setup-form" && password!==String(d.get("password2")||"")){state.authError="비밀번호 확인이 일치하지 않습니다.";render();return;}
    const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
    try{
      const session=form.id==="setup-form"?await setupAccount(username,password):await signIn(username,password);
      state.authenticated=true;state.authError="";state.setupRequired=false;state.username=session.username||username;
      startPolling();await loadFromApi();
    }
    catch(e){
      state.authError=e.message;
      if(e.status===409)state.setupRequired=false;
      render();
    }
    finally{if(submit?.isConnected)submit.disabled=false;}
    return;
  }
  if(!["console-form","startup-form","settings-form","schedule-form","create-server-form","file-editor-form","folder-create-form","file-rename-form","file-create-form","jar-upgrade-form","user-create-form","password-form","port-form"].includes(form.id))return;
  event.preventDefault();
  if(form.id==="jar-upgrade-form"){
    const template=state.startupLive?.template;
    const version=String(new FormData(form).get("version")||"");
    if(!["paper","folia","purpur","leaf","velocity"].includes(template) || !version)return toast("업데이트 버전을 선택하세요.");
    setModal({kind:"confirm",title:"공식 서버 JAR을 업데이트할까요?",
      description:template+" "+version+" 안정 빌드를 다운로드하고 SHA-256 검증 후 기존 JAR을 교체합니다. 서버 중지가 필요하며 이전 JAR은 롤백용으로 보관합니다.",
      template,version,confirmLabel:"검증 후 업데이트",confirmAction:"jar-upgrade-run"});
    return;
  }
  if(form.id==="console-form"){await sendCommand();return;}
  if(form.id==="file-editor-form"){
    const modal=state.modal,path=modal?.path;if(!path)return;
    const text=String(new FormData(form).get("content")||"");
    try{
      await uploadFile(state.selectedId,path,new Blob([text],{type:"application/octet-stream"}));
      if(state.modal===modal){
        modal.dirty=modal.content!==text;
        const label=$("#editor-state");if(label&&!modal.dirty){label.textContent="저장됨";label.classList.remove("dirty");}
      }
      toast("저장했습니다: "+path);await loadFiles({quiet:true});
    }catch(e){toast(e.message);}return;
  }
  if(form.id==="folder-create-form" || form.id==="file-rename-form" || form.id==="file-create-form"){
    const name=String(new FormData(form).get("name")||"").trim();if(!name)return;
    try{
      if(form.id==="folder-create-form")await apiRequest(fileApi("/mkdir"),{method:"POST",body:{path:relativeFile(name)}});
      else if(form.id==="file-create-form"){
        if(state.fileEntries.some(f=>f.name===name))return toast("같은 이름의 항목이 이미 있습니다.");
        await uploadFile(state.selectedId,relativeFile(name),new Blob([],{type:"application/octet-stream"}));
      }
      else await apiRequest(fileApi("/rename"),{method:"PATCH",body:{from:relativeFile(state.modal?.name||""),to:relativeFile(name)}});
      setModal(null);state.fileSelection=new Set([name]);await loadFiles();
      if(form.id==="file-create-form")await openTextFile(name);else toast("완료되었습니다.");
    }catch(e){toast(e.message);}return;
  }
  if(form.id==="port-form"){
    const port=Number(new FormData(form).get("port"));
    try{
      await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/network",{method:"PATCH",body:{port}});
      toast("포트를 "+port+"(으)로 바꿨습니다. 다음 시작부터 적용됩니다.");await pollLiveStatus(true);await refreshRouteData();
    }catch(e){toast(e.message);}return;
  }
  if(form.id==="user-create-form"){
    const d=new FormData(form);
    try{
      await apiRequest("/users",{method:"POST",body:{username:String(d.get("new-username")||"").trim(),password:String(d.get("new-user-password")||"")}});
      toast("계정을 만들었습니다.");form.reset();await refreshRouteData();
    }catch(e){toast(e.message);}return;
  }
  if(form.id==="password-form"){
    const d=new FormData(form);
    try{
      await apiRequest("/auth/password",{method:"POST",body:{current:String(d.get("current-password")||""),password:String(d.get("next-password")||"")}});
      toast("비밀번호를 변경했습니다. 다른 기기의 로그인은 종료됩니다.");form.reset();
    }catch(e){toast(e.message);}return;
  }
  if(form.id==="startup-form"){
    const d=new FormData(form);
    const input={executable:String(d.get("executable")||""),directory:String(d.get("directory")||""),
      memory:String(d.get("memory")||""),timeout:String(d.get("timeout")||""),
      arguments:String(d.get("arguments")||""),autoRestart:d.has("autoRestart")};
    if(state.mode==="demo"){state.startup=input;store("pconn-startup",input);toast("예시 시작 설정만 브라우저에 저장했습니다.");}
    else{
      try{
        await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/startup",{
          method:"PATCH",body:{name:String(d.get("live-name")||""),
            memoryMb:Number(d.get("live-memory")),jar:String(d.get("live-jar")||"server.jar"),
            javaBin:String(d.get("live-java")||"").trim(),startCommand:String(d.get("live-command")||"").trim(),
            eulaAccepted:d.has("live-eula"),autoRestart:d.has("live-auto-restart")}
        });
        toast("시작 설정을 저장했습니다. 다음 시작부터 적용됩니다.");await refreshRouteData();await pollLiveStatus(true);
      }catch(e){toast(e.message);}
    }
    return;
  }
  if(form.id==="settings-form"){
    const d=new FormData(form);
    const values={panelName:String(d.get("panelName")||"Panel"),timezone:String(d.get("timezone")||"Asia/Seoul"),
      sessionHours:String(d.get("sessionHours")||"24"),retention:String(d.get("retention")||"7"),audit:state.settings.audit};
    state.settings=values;store("pconn-settings",values);toast("화면 미리보기 설정을 브라우저에 저장했습니다. 서버 정책은 변경되지 않았습니다.");return;
  }
  if(form.id==="schedule-form"){
    const d=new FormData(form);const name=String(d.get("schedule-name")||"").trim();
    if(!name)return toast("작업 이름을 입력해 주세요.");
    if(state.mode==="demo"){if(state.schedules.length>=50)return toast("예시 작업은 최대 50개까지 등록할 수 있습니다.");state.schedules.push({id:"demo-"+Date.now(),name,when:String(d.get("schedule-cron")||""),type:String(d.get("schedule-type")||"백업"),active:false});render();toast("예시 작업에만 추가되었습니다. 실제 실행은 예약되지 않았습니다.");}
    else{try{await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/schedules",{method:"POST",body:{name,cron:String(d.get("schedule-cron")),type:String(d.get("schedule-type"))}});toast("예약 작업을 등록했습니다.");await refreshRouteData();}catch(e){toast(e.message);}}
    return;
  }
  if(form.id==="create-server-form"){
    const d=new FormData(form);const name=String(d.get("server-name")||"").trim();
    if(!name)return toast("서버 이름을 입력해 주세요.");
    const template=String(d.get("server-template")||"manual");
    const version=String(d.get("server-version")||"");
    if(state.mode==="live" && template!=="manual" && !version)return toast("자동 설치할 Minecraft 버전을 선택하세요.");
    if(state.mode==="demo"){
      if(state.servers.length>=50)return toast("예시 서버는 최대 50대까지 등록할 수 있습니다.");
      const id="demo-"+Date.now();
      state.servers.push({id,name,kind:String(d.get("server-kind")||"마인크래프트"),status:"stopped",players:0,maxPlayers:20,memoryGb:0,memoryLimitGb:4,cpu:0,tps:null,mspt:null,port:25569,uptime:"—",version:"예시 서버",directory:"—"});
      state.selectedId=id;setModal(null);navigate("servers");toast("예시 서버를 목록에 추가했습니다. 실제 서버는 생성되지 않았습니다.");
    }else{
      const createButton=form.querySelector('[type="submit"]');
      if(createButton?.disabled)return;
      if(createButton)createButton.disabled=true;
      try{
        const created=await apiRequest("/servers",{method:"POST",body:{
          name,port:Number(d.get("server-port")),memoryMb:Number(d.get("server-memory")),
          eulaAccepted:d.has("eula-accepted"),template
        }});
        let installed=false;
        if(template!=="manual"){
          try{
            toast("공식 안정 JAR을 다운로드하고 SHA-256을 확인하는 중입니다.");
            await apiRequest("/servers/"+encodeURIComponent(created.id)+"/install",{
              method:"POST",body:{template,version},timeoutMs:200000
            });
            installed=true;
          }catch(installError){
            toast("서버는 생성됐지만 자동 설치에 실패했습니다: "+installError.message);
          }
        }
        setModal(null);
        await loadFromApi();
        if(created?.id)state.selectedId=created.id;
        state.filePath="";state.selectedFile="";
        navigate("files");await loadFiles();
        if(installed)toast("공식 JAR 설치가 완료되었습니다. 이제 서버를 시작할 수 있습니다.");
        else if(template==="manual")toast("서버가 생성됐습니다. server.jar을 직접 업로드하세요.");
      }catch(e){toast(e.message);}
      finally{if(createButton?.isConnected)createButton.disabled=false;}
    }
  }
});
render();
window.addEventListener("pconn-session-expired",()=>{
  if(!apiEnabled)return;
  stopPolling();state.authenticated=false;
  state.authError="세션이 만료됐습니다. 다시 로그인하세요.";
  state.servers=[];state.logs=[];
  if(logClose){logClose();logClose=null;}
  cancelLogUpdate();render();
});
window.addEventListener("pagehide", () => {
  stopPolling();cancelLogUpdate();
  if (logClose) { logClose(); logClose = null; }
  clearTimeout(toastTimer);
});
if (apiEnabled) bootstrapAuth();
