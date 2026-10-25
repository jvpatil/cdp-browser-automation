const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const planner = require("../deletePlanner.js");

const context = vm.createContext({
  CdpDeletePlanner: planner,
  chrome: { runtime: { onMessage: { addListener() {} } } },
  importScripts() {},
  console,
  crypto: globalThis.crypto,
  URL,
  setTimeout,
  clearTimeout
});
const background = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
vm.runInContext(`${background}\nthis.testBuildCustomImportConfig = buildCustomImportConfig; this.testSingleImportTemplateId = singleImportTemplateId; this.testImportRouteTemplateId = importRouteTemplateId; this.testCustomObjectCode = customObjectCode; this.testJobNameForRequest = jobNameForRequest; this.testCombineImportMappingSources = combineImportMappingSources; loadLiveDataViewerFields = async (_tabId, table) => table.testFields; loadTableCatalog = async () => ({ importsById: {} });`, context);

const original = {
  isCustom: true, tableId: "Profile_TEST_23OCT_1520_c", cdpTable: "Profile_TEST_23OCT_1520_c", label: "PROFILE_TEST_23OCT_1520",
  testFields: ["SourceID", "SourceProfile_TEST_23OCT_1520_cID", "SourceCustomerID_c", "Email_c"].map((fieldId) => ({ fieldId }))
};
const copy = {
  isCustom: true, tableId: "Profile_DELETE_TEST_23OCT_1520_c", cdpTable: "Profile_DELETE_TEST_23OCT_1520_c", label: "PROFILE_DELETE_TEST_23OCT_1520",
  testFields: ["SourceID", "SourceProfile_DELETE_TEST_23OCT_1520_cID", "SourceCustomerID_c", "Email_c"].map((fieldId) => ({ fieldId }))
};
const unrelated = {
  isCustom: true, tableId: "Product_TEST_23OCT_1520_c", cdpTable: "Product_TEST_23OCT_1520_c", label: "PRODUCT_TEST_23OCT_1520",
  testFields: ["SourceID", "SourceProduct_TEST_23OCT_1520_cID", "Email_c"].map((fieldId) => ({ fieldId }))
};

const build = (tables, mode, selection = tables) => context.testBuildCustomImportConfig(1, tables, ",", mode, selection);
const ownHeader = "sourceprofile_test_23oct_1520_cid";
const copyHeader = "sourceprofile_delete_test_23oct_1520_cid";

test("original alone maps its own source key", async () => {
  const result = await build([original], "combined");
  assert.match(result.sources[0].csvContent, new RegExp(ownHeader));
  assert.equal(result.sources[0].fieldToTable[ownHeader][0], original.cdpTable);
});

test("DELETE copy alone maps its own physical headers", async () => {
  const result = await build([copy], "combined");
  assert.match(result.sources[0].csvContent, new RegExp(copyHeader));
  assert.equal(result.sources[0].fieldToTable[ownHeader], undefined);
});

test("exact selected pair bridges one original CSV header in separate and combined modes", async () => {
  for (const mode of ["separate", "combined"]) {
    const result = await build([original, copy], mode);
    const mapping = mode === "combined" ? result.sources[0] : result.sources.find((source) => source.table?.label === copy.label);
    assert.match(mapping.csvContent, new RegExp(ownHeader));
    assert.equal(mapping.csvContent.includes(copyHeader), false);
    assert.equal(mapping.fieldTargetAttributes[ownHeader][copy.cdpTable][0], "SourceProfile_DELETE_TEST_23OCT_1520_cID");
    assert.equal(mapping.requiredTargetMappings[0].sourceHeader, ownHeader);
    assert.equal(mapping.requiredTargetMappings[0].tableName, copy.cdpTable);
  }
});

test("separate-job mapping retains the full selected-set pair context", async () => {
  const result = await build([copy], "combined", [original, copy]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].fieldTargetAttributes[ownHeader][copy.cdpTable][0], "SourceProfile_DELETE_TEST_23OCT_1520_cID");
  assert.equal(result.sources[0].requiredTargetMappings.length, 1);
});

