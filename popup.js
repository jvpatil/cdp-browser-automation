const IMPORT_JOB_TYPES = [
  { id: "customer", label: "Customer" },
  { id: "contactPoint", label: "Contacts" },
  { id: "address", label: "Address" }
];
const EXPORT_PAYLOAD_OPTIONS = ["Customer", "Master Customer", "Account", "Master Account", "ContactPoint", "Address", "Order", "Product"];
const SCHEDULES = [{ value: "-1", label: "On-demand" }, { value: "0", label: "Next hour" }, { value: "1", label: "+1 hour" }];
const DEFAULT_FLOW = ["source", "destination", "export", "import", "publish", "verify"];

const state = {
  importSettings: {}, exportPayloadName: "Customer", schedules: {
    responsysSchedule: "0", quickImportSchedule: "0", quickExportSchedule: "0", flowImportSchedule: "0", flowExportSchedule: "0"
  }
};
const statusEl = document.getElementById("status");
const statusDot = document.getElementById("statusDot");
const stopButton = document.getElementById("stopE2EBtn");

function scheduleLabel(value) { return SCHEDULES.find((item) => item.value === String(value))?.label || "Next hour"; }
function selectedTableIds() { return IMPORT_JOB_TYPES.filter((table) => state.importSettings[table.id]).map((table) => table.id); }
function scheduleObject(value) { return String(value) === "-1" ? { mode: "onDemand" } : { offsetHours: Number(value) }; }
function renderScheduleControls() {
  document.querySelectorAll("[data-schedule]").forEach((container) => {
    const key = container.dataset.schedule;
    container.replaceChildren(...SCHEDULES.map((item) => {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = item.label; button.dataset.value = item.value;
      button.setAttribute("aria-pressed", String(state.schedules[key] === item.value));
      button.disabled = key.startsWith("flow") && flowHasBothJobs();
      button.addEventListener("click", () => { state.schedules[key] = item.value; persistDraft(); renderAll(); });
      return button;
    }));
  });
}
function tableChoice(table, scope) {
  const label = document.createElement("label"); label.className = "choice";
  const input = document.createElement("input"); input.type = "checkbox"; input.checked = Boolean(state.importSettings[table.id]);
  input.addEventListener("change", () => { state.importSettings[table.id] = input.checked; persistDraft(); renderAll(); });
  label.append(input, document.createTextNode(table.label)); return label;
}
function renderTableChoices() {
  const filter = document.getElementById("quickImportSearch").value.trim().toLowerCase();
  const filtered = IMPORT_JOB_TYPES.filter((table) => table.label.toLowerCase().includes(filter));
  document.getElementById("quickImportTables").replaceChildren(...filtered.map((table) => tableChoice(table, "quick")));
  document.getElementById("flowImportTables").replaceChildren(...IMPORT_JOB_TYPES.map((table) => tableChoice(table, "flow")));
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
  document.getElementById("quickExportPayloads").replaceChildren(...EXPORT_PAYLOAD_OPTIONS.filter((name) => name.toLowerCase().includes(filter)).map((name) => payloadChoice(name, "quick")));
  document.getElementById("flowExportPayloads").replaceChildren(...EXPORT_PAYLOAD_OPTIONS.map((name) => payloadChoice(name, "flow")));
  document.getElementById("quickExportValue").textContent = state.exportPayloadName;
}
function selectedFlowSteps() { return DEFAULT_FLOW.filter((step) => document.getElementById(`flow-${step}`).checked); }
function flowHasBothJobs() { const steps = selectedFlowSteps(); return steps.includes("export") && steps.includes("import"); }
function renderFlow() {
  const steps = selectedFlowSteps(); const hasJobs = steps.includes("export") || steps.includes("import"); const bothJobs = flowHasBothJobs();
  document.getElementById("flowExportConfig").hidden = !steps.includes("export");
  document.getElementById("flowImportConfig").hidden = !steps.includes("import");
  const publish = document.getElementById("flow-publish"); const verify = document.getElementById("flow-verify");
  publish.disabled = !hasJobs; if (!hasJobs) publish.checked = false;
  verify.disabled = !hasJobs || !publish.checked; if (verify.disabled) verify.checked = false;
  const preview = steps.map((step) => {
    if (step === "export") return `Export (${state.exportPayloadName}${bothJobs ? ", next hour" : `, ${scheduleLabel(state.schedules.flowExportSchedule)}`})`;
    if (step === "import") return `Import (${selectedTableIds().length || 0} tables${bothJobs ? ", +1 hour" : `, ${scheduleLabel(state.schedules.flowImportSchedule)}`})`;
    return ({ source: "Source", destination: "Destination", publish: "Publish", verify: "Verify" })[step];
  });
  document.getElementById("flowPreview").textContent = preview.length ? preview.join("  →  ") : "Select at least one step.";
  document.getElementById("flowHint").textContent = bothJobs ? "Export is scheduled for the next hour; Import runs one exact hour later." : "Steps always run in dependency-safe order.";
  const run = document.getElementById("runCustomFlowBtn"); run.textContent = `▶ Run ${steps.length}-step flow`; run.disabled = !steps.length || (steps.includes("import") && !selectedTableIds().length);
}
function renderAll() { renderScheduleControls(); renderTableChoices(); renderPayloadChoices(); renderFlow(); document.getElementById("responsysScheduleLabel").textContent = scheduleLabel(state.schedules.responsysSchedule); }
async function persistDraft() { await chrome.storage.local.set({ flowDraft: { importSettings: state.importSettings, exportPayloadName: state.exportPayloadName, schedules: state.schedules, flowSteps: selectedFlowSteps() } }); }
function setStatus(status) { const running = /^Running:/.test(status || ""); statusEl.textContent = status || "No automation running"; statusDot.classList.toggle("idle", !running); stopButton.hidden = !running; }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error("No active tab found."); return tab.id; }
function closeAfterLaunch() { document.querySelectorAll("button").forEach((button) => { button.disabled = true; }); setTimeout(() => window.close(), 1200); }
async function send(message, startingLabel) { try { setStatus(`Running: ${startingLabel}`); const tabId = await activeTab(); chrome.runtime.sendMessage({ ...message, tabId }); closeAfterLaunch(); } catch (error) { setStatus(`Failed: ${error.message || error}`); } }

