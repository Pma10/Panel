import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, filterLogs, serverSummary, validateCommand, routeFromHash } from "../src/utils.mjs";
test("HTML is escaped before rendering", () => {
  assert.equal(escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});
test("filters logs by level and Korean content", () => {
  const entries = [{ time: "10:00", level: "INFO", message: "서버 시작" }, { time: "10:02", level: "WARN", message: "백업 예정" }];
  assert.deepEqual(filterLogs(entries, "백업", "warn"), [entries[1]]);
  assert.equal(filterLogs(entries, "", "error").length, 0);
});
test("summary counts running servers and players", () => {
  assert.deepEqual(serverSummary([{ status: "running", players: 15, memoryGb: 4 }, { status: "stopped", players: 0, memoryGb: 0 }]), { total: 2, running: 1, players: 15, memoryGb: 4 });
});
test("command rejects blank, multiline and too long values", () => {
  assert.equal(validateCommand("  ").valid, false);
  assert.equal(validateCommand("say hi\nstop").valid, false);
  assert.equal(validateCommand("x".repeat(513)).valid, false);
  assert.equal(validateCommand("list").value, "list");
});
test("only registered navigation routes are accepted", () => {
  assert.equal(routeFromHash("#/console"), "console");
  assert.equal(routeFromHash("#/../../bad"), "dashboard");
});
