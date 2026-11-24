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
  .replace(/if \(apiEnabled\) (?:loadFromApi|bootstrapAuth)\(\);\s*$/,"");

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
    LANGUAGES:{ko:"한국어",en:"English"},detectLanguage:()=>"ko",startI18n(){},setLanguage(){},translate:(t)=>t,
    window:{addEventListener(){},scrollTo(){}},location,
    localStorage:{getItem(){return null;},setItem(){}},
    structuredClone,requestAnimationFrame(){},setTimeout,clearTimeout,
    URL,Blob,Date,Intl,FormData
  };
  runInNewContext(source + "\nglobalThis.__panel = { state, render, loadFromApi, switchSelectedServer };",ctx);
  if(live){ctx.__panel.state.authenticated=true;ctx.__panel.state.authLoading=false;ctx.__panel.state.loading=false;}
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

test("server fleet pages keep table DOM below the configured page limit",()=>{
  const ui=harness();
  ui.state.servers=Array.from({length:2000},(_,i)=>({
    id:"fleet-"+i,name:"Fleet "+i,kind:"Minecraft",status:"running",
    players:0,maxPlayers:20,memoryGb:1
  }));
  ui.state.route="servers";
  ui.render();
  assert.equal((ui.appRoot.innerHTML.match(/data-server-row=/g)||[]).length,60);
  ui.state.route="dashboard";
  ui.render();
  assert.equal((ui.appRoot.innerHTML.match(/data-server-row=/g)||[]).length,8);
});

test("live mode does not present fixture health, backups, or audit records as real",()=>{
  const ui=harness({live:true});
  ui.state.loading=false;
  ui.state.mode="live";
  for (const route of ["health","backups","audit","files","network","startup","schedules","users"]) {
    ui.state.route=route;
    ui.render();
    assert.match(ui.appRoot.innerHTML,/실제 데이터 API가 연결되지 않았습니다/);
  }
  ui.state.route="health";
  ui.render();
  assert.doesNotMatch(ui.appRoot.innerHTML,/모든 검사 정상/);
});

test("invalid log levels and messages never become raw HTML attributes",()=>{
  const ui=harness();
  ui.state.logs=[];
  appendBoundedLog(ui.state.logs,{
    time:"22:00:00",level:'ERROR" autofocus',message:'<img src=x onerror="bad">'
  });
  ui.state.route="console";
  ui.render();
  assert.match(ui.appRoot.innerHTML,/class="log-line other"/);
  assert.match(ui.appRoot.innerHTML,/&lt;img src=x onerror=&quot;bad&quot;&gt;/);
  assert.doesNotMatch(ui.appRoot.innerHTML,/class="log-line error" autofocus/);
});

test("console colors ANSI and § codes without letting them inject markup",()=>{
  const ui=harness();
  ui.state.logs=[];
  appendBoundedLog(ui.state.logs,{time:"22:00:00",level:"INFO",message:"\x1b[33m[22:00:00 WARN]: \x1b[38;2;255;0;0mhot\x1b[0m <b>x</b>"});
  appendBoundedLog(ui.state.logs,{time:"22:00:01",level:"INFO",message:"§aGreen §x§1§2§3§4§5§6hex §lbold"});
  appendBoundedLog(ui.state.logs,{time:"22:00:02",level:"INFO",message:"[Server thread/INFO]: Steve joined the game"});
  appendBoundedLog(ui.state.logs,{time:"22:00:03",level:"INFO",message:'\x1b[38;2;1;2;"onmouseover=alert(1)m bad'});
  ui.state.route="console";
  ui.render();
  const html=ui.appRoot.innerHTML;
  assert.match(html,/color:#ff0000;">hot<\/span>/);
  assert.match(html,/&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html,/color:#7ee787;">Green /);
  assert.match(html,/color:#123456;">hex /);
  assert.match(html,/font-weight:700;">bold/);
  assert.match(html,/<span class="log-prefix">\[Server thread\/INFO\]: <\/span><span class="log-join">Steve joined the game<\/span>/);
  assert.doesNotMatch(html,/onmouseover=alert/);
});
