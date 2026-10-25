const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../dataModel.js"), "utf8");

function createPage({ searchExpanded }) {
  const state = { searchExpanded, plusVisible: !searchExpanded, drawerVisible: false, doneClicks: 0, plusClicks: 0, profileClicks: 0 };
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
  done.getClientRects = () => state.searchExpanded ? [{}] : [];
  done.click = () => { state.doneClicks += 1; state.searchExpanded = false; state.plusVisible = true; };
  const plus = element();
  plus.getClientRects = () => state.plusVisible ? [{}] : [];
  plus.click = () => { state.plusClicks += 1; state.drawerVisible = true; };
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
      "#btnCancel button": cancel
    })[selector] || null,
    getElementById: (id) => ({ "do-plus-icon": plus, "data-object-management": drawer, ...inputs })[id] || null
  };
  const window = { __cdpAutomationStopped: false };
  vm.runInNewContext(source, {
    window, document, MouseEvent: class {},
    setTimeout: (callback) => { queueMicrotask(callback); return 0; }
  });
  return { state, window };
}

test("next Profile object closes search before using the exact Create icon", async () => {
  const { state, window } = createPage({ searchExpanded: true });
  await window.cdpDataModelOpenGroup("Profile");
  assert.equal(state.profileClicks, 0, "do not reselect the already-selected group");
  assert.equal(state.doneClicks, 1);
  assert.equal(state.plusClicks, 1);
});

test("Create icon is used directly when object search is already closed", async () => {
  const { state, window } = createPage({ searchExpanded: false });
  await window.cdpDataModelOpenGroup("Profile");
  assert.equal(state.doneClicks, 0);
  assert.equal(state.plusClicks, 1);
});
