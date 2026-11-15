import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { availableVersions, stableBuild, installStableJar, MAX_INSTALL_BYTES } from "../server/templates.mjs";
import { safeJavaEnvironment, MinecraftManager } from "../server/manager.mjs";

function paperFixture({ tamper = false, channel = "STABLE", overrideUrl } = {}) {
  const bytes = Buffer.alloc(2048, 0x51);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const url = overrideUrl || "https://fill-data.papermc.io/v1/objects/" + sha + "/paper-1.21.11-16.jar";
  const metadata = { id:16, channel, downloads:{
    "server:default":{url,size:bytes.length,checksums:{sha256:sha}}
  }};
  const calls = [];
  const fetchImpl = async (requestUrl, options) => {
    const target = String(requestUrl);
    calls.push({ url:target, redirect:options.redirect, agent:options.headers["User-Agent"] });
    if(target.endsWith("/v3/projects/paper"))
      return new Response(JSON.stringify({versions:{"1.21":["1.21.11","1.21.10"],"1.20":["1.20.6"]}}),{status:200});
    if(target.endsWith("/v3/projects/paper/versions/1.21.11/builds"))
      return new Response(JSON.stringify([metadata]),{status:200});
    if(target.startsWith("https://fill-data.papermc.io/")){
      const body = tamper ? Buffer.alloc(2048,0x52) : bytes;
      return new Response(body,{status:200});
    }
    throw new Error("Unexpected upstream URL: "+target);
  };
  return { fetchImpl, calls, bytes, sha };
}

test("PaperMC stable template resolves grouped versions and uses a named user agent",async()=>{
  const {fetchImpl,calls}=paperFixture();
  const versions=await availableVersions("paper",fetchImpl);
  assert.deepEqual(versions,["1.21.11","1.21.10","1.20.6"]);
  assert.match(calls[0].agent,/PConnPanel/);
  assert.equal(calls[0].redirect,"error");
});
test("installer streams verified official JAR to disk, without arbitrary command execution",async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),"pconn-installer-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const {fetchImpl,bytes,sha,calls}=paperFixture();
  const result=await installStableJar({directory:dir,project:"paper",version:"1.21.11",fetchImpl});
  assert.equal(result.sha256,sha);
  assert.deepEqual(await readFile(join(dir,"server.jar")),bytes);
  assert.equal(calls.length,2);
  assert.equal(calls[1].redirect,"error");
  assert.equal((await readdir(dir)).length,1);
  await assert.rejects(
    installStableJar({directory:dir,project:"paper",version:"1.21.11",fetchImpl}),
    error=>error.status===409
  );
});
test("mismatched checksum never leaves a partial jar or temp file",async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),"pconn-installer-bad-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const {fetchImpl}=paperFixture({tamper:true});
  await assert.rejects(installStableJar({directory:dir,project:"paper",version:"1.21.11",fetchImpl}),
    error=>error.status===502);
  assert.deepEqual(await readdir(dir),[]);
});
test("untrusted build URLs and experimental builds are refused",async()=>{
  const fixture=paperFixture({overrideUrl:"https://example.org/untrusted.jar"});
  await assert.rejects(stableBuild("paper","1.21.11",fixture.fetchImpl),
    error=>error.status===502);
  const experimental=paperFixture({channel:"EXPERIMENTAL"});
  await assert.rejects(stableBuild("paper","1.21.11",experimental.fetchImpl),
    error=>error.status===404);
  await assert.rejects(stableBuild("paper","../admin",fixture.fetchImpl),
    error=>error.status===400);
  await assert.rejects(stableBuild("arbitrary","1.21.11",fixture.fetchImpl),
    error=>error.status===400);
});
test("Java process environment does not leak panel password or provider API keys",()=>{
  const environment=safeJavaEnvironment({
    PATH:"/usr/bin",HOME:"/srv/servers",LANG:"ko_KR.UTF-8",
    PANEL_ADMIN_PASSWORD:"super-secret",GITHUB_TOKEN:"hidden",
    AWS_SECRET_ACCESS_KEY:"hidden",OPENAI_API_KEY:"hidden"
  });
  assert.deepEqual(environment,{PATH:"/usr/bin",HOME:"/srv/servers",LANG:"ko_KR.UTF-8"});
});
test("crash restart policy is opt-in, bounded to 3 attempts and cancellable",()=>{
  const manager=new MinecraftManager({dataDir:"/nonexistent-pconn-test"});
  const id="d3831a2b3c4d5e6f";
  manager.servers.set(id,{id,name:"test",autoRestart:true});
  const history=[];
  manager.pushLog=(server,level,message)=>history.push({server,level,message});
  manager.scheduleCrashRestart(id,Date.now());
  assert.equal(manager.restartTimers.has(id),true);
  manager.clearRestartTimer(id);
  for(let i=0;i<3;i++){
    manager.scheduleCrashRestart(id,Date.now());manager.clearRestartTimer(id);
  }
  manager.scheduleCrashRestart(id,Date.now());
  assert.equal(manager.restartTimers.has(id),false);
  assert.ok(history.some(x=>x.message.includes("자동 재시작 중단")));
});
