const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../dataModel.js"), "utf8");

function createPage({ objectSelected, attributesSelected, drawerObject = "Profile_Test" }) {
  let now = 0;
  let drawerOpen = false;
  const state = { objectSelected, attributesSelected, objectClicks: 0, tabClicks: 0, addClicks: 0 };
  const element = (label = "") => ({
    textContent: label, value: "", disabled: false, isConnected: true,
    getClientRects: () => [{}], getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    scrollIntoView() {}, focus() {}, dispatchEvent() {}, click() {}
  });
  const heading = element("Profile_Test");
  heading.getAttribute = (name) => name === "title" ? "Profile_Test" : null;
  const object = element();
  object.querySelector = (selector) => selector === "h4[title], h4" ? heading : null;
  object.getAttribute = (name) => name === "aria-selected" ? String(state.objectSelected) : null;
  object.click = () => { state.objectClicks++; state.objectSelected = true; };
  const attributes = element("Attributes");
  attributes.getAttribute = (name) => name === "aria-selected" ? String(state.attributesSelected) : null;
  attributes.click = () => { state.tabClicks++; state.attributesSelected = true; };
  const tabBar = { querySelectorAll: () => [attributes] };
  const details = element("Details");
  details.closest = () => tabBar;
  const add = element();
  add.click = () => { state.addClicks++; drawerOpen = true; };
  const drawer = {
    querySelector: (selector) => selector === ".data-object-title" ? element(`Data object : ${drawerObject}`) : null,
    querySelectorAll: (selector) => selector.startsWith("button") ? [cancel] : []
  };
  const inputs = Object.fromEntries(["attrNameInput|input", "attrIdInput|input", "attrDataTypeInput|input"]
    .map((id) => {
      const input = element();
      input.getClientRects = () => drawerOpen ? [{}] : [];
      input.closest = () => drawer;
      return [id, input];
    }));
  const cancel = element("Cancel");
  cancel.getClientRects = () => drawerOpen ? [{}] : [];
  cancel.click = () => { drawerOpen = false; };
  const save = element("Save");
  const document = {
    getElementById: (id) => ({ "dataObjDetails-tab": details, "attribute-plus-icon": add, ...inputs })[id] || null,
    querySelectorAll: (selector) => selector === "[role=tab]" ? [object]
      : selector === "button, oj-button, [role=button]" ? [cancel] : [],
    querySelector: (selector) => selector === "#attr-save-btn button" ? save : null
  };
  const window = { __cdpAutomationStopped: false };
  vm.runInNewContext(source, {
    window, document, MouseEvent: class {},
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => { now += delay; queueMicrotask(callback); return 0; }
  });
  return { state, window };
}

test("adding the next attribute explicitly reselects the target object and Attributes tab", async () => {
  const { state, window } = createPage({ objectSelected: true, attributesSelected: true });
  await window.cdpDataModelOpenAttribute("Profile", "Profile_Test", true);
  assert.equal(state.objectClicks, 1);
  assert.equal(state.tabClicks, 1);
  assert.equal(state.addClicks, 1);
});

test("verified target can add another attribute without resetting the search", async () => {
  const { state, window } = createPage({ objectSelected: true, attributesSelected: true });
  await window.cdpDataModelOpenAttribute("Profile", "Profile_Test", true, true);
  assert.equal(state.objectClicks, 0);
  assert.equal(state.tabClicks, 0);
  assert.equal(state.addClicks, 1);
});

test("relationship Details view switches back to Attributes for the new object", async () => {
  const { state, window } = createPage({ objectSelected: false, attributesSelected: false });
  await window.cdpDataModelOpenAttribute("Profile", "Profile_Test", true);
  assert.equal(state.objectClicks, 1);
  assert.equal(state.tabClicks, 1);
  assert.equal(state.addClicks, 1);
});

test("wrong attribute drawer target stops before entering fields", async () => {
  const { state, window } = createPage({ objectSelected: false, attributesSelected: false, drawerObject: "Account" });
  await assert.rejects(window.cdpDataModelOpenAttribute("Profile", "Profile_Test", true), /Account, not Profile_Test/);
  assert.equal(state.addClicks, 2, "retry once, then stop rather than entering data on Account");
});

