import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MinecraftManager } from "../server/manager.mjs";
import { createAuthenticator, confinedPath } from "../server/security.mjs";

async function makeTestManager(t) {
  const dir=await mkdtemp(join(tmpdir(),"pconn-backend-"));
  const manager=new MinecraftManager({dataDir:dir});
  await manager.init();
  t.after(async()=>{await manager.close();await rm(dir,{recursive:true,force:true});});
  return manager;
}
test("admin authentication limits attempts and requires CSRF for writes",()=>{
  const origin="http://127.0.0.1:4173";
  const auth=createAuthenticator("test-password-12345",{origin,secure:false});
  assert.throws(()=>auth.verifyPassword("incorrect","127.0.0.1"),e=>e.status===401);
  const s=auth.verifyPassword("test-password-12345","127.0.0.1");
  assert.equal(typeof s.csrf,"string");
  const req={headers:{cookie:"pconn_session="+s.id,origin,"x-csrf-token":s.csrf}};
  assert.equal(auth.requireSession(req).csrf,s.csrf);
  assert.doesNotThrow(()=>auth.checkMutation(req,auth.requireSession(req)));
  req.headers["x-csrf-token"]="invalid";
  assert.throws(()=>auth.checkMutation(req,auth.requireSession(req)),e=>e.status===403);
  auth.clear(s.id);
  assert.equal(auth.session(req),null);
});
test("path confinement blocks escapes, absolute paths and symlinks",async(t)=>{
  const root=await mkdtemp(join(tmpdir(),"pconn-path-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,"world"));
  assert.equal(await confinedPath(root,"world").then(p=>p.endsWith("world")),true);
  await assert.rejects(confinedPath(root,"../config.json"),e=>e.status===400);
  await assert.rejects(confinedPath(root,"/etc/passwd"),e=>e.status===400);
  await symlink(tmpdir(),join(root,"link"));
  await assert.rejects(confinedPath(root,"link"),e=>e.status===403);
});
test("create, upload, edit, backup, restore, schedule and restart persistence",async(t)=>{
  const manager=await makeTestManager(t);
  const cfg=await manager.create({name:"개발 서버",port:26871,memoryMb:2048,eulaAccepted:true});
  assert.match(cfg.id,/^[a-f0-9]{16}$/);
  const root=manager.dir(cfg.id);
  const props=await readFile(join(root,"server.properties"),"utf8");
  assert.match(props,/online-mode=true/);
  await writeFile(join(root,"server.jar"),"fake jar");
  await writeFile(join(root,"hello.txt"),"BEFORE");
  assert.match(await manager.readText(cfg.id,"hello.txt"),/BEFORE/);
  const backup=await manager.backup(cfg.id);
  assert.equal(backup.serverId,cfg.id);
  const all=await manager.backups(cfg.id);
  assert.equal(all.length,1);
  await writeFile(join(root,"hello.txt"),"AFTER");
  await manager.restore(cfg.id,backup.id);
  assert.equal(await readFile(join(root,"hello.txt"),"utf8"),"BEFORE");
  const schedule=await manager.addSchedule(cfg.id,{name:"새벽 백업",cron:"0 3 * * *",type:"backup"});
  assert.equal(schedule.type,"backup");
  assert.equal((await manager.schedules(cfg.id)).length,1);
  await manager.deleteSchedule(cfg.id,schedule.id);
  assert.equal((await manager.schedules(cfg.id)).length,0);
  const updated=await manager.update(cfg.id,{memoryMb:4096,jar:"server.jar"});
  assert.equal(updated.memoryMb,4096);
  await manager.mkdir(cfg.id,"new-folder");
  await manager.renameFile(cfg.id,"hello.txt","renamed.txt");
  await manager.removeFile(cfg.id,"renamed.txt");
  const entries=await manager.files(cfg.id);
  assert.ok(entries.some(x=>x.name==="new-folder"&&x.type==="folder"));
  await manager.removeFile(cfg.id,"new-folder");
  const restarted=new MinecraftManager({dataDir:manager.root});
  await restarted.init();
  assert.equal((await restarted.list()).length,1);
  await restarted.close();
});
test("world backups are refused while server is running",async(t)=>{
  const manager=await makeTestManager(t);
  const cfg=await manager.create({name:"서버",port:26872,eulaAccepted:true});
  manager.active.set(cfg.id,{status:"running",proc:{stdin:{writable:true,write(){}},kill(){}},startedAt:Date.now()});
  await assert.rejects(manager.backup(cfg.id),e=>e.status===409);
  // Avoid trying to signal a fake process from test cleanup.
  manager.active.delete(cfg.id);
});
