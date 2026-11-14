/** Safe text-only utilities shared by the browser and Node's built-in tests. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
export function filterLogs(entries, query = "", level = "all") {
  const term = query.trim().toLocaleLowerCase("ko");
  return entries.filter((entry) => {
    const matchLevel = level === "all" || entry.level.toLowerCase() === level.toLowerCase();
    const matchTerm = !term || [entry.time, entry.level, entry.message].some((v) => String(v).toLocaleLowerCase("ko").includes(term));
    return matchLevel && matchTerm;
  });
}
export function serverSummary(servers) {
  return {
    total: servers.length,
    running: servers.filter((s) => s.status === "running").length,
    players: servers.filter((s) => s.status === "running").reduce((sum, s) => sum + (s.players ?? 0), 0),
    memoryGb: servers.reduce((sum, s) => sum + (s.memoryGb ?? 0), 0)
  };
}
export function formatMemory(gb) {
  return Number.isFinite(gb) ? gb.toFixed(1) + " GB" : "—";
}
export function validateCommand(input) {
  const value = String(input || "").trim();
  if (!value) return { valid: false, error: "명령어를 입력해 주세요." };
  if (value.length > 512) return { valid: false, error: "명령어는 512자를 넘을 수 없습니다." };
  if (/[\r\n\0]/.test(value)) return { valid: false, error: "여러 줄 명령은 허용하지 않습니다." };
  return { valid: true, value };
}
export const ROUTES = Object.freeze(["dashboard", "servers", "overview", "console", "files", "backups", "startup", "network", "schedules", "health", "users", "audit", "settings"]);
export function routeFromHash(hash) {
  const path = String(hash || "").replace(/^#\/?/, "").replace(/^\/+/, "").split(/[?\/]/)[0];
  return ROUTES.includes(path) ? path : "dashboard";
}