test("pair recognition tolerates Oracle's displayed _c table suffix", async () => {
  const source = { ...original, label: `${original.label}_c` };
  const target = { ...copy, label: `${copy.label}_c` };
  const result = await build([source, target], "separate");
  const mapping = result.sources.find((item) => item.table?.label === target.label);
  assert.equal(mapping.fieldTargetAttributes[ownHeader][target.cdpTable][0], "SourceProfile_DELETE_TEST_23OCT_1520_cID");
});

test("pair recognition preserves mixed-case names from the new naming format", async () => {
  const source = { ...original, label: "Profile_Test_23OCT_1520" };
  const target = { ...copy, label: "Profile_DELETE_Test_23OCT_1520" };
  const result = await build([source, target], "separate");
  const mapping = result.sources.find((item) => item.table?.label === target.label);
  assert.equal(mapping.fieldTargetAttributes[ownHeader][target.cdpTable][0], "SourceProfile_DELETE_TEST_23OCT_1520_cID");
});

test("DELETE and unrelated Product each use their own fields", async () => {
  const result = await build([copy, unrelated], "separate");
  const deleteSource = result.sources.find((source) => source.table?.label === copy.label);
  const productSource = result.sources.find((source) => source.table?.label === unrelated.label);
  assert.match(deleteSource.csvContent, new RegExp(copyHeader));
  assert.match(productSource.csvContent, /sourceproduct_test_23oct_1520_cid/);
  assert.equal(deleteSource.fieldToTable[ownHeader], undefined);
});

test("Behavioral pair bridges its own physical source key", async () => {
  const behavioral = { ...original, label: "BEHAVIORAL_TEST_23OCT_1520", tableId: "Behavioral_TEST_23OCT_1520_c", cdpTable: "Behavioral_TEST_23OCT_1520_c",
    testFields: ["SourceID", "SourceBehavioral_TEST_23OCT_1520_cID", "SourceCustomerID_c", "Email_c"].map((fieldId) => ({ fieldId })) };
  const deleteBehavioral = { ...copy, label: "BEHAVIORAL_DELETE_TEST_23OCT_1520", tableId: "Behavioral_DELETE_TEST_23OCT_1520_c", cdpTable: "Behavioral_DELETE_TEST_23OCT_1520_c",
    testFields: ["SourceID", "SourceBehavioral_DELETE_TEST_23OCT_1520_cID", "SourceCustomerID_c", "Email_c"].map((fieldId) => ({ fieldId })) };
  const result = await build([behavioral, deleteBehavioral], "combined");
  assert.equal(result.sources[0].fieldTargetAttributes.sourcebehavioral_test_23oct_1520_cid[deleteBehavioral.cdpTable][0], "SourceBehavioral_DELETE_TEST_23OCT_1520_cID");
});

test("one-job Import uses the original route for a selected DELETE copy", async () => {
  const flow = {
    importMappingMode: "separate", templateId: "default", exportPayloads: [original.label],
    importCustomTables: [original, copy], transferRoutes: { [original.label]: "source-a" }
  };
  assert.equal(context.testImportRouteTemplateId(flow, copy.label), "source-a");
  assert.equal(await context.testSingleImportTemplateId(flow), "source-a");
  const manual = { ...flow, exportPayloads: [] };
  assert.equal(context.testImportRouteTemplateId(manual, copy.label), "source-a");
});

test("mixed Import routes fail before creating a one-job Import", async () => {
  const flow = {
    importMappingMode: "combined", templateId: "default", importCustomTables: [original, unrelated],
    transferRoutes: { [original.label]: "source-a", [unrelated.label]: "source-b" }
  };
  await assert.rejects(context.testSingleImportTemplateId(flow), /one source template/i);
  flow.importMappingMode = "separateJobs";
  assert.equal(await context.testSingleImportTemplateId(flow), "");
});

