const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const planner = require("../deletePlanner.js");

const popupSource = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
const syncSource = popupSource.match(/function syncImportSelectionsFromExport\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(syncSource, "Import selection sync must be present");

test("Export selection gains its exact DELETE copy after the live catalog loads", () => {
  const original = "PROFILE_PREJDK_23OCT_1806";
  const copy = "PROFILE_DELETE_PREJDK_23OCT_1806";
  const state = { importSettings: {}, importCustomSettings: {} };
  let tables = [];
  const context = vm.createContext({
    CdpDeletePlanner: planner,
    state,
    importIsDrivenByExport: () => true,
    selectedExportPayloads: () => [original],
    importNameKey: (name) => String(name || "").replace(/_c$/i, "").toLowerCase(),
    importPickerTables: () => tables,
    setImportSelected: (table, selected) => { state.importCustomSettings[table.id] = selected; }
  });
  vm.runInContext(`${syncSource}\nthis.sync = syncImportSelectionsFromExport`, context);

  context.sync(); // Export was chosen before the asynchronous table response.
  assert.deepEqual(Object.entries(state.importCustomSettings), []);
  tables = [
    { id: "original", label: original, isCustom: true },
    { id: "copy", label: `${copy}_c`, isCustom: true },
    { id: "other", label: "PROFILE_DELETE_OTHER_23OCT_1806", isCustom: true }
  ];
  context.sync(); // The catalog refresh must call sync again.
  assert.deepEqual(Object.entries(state.importCustomSettings), [["original", true], ["copy", true]]);
  assert.match(popupSource, /LIVE_CUSTOM_TABLES = DATA_VIEWER_TABLES\.filter\(\(table\) => table\.isCustom\);\s*DATA_VIEWER_LIVE_FIELDS = \{\};[\s\S]*?syncImportSelectionsFromExport\(\);/);
});
