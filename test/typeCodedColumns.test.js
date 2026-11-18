const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "config/data-model-columns.json"), "utf8"));
const context = vm.createContext({ Date });
vm.runInContext(fs.readFileSync(path.join(root, "recordProfiles.js"), "utf8"), context);
const profiles = context.cdpRecordProfiles;
const runDate = new Date("2026-10-24T09:30:00Z");
const typesByCode = {
  AS: "array - string", I64: "bigint", B: "boolean", DT: "date", DEC: "decimal",
  F64: "double", F32: "float", I32: "int", I16: "smallint", TXT: "text", TS: "timestamp", I8: "tinyint"
};

test("every new type-coverage preset has twelve distinct typed fields and Email last", () => {
  for (const group of ["Profile", "Behavioral", "Transactional", "Product", "Other"]) {
    const columns = config.typeCoverageByGroup[group];
    assert.equal(columns.length, 12, group);
    assert.deepEqual(columns.map((column) => column.name.split("_").at(-1)).sort(), Object.keys(typesByCode).sort(), group);
    assert.equal(new Set(columns.map((column) => column.name.toLowerCase())).size, 12, group);
    for (const column of columns) {
      const code = column.name.split("_").at(-1);
      assert.equal(column.dataType, typesByCode[code], column.name);
      assert.ok(column.name.length + 2 <= 50, column.name);
    }
    assert.deepEqual(config.groups[group].at(-1), { name: "Email", dataType: "string" });
  }
});

test("all new field IDs have realistic shared API and UI sample values", () => {
  for (const columns of Object.values(config.typeCoverageByGroup)) {
    for (const column of columns) {
      const fieldId = `${column.name}_c`;
      const key = fieldId.replace(/_c$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      const value = profiles.businessValue(key, { sequence: 3, runDate });
      const apiValue = profiles.normalValue(key, { sequence: 3, runDate });
      assert.notEqual(value, undefined, fieldId);
      assert.deepEqual(apiValue, value, fieldId);
      if (column.dataType === "array - string") assert.ok(Array.isArray(value) && value.length > 0, fieldId);
      else if (column.dataType === "boolean") assert.equal(typeof value, "boolean", fieldId);
      else if (column.dataType === "bigint") assert.match(value, /^\d+$/, fieldId);
      else if (column.dataType === "decimal") assert.match(value, /^\d+\.\d+$/, fieldId);
      else if (["float", "double", "tinyint", "smallint", "int"].includes(column.dataType)) assert.ok(Number.isFinite(value), fieldId);
      else if (column.dataType === "date") assert.match(value, /^\d{4}-\d{2}-\d{2}$/, fieldId);
      else if (column.dataType === "timestamp") assert.match(value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, fieldId);
      else assert.ok(typeof value === "string" && value.length > 0, fieldId);
    }
  }
});

test("legacy literal-name columns remain supported", () => {
  assert.equal(profiles.businessValue("intvalue", { sequence: 1, runDate }), undefined);
  assert.equal(profiles.normalValue("intvalue", { sequence: 1, runDate }), 100001);
  assert.equal(profiles.normalValue("email", { sequence: 1, runDate }).endsWith("@gmail.com"), true);
  assert.notEqual(profiles.businessValue("lifetimespendn18p4", { sequence: 1, runDate }), undefined);
});

test("live metadata validates decimal type without imposing precision or scale", async () => {
  const backgroundContext = vm.createContext({
    chrome: { runtime: { onMessage: { addListener() {} } } },
    importScripts() {}, console, crypto: globalThis.crypto, URL, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(root, "background.js"), "utf8"), backgroundContext);
  backgroundContext.qaConfig = config;
  vm.runInContext("loadDataModelColumnConfig = async () => qaConfig; this.validateCoded = validateTypeCodedLiveFields", backgroundContext);
  await backgroundContext.validateCoded([
    { fieldId: "ReferralCount_I16_c", dataType: "smallint" },
    { fieldId: "LifetimeSpend_DEC_c", dataType: "decimal", precision: 18, scale: 4 }
  ], "Profile_QA_c");
  await assert.rejects(
    backgroundContext.validateCoded([{ fieldId: "ReferralCount_I16_c", dataType: "string" }], "Profile_QA_c"),
    /requires smallint/
  );
  await assert.rejects(
    backgroundContext.validateCoded([{ fieldId: "LifetimeSpend_DEC_c", dataType: "string" }], "Profile_QA_c"),
    /requires decimal/
  );
  await backgroundContext.validateCoded([{ fieldId: "LifetimeSpend_DEC_c", dataType: "decimal", precision: 18, scale: 2 }], "Profile_QA_c");
  await backgroundContext.validateCoded([{ fieldId: "LifetimeSpend_N18P4_c", dataType: "decimal" }], "Profile_QA_c");
});
