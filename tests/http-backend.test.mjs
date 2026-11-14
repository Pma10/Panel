import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePanel } from "../server/http.mjs";

async function freePort(){
  const net=createServer();
  net.listen(0,"127.0.0.1");
  await once(net,"listening");
  const port=net.address().port;
  await new Promise(resolve=>net.close(resolve));
  return port;
}
test("real HTTP login, CSRF, server creation, binary files, backups and audit",async(t)=>{
  const directory=await mkdtemp(join(tmpdir(),"pconn-http-"));
  const port=await freePort(),origin="http://127.0.0.1:"+port;
  const panel=await makePanel({
    root:directory,origin,adminPassword:"integration-test-password-12345",staticRoot:process.cwd()
  });
  panel.server.listen(port,"127.0.0.1");
  await once(panel.server,"listening");
  t.after(async()=>{await panel.close();await rm(directory,{recursive:true,force:true});});
  const url="/api/v1";
  const call=(path,{method="GET",body,cookie,csrf,originHeader=origin,raw=false}={})=>
    fetch(origin+url+path,{
      method,
      headers:{
        ...(method==="GET"?{}:{Origin:originHeader}),
        ...(cookie?{Cookie:cookie}:{}),
        ...(csrf?{"X-CSRF-Token":csrf}:{}),
        ...(body!==undefined?{"Content-Type":raw?"application/octet-stream":"application/json"}:{})
      },
      ...(body===undefined?{}:{body:raw?body:JSON.stringify(body)})
    });

  let res=await call("/servers");
  assert.equal(res.status,401);
  res=await call("/auth/login",{method:"POST",body:{password:"integration-test-password-12345"}});
  assert.equal(res.status,200);
  const cookie=res.headers.get("set-cookie").split(";")[0],session=await res.json();
  assert.equal(typeof session.csrf,"string");
  assert.match(res.headers.get("set-cookie"),/HttpOnly/);
  res=await call("/servers",{method:"POST",cookie,body:{name:"No CSRF",port:26921,eulaAccepted:true}});
  assert.equal(res.status,403);
  res=await call("/servers",{method:"POST",cookie,csrf:session.csrf,originHeader:"http://evil.example",
    body:{name:"Invalid origin",port:26921,eulaAccepted:true}});
  assert.equal(res.status,403);

  res=await call("/servers",{method:"POST",cookie,csrf:session.csrf,
    body:{name:"실제 서버",port:26921,memoryMb:2048,eulaAccepted:true}});
  assert.equal(res.status,201);
  const server=await res.json(),id=server.id;
  assert.match(id,/^[a-f0-9]{16}$/);
  res=await call("/servers/"+id+"/actions/start",{method:"POST",cookie,csrf:session.csrf});
  assert.equal(res.status,409); // No server.jar yet
  res=await call("/servers/"+id+"/files/upload?path=server.jar",{
    method:"PUT",cookie,csrf:session.csrf,body:Buffer.from("jar-placeholder"),raw:true
  });
  assert.equal(res.status,201);

  res=await call("/servers/"+id+"/files",{cookie});
  assert.equal(res.status,200);
  assert.ok((await res.json()).entries.some(x=>x.name==="server.jar"));

  res=await call("/servers/"+id+"/files/upload?path=hello.txt",{
    method:"PUT",cookie,csrf:session.csrf,body:Buffer.from("BEFORE"),raw:true
  });
  assert.equal(res.status,201);
  res=await call("/servers/"+id+"/backups",{method:"POST",cookie,csrf:session.csrf});
  assert.equal(res.status,201);
  const backup=await res.json();
  assert.match(backup.id,/^[a-f0-9]{16}$/);
  res=await call("/servers/"+id+"/files/upload?path=hello.txt",{
    method:"PUT",cookie,csrf:session.csrf,body:Buffer.from("AFTER"),raw:true
  });
  assert.equal(res.status,201);
  res=await call("/servers/"+id+"/backups/"+backup.id+"/restore",{method:"POST",cookie,csrf:session.csrf});
  assert.equal(res.status,200);
  res=await call("/servers/"+id+"/files/content?path=hello.txt",{cookie});
  assert.equal(res.status,200);
  assert.equal((await res.json()).text,"BEFORE");

  res=await call("/servers/"+id+"/files?path=..%2Fconfig.json",{cookie});
  assert.equal(res.status,400);
  res=await call("/audit",{cookie});
  assert.equal(res.status,200);
  assert.ok(Array.isArray((await res.json()).entries));

  res=await call("/auth/logout",{method:"POST",cookie,csrf:session.csrf});
  assert.equal(res.status,200);
  res=await call("/servers",{cookie});
  assert.equal(res.status,401);
});
