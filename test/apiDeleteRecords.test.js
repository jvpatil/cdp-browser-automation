const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  chrome: { runtime: { onMessage: { addListener() {} } } },
  importScripts() {}, console, crypto: globalThis.crypto, URL, setTimeout, clearTimeout
});
const profiles = fs.readFileSync(path.join(__dirname, "../recordProfiles.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
vm.runInContext(`${profiles}\n${background}\nthis.testApiRecordPlan = apiRecordPlan; this.testApiRecordFieldValue = apiRecordFieldValue; this.testRunApiCustomRecords = runApiCustomRecords;`, context);
vm.runInContext(`
  setE2EStatus = async () => {};
  appendRunLog = async () => {};
  finalizeRunHistory = async () => {};
  clearFlowDraft = async () => {};
  resolveDataViewerTables = async () => [{ id: "Customer", tableId: "Customer", label: "Customer", cdpTable: "Customer", sourceAttribute: "SourceCustomerID" }];
  fetchCdpMetadata = async () => ({ tenantId: 42, resourceName: "customers" });
  liveDataViewerFieldsFromMetadata = () => [
    { fieldId: "SourceID", displayName: "Source ID", dataType: "string", required: true },
    { fieldId: "SourceCustomerID", displayName: "Source Customer ID", dataType: "string", required: true },
    { fieldId: "Email", displayName: "Email", dataType: "string" },
    { fieldId: "FirstName", displayName: "First Name", dataType: "string" }
  ];
`, context);

test("optional API delete set uses distinct source keys and matching delete emails", async () => {
  const result = await context.testRunApiCustomRecords(1, ["Customer"], {
    recordsPerTable: 4, startingIndex: 10, includeDeleteTestRecords: true, saveRecords: false
  });
  const rows = result.payload.customers;
  assert.equal(rows.length, 8);
  assert.equal(new Set(rows.map((row) => row.SourceCustomerID)).size, 8);
  for (let index = 0; index < rows.length; index += 1) {
    assert.equal(rows[index].SourceID, "CDP");
    if (index < 4) assert.doesNotMatch(rows[index].Email || "", /^delete\./);
    else assert.equal(rows[index].Email, `delete.${rows[index].SourceCustomerID}@gmail.com`);
  }
  // All rows, including the fourth, have populated normal values.
  assert.equal(rows[7].Email, `delete.${rows[7].SourceCustomerID}@gmail.com`);
  assert.ok(rows.every((row) => row.FirstName));
  assert.ok(rows.every((row) => /^\d{9}$/.test(row.SourceCustomerID)));
});

test("API record count remains unchanged when the option is off", async () => {
  const result = await context.testRunApiCustomRecords(1, ["Customer"], {
    recordsPerTable: 2, startingIndex: 20, saveRecords: false
  });
  assert.equal(result.payload.customers.length, 2);
});

test("API fields stay populated with normal values regardless of batch position", () => {
  const date = new Date("2026-10-23T12:00:00.000Z");
  const table = { cdpTable: "Profile" };
  const value = (fieldId, dataType, sequence) => context.testApiRecordFieldValue(
    { fieldId, displayName: fieldId, dataType }, table, "CDP", sequence, {}, date
  );
  for (let position = 1; position <= 5; position += 1) {
    const sequence = 5 + position;
    const sourceKey = value("SourceCustomerID_c", "string", sequence);
    assert.equal(sourceKey, `231026${String(5 + position).padStart(3, "0")}`);
    assert.equal(value("BigIntValue_c", "bigint", sequence), String(1000000000 + sequence));
    assert.ok(value("TinyIntValue_c", "tinyint", sequence) > 0);
    assert.ok(value("TextValue_c", "text", sequence));
    assert.match(value("Email_c", "string", sequence), new RegExp(`\\.${sourceKey}@(gmail|yahoo|outlook)\\.com$`));
  }
});

test("API rejects delete copies that would exceed the three-digit suffix", () => {
  assert.throws(() => context.testApiRecordPlan(2, 997, true), /cannot exceed 999/);
});
