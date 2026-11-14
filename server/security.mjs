import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { resolve, relative, sep, isAbsolute, dirname } from "node:path";
import { lstat, realpath } from "node:fs/promises";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assert(value, status, message) {
  if (!value) throw new HttpError(status,message);
}
export function stringValue(value, name, max = 100) {
  assert(typeof value === "string",400,name+" 형식이 올바르지 않습니다.");
  const result = value.trim();
  assert(result.length > 0 && result.length <= max && !/[\u0000-\u001f\u007f]/.test(result),400,name+" 길이 또는 문자가 올바르지 않습니다.");
  return result;
}
export function positiveInt(value, name, min, max) {
  const n = Number(value);
  assert(Number.isSafeInteger(n) && n>=min && n<=max,400,name+" 범위가 올바르지 않습니다.");
  return n;
}
export function safeRelative(value) {
  assert(typeof value === "string" && value.length <= 1024,400,"파일 경로가 올바르지 않습니다.");
  if (value === "" || value === ".") return "";
  assert(!isAbsolute(value) && !value.includes("\\") && !value.includes("\0"),400,"절대 경로를 사용할 수 없습니다.");
  const parts = value.split("/");
  assert(parts.every(p => p && p !== "." && p !== ".." && !p.startsWith(".panel-")),400,"접근이 허용되지 않은 경로입니다.");
  return parts.join(sep);
}
/** Refuse symbolic links in every path component, not just the final file. */
export async function confinedPath(root, input, { missing = false } = {}) {
  const base = resolve(root);
  const sub = safeRelative(input);
  const target = resolve(base,sub);
  const rel = relative(base,target);
  assert(rel === "" || (!rel.startsWith(".."+sep) && rel !== ".." && !isAbsolute(rel)),403,"서버 폴더 밖으로 접근할 수 없습니다.");
  let current = base;
  const segments = rel ? rel.split(sep) : [];
  for (let i=0;i<segments.length;i++) {
    current = resolve(current,segments[i]);
    try {
      const st = await lstat(current);
      assert(!st.isSymbolicLink(),403,"심볼릭 링크에 접근할 수 없습니다.");
      if (i<segments.length-1) assert(st.isDirectory(),400,"올바르지 않은 폴더 경로입니다.");
    } catch(error) {
      if (error?.code === "ENOENT" && missing && i===segments.length-1) break;
      throw error;
    }
  }
  return target;
}
export function createAuthenticator(password, { secure = false, origin } = {}) {
  assert(typeof password === "string" && password.length >= 12,500,"PANEL_ADMIN_PASSWORD는 12자 이상으로 지정해야 합니다.");
  const salt = randomBytes(32);
  const expected = scryptSync(password,salt,64);
  const sessions = new Map();
  const failures = new Map();
  const TTL = 8*60*60*1000;
  function expire() {
    const now=Date.now();
    for(const [key,s] of sessions) if(s.expires<now) sessions.delete(key);
    for(const [key,item] of failures) if(item.until<now) failures.delete(key);
  }
  function verifyPassword(given,client) {
    expire();
    const now=Date.now();
    const attempt=failures.get(client);
    assert(!attempt || attempt.until<now || attempt.count<8,429,"로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.");
    const hash=scryptSync(String(given ?? "").slice(0,4096),salt,64);
    const valid=timingSafeEqual(expected,hash);
    if(!valid) {
      failures.set(client,{count:(attempt?.until>now?attempt.count:0)+1,until:now+5*60*1000});
      throw new HttpError(401,"비밀번호가 일치하지 않습니다.");
    }
    failures.delete(client);
    if(sessions.size>128) expire();
    assert(sessions.size<128,503,"로그인 세션이 가득 찼습니다.");
    const id=randomBytes(32).toString("hex");
    const csrf=randomBytes(32).toString("hex");
    sessions.set(id,{csrf,expires:Date.now()+TTL});
    return {id,csrf};
  }
  function tokenFrom(req) {
    const cookies=String(req.headers.cookie||"").split(";");
    const cookie=cookies.find(c=>c.trim().startsWith("pconn_session="));
    const key=cookie?.trim().split("=")[1];
    return key && /^[a-f0-9]{64}$/.test(key) ? key : null;
  }
  function session(req) {
    const key=tokenFrom(req);
    const item=key?sessions.get(key):null;
    if(!item || item.expires<Date.now()) {
      if(key) sessions.delete(key);
      return null;
    }
    return {...item,id:key};
  }
  function requireSession(req) {
    const item=session(req);
    assert(item,401,"로그인이 필요합니다.");
    return item;
  }
  function checkMutation(req,item) {
    const originHeader=req.headers.origin;
    assert(originHeader && originHeader===origin,403,"동일한 출처의 요청만 허용합니다.");
    assert(req.headers["x-csrf-token"]===item.csrf,403,"CSRF 검증에 실패했습니다.");
  }
  return {
    verifyPassword,session,requireSession,checkMutation,
    clear(id) {sessions.delete(id);},
    cookie(id) {return "pconn_session="+id+"; HttpOnly; SameSite=Strict; Path=/; Max-Age="+(TTL/1000)+(secure?"; Secure":"");},
    clearCookie() {return "pconn_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"+(secure?"; Secure":"");}
  };
}
