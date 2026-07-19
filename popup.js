const IMPORT_JOB_TYPES = [
  { id: "customer", label: "Customer" }, { id: "contactPoint", label: "Contacts" }, { id: "address", label: "Address" }
];
const EXPORT_PAYLOAD_OPTIONS = ["Customer", "Master Customer", "Account", "Master Account", "ContactPoint", "Address", "Order", "Product"];
const DEFAULT_FLOW = ["source", "destination", "export", "import", "publish", "verify"];
const DEFAULT_SCHEDULER = { mode: "scheduled", frequency: "Daily", startTime: "immediate" };
const state = {
  importSettings: {}, exportPayloadName: "Customer", schedulers: {
    responsys: { ...DEFAULT_SCHEDULER }, quickImport: { ...DEFAULT_SCHEDULER }, quickExport: { ...DEFAULT_SCHEDULER }, flowImport: { ...DEFAULT_SCHEDULER }, flowExport: { ...DEFAULT_SCHEDULER }
  }
};
const statusEl = document.getElementById("status");
const statusDot = document.getElementById("statusDot");
const stopButton = document.getElementById("stopE2EBtn");

function selectedTableIds() { return IMPORT_JOB_TYPES.filter((table) => state.importSettings[table.id]).map((table) => table.id); }
function schedulerSummary(config) { return config.mode === "onDemand" ? "On-demand" : `Scheduled · ${config.frequency}`; }
function schedulerConfig(key) { return { ...state.schedulers[key] }; }
function selectedFlowSteps() { return DEFAULT_FLOW.filter((step) => document.getElementById(`flow-${step}`).checked); }
function flowHasBothJobs() { const steps = selectedFlowSteps(); return steps.includes("export") && steps.includes("import"); }
function buttonGroup(options, value, onChange, disabled = false) {
  const group = document.createElement("div"); group.className = "scheduler-options";
  options.forEach((option) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = option.label; button.disabled = disabled;
    button.setAttribute("aria-pressed", String(value === option.value));
    button.addEventListener("click", () => onChange(option.value)); group.append(button);
  });
  return group;
}
function schedulerRow(label, options, value, onChange, disabled = false) {
  const row = document.createElement("div"); row.className = "scheduler-row";
  const text = document.createElement("span"); text.className = "scheduler-label"; text.textContent = label;
  row.append(text, buttonGroup(options, value, onChange, disabled)); return row;
}
function renderSchedulers() {
  document.querySelectorAll("[data-scheduler]").forEach((container) => {
    const key = container.dataset.scheduler; const config = state.schedulers[key]; const lockStart = key.startsWith("flow") && flowHasBothJobs();
    container.replaceChildren();
    container.append(schedulerRow("Mode", [{ value: "onDemand", label: "On-demand" }, { value: "scheduled", label: "Scheduled" }], config.mode, (mode) => { config.mode = mode; persistDraft(); renderAll(); }));
    const advanced = document.createElement("div"); advanced.className = "scheduler-advanced"; advanced.hidden = config.mode !== "scheduled";
    advanced.append(
      schedulerRow("Frequency", ["Hourly", "Daily", "Weekly"].map((value) => ({ value, label: value })), config.frequency, (frequency) => { config.frequency = frequency; persistDraft(); renderAll(); }),
      schedulerRow("Start Time", [{ value: "immediate", label: "Immediate" }, { value: "plusOneHour", label: "+1 Hour" }], lockStart ? (key === "flowExport" ? "immediate" : "plusOneHour") : config.startTime, (startTime) => { config.startTime = startTime; persistDraft(); renderAll(); }, lockStart)
    );
    container.append(advanced);
  });
  document.getElementById("responsysScheduleLabel").textContent = schedulerSummary(state.schedulers.responsys);
}
function tableChoice(table) {
  const label = document.createElement("label"); label.className = "choice";
  const input = document.createElement("input"); input.type = "checkbox"; input.checked = Boolean(state.importSettings[table.id]);
  input.addEventListener("change", () => { state.importSettings[table.id] = input.checked; persistDraft(); renderAll(); });
  label.append(input, document.createTextNode(table.label)); return label;
}
function renderTableChoices() {
  const filter = document.getElementById("quickImportSearch").value.trim().toLowerCase();
  const tables = IMPORT_JOB_TYPES.filter((table) => table.label.toLowerCase().includes(filter));
  document.getElementById("quickImportTables").replaceChildren(...(filter ? tables : tables.slice(0, 6)).map(tableChoice));
  document.getElementById("flowImportTables").replaceChildren(...IMPORT_JOB_TYPES.map(tableChoice));
  const count = selectedTableIds().length;
  document.getElementById("quickImportCount").textContent = count ? `${count} table${count === 1 ? "" : "s"}` : "Select tables";
}
function payloadChoice(name, scope) {
  const label = document.createElement("label"); label.className = "choice";
  const input = document.createElement("input"); input.type = "radio"; input.name = `${scope}-payload`; input.checked = state.exportPayloadName === name;
  input.addEventListener("change", () => { state.exportPayloadName = name; persistDraft(); renderAll(); });
  label.append(input, document.createTextNode(name)); return label;
}
function renderPayloadChoices() {
  const filter = document.getElementById("quickExportSearch").value.trim().toLowerCase();
  const values = EXPORT_PAYLOAD_OPTIONS.filter((name) => name.toLowerCase().includes(filter));
  document.getElementById("quickExportPayloads").replaceChildren(...(filter ? values : values.slice(0, 6)).map((name) => payloadChoice(name, "quick")));
  document.getElementById("flowExportPayloads").replaceChildren(...EXPORT_PAYLOAD_OPTIONS.map((name) => payloadChoice(name, "flow")));
  document.getElementById("quickExportValue").textContent = state.exportPayloadName;
}
function renderFlow() {
  const steps = selectedFlowSteps(); const hasJobs = steps.includes("export") || steps.includes("import");
  document.getElementById("flowExportConfig").hidden = !steps.includes("export"); document.getElementById("flowImportConfig").hidden = !steps.includes("import");
  const publish = document.getElementById("flow-publish"); const verify = document.getElementById("flow-verify"); publish.disabled = !hasJobs; if (!hasJobs) publish.checked = false; verify.disabled = !hasJobs || !publish.checked; if (verify.disabled) verify.checked = false;
  const both = flowHasBothJobs();
  const preview = steps.map((step) => {
    if (step === "export") return `Export (${state.exportPayloadName}${both ? ", next hour" : ""})`;
    if (step === "import") return `Import (${selectedTableIds().length} tables${both ? ", +1 hour" : ""})`;
    return ({ source: "Source", destination: "Destination", publish: "Publish", verify: "Verify" })[step];
  });
  document.getElementById("flowPreview").textContent = preview.length ? preview.join("  →  ") : "Select at least one step.";
  document.getElementById("flowHint").textContent = both ? "Start times are locked: Export next hour, Import one hour later." : "Steps always run in dependency-safe order.";
  const run = document.getElementById("runCustomFlowBtn"); run.textContent = `▶ Run ${steps.length}-step flow`; run.disabled = !steps.length || (steps.includes("import") && !selectedTableIds().length);
}
function renderAll() { renderTableChoices(); renderPayloadChoices(); renderFlow(); renderSchedulers(); }
async function persistDraft() { await chrome.storage.local.set({ flowDraft: { importSettings: state.importSettings, exportPayloadName: state.exportPayloadName, schedulers: state.schedulers, flowSteps: selectedFlowSteps() } }); }
function setStatus(status) { const running = /^Running:/.test(status || ""); statusEl.textContent = status || "No automation running"; statusDot.classList.toggle("idle", !running); stopButton.hidden = !running; }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error("No active tab found."); return tab.id; }
function closeAfterLaunch() { document.querySelectorAll("button").forEach((button) => { button.disabled = true; }); setTimeout(() => window.close(), 1200); }
async function send(message, label) { try { setStatus(`Running: ${label}`); chrome.runtime.sendMessage({ ...message, tabId: await activeTab() }); closeAfterLaunch(); } catch (error) { setStatus(`Failed: ${error.message || error}`); } }

