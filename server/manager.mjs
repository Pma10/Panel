import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, rename, rm, readdir, stat, lstat, copyFile, open, statfs, rmdir } from "node:fs/promises";
import { resolve, join, basename, dirname, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { HttpError, assert, stringValue, positiveInt, confinedPath, safeRelative } from "./security.mjs";

const MAX_LOGS=1200, MAX_LOG_LENGTH=4096, MAX_UPLOAD=256*1024*1024;
const MAX_BACKUP_BYTES=8*1024*1024*1024, MAX_FILES=100_000;
const JAVA_MEMORY_MIN=512, JAVA_MEMORY_MAX=32768;
const now=()=>new Date().toISOString();
const makeId=()=>randomUUID().replaceAll("-","").slice(0,16);
const safeName=s=>stringValue(s,"서버 이름",64);
const serialName=s=>{assert(/^[a-zA-Z0-9._-]{1,100}$/.test(s)&&s!=="."&&s!==".."&&!s.startsWith("."),400,"파일 이름 형식이 올바르지 않습니다.");return s;};
const javaJarName=s=>{const n=serialName(s);assert(n.toLowerCase().endsWith(".jar"),400,"실행 JAR 파일만 지정할 수 있습니다.");return n;};

export class MinecraftManager {
  constructor({dataDir,javaBin="java"}={}) {
    this.root=resolve(dataDir||"./.panel-data");
    this.serversDir=join(this.root,"servers");
    this.backupsDir=join(this.root,"backups");
    this.configPath=join(this.root,"config.json");
    this.javaBin=javaBin;
    this.servers=new Map();this.active=new Map();this.logs=new Map();
    this.events=new EventEmitter();this.events.setMaxListeners(256);
    this.busy=new Set();this.stopped=false;this.scheduleTimer=null;
  }
  async init() {
    await mkdir(this.serversDir,{recursive:true,mode:0o700});
    await mkdir(this.backupsDir,{recursive:true,mode:0o700});
    let saved={servers:[]};
    try { saved=JSON.parse(await readFile(this.configPath,"utf8")); }
    catch(error){if(error.code!=="ENOENT")throw error;}
    assert(Array.isArray(saved.servers),500,"패널 설정 파일이 손상되었습니다.");
    for(const item of saved.servers) {
      if(!/^[a-f0-9]{16}$/.test(item.id))continue;
      this.servers.set(item.id,{...item,schedules:Array.isArray(item.schedules)?item.schedules:[]});
      this.logs.set(item.id,[]);
    }
    this.startScheduler();
  }
  get(id) {
    const s=this.servers.get(id);
    assert(s,404,"서버를 찾을 수 없습니다.");
    return s;
  }
  dir(id){this.get(id);return join(this.serversDir,id);}
  async persist() {
    const tmp=this.configPath+"."+makeId()+".tmp";
    await writeFile(tmp,JSON.stringify({servers:[...this.servers.values()]},null,2),{mode:0o600});
    await rename(tmp,this.configPath);
  }
  pushLog(id,level,message) {
    if(!this.logs.has(id))this.logs.set(id,[]);
    const text=String(message).replace(/\u001b\[[0-9;]*[a-zA-Z]/g,"").slice(0,MAX_LOG_LENGTH);
    const entry={time:new Date().toLocaleTimeString("en-GB",{hour12:false,timeZone:"Asia/Seoul"}),level,message:text};
    const items=this.logs.get(id);items.push(entry);
    if(items.length>MAX_LOGS)items.splice(0,items.length-MAX_LOGS+128);
    this.events.emit("log:"+id,entry);
    return entry;
  }
  subscribe(id,listener){this.get(id);this.events.on("log:"+id,listener);return()=>this.events.off("log:"+id,listener);}
  history(id){this.get(id);return [...(this.logs.get(id)||[])];}
  async summary(item) {
    const child=this.active.get(item.id);
    const status=child ? child.status : "stopped";
    let memoryGb=null;
    if(child?.proc?.pid && process.platform==="linux"){
      try {
        const stats=(await readFile("/proc/"+child.proc.pid+"/status","utf8")).match(/^VmRSS:\s+(\d+)\s+kB/m);
        if(stats)memoryGb=Math.round(Number(stats[1])/1048576*100)/100;
      }catch{}
    }
    return {
      id:item.id,name:item.name,kind:"마인크래프트",status,
      memoryMb:item.memoryMb,memoryGb,
      maxPlayers:null,players:null,tps:null,mspt:null,cpu:null,
      port:item.port,version:item.jar,jar:item.jar,
      directory:this.dir(item.id),uptime:child?.startedAt?
        Math.max(0,Math.floor((Date.now()-child.startedAt)/1000))+"초":"—",
      eulaAccepted:item.eulaAccepted
    };
  }
  async list() {return await Promise.all([...this.servers.values()].map(x=>this.summary(x)));}
  async create({name,memoryMb=2048,port,eulaAccepted=false}={}) {
    name=safeName(name);
    memoryMb=positiveInt(memoryMb,"메모리",JAVA_MEMORY_MIN,JAVA_MEMORY_MAX);
    port=positiveInt(port,"포트",1024,65535);
    assert(typeof eulaAccepted==="boolean",400,"EULA 동의 값이 올바르지 않습니다.");
    assert(![...this.servers.values()].some(s=>s.port===port),409,"이미 사용 중인 서버 포트입니다.");
    assert(this.servers.size<100,409,"최대 서버 100개까지 등록할 수 있습니다.");
    const id=makeId(),dir=join(this.serversDir,id);
    await mkdir(dir,{mode:0o700});
    const cfg={id,name,memoryMb,port,jar:"server.jar",eulaAccepted,createdAt:now(),schedules:[]};
    try {
      await writeFile(join(dir,"eula.txt"),"eula="+eulaAccepted+"\n");
      await writeFile(join(dir,"server.properties"),"server-port="+port+"\nonline-mode=true\nenable-rcon=false\n");
      this.servers.set(id,cfg);this.logs.set(id,[]);
      await this.persist();
    }catch(error){this.servers.delete(id);this.logs.delete(id);await rm(dir,{recursive:true,force:true});throw error;}
    return this.summary(cfg);
  }
  async update(id,input) {
    const cfg=this.get(id);
    assert(!this.active.has(id),409,"서버가 실행 중일 때는 시작 설정을 변경할 수 없습니다.");
    const old={...cfg};
    if(input.name!==undefined)cfg.name=safeName(input.name);
    if(input.memoryMb!==undefined)cfg.memoryMb=positiveInt(input.memoryMb,"메모리",JAVA_MEMORY_MIN,JAVA_MEMORY_MAX);
    if(input.jar!==undefined)cfg.jar=javaJarName(input.jar);
    if(input.eulaAccepted!==undefined){
      assert(typeof input.eulaAccepted==="boolean",400,"EULA 값이 올바르지 않습니다.");
      cfg.eulaAccepted=input.eulaAccepted;
      await writeFile(join(this.dir(id),"eula.txt"),"eula="+cfg.eulaAccepted+"\n");
    }
    try {await this.persist();}catch(e){this.servers.set(id,old);throw e;}
    return this.summary(cfg);
  }
  async start(id){
    const cfg=this.get(id);
    assert(!this.active.has(id),409,"서버가 이미 실행 중입니다.");
    assert(cfg.eulaAccepted,409,"Minecraft EULA 동의가 필요합니다.");
    const folder=this.dir(id);
    const jar=await confinedPath(folder,cfg.jar);
    assert((await stat(jar)).isFile(),409,"실행 JAR 파일이 없습니다.");
    const child=spawn(this.javaBin,["-Xms"+Math.min(512,cfg.memoryMb)+"M","-Xmx"+cfg.memoryMb+"M","-jar",cfg.jar,"nogui"],{
      cwd:folder,env:{...process.env},stdio:["pipe","pipe","pipe"],shell:false,windowsHide:true
    });
    const item={proc:child,status:"starting",startedAt:Date.now(),pending:"",stopTimer:null,killTimer:null};
    this.active.set(id,item);
    const pipeLines=(stream,level)=>{
      let buffer="";
      stream.setEncoding("utf8");
      stream.on("data",chunk=>{
        buffer+=chunk;
        while(buffer.includes("\n")){
          const i=buffer.indexOf("\n");
          this.pushLog(id,level,buffer.slice(0,i).replace(/\r$/,""));
          buffer=buffer.slice(i+1);
        }
        if(buffer.length>8192){
          this.pushLog(id,level,buffer.slice(0,8192)+" [출력 분할]");
          buffer=buffer.slice(8192);
        }
      });
      stream.on("end",()=>{if(buffer){this.pushLog(id,level,buffer);buffer="";}});
    };
    pipeLines(child.stdout,"INFO");
    pipeLines(child.stderr,"WARN");
    child.once("exit",(code,signal)=>{
      if(item.stopTimer)clearTimeout(item.stopTimer);
      if(item.killTimer)clearTimeout(item.killTimer);
      this.active.delete(id);
      this.pushLog(id,"INFO","Java 프로세스 종료: code="+code+" signal="+signal);
    });
    try {
      await new Promise((resolve,reject)=>{
        child.once("spawn",resolve);child.once("error",reject);
      });
    }catch(error){
      this.active.delete(id);
      throw new HttpError(500,"Java 실행 실패: "+error.message);
    }
    item.status="running";
    this.pushLog(id,"INFO","Java 서버 시작 요청: PID "+child.pid);
    return this.summary(cfg);
  }
  command(id,raw){
    const running=this.active.get(id);
    assert(running && running.status==="running" && running.proc.stdin.writable,409,"실행 중인 서버가 아닙니다.");
    const command=stringValue(raw,"명령어",512);
    assert(!/[\r\n\0]/.test(command),400,"여러 줄 명령어는 사용할 수 없습니다.");
    running.proc.stdin.write(command+"\n");
    return {accepted:true};
  }
  async stop(id) {
    const running=this.active.get(id);
    assert(running,409,"서버가 실행 중이 아닙니다.");
    if(running.status==="stopping")return {accepted:true};
    running.status="stopping";
    try {running.proc.stdin.write("stop\n");}
    catch {running.proc.kill("SIGTERM");}
    running.stopTimer=setTimeout(()=>{
      if(this.active.get(id)!==running)return;
      this.pushLog(id,"WARN","정상 종료 시간 초과: SIGTERM 전송");
      running.proc.kill("SIGTERM");
      running.killTimer=setTimeout(()=>{
        if(this.active.get(id)===running)running.proc.kill("SIGKILL");
      },10000);
      running.killTimer.unref();
    },25000);
    running.stopTimer.unref();
    return {accepted:true};
  }
  async restart(id) {
    if(!this.active.has(id))return this.start(id);
    await this.stop(id);
    await new Promise((resolve,reject)=>{
      const started=Date.now();
      const interval=setInterval(()=>{
        if(!this.active.has(id)){clearInterval(interval);resolve();}
        else if(Date.now()-started>38000){clearInterval(interval);reject(new HttpError(504,"서버 종료 시간 초과"));}
      },250);
    });
    return this.start(id);
  }
  async close() {
    this.stopped=true;
    if(this.scheduleTimer)clearInterval(this.scheduleTimer);
    await Promise.all([...this.active.keys()].map(async id=>{try{await this.stop(id);}catch{}}));
  }
  async files(id,sub=""){
    const base=this.dir(id),path=await confinedPath(base,sub);
    const entries=await readdir(path,{withFileTypes:true});
    assert(entries.length<=10000,413,"폴더의 항목이 너무 많습니다.");
    const result=[];
    for(const e of entries){
      if(e.isSymbolicLink())continue;
      const s=await stat(join(path,e.name));
      result.push({name:e.name,type:e.isDirectory()?"folder":"file",size:s.size,modified:s.mtime.toISOString()});
    }
    return result.sort((a,b)=>(a.type===b.type? a.name.localeCompare(b.name):a.type==="folder"?-1:1));
  }
  async fileInfo(id,sub){
    assert(sub && sub!==".",400,"파일 경로를 지정하세요.");
    const path=await confinedPath(this.dir(id),sub);
    const info=await stat(path);
    assert(info.isFile(),400,"파일이 아닙니다.");
    return {path,size:info.size,modified:info.mtime.toISOString()};
  }
  async readText(id,sub){
    const info=await this.fileInfo(id,sub);
    assert(info.size<=1024*1024,413,"텍스트 미리보기는 1MiB까지 지원합니다.");
    return await readFile(info.path,"utf8");
  }
  async upload(id,sub,req){
    assert(!this.active.has(id),409,"파일 수정 전 서버를 중지하세요.");
    const path=await confinedPath(this.dir(id),sub,{missing:true});
    assert(sub && sub!==".",400,"파일 이름을 지정하세요.");
    await mkdir(dirname(path),{recursive:true});
    const tmp=path+"."+makeId()+".upload";
    let total=0;
    const limit=new Transform({transform(chunk,encoding,callback){
      total+=chunk.length;
      callback(total>MAX_UPLOAD?new HttpError(413,"업로드 한도는 256MiB입니다."):null,chunk);
    }});
    try {
      await pipeline(req,limit,createWriteStream(tmp,{flags:"wx",mode:0o600}));
      // Revalidate path after writing to avoid following a symbolic-link replacement.
      await confinedPath(this.dir(id),sub,{missing:true});
      await rename(tmp,path);
    }catch(error){await rm(tmp,{force:true});throw error;}
    return {size:total,path:sub};
  }
  async mkdir(id,sub) {
    assert(!this.active.has(id),409,"파일 수정 전 서버를 중지하세요.");
    const path=await confinedPath(this.dir(id),sub,{missing:true});
    assert(sub && sub!==".",400,"폴더 이름을 지정하세요.");
    await mkdir(path,{recursive:false});return {created:true};
  }
  async removeFile(id,sub) {
    assert(!this.active.has(id),409,"파일 수정 전 서버를 중지하세요.");
    assert(sub && sub!==".",400,"삭제할 파일을 선택하세요.");
    const path=await confinedPath(this.dir(id),sub);
    const info=await lstat(path);
    if(info.isDirectory())await rmdir(path);else await rm(path,{force:false});
    return {deleted:true,type:info.isDirectory()?"folder":"file"};
  }
  async renameFile(id,from,to){
    assert(!this.active.has(id),409,"파일 수정 전 서버를 중지하세요.");
    const a=await confinedPath(this.dir(id),from),b=await confinedPath(this.dir(id),to,{missing:true});
    assert(from && to,400,"경로가 필요합니다.");
    assert(dirname(a)===dirname(b),400,"같은 폴더 내 이름 변경만 지원합니다.");
    try{await lstat(b);throw new HttpError(409,"같은 이름의 파일이 이미 있습니다.");}
    catch(e){if(e.code!=="ENOENT")throw e;}
    await rename(a,b);return {renamed:true};
  }
  async scanTree(base){
    let size=0,count=0;
    const todo=[base];
    while(todo.length){
      const dir=todo.pop();
      for(const e of await readdir(dir,{withFileTypes:true})){
        const path=join(dir,e.name),info=await lstat(path);
        assert(!info.isSymbolicLink() && (info.isFile()||info.isDirectory()),409,"백업에 특수 파일 또는 심볼릭 링크가 있습니다.");
        count++;assert(count<=MAX_FILES,413,"백업 파일 개수 한도를 초과했습니다.");
        if(info.isDirectory())todo.push(path);
        else {size+=info.size;assert(size<=MAX_BACKUP_BYTES,413,"백업 크기가 8GiB를 넘었습니다.");}
      }
    }
    return {size,count};
  }
  async copyTree(source,target){
    await mkdir(target,{recursive:true,mode:0o700});
    for(const item of await readdir(source,{withFileTypes:true})){
      const from=join(source,item.name),to=join(target,item.name);
      const info=await lstat(from);
      assert(!info.isSymbolicLink(),409,"심볼릭 링크는 복사할 수 없습니다.");
      if(info.isDirectory())await this.copyTree(from,to);
      else if(info.isFile())await copyFile(from,to);
      else throw new HttpError(409,"특수 파일은 복사할 수 없습니다.");
    }
  }
  async backup(id) {
    const cfg=this.get(id),folder=this.dir(id);
    assert(!this.busy.has(id),409,"다른 백업/복원 작업이 진행 중입니다.");
    this.busy.add(id);
    const bid=makeId(),backupDir=join(this.backupsDir,id,bid);
    try{
      const {size,count}=await this.scanTree(folder);
      const space=await statfs(this.root);
      assert(Number(space.bavail)*Number(space.bsize)>size+256*1024*1024,507,"저장 공간이 부족합니다.");
      await mkdir(backupDir,{recursive:true,mode:0o700});
      await this.copyTree(folder,join(backupDir,"files"));
      const meta={id:bid,serverId:id,createdAt:now(),size,files:count};
      await writeFile(join(backupDir,"meta.json"),JSON.stringify(meta),{mode:0o600});
      this.pushLog(id,"INFO","백업 완료: "+bid);
      return meta;
    }catch(e){await rm(backupDir,{recursive:true,force:true});throw e;}
    finally{this.busy.delete(id);}
  }
  async backups(id){
    this.get(id);
    const folder=join(this.backupsDir,id);
    let entries=[];try{entries=await readdir(folder,{withFileTypes:true});}catch(e){if(e.code!=="ENOENT")throw e;}
    const list=[];
    for(const e of entries)if(e.isDirectory() && /^[a-f0-9]{16}$/.test(e.name)){
      try{list.push(JSON.parse(await readFile(join(folder,e.name,"meta.json"),"utf8")));}catch{}
    }
    return list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async restore(id,bid){
    this.get(id);
    assert(!this.active.has(id),409,"복원 전에 서버를 중지해야 합니다.");
    assert(/^[a-f0-9]{16}$/.test(bid),400,"백업 ID가 올바르지 않습니다.");
    assert(!this.busy.has(id),409,"다른 백업/복원 작업이 진행 중입니다.");
    this.busy.add(id);
    const snapshot=join(this.backupsDir,id,bid,"files");
    const active=this.dir(id),staged=join(this.serversDir,id+"."+makeId()+".restore"),previous=active+"."+makeId()+".previous";
    let moved=false;
    try{
      assert((await stat(snapshot)).isDirectory(),404,"백업을 찾을 수 없습니다.");
      await this.scanTree(snapshot);
      await this.copyTree(snapshot,staged);
      await rename(active,previous);
      moved=true;
      try{await rename(staged,active);}
      catch(e){
        try{await rename(previous,active);moved=false;}
        catch(rollbackError){
          // Preserve the previous world if rollback also fails.
          moved=false;
          throw new HttpError(500,"복원 실패 및 롤백 실패: 기존 데이터는 "+previous+"에 보존되었습니다.");
        }
        throw e;
      }
      await rm(previous,{recursive:true,force:true});
      this.pushLog(id,"WARN","백업 복원 완료: "+bid);
      return {restored:true,backupId:bid};
    }finally{
      await rm(staged,{recursive:true,force:true});
      // Keep any leftover previous directory on failure for manual recovery.
      this.busy.delete(id);
    }
  }
  async schedules(id){return [...this.get(id).schedules];}
  async addSchedule(id,{name,cron,type}){
    const cfg=this.get(id);
    name=stringValue(name,"작업 이름",64);
    assert(type==="backup"||type==="restart",400,"지원되지 않는 예약 작업 유형입니다.");
    assert(/^(?:[0-5]?\d) (?:[01]?\d|2[0-3]) \* \* (?:\*|[0-6])$/.test(cron),400,"매일 또는 요일별 시간 예약만 지원합니다.");
    assert(cfg.schedules.length<25,409,"서버당 예약 작업은 25개까지 등록할 수 있습니다.");
    const item={id:makeId(),name,cron,type,enabled:true,lastRun:""};
    cfg.schedules.push(item);await this.persist();return item;
  }
  async deleteSchedule(id,sid){
    const cfg=this.get(id);
    const count=cfg.schedules.length;
    cfg.schedules=cfg.schedules.filter(s=>s.id!==sid);
    assert(cfg.schedules.length<count,404,"예약 작업을 찾을 수 없습니다.");
    await this.persist();return {deleted:true};
  }
  startScheduler(){
    if(this.scheduleTimer)return;
    const formatter=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",hour12:false,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short"});
    const weekdays={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
    const tick=async()=>{
      if(this.stopped)return;
      const obj=Object.fromEntries(formatter.formatToParts(new Date()).map(p=>[p.type,p.value]));
      const stamp=obj.year+"-"+obj.month+"-"+obj.day+" "+obj.hour+":"+obj.minute;
      for(const cfg of this.servers.values())for(const item of cfg.schedules){
        if(!item.enabled||item.lastRun===stamp)continue;
        const [minute,hour,,,day]=item.cron.split(" ");
        if(Number(minute)!==Number(obj.minute)||Number(hour)!==Number(obj.hour)||(day!=="*"&&Number(day)!==weekdays[obj.weekday]))continue;
        item.lastRun=stamp;await this.persist();
        try{if(item.type==="backup")await this.backup(cfg.id);else await this.restart(cfg.id);}
        catch(e){this.pushLog(cfg.id,"WARN","예약 작업 실패: "+e.message);}
      }
    };
    this.scheduleTimer=setInterval(()=>tick().catch(e=>process.stderr.write("Schedule error: "+e.message+"\n")),30_000);
    this.scheduleTimer.unref();
  }
}