test("paired Import mapping sources and per-table jobs have distinct names", async () => {
  const mapped = await build([original, copy], "separate");
  assert.equal(mapped.sources.length, 2);
  assert.equal(mapped.sources[0].sourceCode, "PROFILE");
  assert.equal(mapped.sources[1].sourceCode, "PROFILE_DELETE");
  const template = { id: "source-a", name: "source-a", connectionPurpose: "TEST" };
  const sequence = { dateTag: "23OCT", entityTag: "TEST", ordinal: 1 };
  const sourceJob = context.testJobNameForRequest({ kind: "import", customTables: [original], tableIds: [], template, connectionSequence: sequence });
  const copyJob = context.testJobNameForRequest({ kind: "import", customTables: [copy], tableIds: [], template, connectionSequence: sequence });
  assert.notEqual(sourceJob, copyJob);
  assert.match(copyJob, /PROFILE_DEL/);
});

test("shared-map mode merges OOTB and paired custom mappings into one source", async () => {
  const custom = await build([original, copy], "combined");
  const ootb = {
    sourceCode: "CUSTOMER", targetTables: ["Customer"],
    fieldToTable: { sourceid: ["Customer"], sourcecustomerid_c: ["Customer"] },
    csvContent: "sourceid,sourcecustomerid_c\nCDP,231026001\n"
  };
  const result = context.testCombineImportMappingSources([ootb, ...custom.sources]);
  assert.equal(result.sourceCode, "COMBINED");
  assert.deepEqual(Array.from(result.fieldToTable.sourceid), ["Customer", original.cdpTable, "ContactPoint", copy.cdpTable]);
  assert.equal(result.fieldTargetAttributes[ownHeader][copy.cdpTable][0], "SourceProfile_DELETE_TEST_23OCT_1520_cID");
  assert.equal(result.requiredTargetMappings.length, 1);
  assert.match(result.csvContent, /sourcecustomerid_c/);
});

test("model creation adds copies only for checked types with the same attributes and parent", async () => {
  const saved = [];
  const attributes = [];
  const relationships = [];
  context.chrome.tabs = { get: async () => ({ url: "https://example.test/data/" }) };
  context.chrome.scripting = { executeScript: async ({ args = [], func }) => {
    if (args.length === 3) { relationships.push(args); return [{ result: { saved: true, verified: true } }]; }
    if (args.length === 2) return [{ result: { group: args[0] } }];
    if (String(func).includes("cdpDataModelPrepareForSave")) return [{ result: { expectedRecords: 1 } }];
    return [{ result: {} }];
  } };
  context.testSaved = saved;
  context.testAttributes = attributes;
  vm.runInContext(`
    navigateAndWait = async () => {};
    activatePageAutomationRun = async () => {};
    waitForPageElement = async () => {};
    appendRunLog = async () => {};
    assertSequenceActive = () => {};
    commitJetDataModelObjectName = async (_tab, name) => { testSaved.push(name); return { name, objectId: name + "_c" }; };
    commitJetDataModelResourceName = async (_tab, name) => ({ resourceName: name.toLowerCase() });
    runDataModelAttributesStep = async (_tab, _run, options) => { testAttributes.push(options); };
    this.testRunDataModelStep = runDataModelStep;
  `, context);
  const result = await context.testRunDataModelStep(1, "test-run", {
    purpose: "SOAK", groups: ["Profile", "Behavioral", "Product"], deleteCopyGroups: ["Profile", "Product"],
    saveObjects: true, attributeGroups: ["Profile", "Behavioral", "Product"],
    parentByGroup: { Profile: "Customer", Behavioral: "Customer", Product: "Account" }
  });
  assert.equal(saved.length, 5);
  assert.equal(attributes.length, 5);
  assert.equal(relationships.length, 5);
  assert.ok(result.deleteCopies.Profile.name.startsWith("Profile_DELETE_"));
  assert.ok(result.deleteCopies.Product.name.startsWith("Product_DELETE_"));
  assert.equal(result.deleteCopies.Behavioral, undefined);
  assert.equal(relationships.filter((entry) => entry[0] === "Product").every((entry) => entry[2] === "Account"), true);
});