document.getElementById("runE2EBtn").addEventListener("click", () => send({ type: "run-full-sequence" }, "Sanity Flow"));
document.getElementById("sourceBtn").addEventListener("click", () => send({ type: "run-task", filename: "source.js" }, "Create Source"));
document.getElementById("destinationBtn").addEventListener("click", () => send({ type: "run-task", filename: "destination.js" }, "Create Destination"));
document.getElementById("publishAllBtn").addEventListener("click", () => send({ type: "run-publish-all" }, "Publish All Data Feeds"));
document.getElementById("runResponsysBtn").addEventListener("click", () => send({ type: "run-task", filename: "importJob.js", schedule: schedulerConfig("responsys") }, "Import Responsys Profile"));
document.getElementById("runQuickImportBtn").addEventListener("click", () => { const tableIds = selectedTableIds(); if (!tableIds.length) return setStatus("Select at least one import table."); send({ type: "run-import-job", tableIds, schedule: schedulerConfig("quickImport") }, "Import Job"); });
document.getElementById("runQuickExportBtn").addEventListener("click", () => send({ type: "run-task", filename: "exportJob.js", schedule: schedulerConfig("quickExport"), exportPayloadName: state.exportPayloadName }, "Export Job"));
document.getElementById("runCustomFlowBtn").addEventListener("click", () => { const steps = selectedFlowSteps(); const staggerJobs = flowHasBothJobs(); send({ type: "run-custom-flow", flow: { steps, importTableIds: selectedTableIds(), exportPayloadName: state.exportPayloadName, exportSchedule: schedulerConfig("flowExport"), importSchedule: schedulerConfig("flowImport"), staggerJobs } }, "Custom Flow"); });
document.getElementById("stopE2EBtn").addEventListener("click", async () => { try { await chrome.runtime.sendMessage({ type: "stop-current-flow", tabId: await activeTab() }); setStatus(""); } catch (error) { setStatus(`Stop failed: ${error.message || error}`); } });
document.getElementById("quickImportSearch").addEventListener("input", renderTableChoices); document.getElementById("quickExportSearch").addEventListener("input", renderPayloadChoices);
document.getElementById("clearImportBtn").addEventListener("click", () => { state.importSettings = {}; persistDraft(); renderAll(); });
DEFAULT_FLOW.forEach((step) => document.getElementById(`flow-${step}`).addEventListener("change", () => { persistDraft(); renderAll(); }));
chrome.storage.local.get({ flowDraft: null, e2eStatus: "" }).then(({ flowDraft, e2eStatus }) => { if (flowDraft) { state.importSettings = flowDraft.importSettings || {}; state.exportPayloadName = EXPORT_PAYLOAD_OPTIONS.includes(flowDraft.exportPayloadName) ? flowDraft.exportPayloadName : "Customer"; state.schedulers = { ...state.schedulers, ...(flowDraft.schedulers || {}) }; if (Array.isArray(flowDraft.flowSteps)) DEFAULT_FLOW.forEach((step) => { document.getElementById(`flow-${step}`).checked = flowDraft.flowSteps.includes(step); }); } setStatus(e2eStatus); renderAll(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.e2eStatus) setStatus(changes.e2eStatus.newValue || ""); });
