const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const profiles = fs.readFileSync(path.join(__dirname, "../recordProfiles.js"), "utf8");
const viewer = fs.readFileSync(path.join(__dirname, "../dataViewer.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

test("Data Viewer uses the configured suffix for object and parent source keys", async () => {
  const window = {};
  const context = vm.createContext({ window });
  vm.runInContext(profiles, context);
  vm.runInContext(viewer.replace(/\}\)\(\);\s*$/, "window.testValueContext = valueContext; window.testSourceObjectIdFor = sourceObjectIdFor;})();"), context);
  const runDate = new Date("2026-10-23T10:20:30Z");
  const first = window.testValueContext(3, 1, "CDP", "", runDate);
  first.runDate = runDate;
  first.recordCount = 2;
  const second = window.testValueContext(4, 2, "CDP", "", runDate);
  second.runDate = runDate;
  second.recordCount = 2;
  assert.equal(window.testSourceObjectIdFor("Customer", first, 1), "231026003");
  assert.equal(window.testSourceObjectIdFor("Profile", first, 1), "231026003");
  assert.equal(window.testSourceObjectIdFor("Customer", second, 2), "231026004");
  await assert.rejects(window.runCdpDataViewer({ tables: [{ cdpTable: "Customer" }], recordsPerTable: 2, startingIndex: 999 }), /within 1–999/);
});

test("standalone and workflow UI runs forward the suffix start to the page runner", async () => {
  const calls = [];
  const chrome = {
    runtime: { onMessage: { addListener() {} } },
    tabs: { get: async () => ({ url: "https://example.cdp.test/data/" }) },
    scripting: { executeScript: async (request) => {
      if (Array.isArray(request.args) && Array.isArray(request.args[0])) calls.push(request.args[1]);
      return [{ result: { records: [] } }];
    } }
  };
  const context = vm.createContext({ chrome, importScripts() {}, console, crypto: globalThis.crypto, URL, setTimeout, clearTimeout });
  vm.runInContext(`${background}\nthis.testRunDataViewer = runDataViewer; this.testRunDataViewerStep = runDataViewerStep;`, context);
  vm.runInContext(`
    resolveDataViewerTables = async () => [{ id: "Customer", label: "Customer", cdpTable: "Customer" }];
    navigateAndWait = async () => {};
    activatePageAutomationRun = async () => {};
    waitForPageElement = async () => {};
    setE2EStatus = async () => {};
    appendDataViewerRunLog = async () => {};
    finalizeRunHistory = async () => {};
    clearFlowDraft = async () => {};
  `, context);
  await context.testRunDataViewer(1, ["Customer"], { recordsPerTable: 2, startingIndex: 3 });
  await context.testRunDataViewerStep(1, { dataViewerTableIds: ["Customer"], recordsPerTable: 2, startingIndex: 7 }, "run-1");
  assert.deepEqual(calls.map((options) => options.startingIndex), [3, 7]);
});
