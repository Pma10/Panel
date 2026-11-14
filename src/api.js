
/**
 * Optional authenticated backend integration.
 * When window.PCONN_API_BASE is missing, the entire application is visibly demo-only.
 *
 * Server contract (see README):
 * GET  /api/v1/servers
 * GET  /api/v1/servers/:id/logs
 * GET  /api/v1/servers/:id/files?path=...
 * POST /api/v1/servers/:id/commands { command }
 * POST /api/v1/servers/:id/actions/:action
 * GET  /api/v1/servers/:id/logs/stream  (SSE)
 *
 * No secrets or server processes ever run in the browser.
 */
const configuredBase = typeof window !== "undefined" ? window.PCONN_API_BASE : undefined;
export const apiEnabled = typeof configuredBase === "string" && configuredBase.length > 0;

function endpoint(path) {
  const base = apiEnabled ? configuredBase.replace(/\/+$/, "") : "";
  return base + "/api/v1" + path;
}
export async function apiRequest(path, { method = "GET", body } = {}) {
  if (!apiEnabled) throw new Error("실제 서버 API가 연결되어 있지 않습니다.");
  const headers = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
  if (csrf) headers["X-CSRF-Token"] = csrf;
  const response = await fetch(endpoint(path), {
    method, credentials: "same-origin", headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    let detail = null;
    try { detail = await response.json(); } catch {}
    throw new Error(detail?.message || "API 요청 실패 (" + response.status + ")");
  }
  if (response.status === 204) return null;
  return response.json();
}
export function streamLogs(serverId, onEntry, onError) {
  if (!apiEnabled) return () => {};
  const endpointUrl = endpoint("/servers/" + encodeURIComponent(serverId) + "/logs/stream");
  const source = new EventSource(endpointUrl, { withCredentials: false });
  source.onmessage = (message) => {
    try {
      const entry = JSON.parse(message.data);
      if (entry && typeof entry.message === "string" && typeof entry.level === "string" && typeof entry.time === "string") onEntry(entry);
    } catch { onError?.(new Error("로그 이벤트 파싱 실패")); }
  };
  source.onerror = () => onError?.(new Error("실시간 로그 연결 오류"));
  return () => source.close();
}
