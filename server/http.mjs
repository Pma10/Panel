import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createStaticServer } from "../scripts/serve.mjs";
import { createAuthenticator, HttpError, assert } from "./security.mjs";
import { MinecraftManager } from "./manager.mjs";
import { AuditLog } from "./audit.mjs";

const API="/api/v1";
const MIME={".jar":"application/java-archive",".json":"application/json",".yml":"text/plain",".yaml":"text/plain",".txt":"text/plain",".log":"text/plain"};
function json(res,status,data,headers={}) {
  const value=JSON.stringify(data);
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",...headers});
  res.end(value);
}
async function body(req,limit=65536) {
  assert(String(req.headers["content-type"]||"").startsWith("application/json"),415,"JSON 요청만 허용합니다.");
  let size=0,content="";
  for await(const chunk of req){
    size+=chunk.length;
    assert(size<=limit,413,"요청 크기가 너무 큽니다.");
    content+=chunk.toString("utf8");
  }
  try {
    const data=JSON.parse(content);
    assert(data && typeof data==="object" && !Array.isArray(data),400,"JSON 객체가 필요합니다.");
    return data;
  } catch(e) {if(e instanceof HttpError)throw e;throw new HttpError(400,"JSON 형식이 잘못되었습니다.");}
}
function head(req,expectedOrigin) {
  assert(req.headers.origin===expectedOrigin,403,"다른 출처의 요청은 허용되지 않습니다.");
}
function noCache(res) {
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
}
function requireMethod(method,allowed) {assert(method===allowed,405,"허용되지 않은 HTTP 메서드입니다.");}
const OPTIONS_BASE={
  "X-Frame-Options":"DENY",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Permissions-Policy":"camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};

