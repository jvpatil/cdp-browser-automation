let IMPORT_JOB_TYPES = [];
let EXPORT_PAYLOAD_OPTIONS = [];
let DATA_VIEWER_TABLES = [];
let DATA_VIEWER_RECORD_DEFAULTS = { tables: {} };
let dataViewerEditorDraft = null;
let catalogReady = false;
const QUICK_VISIBLE_LIMIT = 6;
const DEFAULT_FLOW = ["dataViewer", "source", "destination", "export", "import", "publish", "verify"];
const DEFAULT_SCHEDULER = { mode: "scheduled", frequency: "Daily", startTime: "immediate" };
const DATA_VIEWER_SAFE_ORDER = ["Customer", "Account", "Product", "Address", "ContactPoint"];
const DATA_VIEWER_PINNED_TABLES = ["Customer", "ContactPoint", "Account"];
const JOB_PICKER_PINNED_OPTIONS = ["Customer", "ContactPoint", "Account"];
const state = {
  // A Custom Flow includes Import by default. Keep Customer selected on a
  // first-use popup so its primary Run action is immediately actionable.
  // Users can still clear this selection or choose any catalog table.
  importSettings: { customer: true }, exportPayloadName: "Customer", dataViewerSettings: { Customer: true }, dataViewerOptions: { recordsPerTable: "", sourceId: "", dryRun: false }, dataViewerOverrides: {}, templateId: "", connectionPurpose: "", templates: [], schedulers: {
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
  const dataViewerTables = Array.isArray(catalog?.dataViewerTables) ? catalog.dataViewerTables : [];
  const validImports = imports.length && imports.every((table) => typeof table?.id === "string" && table.id && typeof table.label === "string" && table.label && typeof table.cdpTable === "string" && table.cdpTable && (table.csvFile === undefined || typeof table.csvFile === "string"));
  const uniqueIds = new Set(imports.map((table) => table.id)).size === imports.length;
  const validExports = exports.length && exports.every((payload) => typeof payload === "string" && payload);
  const validDataViewerTables = dataViewerTables.length && dataViewerTables.every((table) => typeof table === "string" && table);
  if (!validImports || !uniqueIds || !validExports || !validDataViewerTables) throw new Error("config/tables.json has an invalid table or payload entry.");
  IMPORT_JOB_TYPES = imports.map(({ id, label }) => ({ id, label }));
  EXPORT_PAYLOAD_OPTIONS = exports;
  DATA_VIEWER_TABLES = dataViewerTables.map((label) => ({ id: label, label }));
  catalogReady = true;
}
async function loadDataViewerRecordDefaults() {
  const response = await fetch(chrome.runtime.getURL("config/data-viewer-records.json"));
  if (!response.ok) throw new Error("Could not read config/data-viewer-records.json.");
  const config = await response.json();
  if (!config || typeof config !== "object" || !config.tables || typeof config.tables !== "object") throw new Error("config/data-viewer-records.json is invalid.");
  DATA_VIEWER_RECORD_DEFAULTS = config;
}

function selectedTables() { return IMPORT_JOB_TYPES.filter((table) => state.importSettings[table.id]); }
function selectedTableIds() { return selectedTables().map((table) => table.id); }
function selectedDataViewerTables() {
  const rank = (table) => {
    const index = DATA_VIEWER_SAFE_ORDER.indexOf(table.id);
    return index === -1 ? DATA_VIEWER_SAFE_ORDER.length : index;
  };
  return DATA_VIEWER_TABLES.filter((table) => state.dataViewerSettings[table.id])
    .sort((left, right) => rank(left) - rank(right));
}
function dataViewerSummary() { const tables = selectedDataViewerTables(); const count = Number.parseInt(state.dataViewerOptions.recordsPerTable, 10); const repeat = Number.isSafeInteger(count) && count > 1 ? ` ×${count}` : ""; return !tables.length ? "Select tables" : `${tables[0].label}${tables.length > 1 ? ` +${tables.length - 1}` : ""}${repeat}`; }
function dataViewerRunOptions() {
  const rawCount = state.dataViewerOptions.recordsPerTable.trim();
  if (rawCount && !/^[1-9]\d*$/.test(rawCount)) throw new Error("Records per table must be a positive whole number.");
  const recordsPerTable = rawCount ? Number(rawCount) : 1;
  if (!Number.isSafeInteger(recordsPerTable) || recordsPerTable < 1) throw new Error("Records per table must be a positive whole number.");
  return { recordsPerTable, sourceId: state.dataViewerOptions.sourceId.trim() || "UI", saveRecords: !state.dataViewerOptions.dryRun, dataViewerOverrides: state.dataViewerOverrides };
}
function importSummary() { const selected = selectedTables(); return !selected.length ? "Select tables" : `${selected[0].label}${selected.length > 1 ? ` +${selected.length - 1}` : ""}`; }
function selectedTableSummary() { const names = selectedTables().map((table) => table.label); return !names.length ? "No tables" : `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""}`; }
function scheduleSummary(config) { return config.mode === "onDemand" ? "On-demand" : `Scheduled / ${config.frequency} / ${config.startTime === "plusOneHour" ? "+1 Hour" : "Immediate"}`; }
function setLastRun(lastRun) { const text = lastRun?.summary || "No previous run"; lastRunEl.textContent = text; lastRunEl.title = lastRun?.details || text; lastRunEl.classList.toggle("empty", !lastRun); }
function quickVisibleOptions(options, selected, filter, pinnedLabels = []) {
  const ordered = [...options].sort((left, right) => left.label.localeCompare(right.label));
  const matches = ordered.filter((option) => option.label.toLowerCase().includes(filter));
  if (filter) return matches;
  const pinned = pinnedLabels.map((label) => ordered.find((option) => option.label === label)).filter(Boolean);
  const selectedRest = ordered.filter((option) => !pinned.includes(option) && selected(option));
  const remaining = ordered.filter((option) => !pinned.includes(option) && !selected(option));
  return [...pinned, ...selectedRest, ...remaining].slice(0, QUICK_VISIBLE_LIMIT);
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
  const text = document.createElement("span"); text.className = "choice-label"; text.textContent = table.label;
  label.append(input, text); return label;
}
function renderTableChoices() {
  const filter = document.getElementById("quickImportSearch").value.trim().toLowerCase();
  const tables = quickVisibleOptions(IMPORT_JOB_TYPES, (table) => Boolean(state.importSettings[table.id]), filter, JOB_PICKER_PINNED_OPTIONS);
  document.getElementById("quickImportTables").replaceChildren(...tables.map(tableChoice));
  renderOptionHint("quickImportHint", IMPORT_JOB_TYPES.length, tables, filter);
  const flowFilter = document.getElementById("flowImportSearch").value.trim().toLowerCase();
  const flowTables = quickVisibleOptions(IMPORT_JOB_TYPES, (table) => Boolean(state.importSettings[table.id]), flowFilter, JOB_PICKER_PINNED_OPTIONS);
  document.getElementById("flowImportTables").replaceChildren(...flowTables.map(tableChoice));
  renderOptionHint("flowImportHint", IMPORT_JOB_TYPES.length, flowTables, flowFilter);
  document.getElementById("quickImportCount").textContent = importSummary();
  document.getElementById("flowImportCount").textContent = importSummary();
}
function copyRecordTemplate(tableName) {
  const configured = state.dataViewerOverrides[tableName] || DATA_VIEWER_RECORD_DEFAULTS.tables?.[tableName] || {};
  return {
    tableName,
    values: Object.entries(configured.values || {}).map(([field, item]) => ({ field, value: typeof item === "object" ? item.value ?? "" : item })),
    relationships: Object.entries(configured.relationships || {}).map(([field, table]) => ({ field, table }))
  };
}
function editorRow(row, relationship = false) {
  const element = document.createElement("div"); element.className = `editor-row${relationship ? " relationship" : ""}`;
  const field = document.createElement("input"); field.placeholder = "Field ID"; field.value = row.field || ""; field.addEventListener("input", () => { row.field = field.value; });
  const value = document.createElement(relationship ? "input" : "textarea"); value.placeholder = relationship ? "Referenced table" : dataViewerEditorDraft?.tableName === "Address" ? "Value — one per line" : "Value — comma or one per line"; value.value = relationship ? row.table || "" : row.value || ""; value.title = relationship ? "Referenced table" : dataViewerEditorDraft?.tableName === "Address" ? "Use one line per record for Address values." : "Use commas or one line per record.";
  const resizeValue = () => { if (relationship) return; value.style.height = "30px"; value.style.height = `${Math.min(value.scrollHeight, 78)}px`; };
  value.addEventListener("input", () => { if (relationship) row.table = value.value; else { row.value = value.value; resizeValue(); } });
  element.append(field, value);
  resizeValue();
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = "Remove"; remove.addEventListener("click", () => { const list = relationship ? dataViewerEditorDraft.relationships : dataViewerEditorDraft.values; list.splice(list.indexOf(row), 1); renderDataViewerEditor(); }); element.append(remove);
  return element;
}
function renderDataViewerEditor() {
  if (!dataViewerEditorDraft) return;
  document.getElementById("dataViewerEditorTitle").textContent = `${dataViewerEditorDraft.tableName} values`;
  document.getElementById("dataViewerEditorValues").replaceChildren(...dataViewerEditorDraft.values.map((row) => editorRow(row)));
  document.getElementById("dataViewerEditorRelationships").replaceChildren(...dataViewerEditorDraft.relationships.map((row) => editorRow(row, true)));
}
function openDataViewerEditor(tableName) {
  dataViewerEditorDraft = copyRecordTemplate(tableName);
  document.getElementById("dataViewerMain").hidden = true;
  document.getElementById("dataViewerEditor").hidden = false;
  renderDataViewerEditor();
}
function closeDataViewerEditor() {
  dataViewerEditorDraft = null;
  document.getElementById("dataViewerEditor").hidden = true;
  document.getElementById("dataViewerMain").hidden = false;
}
function renderDataViewerChoices() {
  const filter = document.getElementById("dataViewerSearch").value.trim().toLowerCase();
  const tables = quickVisibleOptions(DATA_VIEWER_TABLES, (table) => Boolean(state.dataViewerSettings[table.id]), filter, DATA_VIEWER_PINNED_TABLES);
  const choice = (table) => {
    const label = document.createElement("label"); label.className = "choice";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = Boolean(state.dataViewerSettings[table.id]);
    input.addEventListener("change", () => { state.dataViewerSettings[table.id] = input.checked; persistDraft(); renderDataViewerChoices(); });
    const name = document.createElement("span"); name.className = "data-viewer-choice-name"; name.textContent = table.label;
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "data-viewer-edit"; edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5V20h3.5L18.4 9.1l-3.5-3.5L4 16.5Zm12.7-12.7 3.5 3.5 1.1-1.1a1.25 1.25 0 0 0 0-1.8l-1.7-1.7a1.25 1.25 0 0 0-1.8 0l-1.1 1.1Z"/></svg>'; edit.title = `Edit ${table.label} values`; edit.setAttribute("aria-label", `Edit ${table.label} record values`);
    edit.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openDataViewerEditor(table.id); });
    label.append(input, name, edit); return label;
  };
  document.getElementById("dataViewerTables").replaceChildren(...tables.map(choice));
  renderOptionHint("dataViewerHint", DATA_VIEWER_TABLES.length, tables, filter);
  const flowFilter = document.getElementById("flowDataViewerSearch").value.trim().toLowerCase();
  const flowTables = quickVisibleOptions(DATA_VIEWER_TABLES, (table) => Boolean(state.dataViewerSettings[table.id]), flowFilter, DATA_VIEWER_PINNED_TABLES);
  document.getElementById("flowDataViewerTables").replaceChildren(...flowTables.map(choice));
  renderOptionHint("flowDataViewerHint", DATA_VIEWER_TABLES.length, flowTables, flowFilter);
  document.getElementById("dataViewerValue").textContent = dataViewerSummary();
  document.getElementById("flowDataViewerValue").textContent = dataViewerSummary();
}
function payloadChoice(name, scope) {
  const label = document.createElement("label"); label.className = "choice";
  const input = document.createElement("input"); input.type = "radio"; input.name = `${scope}-payload`; input.checked = state.exportPayloadName === name;
  input.addEventListener("change", () => { state.exportPayloadName = name; persistDraft(); renderAll(); });
  const text = document.createElement("span"); text.className = "choice-label"; text.textContent = name;
  label.append(input, text); return label;
}
function renderPayloadChoices() {
  const filter = document.getElementById("quickExportSearch").value.trim().toLowerCase();
  const values = quickVisibleOptions(EXPORT_PAYLOAD_OPTIONS.map((label) => ({ label })), (payload) => state.exportPayloadName === payload.label, filter, JOB_PICKER_PINNED_OPTIONS);
  document.getElementById("quickExportPayloads").replaceChildren(...values.map((payload) => payloadChoice(payload.label, "quick")));
  renderOptionHint("quickExportHint", EXPORT_PAYLOAD_OPTIONS.length, values, filter);
  const flowFilter = document.getElementById("flowExportSearch").value.trim().toLowerCase();
  const flowValues = quickVisibleOptions(EXPORT_PAYLOAD_OPTIONS.map((label) => ({ label })), (payload) => state.exportPayloadName === payload.label, flowFilter, JOB_PICKER_PINNED_OPTIONS);
  document.getElementById("flowExportPayloads").replaceChildren(...flowValues.map((payload) => payloadChoice(payload.label, "flow")));
  renderOptionHint("flowExportHint", EXPORT_PAYLOAD_OPTIONS.length, flowValues, flowFilter);
  document.getElementById("quickExportValue").textContent = state.exportPayloadName;
  document.getElementById("flowExportValue").textContent = state.exportPayloadName;
}
function renderFlow() {
  const steps = selectedFlowSteps(); const hasJobs = steps.includes("export") || steps.includes("import");
  document.getElementById("flowDataViewerConfig").hidden = !steps.includes("dataViewer"); document.getElementById("flowExportConfig").hidden = !steps.includes("export"); document.getElementById("flowImportConfig").hidden = !steps.includes("import");
  const publish = document.getElementById("flow-publish"); const verify = document.getElementById("flow-verify"); publish.disabled = !hasJobs; if (!hasJobs) publish.checked = false; verify.disabled = !hasJobs || !publish.checked; if (verify.disabled) verify.checked = false;
  const both = flowHasBothJobs();
  const preview = steps.map((step) => {
    if (step === "export") return `Export (${state.exportPayloadName}${both ? ", next hour" : ""})`;
    if (step === "import") return `Import (${selectedTableSummary()}${both ? ", +1 hour" : ""})`;
    if (step === "dataViewer") return `Data Viewer (${dataViewerSummary()})`;
    return ({ source: "Source", destination: "Destination", publish: "Publish", verify: "Verify" })[step];
  });
  document.getElementById("flowPreview").textContent = preview.length ? preview.join("  →  ") : "Select at least one step.";
  document.getElementById("flowHint").textContent = both ? "Start times are locked: Export next hour, Import one hour later." : "Steps always run in dependency-safe order.";
  const run = document.getElementById("runCustomFlowBtn"); run.textContent = `▶ Run ${steps.length}-step flow`; run.disabled = !steps.length || (steps.includes("import") && !selectedTableIds().length);
}
function renderAll() { renderTableChoices(); renderPayloadChoices(); renderDataViewerChoices(); renderFlow(); renderSchedulers(); }
async function persistDraft() { await chrome.storage.local.set({ flowDraft: { importSettings: state.importSettings, exportPayloadName: state.exportPayloadName, dataViewerSettings: state.dataViewerSettings, dataViewerOptions: state.dataViewerOptions, dataViewerOverrides: state.dataViewerOverrides, connectionPurpose: state.connectionPurpose, schedulers: state.schedulers, flowSteps: selectedFlowSteps() } }); }
function setStatus(status) { const running = /^Running:/.test(status || ""); statusEl.textContent = status || "No automation running"; statusDot.classList.toggle("idle", !running); stopButton.hidden = !running; }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error("No active tab found."); return tab.id; }
function closeAfterLaunch() { document.querySelectorAll("button").forEach((button) => { button.disabled = true; }); setTimeout(() => window.close(), 1200); }
async function send(message, label, lastRun) { try { const customTransferStep = message.type === "run-custom-flow" && message.flow.steps.some((step) => ["source", "destination", "export", "import"].includes(step)); const needsTemplate = !["run-publish-all", "run-data-viewer", "run-custom-flow"].includes(message.type) || customTransferStep; if (needsTemplate && !state.templateId) throw new Error("Select or create a transfer template first."); const tabId = await activeTab(); const status = `Running: ${label}`; await chrome.storage.local.set({ ...(lastRun ? { lastRun } : {}), e2eStatus: status, ...(needsTemplate ? { lastTemplateId: state.templateId } : {}) }); if (lastRun) setLastRun(lastRun); setStatus(status); chrome.runtime.sendMessage({ ...message, tabId, ...(needsTemplate ? { templateId: state.templateId, connectionPurpose: state.connectionPurpose.trim() } : {}) }); closeAfterLaunch(); } catch (error) { setStatus(`Failed: ${error.message || error}`); } }