document.getElementById("runE2EBtn").addEventListener("click", () => send({ type: "run-full-sequence" }, "Default E2E Flow"));
document.getElementById("sourceBtn").addEventListener("click", () => send({ type: "run-task", filename: "source.js" }, "Create Source"));
document.getElementById("destinationBtn").addEventListener("click", () => send({ type: "run-task", filename: "destination.js" }, "Create Destination"));
document.getElementById("publishAllBtn").addEventListener("click", () => send({ type: "run-publish-all" }, "Publish All Data Feeds"));
document.getElementById("runResponsysBtn").addEventListener("click", () => send({ type: "run-task", filename: "importJob.js", schedule: scheduleObject(state.schedules.responsysSchedule) }, "Import Responsys Profile"));
document.getElementById("runQuickImportBtn").addEventListener("click", () => { const tableIds = selectedTableIds(); if (!tableIds.length) return setStatus("Select at least one import table."); send({ type: "run-import-job", tableIds, schedule: scheduleObject(state.schedules.quickImportSchedule) }, "Import Job"); });
document.getElementById("runQuickExportBtn").addEventListener("click", () => send({ type: "run-task", filename: "exportJob.js", schedule: scheduleObject(state.schedules.quickExportSchedule), exportPayloadName: state.exportPayloadName }, "Export Job"));
document.getElementById("runCustomFlowBtn").addEventListener("click", () => { const steps = selectedFlowSteps(); const bothJobs = flowHasBothJobs(); send({ type: "run-custom-flow", flow: { steps, importTableIds: selectedTableIds(), exportPayloadName: state.exportPayloadName, exportSchedule: scheduleObject(bothJobs ? "0" : state.schedules.flowExportSchedule), importSchedule: scheduleObject(bothJobs ? "1" : state.schedules.flowImportSchedule), staggerJobs: bothJobs } }, "Custom Flow"); });
document.getElementById("stopE2EBtn").addEventListener("click", async () => { try { const tabId = await activeTab(); await chrome.runtime.sendMessage({ type: "stop-current-flow", tabId }); setStatus(""); } catch (error) { setStatus(`Stop failed: ${error.message || error}`); } });
document.getElementById("quickImportSearch").addEventListener("input", renderTableChoices); document.getElementById("quickExportSearch").addEventListener("input", renderPayloadChoices);
document.getElementById("clearImportBtn").addEventListener("click", () => { state.importSettings = {}; persistDraft(); renderAll(); });
DEFAULT_FLOW.forEach((step) => document.getElementById(`flow-${step}`).addEventListener("change", () => { persistDraft(); renderAll(); }));
chrome.storage.local.get({ flowDraft: null, e2eStatus: "" }).then(({ flowDraft, e2eStatus }) => { if (flowDraft) { state.importSettings = flowDraft.importSettings || {}; state.exportPayloadName = EXPORT_PAYLOAD_OPTIONS.includes(flowDraft.exportPayloadName) ? flowDraft.exportPayloadName : "Customer"; state.schedules = { ...state.schedules, ...(flowDraft.schedules || {}) }; if (Array.isArray(flowDraft.flowSteps)) DEFAULT_FLOW.forEach((step) => { document.getElementById(`flow-${step}`).checked = flowDraft.flowSteps.includes(step); }); } setStatus(e2eStatus); renderAll(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.e2eStatus) setStatus(changes.e2eStatus.newValue || ""); });
