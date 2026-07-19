let IMPORT_JOB_TYPES = [];
let EXPORT_PAYLOAD_OPTIONS = [];
let catalogReady = false;
const QUICK_VISIBLE_LIMIT = 6;
const DEFAULT_FLOW = ["source", "destination", "export", "import", "publish", "verify"];
const DEFAULT_SCHEDULER = { mode: "scheduled", frequency: "Daily", startTime: "immediate" };
const state = {
  importSettings: {}, exportPayloadName: "Customer", templateId: "", connectionPurpose: "", templates: [], schedulers: {
    responsys: { ...DEFAULT_SCHEDULER }, quickImport: { ...DEFAULT_SCHEDULER }, quickExport: { ...DEFAULT_SCHEDULER }, flowImport: { ...DEFAULT_SCHEDULER }, flowExport: { ...DEFAULT_SCHEDULER }
  }
};
const statusEl = document.getElementById("status");
const statusDot = document.getElementById("statusDot");
const stopButton = document.getElementById("stopE2EBtn");
const lastRunEl = document.getElementById("lastRun");
const templateSelect = document.getElementById("transferTemplate");
const connectionPurposeInput = document.getElementById("connectionPurpose");
const templateSummaryEl = document.getElementById("templateSummary");

function selectedTemplate() { return state.templates.find((template) => template.id === state.templateId); }
function renderTemplates() { const selected = selectedTemplate(); templateSelect.replaceChildren(new Option(state.templates.length ? "Select transfer template" : "Create a template", ""), ...state.templates.map((template) => new Option(template.name, template.id))); templateSelect.value = state.templateId; templateSummaryEl.textContent = selected ? `${selected.sourceType} → ${selected.destinationType} · ${selected.format} · ${selected.compression}` : "A Source and Destination template is required for connection and job runs."; }
async function loadTemplates() { const result = await chrome.runtime.sendMessage({ type: "template-list" }); state.templates = result.templates || []; const { lastTemplateId } = await chrome.storage.local.get({ lastTemplateId: "" }); state.templateId = state.templates.some((template) => template.id === lastTemplateId) ? lastTemplateId : state.templates[0]?.id || ""; renderTemplates(); }

async function loadCatalog() {
  const response = await fetch(chrome.runtime.getURL("config/tables.json"));
  if (!response.ok) throw new Error("Could not read config/tables.json.");
  const catalog = await response.json();
  const imports = Array.isArray(catalog?.importTables) ? catalog.importTables : [];
  const exports = Array.isArray(catalog?.exportPayloads) ? catalog.exportPayloads : [];
  const validImports = imports.length && imports.every((table) => typeof table?.id === "string" && table.id && typeof table.label === "string" && table.label && typeof table.cdpTable === "string" && table.cdpTable && typeof table.csvFile === "string" && table.csvFile);
  const uniqueIds = new Set(imports.map((table) => table.id)).size === imports.length;
  const validExports = exports.length && exports.every((payload) => typeof payload === "string" && payload);
  if (!validImports || !uniqueIds || !validExports) throw new Error("config/tables.json has an invalid table or payload entry.");
  IMPORT_JOB_TYPES = imports.map(({ id, label }) => ({ id, label }));
  EXPORT_PAYLOAD_OPTIONS = exports;
  catalogReady = true;
}

