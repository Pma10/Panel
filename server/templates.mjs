import { createHash, randomBytes } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { lstat, rm, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { HttpError, assert } from "./security.mjs";

const USER_AGENT = "PConnPanel/0.2 (https://github.com/Pma10/Panel)";
const API_ORIGIN = "https://fill.papermc.io";
const DOWNLOAD_ORIGIN = "https://fill-data.papermc.io";
export const MAX_INSTALL_BYTES = 256 * 1024 * 1024;

export const TEMPLATES = Object.freeze([
  { id: "manual", name: "직접 JAR 업로드", description: "Leaf, PmaPaper, 모드 서버 등 원하는 Java JAR을 직접 업로드", automatic: false },
  { id: "paper", name: "Paper", description: "PaperMC에서 안정 버전 서버 JAR 설치", automatic: true },
  { id: "folia", name: "Folia", description: "Folia 호환 플러그인을 사용해야 하는 멀티스레드 서버", automatic: true }
]);

export const allowedTemplate = id => TEMPLATES.some(t => t.id === id);
export const automaticTemplate = id => id === "paper" || id === "folia";

function checkedVersion(version) {
  assert(typeof version === "string" && /^\d+(?:\.\d+){1,3}(?:-[a-z0-9._-]{1,30})?$/i.test(version) && version.length <= 48, 400,
    "게임 버전이 올바르지 않습니다.");
  return version;
}
function checkedProject(project) {
  assert(automaticTemplate(project), 400, "지원되지 않는 자동 설치 템플릿입니다.");
  return project;
}
const abortAfter = (ms) => AbortSignal.timeout(ms);

async function upstreamJson(path, fetchImpl = fetch) {
  const response = await fetchImpl(API_ORIGIN + path, {
    method: "GET", redirect: "error", signal: abortAfter(15000),
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" }
  });
  assert(response?.ok, 502, "PaperMC API에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
  const length = Number(response.headers?.get?.("content-length"));
  assert(!Number.isFinite(length) || length <= 1024 * 1024, 502, "PaperMC 응답이 너무 큽니다.");
  const text = await response.text();
  assert(text.length < 1024 * 1024, 502, "PaperMC 응답이 너무 큽니다.");
  try { return JSON.parse(text); }
  catch { throw new HttpError(502, "PaperMC API 응답을 해석하지 못했습니다."); }
}

/** Official project versions grouped as PaperMC's API returns them. */
export async function availableVersions(project, fetchImpl = fetch) {
  checkedProject(project);
  const response = await upstreamJson("/v3/projects/" + project, fetchImpl);
  assert(response && typeof response.versions === "object" && !Array.isArray(response.versions), 502,
    "PaperMC 버전 목록 형식이 올바르지 않습니다.");
  const values = [];
  for (const group of Object.values(response.versions)) {
    if (!Array.isArray(group)) continue;
    for (const version of group) {
      if (typeof version === "string" && version.length <= 48 &&
          /^\d+(?:\.\d+){1,3}(?:-[a-z0-9._-]{1,30})?$/i.test(version) && !values.includes(version))
        values.push(version);
      if (values.length >= 120) return values;
    }
  }
  return values;
}

/** Fail closed if the upstream returns experimental builds or arbitrary URLs. */
export async function stableBuild(project, version, fetchImpl = fetch) {
  checkedProject(project);
  checkedVersion(version);
  const builds = await upstreamJson(
    "/v3/projects/" + project + "/versions/" + encodeURIComponent(version) + "/builds", fetchImpl
  );
  assert(Array.isArray(builds), 502, "PaperMC 빌드 목록 형식이 올바르지 않습니다.");
  const selected = builds.find(x => x?.channel === "STABLE" && x.downloads?.["server:default"]);
  assert(selected, 404, "선택한 버전의 안정 빌드가 없습니다. 다른 버전을 선택하세요.");
  const file = selected.downloads["server:default"];
  const sha256 = file.checksums?.sha256;
  const size = file.size;
  assert(typeof sha256 === "string" && /^[0-9a-f]{64}$/i.test(sha256), 502, "빌드 체크섬이 없습니다.");
  assert(Number.isSafeInteger(size) && size > 1024 && size <= MAX_INSTALL_BYTES, 502, "빌드 크기가 허용 범위 밖입니다.");
  let url;
  try { url = new URL(file.url); } catch {}
  assert(url && url.origin === DOWNLOAD_ORIGIN &&
    /^\/v1\/objects\/[a-f0-9]{64}\/[^/]+\.jar$/i.test(url.pathname) &&
    url.pathname.split("/")[3].toLowerCase() === sha256.toLowerCase() &&
    !url.search && !url.hash && !url.username && !url.password, 502,
    "다운로드 주소가 공식 PaperMC 형식이 아닙니다.");
  return { project, version, buildId: selected.id, sha256: sha256.toLowerCase(), size, url: url.toString() };
}

/**
 * Download only an official stable PaperMC artifact.
 * Streaming/hash verification enforces byte and memory ceilings.
 * Existing server.jar is never overwritten automatically.
 */
export async function installStableJar({ directory, project, version, fetchImpl = fetch }) {
  const build = await stableBuild(project, version, fetchImpl);
  const dest = join(directory, "server.jar");
  try { await lstat(dest); throw new HttpError(409, "server.jar 파일이 이미 존재합니다. 기존 JAR을 백업한 뒤 직접 교체하세요."); }
  catch (e) { if (e.code !== "ENOENT") throw e; }

  const temp = join(directory, ".panel-" + randomBytes(8).toString("hex") + ".download");
  let received = 0;
  const hash = createHash("sha256");
  try {
    const response = await fetchImpl(build.url, {
      method: "GET", redirect: "error", signal: abortAfter(180000),
      headers: { "User-Agent": USER_AGENT, "Accept": "application/java-archive" }
    });
    assert(response?.ok && response.body, 502, "공식 서버 JAR을 다운로드하지 못했습니다.");
    const limiter = new Transform({
      transform(chunk, encoding, next) {
        received += chunk.length;
        if (received > MAX_INSTALL_BYTES || received > build.size)
          return next(new HttpError(413, "서버 JAR의 크기가 예상 값보다 큽니다."));
        hash.update(chunk);
        next(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), limiter,
      createWriteStream(temp, { flags: "wx", mode: 0o600 }));
    assert(received === build.size, 502, "다운로드한 JAR 크기가 공식 메타데이터와 일치하지 않습니다.");
    assert(hash.digest("hex") === build.sha256, 502, "JAR SHA-256 무결성 검증에 실패했습니다.");
    // The manager holds a per-server operation lock during the download.
    try { await lstat(dest); throw new HttpError(409, "설치 중 다른 server.jar 파일이 생성되었습니다."); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    await rename(temp, dest);
    return { project, version, buildId: build.buildId, size: received, sha256: build.sha256, installedAt: new Date().toISOString() };
  } finally {
    await rm(temp, { force: true });
  }
}
