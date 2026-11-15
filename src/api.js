/**
 * Same-origin API adapter for the managed Minecraft backend.
 * The static preview has no API and deliberately stays in demo mode.
 */
const configuredBase = typeof window === "undefined" ? "" : window.PCONN_API_BASE;
export const apiEnabled = typeof configuredBase === "string" && configuredBase.length > 0;
const base = apiEnabled ? configuredBase.replace(/\/+$/,"") : "";
let csrfToken = "";

const endpoint = (path) => base + "/api/v1" + path;
export function setCsrf(token) {csrfToken = typeof token === "string" ? token : "";}
export async function apiRequest(path,{method="GET",body,headers={},timeoutMs=20000,anonymous=false}={}) {
  if(!apiEnabled)throw new Error("실제 서버 API가 연결되어 있지 않습니다.");
  const requestHeaders={Accept:"application/json",...headers};
  if(body!==undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer))
    requestHeaders["Content-Type"]="application/json";
  if(!["GET","HEAD"].includes(method) && !anonymous) {
    if(!csrfToken)throw new Error("로그인 세션이 없습니다.");
    requestHeaders["X-CSRF-Token"]=csrfToken;
  }
  const response=await fetch(endpoint(path),{
    method,credentials:"same-origin",headers:requestHeaders,
    ...(body===undefined?{}:{body:(body instanceof Blob||body instanceof ArrayBuffer)?body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(!response.ok){
    const message=await response.json().catch(()=>null);
    if(response.status===401){
      setCsrf("");
      if(path!=="/auth/session" && path!=="/auth/login" && typeof window!=="undefined" && typeof Event!=="undefined"){
        window.dispatchEvent(new Event("pconn-session-expired"));
      }
    }
    const error=new Error(message?.message||"API 요청 실패 ("+response.status+")");
    error.status=response.status;throw error;
  }
  if(response.status===204)return null;
  return response.json();
}
export async function getSession(){
  if(!apiEnabled)return null;
  const data=await apiRequest("/auth/session");
  setCsrf(data.csrf);return data;
}
export async function signIn(password){
  const data=await apiRequest("/auth/login",{method:"POST",body:{password},anonymous:true});
  setCsrf(data.csrf);return data;
}
export async function signOut(){
  try{await apiRequest("/auth/logout",{method:"POST"});}
  finally{setCsrf("");}
}
export async function uploadFile(serverId,path,file){
  if(!apiEnabled)throw new Error("API 연결이 없습니다.");
  const result=await apiRequest("/servers/"+encodeURIComponent(serverId)+"/files/upload?path="+encodeURIComponent(path),{
    method:"PUT",body:file,headers:{"Content-Type":"application/octet-stream"},timeoutMs:300000
  });
  return result;
}
export const fileDownloadUrl = (serverId,path) => endpoint("/servers/"+encodeURIComponent(serverId)+"/files/download?path="+encodeURIComponent(path));
export async function downloadFile(serverId,path){
  const response=await fetch(endpoint("/servers/"+encodeURIComponent(serverId)+"/files/download?path="+encodeURIComponent(path)),{
    credentials:"same-origin",signal:AbortSignal.timeout(120000)
  });
  if(!response.ok)throw new Error("파일 다운로드 실패 ("+response.status+")");
  return await response.blob();
}
export function streamLogs(serverId,onEntry,onError,onOpen) {
  if(!apiEnabled)return()=>{};
  const url=endpoint("/servers/"+encodeURIComponent(serverId)+"/logs/stream");
  const source=new EventSource(url,{withCredentials:false});
  source.onopen=()=>onOpen?.();
  source.onmessage=(message)=>{
    try{
      const entry=JSON.parse(message.data);
      if(entry && typeof entry.message==="string" && typeof entry.level==="string" && typeof entry.time==="string")onEntry(entry);
    }catch{onError?.(new Error("실시간 로그를 해석하지 못했습니다."));}
  };
  source.onerror=()=>onError?.(new Error("실시간 로그 연결 오류"));
  return()=>{source.onmessage=null;source.onerror=null;source.onopen=null;source.close();};
}