function selectedTables() { return IMPORT_JOB_TYPES.filter((table) => state.importSettings[table.id]); }
function selectedTableIds() { return selectedTables().map((table) => table.id); }
function importSummary() { const selected = selectedTables(); return !selected.length ? "Select tables" : `${selected[0].label}${selected.length > 1 ? ` +${selected.length - 1}` : ""}`; }
function selectedTableSummary() { const names = selectedTables().map((table) => table.label); return !names.length ? "No tables" : `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""}`; }
function scheduleSummary(config) { return config.mode === "onDemand" ? "On-demand" : `Scheduled / ${config.frequency} / ${config.startTime === "plusOneHour" ? "+1 Hour" : "Immediate"}`; }
function setLastRun(lastRun) { const text = lastRun?.summary || "No previous run"; lastRunEl.textContent = text; lastRunEl.title = lastRun?.details || text; lastRunEl.classList.toggle("empty", !lastRun); }
function quickVisibleOptions(options, selected, filter) {
  const matches = options.filter((option) => option.label.toLowerCase().includes(filter));
  if (filter) return matches;
  const pinned = options.filter((option) => selected(option));
  const remaining = options.filter((option) => !selected(option));
  return [...pinned, ...remaining].slice(0, QUICK_VISIBLE_LIMIT);
}
function renderOptionHint(id, total, visible, filter) {
  const hint = document.getElementById(id); const remaining = Math.max(0, total - visible.length);
  hint.hidden = Boolean(filter) || !remaining;
  hint.textContent = `${remaining} more available — search to find`;
}
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
  const tables = quickVisibleOptions(IMPORT_JOB_TYPES, (table) => Boolean(state.importSettings[table.id]), filter);
  document.getElementById("quickImportTables").replaceChildren(...tables.map(tableChoice));
  renderOptionHint("quickImportHint", IMPORT_JOB_TYPES.length, tables, filter);
  document.getElementById("flowImportTables").replaceChildren(...IMPORT_JOB_TYPES.map(tableChoice));
  document.getElementById("quickImportCount").textContent = importSummary();
}
function payloadChoice(name, scope) {
  const label = document.createElement("label"); label.className = "choice";
  const input = document.createElement("input"); input.type = "radio"; input.name = `${scope}-payload`; input.checked = state.exportPayloadName === name;
  input.addEventListener("change", () => { state.exportPayloadName = name; persistDraft(); renderAll(); });
  label.append(input, document.createTextNode(name)); return label;
}
function renderPayloadChoices() {
  const filter = document.getElementById("quickExportSearch").value.trim().toLowerCase();
  const values = quickVisibleOptions(EXPORT_PAYLOAD_OPTIONS.map((label) => ({ label })), (payload) => state.exportPayloadName === payload.label, filter);
  document.getElementById("quickExportPayloads").replaceChildren(...values.map((payload) => payloadChoice(payload.label, "quick")));
  renderOptionHint("quickExportHint", EXPORT_PAYLOAD_OPTIONS.length, values, filter);
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
async function persistDraft() { await chrome.storage.local.set({ flowDraft: { importSettings: state.importSettings, exportPayloadName: state.exportPayloadName, connectionPurpose: state.connectionPurpose, schedulers: state.schedulers, flowSteps: selectedFlowSteps() } }); }
function setStatus(status) { const running = /^Running:/.test(status || ""); statusEl.textContent = status || "No automation running"; statusDot.classList.toggle("idle", !running); stopButton.hidden = !running; }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error("No active tab found."); return tab.id; }
function closeAfterLaunch() { document.querySelectorAll("button").forEach((button) => { button.disabled = true; }); setTimeout(() => window.close(), 1200); }
async function send(message, label, lastRun) { try { const needsTemplate = !["run-publish-all"].includes(message.type); if (needsTemplate && !state.templateId) throw new Error("Select or create a transfer template first."); if (needsTemplate && !state.connectionPurpose.trim()) throw new Error("Enter a connection purpose, for example CWB."); const tabId = await activeTab(); const status = `Running: ${label}`; await chrome.storage.local.set({ ...(lastRun ? { lastRun } : {}), e2eStatus: status, ...(needsTemplate ? { lastTemplateId: state.templateId } : {}) }); if (lastRun) setLastRun(lastRun); setStatus(status); chrome.runtime.sendMessage({ ...message, tabId, ...(needsTemplate ? { templateId: state.templateId, connectionPurpose: state.connectionPurpose.trim() } : {}) }); closeAfterLaunch(); } catch (error) { setStatus(`Failed: ${error.message || error}`); } }