test("a newly created exact-match object is selected without opening JET search", async () => {
  const group = {
    textContent: "Profile", getClientRects: () => [{}],
    getAttribute: (name) => name === "aria-selected" ? "true" : null
  };
  const heading = {
    textContent: "Profile_Test", getAttribute: (name) => name === "title" ? "Profile_Test" : null
  };
  const object = {
    getClientRects: () => [{}],
    querySelector: (selector) => selector === "h4[title], h4" ? heading : null
  };
  const document = {
    querySelectorAll: (selector) => selector === "[role=tab]" ? [object] : [group],
    querySelector: (selector) => selector === "#cd-do-search .search-box-container"
      ? { getAttribute: () => "false" } : null,
    getElementById: () => null
  };
  const window = { __cdpAutomationStopped: false };
  vm.runInNewContext(source, { window, document, setTimeout });
  const result = await window.cdpDataModelPrepareObjectSearch("Profile", "Profile_Test");
  assert.equal(result.mode, "direct");
});

test("an exact-match object beyond the first rendered list page is found by scrolling", async () => {
  let scrollTop = 0;
  const group = {
    textContent: "Profile", getClientRects: () => [{}],
    getAttribute: (name) => name === "aria-selected" ? "true" : null
  };
  const heading = {
    textContent: "Profile_Later", getAttribute: (name) => name === "title" ? "Profile_Later" : null
  };
  const object = {
    getClientRects: () => [{}],
    querySelector: (selector) => selector === "h4[title], h4" ? heading : null
  };
  const list = {
    clientHeight: 100, scrollHeight: 10000, parentElement: null,
    get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = value; }
  };
  const document = {
    body: {},
    querySelectorAll: (selector) => selector === "[role=tab]" ? (scrollTop >= 8100 ? [object] : []) : [group],
    querySelector: (selector) => selector === "#cd-do-search .search-box-container"
      ? { getAttribute: () => "false" } : null,
    getElementById: (id) => id === "data-object-navigation-list" ? list : null
  };
  const window = { __cdpAutomationStopped: false };
  vm.runInNewContext(source, {
    window, document,
    setTimeout: (callback) => { queueMicrotask(callback); return 0; }
  });
  const result = await window.cdpDataModelPrepareObjectSearch("Profile", "Profile_Later");
  assert.equal(result.mode, "direct");
  assert.ok(scrollTop >= 8100);
});

test("the list scan checks rows loaded after reaching the previous bottom", async () => {
  let scrollTop = 0;
  let loadedNextPage = false;
  const group = {
    textContent: "Profile", getClientRects: () => [{}],
    getAttribute: (name) => name === "aria-selected" ? "true" : null
  };
  const heading = {
    textContent: "Profile_NextPage", getAttribute: (name) => name === "title" ? "Profile_NextPage" : null
  };
  const object = {
    getClientRects: () => [{}],
    querySelector: (selector) => selector === "h4[title], h4" ? heading : null
  };
  const list = {
    clientHeight: 100, scrollHeight: 300, parentElement: null,
    get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = value; },
    querySelectorAll: () => { loadedNextPage = true; return []; }
  };
  const document = {
    body: {},
    querySelectorAll: (selector) => selector === "[role=tab]" ? (loadedNextPage ? [object] : []) : [group],
    querySelector: (selector) => selector === "#cd-do-search .search-box-container"
      ? { getAttribute: () => "false" } : null,
    getElementById: (id) => id === "data-object-navigation-list" ? list : null
  };
  const window = { __cdpAutomationStopped: false };
  vm.runInNewContext(source, {
    window, document,
    setTimeout: (callback) => { queueMicrotask(callback); return 0; }
  });
  const result = await window.cdpDataModelPrepareObjectSearch("Profile", "Profile_NextPage");
  assert.equal(result.mode, "direct");
  assert.equal(loadedNextPage, true);
});
