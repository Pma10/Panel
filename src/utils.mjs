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
  const result = { total: 0, running: 0, players: 0, memoryGb: 0 };
  for (const item of servers) {
    result.total++;
    if (item.status === "running") {
      result.running++;
      result.players += Number(item.players) || 0;
    }
    result.memoryGb += Number(item.memoryGb) || 0;
  }
  return result;
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
export const ROUTES = Object.freeze(["dashboard", "servers", "overview", "console", "files", "plugins", "backups", "startup", "network", "schedules", "health", "users", "audit", "settings"]);
export function routeFromHash(hash) {
  const path = String(hash || "").replace(/^#\/?/, "").replace(/^\/+/, "").split(/[?\/]/)[0];
  return ROUTES.includes(path) ? path : "dashboard";
}

/**
 * A bounded log history prevents long-running tabs from retaining unlimited
 * strings. Pruning in small chunks amortizes Array.splice and avoids cloning
 * the complete log array on every SSE message.
 */
export const MAX_LOG_ENTRIES = 1200;
export const MAX_VISIBLE_LOGS = 1000;
export const MAX_LOG_CHARS = 4096;

export function appendBoundedLog(entries, raw, limit = MAX_LOG_ENTRIES) {
  if (!raw || typeof raw.time !== "string" || typeof raw.level !== "string" || typeof raw.message !== "string") return false;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid log limit");
  const record = {
    time: raw.time.slice(0, 32),
    level: raw.level.slice(0, 12).toUpperCase(),
    message: raw.message.slice(0, MAX_LOG_CHARS)
  };
  entries.push(record);
  if (entries.length > limit) {
    // Keep some spare space so we don't shift the array for every message.
    const spare = Math.min(128, Math.floor(limit / 4));
    entries.splice(0, entries.length - limit + spare);
  }
  return true;
}

export function recentLogs(entries, query = "", level = "all", limit = MAX_VISIBLE_LOGS) {
  if (!Number.isSafeInteger(limit) || limit < 1) return [];
  const term = String(query).trim().toLocaleLowerCase("ko");
  const normalizedLevel = String(level).toLowerCase();
  const result = [];
  for (let i = entries.length - 1; i >= 0 && result.length < limit; i--) {
    const entry = entries[i];
    if (normalizedLevel !== "all" && entry.level.toLowerCase() !== normalizedLevel) continue;
    if (term && !String(entry.time).toLowerCase().includes(term) &&
        !String(entry.level).toLowerCase().includes(term) &&
        !String(entry.message).toLocaleLowerCase("ko").includes(term)) continue;
    result.push(entry);
  }
  return result.reverse();
}

export function replaceLogHistory(rawEntries, limit = MAX_LOG_ENTRIES) {
  const result = [];
  if (!Array.isArray(rawEntries)) return result;
  for (const entry of rawEntries.slice(-limit)) appendBoundedLog(result, entry, limit);
  return result;
}
