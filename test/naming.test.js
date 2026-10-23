const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const planner = require("../deletePlanner.js");

const context = vm.createContext({
  CdpDeletePlanner: planner,
  chrome: { runtime: { onMessage: { addListener() {} } } },
  importScripts() {}, console, crypto: globalThis.crypto, URL, setTimeout, clearTimeout
});
const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
vm.runInContext(`${source}\nthis.testConnectionRuntime = connectionRuntime; this.testJobName = jobNameForRequest; this.testTransferJobName = transferJobName; this.testResponsysSourceRuntime = responsysSourceRuntime;`, context);

const sequence = { entityTag: "23Oct_1939", jobTag: "23OCT_1939", ordinal: 1 };
const template = {
  connectionPurpose: "PreJDK",
  source: { type: "Oracle Object Storage" },
  destination: { type: "Google Cloud Storage" }
};
const original = { label: "PROFILE_PreJDK_23OCT_1806" };
const copy = { label: "PROFILE_DELETE_PreJDK_23OCT_1806" };

test("connections include the full date tag and preserve purpose casing", () => {
  assert.equal(context.testConnectionRuntime(template, "source", sequence).name, "OOS_PreJDK_23OCT_1939");
  assert.equal(context.testConnectionRuntime(template, "destination", sequence).name, "GCS_PreJDK_23OCT_1939");
  assert.equal(context.testResponsysSourceRuntime(template, sequence).name, "OOS_PreJDK_RESPONSYS_23OCT_1939");
  assert.equal(context.testTransferJobName(template, template.source, "Import", sequence), "IMPORT_OOS_PreJDK_23OCT_1939");
});

test("Import job names use short, distinct object scopes", () => {
  const name = (customTables, tableIds = []) => context.testJobName({
    kind: "import", customTables, tableIds, template, connectionSequence: sequence
  });
  assert.equal(name([original]), "IMP_PROFILE_PreJDK_23OCT_1939");
  assert.equal(name([copy]), "IMP_PROFILE_DEL_PreJDK_23OCT_1939");
  assert.equal(name([original, copy]), "IMP_PROFILE_SET_PreJDK_23OCT_1939");
  assert.equal(name([original], ["Customer"]), "IMP_MULTI_PreJDK_23OCT_1939");
});

test("purpose separators are sanitized without changing letter case", () => {
  const value = { ...template, connectionPurpose: "Pre JDK-27D" };
  assert.equal(context.testConnectionRuntime(value, "source", sequence).name, "OOS_Pre_JDK_27D_23OCT_1939");
});
