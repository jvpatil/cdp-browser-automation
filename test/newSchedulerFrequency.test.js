const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Export scheduler keeps an already-selected Daily frequency without reopening the dropdown", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    importScripts() {}, console, crypto: globalThis.crypto, URL, setTimeout, clearTimeout
  });
  vm.runInContext(`${source}\nthis.applySchedule = applyTrustedNewScheduler;`, context);
  const actions = [];
  context.actions = actions;
  vm.runInContext(`
    appendRunLog = async () => {};
    readNewSchedulerState = async (_tabId, probe) => probe.type === "frequency-value" ? "Daily" : null;
    waitForNewSchedulerState = async (_tabId, probe) => {
      if (probe.type === "recurring-run") return { exists: true, checked: true };
      if (probe.type === "frequency-value") return "Daily";
      if (probe.type === "time-mode") return { checked: true, rect: { x: 1, y: 1 } };
      if (probe.type === "time-input") return "specific-time|input";
      return { x: 1, y: 1 };
    };
    trustedSchedulerClick = async () => { actions.push("dropdown-click"); };
    typeJetInput = async (_tabId, id) => { actions.push(id); };
  `, context);
  const result = await context.applySchedule(1, { jobKind: "export", frequency: "Daily", timeMode: "specific", specificPreset: "in15" });
  assert.equal(result.ok, true);
  assert.deepEqual(actions, ["specific-time|input"]);
});
