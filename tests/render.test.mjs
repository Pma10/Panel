import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as fixtures from "../src/data.js";
import {
  escapeHtml, filterLogs, serverSummary, formatMemory, validateCommand,
  routeFromHash, appendBoundedLog, replaceLogHistory, recentLogs, MAX_VISIBLE_LOGS
} from "../src/utils.mjs";

const source = (await readFile(new URL("../src/app.js",import.meta.url),"utf8"))
  .replace(/^import .+;$/gm,"")
  .replace(/render\(\);\s*if \(apiEnabled\) loadFromApi\(\);\s*$/,"render();");

function harness({live=false,request=async()=>null,stream=()=>()=>{}}={}) {
  const appRoot={innerHTML:""};
  const doc={
    documentElement:{dataset:{}},title:"",hidden:false,
    querySelector(query){return query==="#app"?appRoot:null;},
    querySelectorAll(){return [];},
    addEventListener(){}
  };
  const location={hash:"#/dashboard"};
  const ctx={
    ...fixtures, h:escapeHtml, filterLogs, serverSummary, formatMemory,
    validateCommand, routeFromHash, appendBoundedLog, replaceLogHistory, recentLogs,
    apiEnabled:live,apiRequest:request,streamLogs:stream,document:doc,
    window:{addEventListener(){},scrollTo(){}},location,
    localStorage:{getItem(){return null;},setItem(){}},
    structuredClone,requestAnimationFrame(){},setTimeout,clearTimeout,
    URL,Blob,Date,Intl,FormData
  };
  runInNewContext(source + "\nglobalThis.__panel = { state, render, loadFromApi, switchSelectedServer };",ctx);
  return {appRoot,doc,location,...ctx.__panel};
}

test("all 13 routes render without browser frameworks or runtime dependencies",()=>{
  const ui=harness();
  for (const route of fixtures.ROUTE_INFO) {
    ui.state.route=route.route;
    ui.render();
    assert.match(ui.appRoot.innerHTML,/app-shell/);
    assert.match(ui.appRoot.innerHTML,/page-heading/);
    assert.ok(ui.appRoot.innerHTML.length>1500,route.route);
  }
});

test("one heavy console stream never produces more than the log viewport limit",()=>{
  const ui=harness();
  ui.state.route="console";
  for(let i=0;i<9_000;i++) {
    appendBoundedLog(ui.state.logs,{time:"22:00:00",level:"INFO",message:"test "+i});
  }
  ui.render();
  const nodes=ui.appRoot.innerHTML.match(/class="log-line\b/g)||[];
  assert.equal(nodes.length,MAX_VISIBLE_LOGS);
  assert.ok(ui.state.logs.length<=1200);
  assert.match(ui.appRoot.innerHTML,/test 8999/);
});

test("switching servers loads only selected log history and closes the old SSE stream",async()=>{
  const streams=[];
  const ui=harness({
    live:true,
    async request(path) {
      if (path==="/servers") return fixtures.DEMO_SERVERS;
      if (path.endsWith("/logs")) return [{time:"10:01",level:"INFO",message:path.includes("staging")?"STAGING-ONLY":"MAIN-ONLY"}];
      throw new Error("unexpected: "+path);
    },
    stream(id) {const item={id,closed:false};streams.push(item);return ()=>{item.closed=true;};}
  });
  ui.state.route="console";
  await ui.loadFromApi();
  assert.equal(ui.state.logs[0].message,"MAIN-ONLY");
  assert.equal(streams.at(-1).id,"pvpconnect");

  await ui.switchSelectedServer("staging","console");
  assert.equal(ui.state.selectedId,"staging");
  assert.deepEqual(Array.from(ui.state.logs,e=>e.message),["STAGING-ONLY"]);
  assert.ok(streams.some(x=>x.id==="pvpconnect"&&x.closed));
  assert.equal(streams.at(-1).id,"staging");
});

test("late server responses are discarded after selecting another server",async()=>{
  let unblock;
  const stalled=new Promise(resolve=>{unblock=resolve;});
  const ui=harness({
    live:true,
    async request(path) {
      if(path==="/servers")return fixtures.DEMO_SERVERS;
      if(path==="/servers/staging/logs") {await stalled;return [{time:"1",level:"INFO",message:"STALE"}];}
      return [{time:"2",level:"INFO",message:"CURRENT"}];
    }
  });
  await ui.loadFromApi();
  const older=ui.switchSelectedServer("staging","overview");
  const newer=ui.switchSelectedServer("pvpconnect","overview");
  await newer;
  unblock();
  await older;
  assert.equal(ui.state.selectedId,"pvpconnect");
  assert.deepEqual(Array.from(ui.state.logs,e=>e.message),["CURRENT"]);
});