document.getElementById("runE2EBtn").addEventListener("click", () => send({ type: "run-full-sequence" }, "Sanity Flow", { summary: "Sanity Flow — Data Viewer → Source → Destination → Export → Import", details: "Sanity Flow — Data Viewer → Source → Destination → Export → Import → Publish → Verify" }));
document.getElementById("sourceBtn").addEventListener("click", () => send({ type: "run-task", filename: "source.js" }, "Create Source", { summary: "Create Source", details: "Create Source" }));
document.getElementById("destinationBtn").addEventListener("click", () => send({ type: "run-task", filename: "destination.js" }, "Create Destination", { summary: "Create Destination", details: "Create Destination" }));
document.getElementById("publishAllBtn").addEventListener("click", () => send({ type: "run-publish-all" }, "Publish All Data Feeds", { summary: "Publish All Data Feeds", details: "Publish All Data Feeds" }));
document.getElementById("runResponsysBtn").addEventListener("click", () => { const schedule = schedulerConfig("responsys"); send({ type: "run-task", filename: "importJob.js", schedule }, "Import Responsys Profile", { summary: `Responsys Import — ${scheduleSummary(schedule)}`, details: `Import Responsys Profile — ${scheduleSummary(schedule)}` }); });
document.getElementById("runQuickImportBtn").addEventListener("click", () => { if (!catalogReady) return setStatus("Table catalog is still loading."); const tableIds = selectedTableIds(); if (!tableIds.length) return setStatus("Select at least one import table."); const schedule = schedulerConfig("quickImport"); const tables = selectedTableSummary(); send({ type: "run-import-job", tableIds, schedule }, "Import Job", { summary: `Import — ${tables} — ${scheduleSummary(schedule)}`, details: `Import — ${selectedTables().map((table) => table.label).join(", ")} — ${scheduleSummary(schedule)}` }); });
document.getElementById("runQuickExportBtn").addEventListener("click", () => { if (!catalogReady) return setStatus("Table catalog is still loading."); const schedule = schedulerConfig("quickExport"); send({ type: "run-task", filename: "exportJob.js", schedule, exportPayloadName: state.exportPayloadName }, "Export Job", { summary: `Export — ${state.exportPayloadName} — ${scheduleSummary(schedule)}`, details: `Export — ${state.exportPayloadName} — ${scheduleSummary(schedule)}` }); });
document.getElementById("runDataViewerBtn").addEventListener("click", () => { try { if (!catalogReady) return setStatus("Table catalog is still loading."); const tables = selectedDataViewerTables(); if (!tables.length) return setStatus("Select at least one table."); const options = dataViewerRunOptions(); const mode = options.saveRecords ? "Save records" : "Dry run"; send({ type: "run-data-viewer", tableIds: tables.map((table) => table.id), ...options }, "Data Viewer Records", { summary: `Data Viewer — ${dataViewerSummary()}`, details: `Data Viewer ${mode.toLowerCase()}: ${tables.map((table) => table.label).join(", ")} · ${options.recordsPerTable} per table · Source ID: ${options.sourceId}` }); } catch (error) { setStatus(`Failed: ${error.message || error}`); } });
document.getElementById("runCustomFlowBtn").addEventListener("click", () => { try { const steps = selectedFlowSteps(); if (!catalogReady && (steps.includes("import") || steps.includes("export") || steps.includes("dataViewer"))) return setStatus("Table catalog is still loading."); const dataViewerTableIds = selectedDataViewerTables().map((table) => table.id); if (steps.includes("dataViewer") && !dataViewerTableIds.length) return setStatus("Select at least one Data Viewer table."); const staggerJobs = flowHasBothJobs(); const customDataViewer = { recordsPerTable: 1, sourceId: "UI", saveRecords: true, dataViewerOverrides: state.dataViewerOverrides }; send({ type: "run-custom-flow", flow: { steps, importTableIds: selectedTableIds(), exportPayloadName: state.exportPayloadName, exportSchedule: schedulerConfig("flowExport"), importSchedule: schedulerConfig("flowImport"), staggerJobs, dataViewerTableIds, ...customDataViewer } }, "Custom Flow", { summary: `Custom Flow — ${steps.length} steps`, details: `Custom Flow — ${steps.join(" → ")}` }); } catch (error) { setStatus(`Failed: ${error.message || error}`); } });
templateSelect.addEventListener("change", async () => { state.templateId = templateSelect.value; await chrome.storage.local.set({ lastTemplateId: state.templateId }); renderTemplates(); });
connectionPurposeInput.addEventListener("input", () => { state.connectionPurpose = connectionPurposeInput.value; chrome.storage.local.set({ lastConnectionPurpose: state.connectionPurpose }); persistDraft(); });
document.getElementById("manageTemplatesBtn").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("templates.html") });
    window.close();
  } catch (_) {
    chrome.runtime.openOptionsPage();
  }
});
document.getElementById("stopE2EBtn").addEventListener("click", async () => { try { await chrome.runtime.sendMessage({ type: "stop-current-flow", tabId: await activeTab() }); setStatus(""); } catch (error) { setStatus(`Stop failed: ${error.message || error}`); } });
document.getElementById("quickImportSearch").addEventListener("input", renderTableChoices); document.getElementById("quickExportSearch").addEventListener("input", renderPayloadChoices); document.getElementById("flowImportSearch").addEventListener("input", renderTableChoices); document.getElementById("flowExportSearch").addEventListener("input", renderPayloadChoices); document.getElementById("dataViewerSearch").addEventListener("input", renderDataViewerChoices); document.getElementById("flowDataViewerSearch").addEventListener("input", renderDataViewerChoices);
document.getElementById("dataViewerRecordsPerTable").addEventListener("input", (event) => { state.dataViewerOptions.recordsPerTable = event.target.value; persistDraft(); renderDataViewerChoices(); });
document.getElementById("dataViewerSourceId").addEventListener("input", (event) => { state.dataViewerOptions.sourceId = event.target.value; persistDraft(); });
document.getElementById("dataViewerDryRun").addEventListener("change", (event) => { state.dataViewerOptions.dryRun = event.target.checked; document.getElementById("runDataViewerBtn").textContent = event.target.checked ? "▶ Test Data Viewer Record" : "▶ Save Data Viewer Record"; persistDraft(); });
document.getElementById("dataViewerEditorBack").addEventListener("click", closeDataViewerEditor);
document.getElementById("dataViewerAddValue").addEventListener("click", () => { dataViewerEditorDraft?.values.push({ field: "", value: "" }); renderDataViewerEditor(); });
document.getElementById("dataViewerAddRelationship").addEventListener("click", () => { dataViewerEditorDraft?.relationships.push({ field: "", table: "" }); renderDataViewerEditor(); });
document.getElementById("dataViewerUseDefaults").addEventListener("click", () => { if (!dataViewerEditorDraft) return; delete state.dataViewerOverrides[dataViewerEditorDraft.tableName]; persistDraft(); closeDataViewerEditor(); });
document.getElementById("dataViewerApplyEditor").addEventListener("click", () => {
  if (!dataViewerEditorDraft) return;
  const values = Object.fromEntries(dataViewerEditorDraft.values.filter((row) => row.field.trim()).map((row) => [row.field.trim(), { value: row.value }]));
  const relationships = Object.fromEntries(dataViewerEditorDraft.relationships.filter((row) => row.field.trim() && row.table.trim()).map((row) => [row.field.trim(), row.table.trim()]));
  state.dataViewerOverrides[dataViewerEditorDraft.tableName] = { values, relationships };
  persistDraft(); closeDataViewerEditor();
});
document.getElementById("clearImportBtn").addEventListener("click", () => { state.importSettings = {}; persistDraft(); renderAll(); });
DEFAULT_FLOW.forEach((step) => document.getElementById(`flow-${step}`).addEventListener("change", () => { persistDraft(); renderAll(); }));
async function initialize() {
  try {
    await Promise.all([loadCatalog(), loadTemplates(), loadDataViewerRecordDefaults()]);
    const { flowDraft, e2eStatus, lastRun, lastConnectionPurpose } = await chrome.storage.local.get({ flowDraft: null, e2eStatus: "", lastRun: null, lastConnectionPurpose: "" });
    state.connectionPurpose = flowDraft?.connectionPurpose ?? lastConnectionPurpose;
    connectionPurposeInput.value = state.connectionPurpose;
    if (flowDraft) { state.importSettings = flowDraft.importSettings || {}; state.exportPayloadName = EXPORT_PAYLOAD_OPTIONS.includes(flowDraft.exportPayloadName) ? flowDraft.exportPayloadName : "Customer"; state.dataViewerSettings = flowDraft.dataViewerSettings || { Customer: true }; state.dataViewerOptions = { ...state.dataViewerOptions, ...(flowDraft.dataViewerOptions || {}) }; state.dataViewerOverrides = flowDraft.dataViewerOverrides || {}; if (state.dataViewerSettings.customer && !state.dataViewerSettings.Customer) { state.dataViewerSettings.Customer = true; delete state.dataViewerSettings.customer; } state.schedulers = { ...state.schedulers, ...(flowDraft.schedulers || {}) }; if (Array.isArray(flowDraft.flowSteps)) DEFAULT_FLOW.forEach((step) => { document.getElementById(`flow-${step}`).checked = flowDraft.flowSteps.includes(step); }); }
    // Drafts saved before the Custom Flow picker had a first-use selection
    // contain an empty import map. Migrate those drafts so the default flow
    // can be launched rather than presenting a permanently disabled button.
    if (document.getElementById("flow-import").checked && !selectedTableIds().length) state.importSettings = { customer: true };
    // The same first-use default applies to the independent Data Viewer step.
    // Older drafts did not contain its selection state, which made the Custom
    // Flow handler stop before it sent the automation message.
    if (document.getElementById("flow-dataViewer").checked && !selectedDataViewerTables().length) state.dataViewerSettings = { Customer: true };
    document.getElementById("dataViewerRecordsPerTable").value = state.dataViewerOptions.recordsPerTable;
    document.getElementById("dataViewerSourceId").value = state.dataViewerOptions.sourceId;
    document.getElementById("dataViewerDryRun").checked = state.dataViewerOptions.dryRun;
    document.getElementById("runDataViewerBtn").textContent = state.dataViewerOptions.dryRun ? "▶ Test Data Viewer Record" : "▶ Save Data Viewer Record";
    await chrome.storage.local.remove("popupAccordionState");
    setStatus(e2eStatus); setLastRun(lastRun); renderAll();
  } catch (error) {
    setStatus(`Catalog error: ${error.message || error}`);
  }
}
initialize();
chrome.storage.onChanged.addListener((changes, area) => { if (area !== "local") return; if (changes.e2eStatus) setStatus(changes.e2eStatus.newValue || ""); if (changes.lastRun) setLastRun(changes.lastRun.newValue || null); });
