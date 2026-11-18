const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
const start = source.indexOf("async function resolveTableDeleteTarget(");
const end = source.indexOf("async function prepareSegmentDeleteJob(", start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({
  loadLiveDataViewerTables: async () => [
    { id: "Profile_DELETE_Test_c", label: "Profile_DELETE_Test", tableId: "Profile_DELETE_Test_c" },
    { id: "Customer", label: "Customer", tableId: "Customer" }
  ]
});
vm.runInContext(`${source.slice(start, end)}\nthis.resolveTableDeleteTarget = resolveTableDeleteTarget;`, context);

test("full-table Delete requires one exact live-tenant table, without a second checkbox", async () => {
  const table = await context.resolveTableDeleteTarget(1, { tableId: "Profile_DELETE_Test_c" });
  assert.equal(table.tableId, "Profile_DELETE_Test_c");
  await assert.rejects(context.resolveTableDeleteTarget(1, { tableId: "" }), /Select the exact/);
  await assert.rejects(context.resolveTableDeleteTarget(1, { tableId: "Unknown" }), /Select one published table/);
});

test("full-table Delete no longer renders a confirmation checkbox", () => {
  const html = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
  assert.doesNotMatch(html, /deleteConfirmWholeTable|I understand this deletes every record/);
});
