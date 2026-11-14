
import { DEMO_SERVERS, DEMO_LOGS, DEMO_ACTIVITY, DEMO_FILES, DEMO_BACKUPS, DEMO_SCHEDULES, DEMO_USERS, DEMO_AUDIT, ROUTE_INFO } from "./data.js";
import { escapeHtml as h, filterLogs, serverSummary, formatMemory, validateCommand, routeFromHash, appendBoundedLog, replaceLogHistory, recentLogs } from "./utils.mjs";
import { apiEnabled, apiRequest, streamLogs } from "./api.js";

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
  query: "", serverQuery: "", serverStatus: "all", fileQuery: "", filePath: "/home/minecraft/server", selectedFile: "",
  level: "all", autoScroll: true, command: "", theme: getStore("pconn-theme", "light"),
  modal: null, paletteQuery: "", mobileMenu: false,
  startup: getStore("pconn-startup", { executable: "java", directory: "/srv/minecraft/main", memory: "10240", timeout: "30", arguments: "-Xms4G -Xmx10G -jar pma-paper.jar nogui", autoRestart: true }),
  settings: getStore("pconn-settings", { panelName: "피컨", timezone: "Asia/Seoul", sessionHours: "24", retention: "7", audit: true })
};
document.documentElement.dataset.theme = state.theme === "dark" ? "dark" : "light";
let toastTimer = null, logClose = null, logRenderTimer = null;
let logFetchVersion = 0, loadVersion = 0, commandPending = false;
const LOG_FLUSH_MS = 130;
const server = () => state.servers.find((s) => s.id === state.selectedId) || state.servers[0] || null;
const routeTitle = () => routeMap[state.route]?.label || "대시보드";
const selectedName = () => server()?.name || "서버 없음";
const statusText = (status) => status === "running" ? "실행 중" : status === "stopped" ? "중지됨" : status === "starting" ? "시작 중" : "상태 알 수 없음";
const badge = (status) => `<span class="status ${status === "running" ? "running" : "stopped"}"><i class="indicator"></i>${statusText(status)}</span>`;
const fmtPlayers = (s) => s.maxPlayers ? `${s.players ?? 0} / ${s.maxPlayers}` : "—";
const sectionNav = (section) => ROUTE_INFO.filter((item) => item.section === section).map((item) =>
  `<a href="#/${item.route}" class="nav-link ${state.route === item.route ? "active" : ""}" data-action="navigate" aria-current="${state.route === item.route ? "page" : "false"}">${icon(item.icon)}<span>${h(item.label)}</span></a>`
).join("");
function renderSidebar() {
  const s = server();
  return `<aside class="sidebar ${state.mobileMenu ? "open" : ""}" id="sidebar" aria-label="탐색">
    <div class="brand-block"><a class="brand" href="#/dashboard">피컨</a><span class="brand-description">서버 관리</span></div>
    <div class="side-caption">작업 공간</div><nav class="nav-group">${sectionNav("workspace")}</nav>
    <hr class="side-rule" /><div class="side-caption">현재 서버</div>
    <button class="server-selector" data-action="server-switcher" aria-label="현재 서버 변경">
      <span><span class="selector-title">${h(s?.name || "선택된 서버 없음")}</span>
      <span class="selector-state ${s?.status === "stopped" ? "stopped" : ""}"><i class="indicator"></i>${statusText(s?.status)}</span></span>${icon("chevron", "small")}
    </button>
    <nav class="nav-group" style="margin-top:15px">${sectionNav("server")}</nav>
    <hr class="side-rule" /><div class="side-caption">관리</div>
    <nav class="nav-group">${sectionNav("admin")}</nav>
    <div class="user-summary"><span class="avatar">P</span><span><strong>Pma</strong><small>소유자 · 미리보기</small></span></div>
  </aside>`;
}
function renderChrome() {
  return `<div class="mobile-overlay ${state.mobileMenu ? "open" : ""}" data-action="close-menu"></div>
    <header class="mobile-top"><button class="icon-button" data-action="open-menu" aria-label="메뉴 열기">${icon("menu")}</button>
      <a class="brand" href="#/dashboard">피컨</a><span class="demo-ribbon">${state.mode === "demo" ? "예시 모드" : "API 연결"}</span></header>
    <header class="topbar"><div class="crumbs"><a href="#/dashboard">피컨</a><span>/</span><span class="current">${h(routeTitle())}</span></div>
      <div class="top-actions"><span class="demo-ribbon">${state.mode === "demo" ? "예시 데이터" : "실제 API"}</span>
      <button class="global-search" data-action="palette" aria-label="기능 검색">${icon("search", "small")}<span>기능 검색</span><kbd class="keycap">⌘ K</kbd></button>
      <button class="icon-button" data-action="show-notifications" aria-label="알림">${icon("bell")}</button><span class="top-avatar" title="Pma">P</span></div>
    </header>
    <nav class="mobile-tabbar" aria-label="모바일 주요 탐색">
      ${[["dashboard","대시보드","grid"],["servers","서버","server"],["console","콘솔","terminal"],["settings","설정","gear"]].map(([route,title,glyph]) =>
        `<a href="#/${route}" class="${state.route === route ? "active" : ""}" aria-label="${title}">${icon(glyph)}<span>${title}</span></a>`).join("")}
    </nav>`;
}
const button = (label, action, kind = "", extra = "") => `<button class="btn ${kind}" data-action="${h(action)}" ${extra}>${label}</button>`;
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
  const activities = state.activity.map((a) => `<div class="activity-row"><div class="activity-spot ${a.type === "ok" ? "ok" : ""}">${icon(a.type === "ok" ? "check" : "clock","small")}</div>
     <div class="activity-info"><strong>${h(a.title)}</strong><small>${h(a.detail)}</small></div><time>${h(a.time)}</time></div>`).join("");
  return `${header("대시보드","서버 상태와 최근 작업",button(`${icon("plus","small")} 서버 추가`,"server-create","primary"))}
    <section class="card summary-strip" aria-label="운영 현황">
      <div class="summary-primary"><strong><i class="indicator" style="color:var(--success)"></i>${sum.running}대 서버가 실행 중</strong>
        <small>전체 ${sum.total}대 중 중지 ${sum.total-sum.running}대 · 서버 상태 확인</small>
        <span class="fine-print">최근 확인 · ${state.mode === "demo" ? "예시 데이터" : "연결된 API"}</span></div>
      <div class="summary-secondary"><span>현재 접속 인원</span><strong>${sum.players}명</strong></div>
      <div class="summary-secondary"><span>전체 메모리 사용량</span><strong>${sum.memoryGb.toFixed(1)} GB</strong></div>
    </section>
    <div class="dashboard-layout">
      ${card("내 서버",`<div class="table-scroll"><table class="data-table">
        <thead><tr><th>서버 이름</th><th>상태</th><th class="numeric">플레이어</th><th class="numeric">메모리</th></tr></thead>
        <tbody>${renderServerRows(state.servers)}</tbody></table></div>`,`<a href="#/servers">전체 서버 보기 →</a>`)}
      ${card("최근 활동",`<div class="activity-list">${activities}</div>`,`<a href="#/audit">전체 보기</a>`)}
    </div>${demoNote()}`;
}
function renderServers() {
  return `${header("서버","등록된 인스턴스를 검색하고 제어합니다",button(`${icon("plus","small")} 서버 추가`,"server-create","primary"))}
    <div class="toolbar"><label class="search-field">${icon("search")}<input class="field" id="server-search" placeholder="서버 이름 또는 ID로 검색" autocomplete="off" value="${h(state.serverQuery)}" aria-label="서버 검색"></label>
      <select id="server-status" class="select" aria-label="서버 상태">
        <option value="all" ${state.serverStatus === "all" ? "selected":""}>전체 상태</option>
        <option value="running" ${state.serverStatus === "running" ? "selected":""}>실행 중</option>
        <option value="stopped" ${state.serverStatus === "stopped" ? "selected":""}>중지됨</option></select>
      <div class="toolbar-spacer"></div><span class="demo-ribbon">${state.servers.length}대 등록</span></div>
    ${card("서버 목록",`<div class="table-scroll"><table class="data-table">
      <thead><tr><th>서버 이름</th><th>상태</th><th class="numeric">접속 인원</th><th class="numeric">메모리</th><th>관리</th></tr></thead>
      <tbody id="server-results">${renderServerRows(state.servers,true)}</tbody></table></div>`)}
    ${demoNote()}`;
}
function renderOverview() {
  const s = server();
  if (!s) return emptyServer();
  const action = `${button(`${icon("refresh","small")} 재시작`,"power-confirm","",`data-power="restart"`)}
    ${button(`${icon("power","small")} 서버 중지`,"power-confirm","danger",`data-power="stop"`)}`;
  const metrics = [
    ["접속 인원",fmtPlayers(s),"현재 플레이어"],
    ["TPS",s.tps == null ? "—" : s.tps.toFixed(1),"틱 처리율"],
    ["MSPT",s.mspt == null ? "—" : s.mspt.toFixed(1),"평균 처리 시간"],
    ["가동 시간",s.uptime,"마지막 시작 이후"]
  ].map(([title,value,note]) => `<div class="card stat-card"><span>${h(title)}</span><strong>${h(value)}</strong><small>${h(note)}</small></div>`).join("");
  const resources = [
    ["CPU 사용량",s.cpu.toFixed(1)+"%","호스트 프로세서",s.cpu/100],
    ["메모리 사용량",formatMemory(s.memoryGb)+" / "+s.memoryLimitGb+" GB","할당 메모리 대비 사용량",s.memoryGb/s.memoryLimitGb]
  ].map(([title,value,note,percent],index) => `<div class="card resource-card"><h2>${h(title)}</h2>
    <strong>${h(value)}</strong><p>${h(note)}</p><div class="progress-track"><div class="progress-fill ${index ? "green" : ""}" style="width:${Math.min(100,Math.max(0,percent*100))}%"></div></div></div>`).join("");
  return `${header("서버 개요","서버 상태와 자원 사용량을 확인합니다")}
    <div class="card overview-head"><div class="server-glyph">${icon("server","large")}</div><div class="overview-title">
    <h2>${h(s.name)}</h2><p>${h(s.version)} · 가동 ${h(s.uptime)}</p></div>${badge(s.status)}<div class="page-actions">${action}</div></div>
    <div class="grid-stats">${metrics}</div><div class="two-col">${resources}</div>
    ${card("실행 환경",`<div class="info-list"><div class="info-line"><strong>실행 경로</strong><span class="right mono">${h(s.directory)}</span></div>
    <div class="info-line"><strong>접속 포트</strong><span class="right mono">${s.port}</span></div></div>`)}
    ${demoNote()}`;
}
const emptyServer = () => `<div class="card empty-state">${icon("server","large")}<strong>선택된 서버가 없습니다</strong><p>서버 목록에서 서버를 선택하세요.</p><a class="btn" href="#/servers">서버 목록 열기</a></div>`;
function renderLogRows() {
  const rows = recentLogs(state.logs,state.query,state.level);
  if (!rows.length) return `<div class="log-empty">조건에 맞는 로그가 없습니다.</div>`;
  return rows.map((row,i) => `<div class="log-line ${row.level.toLowerCase()}" role="row">
    <span class="mono">${String(i+1).padStart(2,"0")}</span>
    <span class="log-time mono">${h(row.time)}</span>
    <span class="log-level mono">${h(row.level)}</span>
    <span class="log-message">${h(row.message)}</span></div>`).join("");
}
function renderConsole() {
  const s = server();
  return `<div class="console-page">${header("콘솔",(s?.name || "서버 없음")+" · 로그 확인 및 명령어 실행")}
    <div class="toolbar console-toolbar">
      <label class="search-field">${icon("search")}<input class="field" id="log-search" placeholder="로그 검색" aria-label="로그 검색" value="${h(state.query)}"></label>
      <div class="filter-tabs" role="group" aria-label="로그 수준">
      ${[["all","전체"],["info","정보"],["warn","경고"],["error","오류"]].map(([key,label]) =>
        `<button class="filter-tab ${state.level === key ? "active" : ""}" data-action="log-level" data-level="${key}" aria-pressed="${state.level===key}">${label}</button>`).join("")}</div>
      <div class="toolbar-spacer"></div>
      <label class="checkbox-label"><input type="checkbox" id="log-autoscroll" ${state.autoScroll ? "checked":""}>자동 스크롤</label>
      ${button(`${icon("download","small")} 로그 내보내기`,"download-logs","export-btn")}
    </div>
    <section class="console-panel" aria-label="실시간 서버 로그">
      <header class="console-statusbar">
        <span class="console-status ${!s || s.status !== "running" ? "offline" : ""}"><i class="indicator"></i>${state.mode==="demo" ? "예시 로그" : state.logError ? "연결 오류" : "연결됨"}</span>
        <span class="console-separator console-desktop"></span><span class="console-muted console-desktop">${h(s?.name || "선택된 서버 없음")}</span>
        <span class="console-grow"></span><span class="console-muted console-desktop">실시간 출력</span>
        <span class="console-separator console-desktop"></span><span class="console-muted mono">UTF-8</span>
        <span class="console-muted console-desktop">최근 ${recentLogs(state.logs,state.query,state.level).length}줄</span>
      </header>
      <div class="log-header log-grid"><span>번호</span><span>시각</span><span>수준</span><span>메시지</span></div>
      <div class="log-viewport" id="log-viewport" role="log" aria-live="off"><div class="log-rows" id="log-rows">${renderLogRows()}</div></div>
      <form class="console-composer" id="console-form"><label class="command-field"><span>›</span>
        <input id="console-command" aria-label="서버 명령어" autocomplete="off" maxlength="512" placeholder="서버 명령어 입력" value="${h(state.command)}"></label>
        <button class="btn primary command-send" type="submit">전송</button></form>
    </section>
    <p class="console-help">${state.mode === "demo" ? "예시 모드: 입력한 명령은 실제 서버에 전송되지 않습니다." : "명령어는 현재 선택된 서버에 전송됩니다. 관리 권한이 있는 계정에서만 사용하세요."}</p></div>`;
}