document.getElementById("runE2EBtn").addEventListener("click", () => send({ type: "run-full-sequence" }, "Sanity Flow", { summary: "Sanity Flow — Source → Destination → Export → Import", details: "Sanity Flow — Source → Destination → Export → Import → Publish → Verify" }));
document.getElementById("sourceBtn").addEventListener("click", () => send({ type: "run-task", filename: "source.js" }, "Create Source", { summary: "Create Source", details: "Create Source" }));
document.getElementById("destinationBtn").addEventListener("click", () => send({ type: "run-task", filename: "destination.js" }, "Create Destination", { summary: "Create Destination", details: "Create Destination" }));
document.getElementById("publishAllBtn").addEventListener("click", () => send({ type: "run-publish-all" }, "Publish All Data Feeds", { summary: "Publish All Data Feeds", details: "Publish All Data Feeds" }));
document.getElementById("runResponsysBtn").addEventListener("click", () => { const schedule = schedulerConfig("responsys"); send({ type: "run-task", filename: "importJob.js", schedule }, "Import Responsys Profile", { summary: `Responsys Import — ${scheduleSummary(schedule)}`, details: `Import Responsys Profile — ${scheduleSummary(schedule)}` }); });
document.getElementById("runQuickImportBtn").addEventListener("click", () => { if (!catalogReady) return setStatus("Table catalog is still loading."); const tableIds = selectedTableIds(); if (!tableIds.length) return setStatus("Select at least one import table."); const schedule = schedulerConfig("quickImport"); const tables = selectedTableSummary(); send({ type: "run-import-job", tableIds, schedule }, "Import Job", { summary: `Import — ${tables} — ${scheduleSummary(schedule)}`, details: `Import — ${selectedTables().map((table) => table.label).join(", ")} — ${scheduleSummary(schedule)}` }); });
document.getElementById("runQuickExportBtn").addEventListener("click", () => { if (!catalogReady) return setStatus("Table catalog is still loading."); const schedule = schedulerConfig("quickExport"); send({ type: "run-task", filename: "exportJob.js", schedule, exportPayloadName: state.exportPayloadName }, "Export Job", { summary: `Export — ${state.exportPayloadName} — ${scheduleSummary(schedule)}`, details: `Export — ${state.exportPayloadName} — ${scheduleSummary(schedule)}` }); });
document.getElementById("runCustomFlowBtn").addEventListener("click", () => { const steps = selectedFlowSteps(); if (!catalogReady && (steps.includes("import") || steps.includes("export"))) return setStatus("Table catalog is still loading."); const staggerJobs = flowHasBothJobs(); send({ type: "run-custom-flow", flow: { steps, importTableIds: selectedTableIds(), exportPayloadName: state.exportPayloadName, exportSchedule: schedulerConfig("flowExport"), importSchedule: schedulerConfig("flowImport"), staggerJobs } }, "Custom Flow", { summary: `Custom Flow — ${steps.length} steps`, details: `Custom Flow — ${steps.join(" → ")}` }); });
templateSelect.addEventListener("change", async () => { state.templateId = templateSelect.value; await chrome.storage.local.set({ lastTemplateId: state.templateId }); renderTemplates(); });
connectionPurposeInput.addEventListener("input", () => { state.connectionPurpose = connectionPurposeInput.value; persistDraft(); });
document.getElementById("manageTemplatesBtn").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("templates.html") });
    window.close();
  } catch (_) {
    chrome.runtime.openOptionsPage();
  }
});
document.getElementById("stopE2EBtn").addEventListener("click", async () => { try { await chrome.runtime.sendMessage({ type: "stop-current-flow", tabId: await activeTab() }); setStatus(""); } catch (error) { setStatus(`Stop failed: ${error.message || error}`); } });
document.getElementById("quickImportSearch").addEventListener("input", renderTableChoices); document.getElementById("quickExportSearch").addEventListener("input", renderPayloadChoices);
document.getElementById("clearImportBtn").addEventListener("click", () => { state.importSettings = {}; persistDraft(); renderAll(); });
DEFAULT_FLOW.forEach((step) => document.getElementById(`flow-${step}`).addEventListener("change", () => { persistDraft(); renderAll(); }));
async function initialize() {
  try {
    await Promise.all([loadCatalog(), loadTemplates()]);
    const { flowDraft, e2eStatus, lastRun } = await chrome.storage.local.get({ flowDraft: null, e2eStatus: "", lastRun: null });
    if (flowDraft) { state.importSettings = flowDraft.importSettings || {}; state.exportPayloadName = EXPORT_PAYLOAD_OPTIONS.includes(flowDraft.exportPayloadName) ? flowDraft.exportPayloadName : "Customer"; state.connectionPurpose = flowDraft.connectionPurpose || ""; connectionPurposeInput.value = state.connectionPurpose; state.schedulers = { ...state.schedulers, ...(flowDraft.schedulers || {}) }; if (Array.isArray(flowDraft.flowSteps)) DEFAULT_FLOW.forEach((step) => { document.getElementById(`flow-${step}`).checked = flowDraft.flowSteps.includes(step); }); }
    await chrome.storage.local.remove("popupAccordionState");
    setStatus(e2eStatus); setLastRun(lastRun); renderAll();
  } catch (error) {
    setStatus(`Catalog error: ${error.message || error}`);
  }
}
initialize();
chrome.storage.onChanged.addListener((changes, area) => { if (area !== "local") return; if (changes.e2eStatus) setStatus(changes.e2eStatus.newValue || ""); if (changes.lastRun) setLastRun(changes.lastRun.newValue || null); });
