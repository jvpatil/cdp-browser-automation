const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const popup = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
const markup = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
const renderSource = popup.match(/function renderActivityLogs\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(renderSource);

function node() {
  return {
    children: [], dataset: {}, textContent: "", scrollTop: 0, scrollHeight: 500, open: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector !== "details.activity-log-group[open]") return [];
      return this.children.flatMap((child) => [child, ...(child.querySelectorAll?.(selector) || [])])
        .filter((child) => child.className?.includes("activity-log-group") && child.open);
    }
  };
}

test("Activity shows Data Viewer records without a redundant Run card", () => {
  const liveButton = node();
  const logContainer = node();
  const controls = { showLiveLogBtn: liveButton, logIssuesOnly: { checked: false }, logAutoFollow: { checked: true } };
  const context = vm.createContext({
    document: { createElement: node, getElementById: (id) => controls[id] },
    Intl, Date, activityLogsEl: logContainer, selectedLogRun: null,
    activeLogRun: { summary: "Add data", flowSteps: ["Data Viewer"], startedAt: 1000, logs: [
      { at: 1000, message: "Started" },
      { at: 2000, group: "Customer · Record 1", parentGroup: "Data Viewer", action: "Summary", message: "Saved · Customer ID: 251026001 · Source ID: CDP · Record key: 251026001" },
      { at: 2500, group: "Customer · Record 1", parentGroup: "Data Viewer", action: "Type", message: "AlternateEmails = jagan.test01.alt1@gmail.com, jagan.test01.alt2@yahoo.com" },
      { at: 3000, level: "error", group: "ContactPoint · Record 1", parentGroup: "Data Viewer", message: "Failed" }
    ] }
  });
  vm.runInContext(`${renderSource}\nthis.render = renderActivityLogs`, context);
  context.render();
  const groups = logContainer.children[1].children;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].children[0].children[0].textContent, "Data Viewer");
  const record = groups[0].children[1].children.find((child) => child.dataset?.logGroupKey?.includes("Customer · Record 1"));
  assert.ok(record);
  assert.match(record.children[0].children[2].textContent, /Customer ID: 251026001 · Source ID: CDP/);
  assert.equal(record.children[1].children.length, 1);
  assert.match(record.children[1].children[0].children[2].textContent, /AlternateEmails/);
  assert.equal(logContainer.children[1].scrollTop, 500);
  groups[0].open = true; record.open = true;
  context.activeLogRun.logs.push({ at: 4000, group: "Customer · Record 1", action: "Save", message: "Completed" });
  context.render();
  assert.equal(logContainer.children[1].children[0].open, true);
  assert.equal(logContainer.children[1].children[0].children[1].children.find((child) => child.dataset?.logGroupKey?.includes("Customer · Record 1")).open, true);
  controls.logIssuesOnly.checked = true;
  context.render();
  assert.equal(logContainer.children[1].children.length, 1);
  assert.equal(logContainer.children[1].children[0].children[1].children.filter((child) => child.dataset?.logGroupKey?.includes("Record 1")).length, 1);
});

test("Source, destination, and named jobs appear once under their actual stages", () => {
  const controls = { showLiveLogBtn: node(), logIssuesOnly: { checked: false }, logAutoFollow: { checked: false } };
  const logContainer = node();
  const context = vm.createContext({
    document: { createElement: node, getElementById: (id) => controls[id] },
    Intl, Date, activityLogsEl: logContainer, selectedLogRun: null,
    activeLogRun: { summary: "Workflow", flowSteps: ["Source", "Destination", "Export", "Import"], startedAt: 1000, logs: [
      { at: 1000, message: "Started: Workflow" },
      { at: 2000, group: "Create Source · OOS-CSV", message: "Source saved." },
      { at: 3000, group: "Create Destination · OOS-CSV", message: "Destination saved." },
      { at: 4000, group: "Export · EXP_Customer", message: "Job name = EXP_Customer" },
      { at: 5000, group: "Import · IMP_Customer", message: "Job name = IMP_Customer" }
    ] }
  });
  vm.runInContext(`${renderSource}\nthis.render = renderActivityLogs`, context);
  context.render();
  const cards = logContainer.children[1].children;
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((item) => item.children[0].children[0].textContent), ["Source", "Destination", "Export", "Import"]);
  assert.equal(cards[0].children[1].children[0].children[0].children[0].textContent, "Connection · OOS-CSV");
  assert.equal(cards[3].children[0].children[1].textContent, "1 job");
  assert.equal(cards[3].children[1].children[0].children[0].children[0].textContent, "Job · IMP_Customer");
});

