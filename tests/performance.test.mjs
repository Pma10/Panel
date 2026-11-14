import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LOG_ENTRIES, MAX_VISIBLE_LOGS, MAX_LOG_CHARS,
  appendBoundedLog, recentLogs, replaceLogHistory, serverSummary
} from "../src/utils.mjs";

const row = (i, level="INFO") => ({time:"22:29:"+String(i%60).padStart(2,"0"),level,message:"메시지 "+i});

test("100,000 live log messages keep bounded memory without replacing the array", () => {
  const history=[];
  for(let i=0;i<100_000;i++) {
    assert.equal(appendBoundedLog(history,row(i)),true);
    assert.ok(history.length<=MAX_LOG_ENTRIES);
  }
  assert.equal(history.at(-1).message,"메시지 99999");
  assert.ok(history.length>0);
});

test("visible log window is capped independently and ordered chronologically", () => {
  const history = Array.from({length:1600},(_,i)=>row(i,i%2?"WARN":"INFO"));
  const latest = recentLogs(history);
  assert.equal(latest.length,MAX_VISIBLE_LOGS);
  assert.equal(latest[0].message,"메시지 1480");
  assert.equal(latest.at(-1).message,"메시지 1599");
  const warning = recentLogs(history,"메시지 15","warn",8);
  assert.ok(warning.length<=8);
  assert.ok(warning.every(x=>x.level==="WARN" && x.message.includes("메시지 15")));
});

test("untrusted oversized server entries are truncated and malformed records ignored", () => {
  const list=[];
  assert.equal(appendBoundedLog(list,{time:"1",level:"WARN",message:"x".repeat(100_000)}),true);
  assert.equal(list[0].message.length,MAX_LOG_CHARS);
  assert.equal(appendBoundedLog(list,{time:"1",level:"INFO",message:null}),false);
  assert.equal(appendBoundedLog(list,null),false);
  assert.equal(list.length,1);
});

test("initial history load retains only recent valid data", () => {
  const source=Array.from({length:1500},(_,i)=>row(i));
  source.push({time:1,level:"WARN",message:"bad"});
  const history=replaceLogHistory(source);
  assert.ok(history.length<=MAX_LOG_ENTRIES);
  assert.equal(history.at(-1).message,"메시지 1499");
  assert.equal(replaceLogHistory(undefined).length,0);
});

test("server dashboard rollup counts only running players in a single pass", () => {
  assert.deepEqual(serverSummary([
    {status:"running",players:10,memoryGb:3.5},
    {status:"running",players:5,memoryGb:1.2},
    {status:"stopped",players:999,memoryGb:0}
  ]),{total:3,running:2,players:15,memoryGb:4.7});
});
