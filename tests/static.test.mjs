import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createStaticServer } from "../scripts/serve.mjs";

test("static server streams public files and never exposes repository secrets", async (t) => {
  const dir = await mkdtemp(join(tmpdir(),"pconn-static-"));
  const root = join(dir,"public");
  await mkdir(join(root,"src"),{recursive:true});
  await mkdir(join(root,"assets"),{recursive:true});
  await mkdir(join(root,".git"));
  await writeFile(join(root,"index.html"),"<html>피컨</html>");
  await writeFile(join(root,"src","app.js"),"console.log('ok')");
  await writeFile(join(root,"src","large.css"),"a".repeat(2_000_000));
  await writeFile(join(root,".env"),"SECRET=not-public");
  await writeFile(join(root,".git","config"),"secret-config");
  await writeFile(join(dir,"private.svg"),"TOP-SECRET");
  // Windows without symlink rights: the link is absent and still must 404.
  await symlink(join(dir,"private.svg"),join(root,"assets","linked.svg")).catch((e)=>{if(e.code!=="EPERM")throw e;});
  const server=createStaticServer(root);
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  });
  const base="http://127.0.0.1:"+server.address().port;

  let response=await fetch(base+"/");
  assert.equal(response.status,200);
  assert.match(await response.text(),/피컨/);
  assert.match(response.headers.get("content-type"),/text\/html/);
  const modified=response.headers.get("last-modified");
  response=await fetch(base+"/index.html",{headers:{"If-Modified-Since":modified}});
  assert.equal(response.status,304);

  response=await fetch(base+"/src/app.js",{method:"HEAD"});
  assert.equal(response.status,200);
  assert.equal(await response.text(),"");
  response=await fetch(base+"/src/large.css");
  assert.equal(response.status,200);
  assert.equal((await response.text()).length,2_000_000);

  for (const blocked of ["/.env","/.git/config","/scripts/serve.mjs","/package.json","/tests/utils.test.mjs","/assets/linked.svg"]) {
    response=await fetch(base+blocked);
    assert.equal(response.status,404,blocked);
  }
  response=await fetch(base+"/index.html",{method:"POST"});
  assert.equal(response.status,405);
});
