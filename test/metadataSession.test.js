const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  chrome: {
    runtime: { onMessage: { addListener() {} } },
    scripting: { async executeScript({ func, args }) { return [{ result: await func(...args) }]; } }
  },
  importScripts() {}, console, URL, setTimeout, clearTimeout,
  location: { hostname: "testtenant.cdp.ocs.oc-test.com", origin: "https://testtenant.cdp.ocs.oc-test.com" }
});
const background = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
vm.runInContext(`${background}\nthis.testFetchMetadata = fetchCdpMetadata; this.testLoadLiveTables = loadLiveDataViewerTables;`, context);

test("metadata 302 redirect reports expired CDP session before parsing JSON", async () => {
  let requestOptions;
  context.fetch = async (_url, options) => {
    requestOptions = options;
    return { type: "opaqueredirect", status: 0, ok: false };
  };
  await assert.rejects(context.testFetchMetadata(1, "tables?limit=1000"), /CDP session expired.*Sign in/);
  assert.equal(requestOptions.redirect, "manual");
  context.fetch = async () => ({ type: "basic", status: 302, ok: false });
  await assert.rejects(context.testFetchMetadata(1, "tables?limit=1000"), /CDP session expired/);
});

test("metadata sign-in HTML cannot masquerade as a successful catalog", async () => {
  context.fetch = async () => ({
    type: "basic", status: 200, ok: true,
    headers: { get: () => "text/html" },
    json: () => { throw new Error("JSON parser should not run for HTML"); }
  });
  await assert.rejects(context.testFetchMetadata(1, "tables?limit=1000"), /sign-in page instead of JSON/);
});

test("authenticated metadata still returns JSON", async () => {
  context.fetch = async () => ({
    type: "basic", status: 200, ok: true,
    headers: { get: () => "application/json" }, json: async () => ({ items: [{ name: "Customer" }] })
  });
  const result = await context.testFetchMetadata(1, "tables?limit=1000");
  assert.equal(result.items[0].name, "Customer");
});

test("missing injected result is an error, not an empty table catalog", async () => {
  const executeScript = context.chrome.scripting.executeScript;
  context.chrome.scripting.executeScript = async () => [{ result: undefined }];
  try {
    await assert.rejects(context.testFetchMetadata(1, "tables?limit=1000"), /metadata request did not complete/);
  } finally {
    context.chrome.scripting.executeScript = executeScript;
  }
});

test("table refresh retains DW filter and sorts catalog alphabetically", async () => {
  vm.runInContext(`
    fetchCdpMetadata = async (_tabId, endpoint) => { this.lastTableEndpoint = endpoint; return { items: [
      { name: "PROFILE_PREJDK_23OCT_1806", tableId: "PROFILE_PREJDK_23OCT_1806_c" },
      { name: "Customer", tableId: "Customer" },
      { name: "ACCOUNT_TEST_c", tableId: "ACCOUNT_TEST_c" }
    ] }; };
  `, context);
  const tables = await context.testLoadLiveTables(1);
  assert.match(context.lastTableEndpoint, /^tables\?q=.*&limit=1000$/);
  assert.deepEqual(Array.from(tables, (table) => table.label), ["ACCOUNT_TEST_c", "Customer", "PROFILE_PREJDK_23OCT_1806"]);
  assert.ok(!tables.find((table) => table.label === "Customer").isCustom);
  assert.equal(tables.find((table) => table.label === "PROFILE_PREJDK_23OCT_1806").isCustom, true);
});

test("quiet startup refresh still shows session-expired error", async () => {
  const popupSource = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
  const refreshSource = popupSource.match(/async function refreshLiveDataViewerTables\(\{ quiet = false \} = \{\}\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(refreshSource);
  const messages = [];
  const hints = new Map();
  const popupContext = vm.createContext({
    URL, liveCatalogRefreshId: 0, liveCatalogOrigin: "https://testtenant.cdp.ocs.oc-test.com",
    activeTab: async () => 1,
    chrome: {
      tabs: { get: async () => ({ url: "https://testtenant.cdp.ocs.oc-test.com/data/" }) },
      runtime: { sendMessage: async () => ({ ok: false, error: "CDP session expired. Sign in to this tenant, then click Refresh CDP tables." }) }
    },
    document: { getElementById(id) { if (!hints.has(id)) hints.set(id, { textContent: "", hidden: true, classList: { add() {} } }); return hints.get(id); } },
    setStatus: (message) => messages.push(message)
  });
  vm.runInContext(`${refreshSource}\nthis.testRefresh = refreshLiveDataViewerTables;`, popupContext);
  await popupContext.testRefresh({ quiet: true });
  assert.match(messages[0], /CDP session expired/);
  assert.match(hints.get("dataViewerLiveHint").textContent, /Sign in/);
  assert.equal(hints.get("workingSetHint").hidden, false);
});