test("job and scheduler aliases fold into one Export and Import stage", () => {
  const controls = { showLiveLogBtn: node(), logIssuesOnly: { checked: false }, logAutoFollow: { checked: false } };
  const logContainer = node();
  const context = vm.createContext({
    document: { createElement: node, getElementById: (id) => controls[id] },
    Intl, Date, activityLogsEl: logContainer, selectedLogRun: null,
    activeLogRun: { summary: "Workflow", outcome: "completed", startedAt: 1000, logs: [
      { at: 1000, message: "Started: Workflow" },
      { at: 2000, group: "Create Export Job", message: "Running: Create Export Job" },
      { at: 2100, group: "Export · EXP_PROFILE", message: "Job name = EXP_PROFILE; Destination = OOS_TEST." },
      { at: 2200, group: "Scheduler · Create Export Job", message: "Create Export Job scheduler: New · Daily · specific · in15." },
      { at: 2300, group: "Scheduler · Export", action: "Type", message: "Specific time = 11:06 AM." },
      { at: 2400, group: "Export Job", message: "Export Job saved." },
      { at: 3000, group: "Create Import Job", message: "Running: Create Import Job" },
      { at: 3100, group: "Import · IMP_PROFILE", message: "Job name = IMP_PROFILE; Source = OOS_TEST." },
      { at: 3200, group: "Scheduler · Create Import Job", message: "Create Import Job scheduler: New · Daily · specific · in30." },
      { at: 3300, group: "Scheduler · Import", action: "Type", message: "Specific time = 11:23 AM." },
      { at: 3400, group: "Import Job", message: "Import Job saved." },
      { at: 4000, group: "Prepare Segment and Delete Job", message: "Running: Prepare Segment and Delete Job" },
      { at: 4100, group: "Prepare Delete", message: "Created entire-table Delete job DEL_TEST for Profile_DELETE; destination OOS_TEST." },
      { at: 4200, group: "Scheduler · Delete", action: "Type", message: "Specific time = 2:53 PM." },
      { at: 5000, group: "Publish Created Jobs", message: "Running: Publish Created Jobs" },
      { at: 5100, group: "Source", message: "Create Source saved." },
      { at: 5200, group: "Create Destination · OOS-CSV", message: "Create Destination · OOS-CSV saved." },
      { at: 6000, message: "Run completed." }
    ] }
  });
  vm.runInContext(`${renderSource}\nthis.render = renderActivityLogs`, context);
  context.render();
  const cards = logContainer.children[1].children;
  assert.deepEqual(cards.map((item) => item.children[0].children[0].textContent), ["Source", "Destination", "Export", "Import", "Delete", "Publish"]);
  assert.equal(cards[2].children[0].children[1].textContent, "1 job");
  assert.equal(cards[2].children[0].children[2].textContent, "EXP_PROFILE");
  assert.deepEqual(cards[2].children[1].children.map((item) => item.children[0].children[0].textContent), ["Job · EXP_PROFILE", "Schedule and notify", "Save confirmation"]);
  assert.equal(cards[3].children[0].children[1].textContent, "1 job");
  assert.deepEqual(cards[3].children[1].children.map((item) => item.children[0].children[0].textContent), ["Job · IMP_PROFILE", "Schedule and notify", "Save confirmation"]);
  assert.equal(cards[4].children[0].children[1].textContent, "1 job");
  assert.equal(cards[5].children[0].children[2].textContent, "Completed");
});

test("Data Viewer populates unconfigured AlternateEmails instead of skipping it", () => {
  const viewer = fs.readFileSync(path.join(__dirname, "../dataViewer.js"), "utf8");
  assert.match(viewer, /\^alternateemails\?\$[\s\S]*?\.alt/);
  assert.match(viewer, /const count = 2 \+ .* % 3/);
  assert.doesNotMatch(viewer, /Skip", target: field, value: "not configured"/);
  assert.match(viewer, /oj-combobox-many\[id\^='field-'/);
  assert.match(viewer, /reportCompletedRecord\(record\)/);
  assert.match(background, /Customer ID: \$\{customerId\}/);
  assert.doesNotMatch(background, /Data Viewer selection:/);
  assert.match(background, /!\/\^Running: Data Viewer\(\?: Record\)\?\$\/i\.test\(status\)/);
});

test("record completion writes one live log batch with IDs and detailed actions", async () => {
  const source = background.match(/let runLogQueue = Promise\.resolve\(\);[\s\S]*?(?=async function appendDataViewerRunLog)/)?.[0];
  assert.ok(source);
  let pendingRun = { startedAt: 1, logs: [] };
  let writes = 0;
  const context = vm.createContext({
    chrome: { storage: { local: {
      get: async () => ({ pendingRun }),
      set: async ({ pendingRun: value }) => { pendingRun = value; writes += 1; }
    } } }, Date
  });
  vm.runInContext(`${source}\nthis.appendRecord = appendDataViewerRecordLog;`, context);
  await context.appendRecord({ table: "Customer", sequence: 1, objectId: "251026001", outcome: "Saved",
    keys: [{ field: "SourceCustomerID", value: "251026001" }, { field: "SourceID", value: "CDP" }],
    actions: [{ action: "Type", target: "AlternateEmails", value: "jagan.test01.alt@yahoo.com" }] });
  assert.equal(writes, 1);
  assert.equal(pendingRun.logs.length, 2);
  assert.match(pendingRun.logs[0].message, /Customer ID: 251026001 · Source ID: CDP/);
  assert.match(pendingRun.logs[1].message, /AlternateEmails = jagan\.test01\.alt@yahoo\.com/);
});

test("side panel keeps durable tenant drafts and has no dashboard launcher", () => {
  assert.doesNotMatch(markup, /openDashboardBtn|dashboard-mode/);
  assert.doesNotMatch(popup, /DASHBOARD_MODE|refreshDashboardTabs/);
  assert.doesNotMatch(popup, /storage\.local\.remove\(\["flowDraft"/);
  assert.match(popup, /flowDraft:\$\{tenantHost\}/);
  assert.match(background, /runHistory: \[entry,[\s\S]*?slice\(0, 50\)/);
  assert.match(background, /reconcile-run-state|begin-run/);
});