export async function makePanel({root=process.env.PANEL_DATA_DIR||"./.panel-data",adminPassword=process.env.PANEL_ADMIN_PASSWORD,
  javaBin=process.env.PANEL_JAVA_BIN||"java",origin=process.env.PANEL_PUBLIC_ORIGIN,
  staticRoot=resolve("."),secure}={}){
  assert(origin && /^https?:\/\//.test(origin),500,"PANEL_PUBLIC_ORIGIN이 필요합니다.");
  const url=new URL(origin);
  assert(url.origin===origin,500,"PANEL_PUBLIC_ORIGIN은 완전한 출처(스킴+호스트+포트)여야 합니다.");
  const auth=createAuthenticator(adminPassword,{origin,secure:secure??url.protocol==="https:"});
  const manager=new MinecraftManager({dataDir:root,javaBin});
  await manager.init();
  const audit=new AuditLog(manager.root);
  await audit.init();
  const staticApp=createStaticServer(staticRoot);
  let clients=0;
  const liveResponses=new Set();
  async function routes(req,res,path,query) {
    const method=req.method;
    if(path===API+"/auth/login"){
      requireMethod(method,"POST");head(req,origin);
      const data=await body(req,8192);
      const session=auth.verifyPassword(data.password,req.socket.remoteAddress||"unknown");
      return json(res,200,{authenticated:true,username:"관리자",csrf:session.csrf},
        {"Set-Cookie":auth.cookie(session.id)});
    }
    if(path===API+"/auth/session"){
      requireMethod(method,"GET");
      const s=auth.requireSession(req);
      return json(res,200,{authenticated:true,username:"관리자",csrf:s.csrf});
    }
    const user=auth.requireSession(req);
    if(method!=="GET"&&method!=="HEAD")auth.checkMutation(req,user);
    if(path===API+"/auth/logout"){
      requireMethod(method,"POST");
      auth.clear(user.id);
      return json(res,200,{loggedOut:true},{"Set-Cookie":auth.clearCookie()});
    }
    if(path===API+"/audit"){
      requireMethod(method,"GET");
      return json(res,200,{entries:audit.list()});
    }
    if(path===API+"/servers"){
      if(method==="GET")return json(res,200,{servers:await manager.list()});
      requireMethod(method,"POST");
      return json(res,201,await manager.create(await body(req)));
    }

    const match=path.match(/^\/api\/v1\/servers\/([a-f0-9]{16})(?:\/(.*))?$/);
    assert(match,404,"엔드포인트를 찾을 수 없습니다.");
    const id=match[1],rest=match[2]||"";
    manager.get(id);
    if(!rest) {
      requireMethod(method,"GET");
      return json(res,200,await manager.summary(manager.get(id)));
    }
    if(rest==="health"){
      requireMethod(method,"GET");
      const current=await manager.summary(manager.get(id));
      return json(res,200,{id:current.id,status:current.status,memoryGb:current.memoryGb,uptime:current.uptime});
    }
    if(rest==="network"){
      requireMethod(method,"GET");
      const cfg=manager.get(id);
      return json(res,200,{ports:[{port:cfg.port,protocol:"TCP",description:"Minecraft 접속",status:"allocated"}]});
    }
    if(rest==="startup"){
      if(method==="GET"){
        const {name,memoryMb,jar,eulaAccepted,port}=manager.get(id);
        return json(res,200,{name,memoryMb,jar,eulaAccepted,port});
      }
      requireMethod(method,"PATCH");
      return json(res,200,await manager.update(id,await body(req)));
    }
    if(rest==="logs"){
      requireMethod(method,"GET");
      return json(res,200,{entries:manager.history(id)});
    }
    if(rest==="logs/stream"){
      requireMethod(method,"GET");
      assert(clients<32,429,"실시간 콘솔 연결 수 한도를 초과했습니다.");
      clients++;
      liveResponses.add(res);
      res.writeHead(200,{
        "Content-Type":"text/event-stream; charset=utf-8",
        "Cache-Control":"no-cache, no-transform",
        "Connection":"keep-alive",
        "X-Accel-Buffering":"no",
        "X-Content-Type-Options":"nosniff"
      });
      res.write(": connected\n\n");
      let ended=false;
      const close=()=>{if(ended)return;ended=true;clients--;liveResponses.delete(res);clearInterval(ping);unsubscribe();};
      const send=e=>{
        if(ended)return;
        if(!res.write("data: "+JSON.stringify(e)+"\n\n")){
          // Under backpressure, disconnect rather than retaining unbounded buffers.
          close();res.destroy();
        }
      };
      const unsubscribe=manager.subscribe(id,send);
      const ping=setInterval(()=>{if(!ended && !res.write(": ping\n\n")){close();res.destroy();}},25000);
      ping.unref();
      req.on("close",close);
      res.on("close",close);
      return;
    }
    if(rest==="commands"){
      requireMethod(method,"POST");
      const command=(await body(req)).command;
      return json(res,202,manager.command(id,command));
    }
    if(rest.startsWith("actions/")){
      requireMethod(method,"POST");
      const action=rest.slice("actions/".length);
      assert(["start","stop","restart"].includes(action),400,"서버 제어 작업이 올바르지 않습니다.");
      const result=await manager[action](id);
      return json(res,202,result);
    }
    if(rest==="files"){
      if(method==="GET")return json(res,200,{path:query.get("path")||"",entries:await manager.files(id,query.get("path")||"")});
      if(method==="DELETE")return json(res,200,await manager.removeFile(id,query.get("path")||""));
    }
    if(rest==="files/content"){
      requireMethod(method,"GET");
      return json(res,200,{path:query.get("path")||"",text:await manager.readText(id,query.get("path")||"")});
    }
    if(rest==="files/download"){
      requireMethod(method,"GET");
      const name=query.get("path")||"";
      const file=await manager.fileInfo(id,name);
      const encoded=encodeURIComponent(name.split("/").at(-1));
      res.writeHead(200,{"Content-Type":MIME[extname(name)]||"application/octet-stream",
        "Content-Disposition":"attachment; filename*=UTF-8''"+encoded,
        "Content-Length":String(file.size),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
      createReadStream(file.path).on("error",()=>res.destroy()).pipe(res);
      return;
    }
    if(rest==="files/upload"){
      requireMethod(method,"PUT");
      assert(String(req.headers["content-type"]||"").startsWith("application/octet-stream"),415,"파일은 바이너리로 업로드하세요.");
      return json(res,201,await manager.upload(id,query.get("path")||"",req));
    }
    if(rest==="files/mkdir"){
      requireMethod(method,"POST");
      return json(res,201,await manager.mkdir(id,(await body(req)).path));
    }
    if(rest==="files/rename"){
      requireMethod(method,"PATCH");
      const {from,to}=await body(req);
      return json(res,200,await manager.renameFile(id,from,to));
    }
    if(rest==="backups"){
      if(method==="GET")return json(res,200,{backups:await manager.backups(id)});
      requireMethod(method,"POST");
      return json(res,201,await manager.backup(id));
    }
    const restore=rest.match(/^backups\/([a-f0-9]{16})\/restore$/);
    if(restore){
      requireMethod(method,"POST");
      return json(res,200,await manager.restore(id,restore[1]));
    }
    if(rest==="schedules"){
      if(method==="GET")return json(res,200,{schedules:await manager.schedules(id)});
      requireMethod(method,"POST");
      return json(res,201,await manager.addSchedule(id,await body(req)));
    }
    const schedule=rest.match(/^schedules\/([a-f0-9]{16})$/);
    if(schedule){
      requireMethod(method,"DELETE");
      return json(res,200,await manager.deleteSchedule(id,schedule[1]));
    }
    throw new HttpError(404,"엔드포인트를 찾을 수 없습니다.");
  }
  const app=createServer(async(req,res)=>{
    for(const [k,v] of Object.entries(OPTIONS_BASE))res.setHeader(k,v);
    let requestUrl;
    try{requestUrl=new URL(req.url||"/","http://localhost");}
    catch{res.writeHead(400);res.end("Invalid URL");return;}
    if(requestUrl.pathname.startsWith(API)) {
      try{
        await routes(req,res,requestUrl.pathname,requestUrl.searchParams);
        if(!["GET","HEAD"].includes(req.method) && !requestUrl.pathname.includes("/auth/")){
          const found=requestUrl.pathname.match(/^\/api\/v1\/servers\/([a-f0-9]{16})/);
          audit.record({action:req.method+" "+requestUrl.pathname,serverId:found?.[1]||null})
            .catch(error=>console.error("Audit log error:",error));
        }
      }
      catch(e){
        if(res.headersSent){res.destroy();return;}
        if(!(e instanceof HttpError))console.error("API request error:",e);
        return json(res,e instanceof HttpError?e.status:500,{
          message:e instanceof HttpError?e.message:"요청을 처리할 수 없습니다."
        });
      }
      return;
    }
    if(requestUrl.pathname==="/panel-config.js"){
      if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405);res.end();return;}
      res.writeHead(200,{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"no-store"});
      res.end(req.method==="HEAD"?"":"window.PCONN_API_BASE = window.location.origin;");
      return;
    }
    // Static assets are allowlisted in the existing static-file server.
    staticApp.emit("request",req,res);
  });
  return {server:app,manager,auth,audit,close:async()=>{
    for(const response of [...liveResponses]){try{response.end();}catch{}}
    await manager.close();
    await new Promise(resolve=>app.close(()=>resolve()));
  }};
}
