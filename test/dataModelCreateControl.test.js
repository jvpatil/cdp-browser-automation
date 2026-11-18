const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../dataModel.js"), "utf8");

function createPage({ searchExpanded, searchInputVisible = searchExpanded, plusDelayMs = 0 }) {
  let now = 0;
  const state = { searchExpanded, searchInputVisible, plusVisible: !searchExpanded && !searchInputVisible, drawerVisible: false, doneClicks: 0, plusClicks: 0, profileClicks: 0, plusClickedAt: 0 };
  const element = (label = "") => ({
    textContent: label, disabled: false, isConnected: true,
    getClientRects: () => [{}], getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    scrollIntoView() {}, focus() {}, dispatchEvent() {}, click() {}
  });
  const profile = element("Profile");
  profile.getAttribute = (name) => name === "aria-selected" ? "true" : null;
  profile.click = () => { state.profileClicks += 1; };
  const searchBox = element();
  searchBox.getAttribute = (name) => name === "aria-pressed" ? String(state.searchExpanded) : null;
  const done = element("Done");
  done.getClientRects = () => state.searchExpanded || state.searchInputVisible ? [{}] : [];
  done.click = () => { state.doneClicks += 1; state.searchExpanded = false; state.searchInputVisible = false; state.plusVisible = true; };
  const searchInput = element();
  searchInput.getClientRects = () => state.searchInputVisible ? [{}] : [];
  const plus = element();
  plus.getClientRects = () => state.plusVisible && now >= plusDelayMs ? [{}] : [];
  plus.click = () => { state.plusClicks += 1; state.plusClickedAt = now; state.drawerVisible = true; };
  const drawer = element();
  drawer.getClientRects = () => state.drawerVisible ? [{}] : [];
  drawer.classList = { contains: (name) => name === "oj-complete" };
  const inputs = Object.fromEntries(["objNameInput|input", "objIdInput|input", "objResNameInput|input"]
    .map((id) => [id, element()]));
  const cancel = element();
  const document = {
    querySelectorAll: (selector) => selector.startsWith("oj-tab-bar a") ? [profile] : [],
    querySelector: (selector) => ({
      "#cd-do-search .search-box-container": searchBox,
      "#cd-do-search .close-container": done,
      "#cd-do-search input[placeholder='Enter Keyword']": searchInput,
      "#btnCancel button": cancel
    })[selector] || null,
    getElementById: (id) => ({ "do-plus-icon": plus, "data-object-management": drawer, "search-input-text|input": searchInput, ...inputs })[id] || null
  };
  const window = { __cdpAutomationStopped: false };
  vm.runInNewContext(source, {
    window, document, MouseEvent: class {},
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => { now += delay; queueMicrotask(callback); return 0; }
  });
  return { state, window, getNow: () => now };
}

test("next Profile object closes search before using the exact Create icon", async () => {
  const { state, window } = createPage({ searchExpanded: true });
  await window.cdpDataModelOpenGroup("Profile");
  assert.equal(state.profileClicks, 0, "do not reselect the already-selected group");
  assert.equal(state.doneClicks, 1);
  assert.equal(state.plusClicks, 1);
});

test("search input is closed even when JET's expanded flag is already false", async () => {
  const { state, window } = createPage({ searchExpanded: false, searchInputVisible: true, plusDelayMs: 2600 });
  await window.cdpDataModelOpenGroup("Profile");
  assert.equal(state.doneClicks, 1);
  assert.equal(state.plusClicks, 1);
  assert.ok(state.plusClickedAt >= 2600, "use the Create icon once Oracle restores it");
});

test("Create icon is used directly when object search is already closed", async () => {
  const { state, window } = createPage({ searchExpanded: false });
  await window.cdpDataModelOpenGroup("Profile");
  assert.equal(state.doneClicks, 0);
  assert.equal(state.plusClicks, 1);
});

test("attribute completion closes a cleared search before another same-group model", async () => {
  const { state, window, getNow } = createPage({ searchExpanded: true, searchInputVisible: true, plusDelayMs: 100000 });
  await window.cdpDataModelFinishObjectSearch();
  assert.equal(state.doneClicks, 1);
  assert.equal(state.plusClicks, 0, "attribute completion must not create another object");
  assert.equal(state.searchExpanded, false);
  assert.equal(state.searchInputVisible, false);
  assert.ok(getNow() < 1000, "do not wait for + until the next create step");
});