function renderFiles() {
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
function renderBackups() {
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
  return `${header("사용자","사용자와 서버별 권한을 확인합니다",button(`${icon("plus","small")} 사용자 초대`,"user-invite","primary"))}
    ${card("워크스페이스 사용자",`<div class="table-scroll"><table class="data-table"><thead><tr>
      <th>사용자</th><th>권한</th><th>접근 범위</th></tr></thead><tbody>
      ${DEMO_USERS.map((u) => `<tr><td><strong>${h(u.name)}</strong></td><td>${h(u.role)}</td><td>${h(u.scope)}</td></tr>`).join("")}
      </tbody></table></div>`)}${demoNote()}`;
}
function renderAudit() {
  return `${header("감사 로그","서버와 패널의 주요 작업 기록을 확인합니다",button(`${icon("download","small")} 내보내기`,"audit-export"))}
    ${card("최근 감사 기록",`<div class="table-scroll"><table class="data-table"><thead><tr>
      <th>시각</th><th>작업</th><th>사용자</th><th>대상</th></tr></thead><tbody>
      ${DEMO_AUDIT.map((entry) => `<tr><td class="mono">${h(entry.time)}</td><td>${h(entry.action)}</td>
        <td>${h(entry.actor)}</td><td>${h(entry.target)}</td></tr>`).join("")}
      </tbody></table></div>`)}${demoNote()}`;
}
function renderSettings() {
  const st = state.settings;
  return `${header("설정","패널 표시 환경과 기본 설정을 관리합니다")}
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
        <input id="new-server-name" name="server-name" class="field" maxlength="80" required placeholder="예: PvP Practice"></div>
      <div class="form-group"><label for="new-server-kind">서버 유형</label><select class="select" id="new-server-kind" name="server-kind"><option>마인크래프트 · 새 서버</option><option>프록시</option></select></div></div>
      <div class="modal-actions" style="margin-top:25px"><button class="btn" type="button" data-action="modal-close">취소</button>
        <button class="btn primary" type="submit">서버 추가</button></div>
    </form></div>`;
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
function render() {
  document.title = routeTitle() + " · 피컨";
  const app = $("#app");
  if (!app) return;
  let content = "";
  if (state.loading) {
    content = `<div class="card empty-state">${icon("refresh","large")}<strong>서버 정보를 불러오는 중입니다</strong><p>연결된 API에 요청하고 있습니다.</p></div>`;
  } else if (state.apiError && state.mode === "live" && !state.servers.length) {
    content = `<div class="card empty-state">${icon("alert","large")}<strong>서버 연결에 실패했습니다</strong><p>${h(state.apiError)}</p>
      <button class="btn" style="margin-top:18px" data-action="api-retry">다시 시도</button></div>`;
  } else content = renderPage();
  app.innerHTML = `<div class="app-shell">${renderSidebar()}<div class="main-shell">${renderChrome()}
    <main class="page ${state.route==="console"?"console-page":""}" id="main-content">${content}
      ${state.route!=="console"?`<div class="footer">피컨 · ${state.mode==="demo"?"프런트엔드 시연":"서버 관리"} · <a href="https://github.com/Pma10/Panel" target="_blank" rel="noopener noreferrer">GitHub</a></div>`:""}
    </main></div></div><div id="modal-root">${modalBody()}</div><div id="toast-root" aria-live="polite"></div>`;
  if (state.route === "console") scrollLogs();
  if (state.route === "servers") filterServerRows();
}
function setModal(modal) {
  state.modal = modal;
  const host = $("#modal-root");
  if (host) host.innerHTML = modalBody();
  if (modal?.kind === "palette") {
    const input = $("#palette-search");
    input?.focus();
  } else if (modal?.kind === "create") $("#new-server-name")?.focus();
  else if (modal) $("#modal-root .btn")?.focus();
}
function toast(message) {
  const host = $("#toast-root");
  if (!host) return;
  host.innerHTML = `<div class="toast" role="status">${h(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (host.isConnected) host.innerHTML = ""; }, 3500);
}
function scrollLogs() {
  if (!state.autoScroll) return;
  requestAnimationFrame(() => {
    const pane = $("#log-viewport");
    if (pane) pane.scrollTop = pane.scrollHeight;
  });
}
function updateLogRows() {
  const parent = $("#log-rows");
  if (!parent || state.route !== "console" || document.hidden) return;
  parent.innerHTML = renderLogRows();
  const count = $(".console-statusbar .console-muted:last-child");
  if (count && count.textContent.endsWith("줄")) {
    count.textContent = "최근 " + recentLogs(state.logs,state.query,state.level).length + "줄";
  }
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
  const term = state.serverQuery.trim().toLocaleLowerCase("ko");
  document.querySelectorAll("[data-server-row]").forEach((tr) => {
    const text = tr.dataset.filterText || "";
    tr.hidden = !(!term || text.includes(term)) || (state.serverStatus !== "all" && tr.dataset.status !== state.serverStatus);
  });
}
function navigate(route) {
  if (!routeMap[route]) return;
  state.mobileMenu = false;
  state.modal = null;
  if (location.hash !== "#/" + route) location.hash = "#/" + route;
  else { state.route = route; render(); }
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
  const rows = entries.map((row) => "["+row.time+" "+row.level+"] "+row.message);
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
    await apiRequest("/servers/"+encodeURIComponent(s.id)+"/actions/"+action,{method:"POST"});
    toast("서버 작업 요청이 접수되었습니다."); await loadFromApi();
  } catch (error) { toast(error.message); }
}
async function createBackup() {
  if (state.mode === "demo") { setModal(null); return toast("예시 모드: 실제 백업을 생성하지 않았습니다."); }
  try { await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/backups",{method:"POST"});toast("백업 작업이 접수되었습니다."); }
  catch(e) { toast(e.message); }
  setModal(null);
}
async function restoreBackup() {
  const id=state.modal?.id;setModal(null);
  if (!id) return;
  if (state.mode === "demo") return toast("예시 모드: 실제 백업 복원은 실행되지 않았습니다.");
  try { await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/backups/"+encodeURIComponent(id)+"/restore",{method:"POST"});toast("복원 작업이 접수되었습니다.");}
  catch(e) { toast(e.message); }
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
    state.servers = items.filter((it) => it && typeof it.id === "string" && typeof it.name === "string")
      .map((it) => ({...it,status:it.status||"unknown",players:Number(it.players)||0,maxPlayers:Number(it.maxPlayers)||0,
        memoryGb:Number(it.memoryGb)||0,memoryLimitGb:Number(it.memoryLimitGb)||1,cpu:Number(it.cpu)||0,
        directory:it.directory||"—",version:it.version||"—",uptime:it.uptime||"—"}));
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
  },() => {
    if (state.selectedId !== serverId) return;
    state.logError = "";
    const label = $(".console-status");
    if (label?.lastChild?.nodeType === 3) label.lastChild.textContent = "연결됨";
  });
}
window.addEventListener("hashchange", () => {
  state.route=routeFromHash(location.hash);state.mobileMenu=false;state.modal=null;
  cancelLogUpdate();render();connectLogStream(); window.scrollTo({top:0,behavior:"auto"});
});
document.addEventListener("keydown",(event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==="k") {
    event.preventDefault();state.paletteQuery="";setModal({kind:"palette"});return;
  }
  if (event.key==="Escape" && state.modal) {event.preventDefault();setModal(null);}
  if (event.key==="Enter" && event.target?.id==="console-command") {
    event.preventDefault();sendCommand();
  }
  if (event.key==="Enter" && event.target?.id==="palette-search") {
    const first = ROUTE_INFO.find((r) => r.label.toLowerCase().includes(state.paletteQuery.toLowerCase()));
    if (first) navigate(first.route);
  }
});
document.addEventListener("input",(event) => {
  if (event.target.id === "log-search") { state.query=event.target.value;updateLogRows(); }
  if (event.target.id === "server-search") { state.serverQuery=event.target.value;filterServerRows(); }
  if (event.target.id === "console-command") { state.command=event.target.value; }
  if (event.target.id === "palette-search") {
    state.paletteQuery=event.target.value;const root=$("#palette-results");if(root)root.innerHTML=paletteItems();
  }
});
document.addEventListener("change",(event) => {
  if (event.target.id==="log-autoscroll") {state.autoScroll=event.target.checked;scrollLogs();}
  if (event.target.id==="server-status"){state.serverStatus=event.target.value;filterServerRows();}
});
document.addEventListener("click",async(event) => {
  const target = event.target.closest("[data-action]");if (!target) return;
  const action=target.dataset.action;
  if (action==="navigate") {state.mobileMenu=false;return;}
  if (action==="modal-background" && event.target===target){setModal(null);return;}
  if (action==="modal-close"){setModal(null);return;}
  if (action==="open-menu"){state.mobileMenu=true;render();return;}
  if (action==="close-menu"){state.mobileMenu=false;render();return;}
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
  if (action==="power-confirm"){
    const power=target.dataset.power || "restart";
    const title=power==="stop"?"서버를 중지할까요?":power==="restart"?"서버를 재시작할까요?":"서버를 시작할까요?";
    setModal({kind:"confirm",title,description: selectedName()+" 서버에서 실행 중인 작업과 플레이어 연결에 영향을 줄 수 있습니다.",
      power,confirmLabel: power==="stop"?"서버 중지":power==="restart"?"재시작":"시작",confirmAction:"power-run",danger:power==="stop"});return;
  }
  if (action==="power-run"){await performPowerAction();return;}
  if (action==="download-logs"){exportLogs();return;}
  if (action==="file-select"){state.selectedFile=target.dataset.name;render();return;}
  if (action==="file-root"){state.filePath="/home/minecraft/server";state.selectedFile="";render();return;}
  if (action==="file-open"){
    const value=DEMO_FILES.find((x)=>x.name===target.dataset.name);
    if(value?.type==="folder"){state.filePath="/home/minecraft/server/"+value.name;state.selectedFile="";render();}
    else mockActionMessage("파일 미리보기");return;
  }
  if (action==="backup-create"){setModal({kind:"confirm",title:"새 백업을 생성할까요?",description:"현재 월드 상태를 백업합니다.",
    confirmLabel:"백업 생성",confirmAction:"backup-run"});return;}
  if (action==="backup-run"){await createBackup();return;}
  if (action==="backup-restore"){
    const id=target.dataset.id;setModal({kind:"confirm",title:"백업을 복원할까요?",
      description:"백업 #"+id+"으로 복원하면 현재 월드 데이터가 바뀔 수 있습니다. 복원 전에 별도 백업을 권장합니다.",
      id,confirmLabel:"복원",confirmAction:"restore-run",danger:true});return;}
  if (action==="restore-run"){await restoreBackup();return;}
  if (action==="audit-export"){downloadText("pconn-audit.txt",DEMO_AUDIT.map((x)=>[x.time,x.action,x.actor,x.target].join(" | ")).join("\n"));toast("예시 감사 기록을 내보냈습니다.");return;}
  if (action==="theme-toggle"){
    state.theme=state.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=state.theme;store("pconn-theme",state.theme);render();return;
  }
  if (action==="show-notifications"){setModal({kind:"notice",title:"알림",description:"현재 확인할 새 알림이 없습니다. 실제 서버 알림은 API 연동 이후 제공됩니다.",
    confirmLabel:"닫기",confirmAction:"modal-close"});return;}
  if (action==="api-retry"){await loadFromApi();return;}
  if (["file-upload","file-new-folder","network-add","user-invite","health-check"].includes(action)){mockActionMessage(action);return;}
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
  if(!["console-form","startup-form","settings-form","schedule-form","create-server-form"].includes(form.id))return;
  event.preventDefault();
  if(form.id==="console-form"){await sendCommand();return;}
  if(form.id==="startup-form"){
    const d=new FormData(form);
    const input={executable:String(d.get("executable")||""),directory:String(d.get("directory")||""),
      memory:String(d.get("memory")||""),timeout:String(d.get("timeout")||""),
      arguments:String(d.get("arguments")||""),autoRestart:d.has("autoRestart")};
    if(state.mode==="demo"){state.startup=input;store("pconn-startup",input);toast("예시 시작 설정만 브라우저에 저장했습니다.");}
    else{try{await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/startup",{method:"PATCH",body:input});toast("설정 저장 요청이 완료되었습니다.");}catch(e){toast(e.message);}}
    return;
  }
  if(form.id==="settings-form"){
    const d=new FormData(form);
    const values={panelName:String(d.get("panelName")||"피컨"),timezone:String(d.get("timezone")||"Asia/Seoul"),
      sessionHours:String(d.get("sessionHours")||"24"),retention:String(d.get("retention")||"7"),audit:state.settings.audit};
    state.settings=values;store("pconn-settings",values);toast("화면 미리보기 설정을 브라우저에 저장했습니다. 서버 정책은 변경되지 않았습니다.");return;
  }
  if(form.id==="schedule-form"){
    const d=new FormData(form);const name=String(d.get("schedule-name")||"").trim();
    if(!name)return toast("작업 이름을 입력해 주세요.");
    if(state.mode==="demo"){if(state.schedules.length>=50)return toast("예시 작업은 최대 50개까지 등록할 수 있습니다.");state.schedules.push({id:"demo-"+Date.now(),name,when:String(d.get("schedule-cron")||""),type:String(d.get("schedule-type")||"백업"),active:false});render();toast("예시 작업에만 추가되었습니다. 실제 실행은 예약되지 않았습니다.");}
    else{try{await apiRequest("/servers/"+encodeURIComponent(state.selectedId)+"/schedules",{method:"POST",body:{name,cron:String(d.get("schedule-cron")),type:String(d.get("schedule-type"))}});toast("예약 작업 생성 요청이 접수되었습니다.");}catch(e){toast(e.message);}}
    return;
  }
  if(form.id==="create-server-form"){
    const d=new FormData(form);const name=String(d.get("server-name")||"").trim();
    if(!name)return toast("서버 이름을 입력해 주세요.");
    if(state.mode==="demo"){
      if(state.servers.length>=50)return toast("예시 서버는 최대 50대까지 등록할 수 있습니다.");
      const id="demo-"+Date.now();
      state.servers.push({id,name,kind:String(d.get("server-kind")||"마인크래프트"),status:"stopped",players:0,maxPlayers:20,memoryGb:0,memoryLimitGb:4,cpu:0,tps:null,mspt:null,port:25569,uptime:"—",version:"예시 서버",directory:"—"});
      state.selectedId=id;setModal(null);navigate("servers");toast("예시 서버를 목록에 추가했습니다. 실제 서버는 생성되지 않았습니다.");
    }else{
      try{await apiRequest("/servers",{method:"POST",body:{name,kind:String(d.get("server-kind")||"마인크래프트")}});setModal(null);await loadFromApi();toast("서버 생성 요청이 접수되었습니다.");}
      catch(e){toast(e.message);}
    }
  }
});
render();
if (apiEnabled) loadFromApi();
