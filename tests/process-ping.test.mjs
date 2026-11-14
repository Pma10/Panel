import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MinecraftManager } from "../server/manager.mjs";
import { pingMinecraft } from "../server/ping.mjs";

const varint=n=>{const a=[];do{let b=n&127;n>>>=7;if(n)b|=128;a.push(b);}while(n);return Buffer.from(a);};
test("Java status protocol returns real online/max player counts",async(t)=>{
  const payload=Buffer.from(JSON.stringify({version:{name:"Paper 1.21.11",protocol:0},players:{online:12,max:100}}));
  const packet=Buffer.concat([varint(0),varint(payload.length),payload]);
  const response=Buffer.concat([varint(packet.length),packet]);
  const server=createServer(socket=>socket.once("data",()=>{socket.write(response);socket.end();}));
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const value=await pingMinecraft(server.address().port);
  assert.equal(value?.players,12);
  assert.equal(value?.maxPlayers,100);
  assert.equal(value?.version,"Paper 1.21.11");
});

test("managed Java process receives console commands and stops gracefully",{
  skip:process.platform==="win32"
},async(t)=>{
  const root=await mkdtemp(join(tmpdir(),"pconn-proc-"));
  const fakeJava=join(root,"java-mock.sh");
  await writeFile(fakeJava,'#!/bin/sh\necho "Mock Minecraft server started"\nwhile IFS= read -r line; do\n echo "CONSOLE: $line"\n if [ "$line" = "stop" ]; then exit 0; fi\ndone\n');
  await chmod(fakeJava,0o700);
  const manager=new MinecraftManager({dataDir:join(root,"state"),javaBin:fakeJava});
  await manager.init();
  t.after(async()=>{await manager.close();await rm(root,{recursive:true,force:true});});
  const config=await manager.create({name:"Mock Paper",port:26881,memoryMb:1024,eulaAccepted:true});
  await writeFile(join(manager.dir(config.id),"server.jar"),"placeholder");
  const live=await manager.start(config.id);
  assert.equal(live.status,"running");
  assert.equal(manager.command(config.id,"say hello").accepted,true);
  await new Promise(resolve=>setTimeout(resolve,100));
  const logs=manager.history(config.id).map(x=>x.message).join("\n");
  assert.match(logs,/CONSOLE: say hello/);
  await manager.stop(config.id);
  await manager.waitForStop(config.id,5000);
  assert.equal((await manager.summary(manager.get(config.id))).status,"stopped");
});
