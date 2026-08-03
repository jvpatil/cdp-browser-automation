let IMPORT_JOB_TYPES = [];
let EXPORT_PAYLOAD_OPTIONS = [];
let DATA_VIEWER_TABLES = [];
let DATA_VIEWER_RECORD_DEFAULTS = { tables: {} };
let DATA_MODEL_COLUMN_DEFAULTS = { groups: {} };
let dataViewerEditorDraft = null;
let catalogReady = false;
let activeView = "run";
let attributeEditorForCreationGroup = "";
let dataModelConfigurationContext = "standalone";
// A Flow Configure action is an explicit choice to include that step.  Keep
// the pending step while its sheet is open and select it only on Save & Return.
let pendingFlowConfigurationStep = "";
const QUICK_VISIBLE_LIMIT = 6;
const DEFAULT_FLOW = ["dataModel", "dataModelAttributes", "dataViewer", "source", "destination", "export", "import", "publish", "verify"];
const LEGACY_SCHEDULER = { schedulerUi: "legacy", mode: "scheduled", frequency: "Daily", startTime: "immediate" };
function newSchedulerDefaults(kind = "import") {
  const isExport = /export/i.test(kind);
  return {
    schedulerUi: "new",
    mode: "scheduled",
    frequency: "Daily",
    timeMode: "specific",
    specificPreset: isExport ? "in15" : "in30",
    customTime: "",
    intervalHours: "1",
    intervalStartPreset: isExport ? "in15" : "in30",
    intervalStartTime: "",
    intervalEndTime: "23:59"
  };
}
function defaultScheduler(kind) { return newSchedulerDefaults(kind); }
const DATA_VIEWER_SAFE_ORDER = ["Customer", "Account", "Product", "Address", "ContactPoint"];
const DATA_VIEWER_PINNED_TABLES = ["Customer", "ContactPoint", "Account"];
const JOB_PICKER_PINNED_OPTIONS = ["Customer", "ContactPoint", "Account"];
const DATA_MODEL_GROUPS = ["Profile", "Behavioral", "Transactional", "Product", "Other"];
const state = {
  // A Custom Flow includes Import by default. Keep Customer selected on a
  // first-use popup so its primary Run action is immediately actionable.
  // Users can still clear this selection or choose any catalog table.
  importSettings: { customer: true }, exportPayloadName: "Customer", dataViewerSettings: { Customer: true, ContactPoint: true }, dataViewerOptions: { recordsPerTable: "", sourceId: "", parentSourceCustomerId: "", contactPointExplicitlyUnselected: false, dryRun: false }, dataViewerOverrides: {}, dataModelSettings: { Profile: true }, dataModelOptions: { dryRun: false }, dataModelAttributeEnabled: { Profile: true }, dataModelParents: { Profile: { kind: "Customer", objectName: "" } }, dataModelAttributeGroup: "Profile", dataModelAttributeObjectName: "", dataModelAttributeColumns: {}, templateId: "", connectionPurpose: "", templates: [], schedulers: {
    responsys: defaultScheduler("responsys"), quickImport: defaultScheduler("quickImport"), quickExport: defaultScheduler("quickExport"), flowImport: defaultScheduler("flowImport"), flowExport: defaultScheduler("flowExport")
  }
};
let jobPresets = [];
let flowPresets = [];

function cloneConfig(value) { return JSON.parse(JSON.stringify(value)); }
function jobPresetConfig(kind) {
  const common = { templateId: state.templateId };
  if (kind === "responsys") return { ...common, kind, schedule: cloneConfig(schedulerConfig("responsys")) };
  if (kind === "import") return { ...common, kind, tableIds: selectedTableIds(), schedule: cloneConfig(schedulerConfig("quickImport")) };
  return { ...common, kind: "export", payloadName: state.exportPayloadName, schedule: cloneConfig(schedulerConfig("quickExport")) };
}
function flowPresetConfig() {
  return {
    templateId: state.templateId,
    steps: selectedFlowSteps(),
    importTableIds: selectedTableIds(),
    exportPayloadName: state.exportPayloadName,
    exportSchedule: cloneConfig(schedulerConfig("flowExport")),
    importSchedule: cloneConfig(schedulerConfig("flowImport")),
    staggerJobs: flowHasBothJobs(),
    dataViewerTableIds: selectedDataViewerTables().map((table) => table.id),
    dataModelGroups: selectedDataModelGroups(),
    dataModelAttributeGroups: selectedDataModelAttributeGroups(),
    dataModelParents: cloneConfig(state.dataModelParents),
    dataModelAttributeGroup: state.dataModelAttributeGroup,
    dataModelAttributeObjectName: state.dataModelAttributeObjectName.trim(),
    dataModelColumnOverrides: cloneConfig(state.dataModelAttributeColumns),
    saveDataModelObjects: !state.dataModelOptions.dryRun
  };
}
function applyPresetConfig(config) {
  if (!config) return;
  if (state.templates.some((template) => template.id === config.templateId)) state.templateId = config.templateId;
  if (config.kind === "responsys") state.schedulers.responsys = normalizeScheduler("responsys", config.schedule);
  if (config.kind === "import") {
    state.importSettings = Object.fromEntries((config.tableIds || []).map((id) => [id, true]));
    state.schedulers.quickImport = normalizeScheduler("quickImport", config.schedule);
  }
  if (config.kind === "export") {
    if (EXPORT_PAYLOAD_OPTIONS.includes(config.payloadName)) state.exportPayloadName = config.payloadName;
    state.schedulers.quickExport = normalizeScheduler("quickExport", config.schedule);
  }
  if (!config.kind && Array.isArray(config.steps)) {
    DEFAULT_FLOW.forEach((step) => { document.getElementById(`flow-${step}`).checked = config.steps.includes(step); });
    state.importSettings = Object.fromEntries((config.importTableIds || []).map((id) => [id, true]));
    if (EXPORT_PAYLOAD_OPTIONS.includes(config.exportPayloadName)) state.exportPayloadName = config.exportPayloadName;
    state.schedulers.flowExport = normalizeScheduler("flowExport", config.exportSchedule);
    state.schedulers.flowImport = normalizeScheduler("flowImport", config.importSchedule);
    state.dataViewerSettings = Object.fromEntries((config.dataViewerTableIds || []).map((id) => [id, true]));
    state.dataModelSettings = Object.fromEntries((config.dataModelGroups || []).map((group) => [group, true]));
    state.dataModelAttributeEnabled = Object.fromEntries((config.dataModelAttributeGroups || []).map((group) => [group, true]));
    state.dataModelParents = config.dataModelParents || state.dataModelParents;
    state.dataModelAttributeGroup = DATA_MODEL_GROUPS.includes(config.dataModelAttributeGroup) ? config.dataModelAttributeGroup : state.dataModelAttributeGroup;
    state.dataModelAttributeObjectName = config.dataModelAttributeObjectName || "";
    state.dataModelAttributeColumns = config.dataModelColumnOverrides || {};
  }
  renderTemplates(); renderAll(); persistDraft();
}
async function persistPresets() { await chrome.storage.local.set({ jobPresets, flowPresets }); }
async function loadPresets() {
  const stored = await chrome.storage.local.get({ jobPresets: [], flowPresets: [] });
  const withoutPurpose = (preset) => {
    if (!preset?.config) return preset;
    const { purpose: _purpose, ...config } = preset.config;
    return { ...preset, config };
  };
  jobPresets = Array.isArray(stored.jobPresets) ? stored.jobPresets.map(withoutPurpose) : [];
  flowPresets = Array.isArray(stored.flowPresets) ? stored.flowPresets.map(withoutPurpose) : [];
  // Migrate existing presets once so an older saved Purpose cannot overwrite
  // the run-specific value when a preset is loaded later.
  if (JSON.stringify(jobPresets) !== JSON.stringify(stored.jobPresets) || JSON.stringify(flowPresets) !== JSON.stringify(stored.flowPresets)) {
    await persistPresets();
  }
}
function renderPresetRows() {
  document.querySelectorAll("[data-preset-row]").forEach((row) => {
    const kind = row.dataset.presetRow;
    const list = kind === "flow" ? flowPresets : jobPresets.filter((preset) => preset?.config?.kind === kind);
    const select = document.createElement("select");
    select.append(new Option("Load preset…", ""), ...list.map((preset) => new Option(preset.name, preset.id)));
    const name = document.createElement("input"); name.type = "text"; name.placeholder = "Preset name";
    const save = document.createElement("button"); save.type = "button"; save.textContent = "Save";
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Delete";
    select.addEventListener("change", () => {
      const preset = list.find((item) => item.id === select.value);
      if (preset) applyPresetConfig(preset.config);
    });
    save.addEventListener("click", async () => {
      const presetName = name.value.trim();
      if (!presetName) return setStatus("Enter a preset name before saving.");
      const config = kind === "flow" ? flowPresetConfig() : jobPresetConfig(kind);
      const collection = kind === "flow" ? flowPresets : jobPresets;
      const existing = collection.find((item) => item.name.toLowerCase() === presetName.toLowerCase() && (kind === "flow" || item?.config?.kind === kind));
      const preset = { id: existing?.id || crypto.randomUUID(), name: presetName, savedAt: Date.now(), config };
      if (existing) Object.assign(existing, preset); else collection.unshift(preset);
      if (kind === "flow") flowPresets = collection.slice(0, 20); else jobPresets = collection.slice(0, 40);
      await persistPresets(); renderPresetRows(); setStatus(`Saved preset: ${presetName}`);
    });
    remove.addEventListener("click", async () => {
      if (!select.value) return setStatus("Choose a preset to delete.");
      if (kind === "flow") flowPresets = flowPresets.filter((item) => item.id !== select.value);
      else jobPresets = jobPresets.filter((item) => item.id !== select.value);
      await persistPresets(); renderPresetRows();
    });
    row.replaceChildren(select, name, save, remove);
  });
}
const statusEl = document.getElementById("status");
const statusDot = document.getElementById("statusDot");
const stopButton = document.getElementById("stopE2EBtn");
const runHistoryEl = document.getElementById("runHistory");
const activityLogsEl = document.getElementById("activityLogs");
let activitySection = "runs";
let selectedLogRun = null;
let activeLogRun = null;
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
async function loadDataModelColumnDefaults() {
  const response = await fetch(chrome.runtime.getURL("config/data-model-columns.json"));
  if (!response.ok) throw new Error("Could not read config/data-model-columns.json.");
  const config = await response.json();
  if (!config || typeof config !== "object" || !config.groups || typeof config.groups !== "object") throw new Error("config/data-model-columns.json is invalid.");
  for (const group of DATA_MODEL_GROUPS) {
    if (!Array.isArray(config.groups[group])) throw new Error(`No default columns are configured for ${group}.`);
  }
  DATA_MODEL_COLUMN_DEFAULTS = config;
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
function selectedDataModelGroups() { return DATA_MODEL_GROUPS.filter((group) => state.dataModelSettings[group]); }
function selectedDataModelAttributeGroups() { return selectedDataModelGroups().filter((group) => state.dataModelAttributeEnabled[group]); }
function dataModelParentFor(group) { return state.dataModelParents[group] || { kind: "None", objectName: "" }; }
function dataModelParentName(group) { const parent = dataModelParentFor(group); return parent.kind === "Other" ? parent.objectName.trim() : parent.kind === "None" ? "" : parent.kind; }
function dataModelParentsForRun(groups = selectedDataModelGroups()) {
  const parents = {};
  for (const group of groups) {
    const parent = dataModelParentFor(group);
    const parentName = dataModelParentName(group);
    if (parent.kind === "Other" && !parentName) throw new Error(`${group}: enter the parent object name.`);
    if (parentName) parents[group] = parentName;
  }
  return parents;
}
function dataModelSummary() { const groups = selectedDataModelGroups(); const relationshipCount = groups.filter((group) => dataModelParentName(group)).length; return !groups.length ? "Select types" : `${groups[0]}${groups.length > 1 ? ` +${groups.length - 1}` : ""}${relationshipCount ? ` · ${relationshipCount} parent` : ""}${state.dataModelOptions.dryRun ? " · Dry run" : ""}`; }
function dataModelDefaultColumns(group) { return Array.isArray(DATA_MODEL_COLUMN_DEFAULTS.groups?.[group]) ? DATA_MODEL_COLUMN_DEFAULTS.groups[group] : []; }
function cloneDataModelColumns(columns) { return columns.map((column) => ({ name: String(column?.name || ""), dataType: String(column?.dataType || "string").toLowerCase() })); }
function dataModelEditableColumns(group) { return Array.isArray(state.dataModelAttributeColumns[group]) ? state.dataModelAttributeColumns[group] : cloneDataModelColumns(dataModelDefaultColumns(group)); }
function dataModelColumnCount(group) { return dataModelEditableColumns(group).length; }
function validateDataModelColumnsForRun(columns, group) {
  const allowed = new Set(["string", "int", "bigint", "decimal", "date", "timestamp", "boolean"]);
  const names = new Set();
  const result = columns.map((column, index) => ({ name: String(column?.name || "").trim(), dataType: String(column?.dataType || "string").trim().toLowerCase(), index }));
  if (!result.length) throw new Error(`${group}: add at least one attribute.`);
  for (const column of result) {
    if (!column.name) throw new Error(`${group}: enter a name for attribute ${column.index + 1}.`);
    const key = column.name.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (names.has(key)) throw new Error(`${group}: ${column.name} is duplicated.`);
    if (!allowed.has(column.dataType)) throw new Error(`${group}: ${column.name} uses unsupported type ${column.dataType}.`);
    names.add(key);
  }
  return result.map(({ name, dataType }) => ({ name, dataType }));
}
function dataModelColumnOverridesForRun(groups = selectedDataModelGroups()) {
  const result = {};
  for (const group of [...new Set(groups)]) {
    result[group] = validateDataModelColumnsForRun(dataModelEditableColumns(group), group);
  }
  return result;
}
function dataModelAttributeSummary() { return state.dataModelAttributeObjectName.trim() ? `${state.dataModelAttributeGroup} · ${state.dataModelAttributeObjectName.trim()}` : "Select type and object"; }
function dataViewerRunOptions() {
  const rawCount = state.dataViewerOptions.recordsPerTable.trim();
  if (rawCount && !/^[1-9]\d*$/.test(rawCount)) throw new Error("Records per table must be a positive whole number.");
  const recordsPerTable = rawCount ? Number(rawCount) : 1;
  if (!Number.isSafeInteger(recordsPerTable) || recordsPerTable < 1) throw new Error("Records per table must be a positive whole number.");
  return { recordsPerTable, sourceId: state.dataViewerOptions.sourceId.trim() || "UI", parentSourceCustomerId: state.dataViewerOptions.parentSourceCustomerId.trim(), saveRecords: !state.dataViewerOptions.dryRun, dataViewerOverrides: state.dataViewerOverrides };
}
function importSummary() { const selected = selectedTables(); return !selected.length ? "Select tables" : `${selected[0].label}${selected.length > 1 ? ` +${selected.length - 1}` : ""}`; }
function selectedTableSummary() { const names = selectedTables().map((table) => table.label); return !names.length ? "No tables" : `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""}`; }
function scheduleSummary(config) {
  if (config.schedulerUi === "new") {
    if (config.mode === "onDemand") return "New / On-demand";
    const timing = config.timeMode === "interval" ? `Interval / ${config.intervalHours || 1}h` : `Specific / ${specificPresetLabel(config.specificPreset)}`;
    return `New / ${config.frequency} / ${timing}`;
  }
  return config.mode === "onDemand" ? "Legacy / On-demand" : `Legacy / ${config.frequency} / ${config.startTime === "plusOneHour" ? "+1 Hour" : "Immediate"}`;
}
function snapshotSummary(snapshot) {
  if (!snapshot) return "";
  const jobs = (snapshot.jobs || []).map((job) => {
    const selection = job.kind === "export" ? job.payloadName : (job.tableIds || []).join(", ");
    return [job.name, selection, job.scheduler ? scheduleSummary(job.scheduler) : ""].filter(Boolean).join(" · ");
  });
  const template = snapshot.template?.name || snapshot.templateId || "";
  const connections = Object.entries(snapshot.connections || {}).map(([kind, name]) => `${kind}: ${name}`);
  return [snapshot.origin, template ? `Template: ${template}` : "", snapshot.purpose ? `Purpose: ${snapshot.purpose}` : "", ...connections, ...jobs].filter(Boolean).join(" · ");
}
function renderRunHistory(history = []) {
  const entries = Array.isArray(history) ? history.slice(0, 5) : [];
  if (!entries.length) { runHistoryEl.textContent = "No completed runs yet."; renderActivityLogs(); return; }
  runHistoryEl.replaceChildren(...entries.map((entry) => {
    const audit = snapshotSummary(entry.snapshot);
    const item = document.createElement("div"); item.className = "history-item"; item.title = [entry.details || entry.detail || entry.summary || "", audit].filter(Boolean).join("\n");
    const top = document.createElement("div"); top.className = "history-top";
    const summary = document.createElement("span"); summary.textContent = entry.summary || "Automation run";
    const outcomeValue = entry.outcome || "completed";
    const outcome = document.createElement("span"); outcome.className = `outcome ${outcomeValue}`; outcome.textContent = outcomeValue.charAt(0).toUpperCase() + outcomeValue.slice(1);
    const detail = document.createElement("div"); detail.className = "detail"; detail.textContent = `${new Date(entry.finishedAt || entry.startedAt || Date.now()).toLocaleString()} · ${entry.detail || entry.details || ""}${audit ? ` · ${audit}` : ""}`;
    const logButton = document.createElement("button"); logButton.type = "button"; logButton.className = "history-log-toggle"; logButton.textContent = "View log";
    logButton.addEventListener("click", () => { selectedLogRun = entry; showActivitySection("logs"); });
    top.append(summary, outcome); item.append(top, detail, logButton); return item;
  }));
  renderActivityLogs();
}
function renderActivityLogs() {
  const logRun = selectedLogRun || activeLogRun;
  if (!logRun) { activityLogsEl.textContent = "Choose View log from a recent run."; return; }
  const logs = Array.isArray(logRun.logs) ? logRun.logs : [];
  const title = document.createElement("div"); title.className = "log-run-title"; title.textContent = `${logRun === activeLogRun ? "Active — " : ""}${logRun.summary || "Automation run"}`;
  if (!logs.length) { const empty = document.createElement("div"); empty.textContent = logRun === activeLogRun ? "Waiting for the first run event." : "No detailed log was captured for this earlier run."; activityLogsEl.replaceChildren(title, empty); return; }
  const output = document.createElement("div"); output.className = "activity-log-output";
  const createLogLine = (event) => {
    const level = /error|failed/i.test(event.level || "") ? "error" : /warn|stopped/i.test(event.level || "") ? "warn" : "info";
    const timestamp = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .format(new Date(event.at || logRun.startedAt || Date.now()));
    const line = document.createElement("div"); line.className = `activity-log-line ${level}`;
    const time = document.createElement("time"); time.textContent = timestamp;
    const severity = document.createElement("span"); severity.className = "activity-log-level"; severity.textContent = level === "warn" ? "WARN" : level === "error" ? "ERROR" : "INFO";
    const detail = document.createElement("span"); detail.className = "activity-log-detail"; detail.textContent = event.action ? `${event.action} — ${event.message}` : event.message;
    line.append(time, severity, detail); return line;
  };
  const ungrouped = logs.filter((event) => !event.group);
  ungrouped.forEach((event) => output.append(createLogLine(event)));
  const tableGroups = new Map();
  logs.filter((event) => event.group).forEach((event) => {
    const [table = "Details", record = "Details"] = String(event.group).split(" · ");
    const records = tableGroups.get(table) || new Map();
    const eventsForRecord = records.get(record) || [];
    eventsForRecord.push(event); records.set(record, eventsForRecord); tableGroups.set(table, records);
  });
  tableGroups.forEach((records, table) => {
    const tableDetails = document.createElement("details"); tableDetails.className = "activity-log-group";
    const tableSummary = document.createElement("summary"); tableSummary.textContent = table;
    const tableBody = document.createElement("div"); tableBody.className = "activity-log-group-body";
    records.forEach((events, record) => {
      const recordDetails = document.createElement("details"); recordDetails.className = "activity-log-record";
      const recordSummary = document.createElement("summary"); recordSummary.textContent = record;
      const recordBody = document.createElement("div"); recordBody.className = "activity-log-record-body";
      events.forEach((event) => recordBody.append(createLogLine(event)));
      recordDetails.append(recordSummary, recordBody); tableBody.append(recordDetails);
    });
    tableDetails.append(tableSummary, tableBody); output.append(tableDetails);
  });
  activityLogsEl.replaceChildren(title, output);
}
function showActivitySection(section) {
  activitySection = section;
  document.getElementById("activityRunsPanel").hidden = section !== "runs";
  document.getElementById("activityLogsPanel").hidden = section !== "logs";
  document.querySelectorAll("[data-activity-section]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.activitySection === section)));
  if (section === "logs") renderActivityLogs();
}
function showView(name, persist = true) {
  activeView = name;
  closeSheets(false);
  ["run", "flow", "activity"].forEach((view) => { document.getElementById(`view-${view}`).hidden = view !== name; document.querySelector(`[data-view="${view}"]`).setAttribute("aria-selected", String(view === name)); });
  if (persist) chrome.storage.local.set({ popupView: name });
}
function closeSheets(restoreView = true) { document.querySelectorAll(".sheet").forEach((sheet) => { sheet.hidden = true; }); if (restoreView) ["run", "flow", "activity"].forEach((view) => { document.getElementById(`view-${view}`).hidden = view !== activeView; }); }
function openSheet(name) { closeSheets(false); document.querySelectorAll(".view").forEach((view) => { view.hidden = true; }); document.getElementById(`sheet-${name}`).hidden = false; window.scrollTo(0, 0); }
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
function specificPresetLabel(value) {
  return ({ in15: "+15 min", in30: "+30 min", plusOneHour: "+1 hour", custom: "Custom" })[value] || "+15 min";
}
function schedulerSummary(config) { return scheduleSummary(config); }
function schedulerConfig(key) { return { ...state.schedulers[key] }; }
function schedulerKind(key) { return /export/i.test(key) ? "export" : "import"; }
function normalizeScheduler(key, saved) {
  // Saved drafts from the previous popup retain the legacy scheduler instead
  // of unexpectedly changing an established job's behavior.
  if (!saved || typeof saved !== "object") return defaultScheduler(schedulerKind(key));
  if (!saved.schedulerUi) return { ...LEGACY_SCHEDULER, ...saved };
  if (saved.schedulerUi === "new") {
    // Migrate the retired clock-boundary option to the clear +1 hour preset.
    const migrated = { ...saved };
    if (migrated.specificPreset === "nextHour") migrated.specificPreset = "plusOneHour";
    if (migrated.intervalStartPreset === "nextHour") migrated.intervalStartPreset = "plusOneHour";
    return { ...defaultScheduler(schedulerKind(key)), ...migrated, schedulerUi: "new" };
  }
  return { ...LEGACY_SCHEDULER, ...saved, schedulerUi: "legacy" };
}
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
    const key = container.dataset.scheduler; const config = state.schedulers[key]; const lockStart = key.startsWith("flow") && flowHasBothJobs() && config.schedulerUi === "legacy";
    container.replaceChildren();
    container.append(schedulerRow("Scheduler", [{ value: "new", label: "New" }, { value: "legacy", label: "Legacy" }], config.schedulerUi, (schedulerUi) => { state.schedulers[key] = schedulerUi === "new" ? defaultScheduler(schedulerKind(key)) : { ...LEGACY_SCHEDULER }; persistDraft(); renderAll(); }));
    if (config.schedulerUi === "legacy") {
      container.append(schedulerRow("Mode", [{ value: "onDemand", label: "On-demand" }, { value: "scheduled", label: "Scheduled" }], config.mode, (mode) => { config.mode = mode; persistDraft(); renderAll(); }));
      const advanced = document.createElement("div"); advanced.className = "scheduler-advanced"; advanced.hidden = config.mode !== "scheduled";
      advanced.append(
        schedulerRow("Frequency", ["Hourly", "Daily", "Weekly"].map((value) => ({ value, label: value })), config.frequency, (frequency) => { config.frequency = frequency; persistDraft(); renderAll(); }),
        schedulerRow("Start Time", [{ value: "immediate", label: "Immediate" }, { value: "plusOneHour", label: "+1 Hour" }], lockStart ? (key === "flowExport" ? "immediate" : "plusOneHour") : config.startTime, (startTime) => { config.startTime = startTime; persistDraft(); renderAll(); }, lockStart)
      );
      container.append(advanced);
      return;
    }
    if (schedulerKind(key) === "import") {
      container.append(schedulerRow("Run", [{ value: "onDemand", label: "On-demand" }, { value: "scheduled", label: "Recurring" }], config.mode || "scheduled", (mode) => { config.mode = mode; persistDraft(); renderAll(); }));
      if (config.mode === "onDemand") return;
    }
    const newSchedule = document.createElement("div"); newSchedule.className = "scheduler-advanced";
    const frequency = document.createElement("label"); frequency.className = "scheduler-select-row"; frequency.textContent = "Frequency";
    const select = document.createElement("select");
    [["Daily", "Daily"], ["Weekly, on selected Days", "Weekly"], ["Monthly, on selected Days", "Monthly (days)"], ["Monthly, on selected Dates", "Monthly (dates)"]].forEach(([value, label]) => select.append(new Option(label, value)));
    select.value = config.frequency; select.addEventListener("change", () => { config.frequency = select.value; persistDraft(); renderAll(); }); frequency.append(select); newSchedule.append(frequency);
    newSchedule.append(schedulerRow("Times", [{ value: "specific", label: "Specific" }, { value: "interval", label: "Interval" }], config.timeMode, (timeMode) => { config.timeMode = timeMode; persistDraft(); renderAll(); }));
    const presets = [{ value: "in15", label: "+15 min" }, { value: "in30", label: "+30 min" }, { value: "plusOneHour", label: "+1 hour" }, { value: "custom", label: "Custom" }];
    if (config.timeMode === "specific") {
      newSchedule.append(schedulerRow("Run time", presets, config.specificPreset, (specificPreset) => { config.specificPreset = specificPreset; persistDraft(); renderAll(); }));
      if (config.specificPreset === "custom") {
        const custom = document.createElement("label"); custom.className = "scheduler-select-row"; custom.textContent = "Time";
        const input = document.createElement("input"); input.type = "time"; input.value = config.customTime; input.addEventListener("input", () => { config.customTime = input.value; persistDraft(); }); custom.append(input); newSchedule.append(custom);
      }
    } else {
      const hours = document.createElement("label"); hours.className = "scheduler-select-row"; hours.textContent = "Every (hours)";
      const input = document.createElement("input"); input.type = "number"; input.min = "1"; input.max = "24"; input.step = "1"; input.value = config.intervalHours || "1"; input.addEventListener("input", () => { config.intervalHours = input.value; persistDraft(); }); hours.append(input); newSchedule.append(hours);
      newSchedule.append(schedulerRow("Start", presets, config.intervalStartPreset, (intervalStartPreset) => { config.intervalStartPreset = intervalStartPreset; persistDraft(); renderAll(); }));
      if (config.intervalStartPreset === "custom") {
        const start = document.createElement("label"); start.className = "scheduler-select-row"; start.textContent = "Start time";
        const startInput = document.createElement("input"); startInput.type = "time"; startInput.value = config.intervalStartTime; startInput.addEventListener("input", () => { config.intervalStartTime = startInput.value; persistDraft(); }); start.append(startInput); newSchedule.append(start);
      }
      const end = document.createElement("label"); end.className = "scheduler-select-row"; end.textContent = "End time";
      const endInput = document.createElement("input"); endInput.type = "time"; endInput.value = config.intervalEndTime || "23:59"; endInput.addEventListener("input", () => { config.intervalEndTime = endInput.value; persistDraft(); }); end.append(endInput); newSchedule.append(end);
    }
    container.append(newSchedule);
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
function saveDataViewerEditor() {
  if (!dataViewerEditorDraft) return;
  const values = Object.fromEntries(dataViewerEditorDraft.values.filter((row) => row.field.trim()).map((row) => [row.field.trim(), { value: row.value }]));
  const relationships = Object.fromEntries(dataViewerEditorDraft.relationships.filter((row) => row.field.trim() && row.table.trim()).map((row) => [row.field.trim(), row.table.trim()]));
  state.dataViewerOverrides[dataViewerEditorDraft.tableName] = { values, relationships };
  persistDraft();
  closeDataViewerEditor();
}
function renderDataViewerChoices() {
  const filter = document.getElementById("dataViewerSearch").value.trim().toLowerCase();
  const tables = quickVisibleOptions(DATA_VIEWER_TABLES, (table) => Boolean(state.dataViewerSettings[table.id]), filter, DATA_VIEWER_PINNED_TABLES);
  const choice = (table) => {
    const label = document.createElement("label"); label.className = "choice";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = Boolean(state.dataViewerSettings[table.id]);
    input.addEventListener("change", () => {
      state.dataViewerSettings[table.id] = input.checked;
      // A Customer record is normally consumed through its ContactPoint, so
      // select that companion table for a new Customer run. ContactPoint can
      // still be unchecked afterwards for a Customer-only run.
      if (table.id === "Customer" && input.checked) {
        state.dataViewerSettings.ContactPoint = true;
        state.dataViewerOptions.contactPointExplicitlyUnselected = false;
      }
      if (table.id === "ContactPoint" && !input.checked && state.dataViewerSettings.Customer) state.dataViewerOptions.contactPointExplicitlyUnselected = true;
      persistDraft(); renderDataViewerChoices();
    });
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
  const parentSourceCustomerLabel = document.getElementById("dataViewerParentCustomerLabel");
  parentSourceCustomerLabel.hidden = !(state.dataViewerSettings.ContactPoint && !state.dataViewerSettings.Customer);
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
function renderDataModelChoices() {
  const groups = DATA_MODEL_GROUPS.map((group) => {
    const label = document.createElement("label"); label.className = "choice data-model-choice";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = Boolean(state.dataModelSettings[group]);
    input.addEventListener("change", () => {
      state.dataModelSettings[group] = input.checked;
      // Selecting an object type starts with its shipped JSON attribute list.
      // The per-type badge lets the user edit or remove that list for this run.
      if (input.checked) state.dataModelAttributeEnabled[group] = true;
      persistDraft(); renderDataModelChoices(); renderFlow();
    });
    const name = document.createElement("span"); name.className = "choice-label"; name.textContent = group;
    const attributeBadge = document.createElement("button"); attributeBadge.type = "button"; attributeBadge.className = "data-model-attribute-badge";
    const configured = Boolean(state.dataModelAttributeEnabled[group]);
    attributeBadge.classList.toggle("configured", configured);
    attributeBadge.textContent = configured ? `+${dataModelColumnCount(group)}` : "+";
    attributeBadge.title = configured ? `Configure ${group} attributes` : `Add ${group} attributes`;
    attributeBadge.setAttribute("aria-label", attributeBadge.title);
    attributeBadge.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      state.dataModelSettings[group] = true;
      state.dataModelAttributeEnabled[group] = true;
      attributeEditorForCreationGroup = group;
      persistDraft(); openSheet("dataModelAttributes"); renderAll();
    });
    label.append(input, name, attributeBadge); return label;
  });
  document.getElementById("dataModelGroups").replaceChildren(...groups);
  const parentRows = selectedDataModelGroups().map((group) => {
    const row = document.createElement("div"); row.className = "data-model-parent-row";
    const label = document.createElement("strong"); label.textContent = `${group} parent`;
    const select = document.createElement("select"); select.setAttribute("aria-label", `${group} parent object`);
    ["None", "Customer", "Account", "Other"].forEach((kind) => select.add(new Option(kind, kind)));
    const parent = dataModelParentFor(group);
    select.value = ["None", "Customer", "Account", "Other"].includes(parent.kind) ? parent.kind : "None";
    select.addEventListener("change", () => {
      state.dataModelParents[group] = { kind: select.value, objectName: select.value === "Other" ? parent.objectName || "" : "" };
      persistDraft(); renderDataModelChoices(); renderFlow();
    });
    row.append(label, select);
    if (select.value === "Other") {
      const input = document.createElement("input"); input.type = "text"; input.maxLength = 50; input.placeholder = "Parent object name"; input.value = parent.objectName || "";
      input.setAttribute("aria-label", `${group} custom parent object name`);
      input.addEventListener("input", () => { state.dataModelParents[group] = { kind: "Other", objectName: input.value }; persistDraft(); renderFlow(); });
      row.append(input);
    }
    return row;
  });
  document.getElementById("dataModelParentRelationships").replaceChildren(...parentRows);
  const summary = dataModelSummary();
  document.getElementById("dataModelValue").textContent = summary;
  document.getElementById("flowDataModelValue").textContent = summary;
  document.getElementById("dataModelDryRun").checked = state.dataModelOptions.dryRun;
  const dataModelAction = document.getElementById("runDataModelBtn");
  if (dataModelConfigurationContext === "flow") dataModelAction.textContent = "Apply";
  else dataModelAction.textContent = state.dataModelOptions.dryRun ? "▶ Test Data Model Objects" : selectedDataModelAttributeGroups().length ? "▶ Save Objects & Attributes" : "▶ Save Data Model Objects";
}
function dataModelColumnEditor(group) {
  const columns = dataModelEditableColumns(group);
  const result = document.createDocumentFragment();
  const rows = columns.map((column, index) => {
    const row = document.createElement("div"); row.className = "data-model-column-row";
    const name = document.createElement("input"); name.type = "text"; name.placeholder = "Attribute name"; name.value = column.name || ""; name.setAttribute("aria-label", `${group} attribute name`);
    name.addEventListener("input", () => { columns[index].name = name.value; state.dataModelAttributeColumns[group] = columns; persistDraft(); });
    const type = document.createElement("select"); type.setAttribute("aria-label", `${group} attribute data type`);
    ["string", "int", "bigint", "decimal", "date", "timestamp", "boolean"].forEach((dataType) => type.add(new Option(dataType, dataType)));
    type.value = column.dataType || "string";
    type.addEventListener("change", () => { columns[index].dataType = type.value; state.dataModelAttributeColumns[group] = columns; persistDraft(); });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "data-model-column-remove"; remove.textContent = "×"; remove.title = "Remove attribute";
    remove.addEventListener("click", () => { columns.splice(index, 1); state.dataModelAttributeColumns[group] = columns; persistDraft(); renderDataModelAttributeChoices(); });
    row.append(name, type, remove); return row;
  });
  const add = document.createElement("button"); add.type = "button"; add.className = "link data-model-add-column"; add.textContent = "+ Add attribute";
  add.addEventListener("click", () => { state.dataModelAttributeColumns[group] = [...columns, { name: "", dataType: "string" }]; persistDraft(); renderDataModelAttributeChoices(); });
  const restore = document.createElement("button"); restore.type = "button"; restore.className = "link data-model-restore-columns"; restore.textContent = "Restore defaults";
  restore.addEventListener("click", () => { delete state.dataModelAttributeColumns[group]; persistDraft(); renderDataModelAttributeChoices(); });
  const load = document.createElement("button"); load.type = "button"; load.className = "link data-model-load-columns"; load.textContent = "Load JSON";
  const file = document.createElement("input"); file.type = "file"; file.accept = "application/json,.json"; file.hidden = true;
  load.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    try {
      const selected = file.files?.[0];
      if (!selected) return;
      const parsed = JSON.parse(await selected.text());
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("JSON must be an object of attribute-name: data-type pairs.");
      const uploaded = Object.entries(parsed).map(([name, dataType]) => ({ name, dataType: String(dataType || "").toLowerCase() }));
      state.dataModelAttributeColumns[group] = validateDataModelColumnsForRun(uploaded, group);
      await persistDraft(); renderDataModelAttributeChoices(); setStatus(`Loaded ${uploaded.length} ${group} attributes.`);
    } catch (error) { setStatus(`JSON error: ${error.message || error}`); } finally { file.value = ""; }
  });
  result.append(...rows, add, restore, load, file);
  return result;
}
function renderDataModelAttributeChoices() {
  const groupSelect = document.getElementById("dataModelAttributeGroup");
  const isCreationEditor = Boolean(attributeEditorForCreationGroup);
  const allowedGroups = isCreationEditor ? [attributeEditorForCreationGroup] : DATA_MODEL_GROUPS;
  const groups = allowedGroups.length ? allowedGroups : DATA_MODEL_GROUPS;
  if (!groups.includes(state.dataModelAttributeGroup)) state.dataModelAttributeGroup = groups[0];
  groupSelect.replaceChildren(...groups.map((group) => new Option(group, group)));
  groupSelect.value = state.dataModelAttributeGroup;
  groupSelect.parentElement.hidden = isCreationEditor;
  document.getElementById("dataModelAttributeObjectName").value = state.dataModelAttributeObjectName;
  document.getElementById("dataModelAttributeObjectTarget").hidden = isCreationEditor;
  document.getElementById("dataModelAttributeConfigNote").hidden = !isCreationEditor;
  document.getElementById("runDataModelAttributesBtn").hidden = isCreationEditor;
  document.getElementById("removeDataModelCreationAttributesBtn").hidden = !isCreationEditor;
  document.getElementById("applyDataModelCreationAttributesBtn").hidden = !isCreationEditor;
  document.getElementById("dataModelAttributeSheetTitle").textContent = isCreationEditor ? `${attributeEditorForCreationGroup} attributes` : "Add New Attributes";
  const panel = document.getElementById("dataModelAttributeColumns");
  panel.replaceChildren(dataModelColumnEditor(state.dataModelAttributeGroup));
  const summary = dataModelAttributeSummary();
  document.getElementById("dataModelAttributesValue").textContent = summary;
  document.getElementById("flowDataModelAttributesValue").textContent = summary;
}
function renderFlow() {
  const steps = selectedFlowSteps(); const hasJobs = steps.includes("export") || steps.includes("import");
  const publish = document.getElementById("flow-publish"); const verify = document.getElementById("flow-verify"); publish.disabled = !hasJobs; if (!hasJobs) publish.checked = false; verify.disabled = !hasJobs || !publish.checked; if (verify.disabled) verify.checked = false;
  const both = flowHasBothJobs();
  const legacyStagger = both && state.schedulers.flowExport.schedulerUi === "legacy" && state.schedulers.flowImport.schedulerUi === "legacy";
  const preview = steps.map((step) => {
    if (step === "export") return `Export (${state.exportPayloadName}, ${legacyStagger ? "next hour" : schedulerSummary(state.schedulers.flowExport)})`;
    if (step === "import") return `Import (${selectedTableSummary()}, ${legacyStagger ? "+1 hour" : schedulerSummary(state.schedulers.flowImport)})`;
    if (step === "dataModel") return `Data Model (${dataModelSummary()})`;
    if (step === "dataModelAttributes") return `Add New Attributes (${dataModelAttributeSummary()})`;
    if (step === "dataViewer") return `Data Viewer (${dataViewerSummary()})`;
    return ({ source: "Source", destination: "Destination", publish: "Publish", verify: "Verify" })[step];
  });
  document.getElementById("flowPreview").textContent = preview.length
    ? preview.map((step, index) => `${index + 1}. ${step}`).join("\n")
    : "Select at least one step.";
  document.getElementById("flowHint").textContent = legacyStagger ? "Legacy start times are locked: Export next hour, Import one hour later." : "Steps always run in dependency-safe order.";
  const run = document.getElementById("runCustomFlowBtn"); run.textContent = `▶ Run ${steps.length}-step flow`; run.disabled = !steps.length || (steps.includes("import") && !selectedTableIds().length) || (steps.includes("dataModel") && !selectedDataModelGroups().length);
}
function commitFlowConfiguration() {
  if (!pendingFlowConfigurationStep) return;
  const checkbox = document.getElementById(`flow-${pendingFlowConfigurationStep}`);
  if (checkbox && !checkbox.disabled) checkbox.checked = true;
  pendingFlowConfigurationStep = "";
  renderFlow();
}
function renderAll() { renderTableChoices(); renderPayloadChoices(); renderDataViewerChoices(); renderDataModelChoices(); renderDataModelAttributeChoices(); renderFlow(); renderSchedulers(); }
async function persistDraft() { await chrome.storage.local.set({ flowDraft: { importSettings: state.importSettings, exportPayloadName: state.exportPayloadName, dataViewerSettings: state.dataViewerSettings, dataViewerOptions: state.dataViewerOptions, dataViewerOverrides: state.dataViewerOverrides, dataModelSettings: state.dataModelSettings, dataModelOptions: state.dataModelOptions, dataModelAttributeEnabled: state.dataModelAttributeEnabled, dataModelParents: state.dataModelParents, dataModelAttributeGroup: state.dataModelAttributeGroup, dataModelAttributeObjectName: state.dataModelAttributeObjectName, dataModelAttributeColumns: state.dataModelAttributeColumns, connectionPurpose: state.connectionPurpose, schedulers: state.schedulers, flowSteps: selectedFlowSteps() } }); }
function setStatus(status) { const running = /^Running:/.test(status || ""); statusEl.textContent = status || "No automation running"; statusDot.classList.toggle("idle", !running); stopButton.hidden = !running; }
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error("No active tab found."); return tab.id; }
function closeAfterLaunch() {
  // The in-page status pill remains the progress/Stop control while the
  // automation runs, so release the browser workspace after a launch.
  window.setTimeout(() => window.close(), 1000);
}
async function send(message, label, runInfo) { try { const customTransferStep = message.type === "run-custom-flow" && message.flow.steps.some((step) => ["source", "destination", "export", "import"].includes(step)); const needsTemplate = !["run-publish-all", "run-data-viewer", "run-data-model", "run-data-model-attributes", "run-custom-flow"].includes(message.type) || customTransferStep; if (needsTemplate && !state.templateId) throw new Error("Select a transfer template first."); const tabId = await activeTab(); const status = `Running: ${label}`; const pendingRun = { ...(runInfo || { summary: label, details: label }), startedAt: Date.now(), logs: [{ at: Date.now(), level: "info", message: `Started: ${label}` }] }; await chrome.storage.local.set({ pendingRun, e2eStatus: status, ...(needsTemplate ? { lastTemplateId: state.templateId } : {}) }); setStatus(status); chrome.runtime.sendMessage({ ...message, tabId, connectionPurpose: state.connectionPurpose.trim(), ...(needsTemplate ? { templateId: state.templateId } : {}) }); closeAfterLaunch(); } catch (error) { setStatus(`Failed: ${error.message || error}`); } }

// Configuration sheets can be tall. Keep their return action at the end of
// the content so a user who has just configured a scheduler or table picker
// does not have to scroll back to the top merely to return.
function moveSheetBackActionsToBottom() {
  document.querySelectorAll(".sheet > .sheet-head > .back").forEach((back) => {
    const sheet = back.closest(".sheet");
    const body = [...sheet.children].find((child) => child.classList?.contains("sheet-body"));
    if (!body) return;
    back.classList.add("sheet-back-bottom");
    body.append(back);
  });
  const editor = document.getElementById("dataViewerEditor");
  const editorBack = document.getElementById("dataViewerEditorBack");
  if (editor && editorBack) {
    editorBack.classList.add("sheet-back-bottom");
    editor.append(editorBack);
  }
}
moveSheetBackActionsToBottom();

document.getElementById("runE2EBtn").addEventListener("click", () => send({ type: "run-full-sequence" }, "Sanity Flow", { summary: "Sanity Flow — Data Models → Data Viewer → Source → Destination → Export → Import", details: "Sanity Flow — Data Models → Data Viewer → Source → Destination → Export → Import → Publish → Verify" }));
document.getElementById("sourceBtn").addEventListener("click", () => send({ type: "run-task", filename: "source.js" }, "Create Source", { summary: "Create Source", details: "Create Source" }));
document.getElementById("destinationBtn").addEventListener("click", () => send({ type: "run-task", filename: "destination.js" }, "Create Destination", { summary: "Create Destination", details: "Create Destination" }));
document.getElementById("publishAllBtn").addEventListener("click", () => send({ type: "run-publish-all" }, "Publish All Data Feeds", { summary: "Publish All Data Feeds", details: "Publish All Data Feeds" }));
document.getElementById("runResponsysBtn").addEventListener("click", () => { const schedule = schedulerConfig("responsys"); send({ type: "run-task", filename: "importJob.js", schedule }, "Import Responsys Profile", { summary: `Responsys Import — ${scheduleSummary(schedule)}`, details: `Import Responsys Profile — ${scheduleSummary(schedule)}` }); });
document.getElementById("runQuickImportBtn").addEventListener("click", () => { if (!catalogReady) return setStatus("Table catalog is still loading."); const tableIds = selectedTableIds(); if (!tableIds.length) return setStatus("Select at least one import table."); const schedule = schedulerConfig("quickImport"); const tables = selectedTableSummary(); send({ type: "run-import-job", tableIds, schedule }, "Import Job", { summary: `Import — ${tables} — ${scheduleSummary(schedule)}`, details: `Import — ${selectedTables().map((table) => table.label).join(", ")} — ${scheduleSummary(schedule)}` }); });
document.getElementById("runQuickExportBtn").addEventListener("click", () => { if (!catalogReady) return setStatus("Table catalog is still loading."); const schedule = schedulerConfig("quickExport"); send({ type: "run-task", filename: "exportJob.js", schedule, exportPayloadName: state.exportPayloadName }, "Export Job", { summary: `Export — ${state.exportPayloadName} — ${scheduleSummary(schedule)}`, details: `Export — ${state.exportPayloadName} — ${scheduleSummary(schedule)}` }); });
document.getElementById("runDataViewerBtn").addEventListener("click", () => { try { if (!catalogReady) return setStatus("Table catalog is still loading."); const tables = selectedDataViewerTables(); if (!tables.length) return setStatus("Select at least one table."); const options = dataViewerRunOptions(); const mode = options.saveRecords ? "Save records" : "Dry run"; send({ type: "run-data-viewer", tableIds: tables.map((table) => table.id), ...options }, "Data Viewer Records", { summary: `Data Viewer — ${dataViewerSummary()}`, details: `Data Viewer ${mode.toLowerCase()}: ${tables.map((table) => table.label).join(", ")} · ${options.recordsPerTable} per table · Source ID: ${options.sourceId}` }); } catch (error) { setStatus(`Failed: ${error.message || error}`); } });
document.getElementById("runDataModelBtn").addEventListener("click", () => { try { const groups = selectedDataModelGroups(); if (!groups.length) return setStatus("Select at least one Data Model object group."); if (dataModelConfigurationContext === "flow") { commitFlowConfiguration(); persistDraft(); closeSheets(); showView("flow"); return; } const dryRun = state.dataModelOptions.dryRun; const attributeGroups = dryRun ? [] : selectedDataModelAttributeGroups(); const columnOverrides = attributeGroups.length ? dataModelColumnOverridesForRun(attributeGroups) : {}; const parentByGroup = dryRun ? {} : dataModelParentsForRun(groups); send({ type: "run-data-model", groups, saveObjects: !dryRun, attributeGroups, columnOverrides, parentByGroup }, dryRun ? "Data Model Dry Run" : "Create Data Model Objects", { summary: `Data Model — ${dataModelSummary()}${attributeGroups.length ? ` + ${attributeGroups.length} attribute set${attributeGroups.length === 1 ? "" : "s"}` : ""}`, details: `${dryRun ? "Dry run" : "Live create"}: ${groups.join(", ")}${attributeGroups.length ? ` · attributes: ${attributeGroups.join(", ")}` : ""}${Object.keys(parentByGroup).length ? ` · parents: ${Object.entries(parentByGroup).map(([group, parent]) => `${group} → ${parent}`).join(", ")}` : ""}` }); } catch (error) { setStatus(`Failed: ${error.message || error}`); } });
document.getElementById("runDataModelAttributesBtn").addEventListener("click", () => { try { const objectName = state.dataModelAttributeObjectName.trim(); if (!objectName) return setStatus("Enter the existing Data Model object name."); const group = state.dataModelAttributeGroup; const columnOverrides = dataModelColumnOverridesForRun([group]); send({ type: "run-data-model-attributes", group, objectName, columnOverrides }, "Add New Attributes", { summary: `Add New Attributes — ${group} · ${objectName}`, details: `Add ${dataModelColumnCount(group)} new attributes to ${objectName}` }); } catch (error) { setStatus(`Failed: ${error.message || error}`); } });
document.getElementById("runCustomFlowBtn").addEventListener("click", () => { try { const steps = selectedFlowSteps(); if (!catalogReady && (steps.includes("import") || steps.includes("export") || steps.includes("dataViewer"))) return setStatus("Table catalog is still loading."); const dataViewerTableIds = selectedDataViewerTables().map((table) => table.id); const dataModelGroups = selectedDataModelGroups(); if (steps.includes("dataViewer") && !dataViewerTableIds.length) return setStatus("Select at least one Data Viewer table."); if (steps.includes("dataModel") && !dataModelGroups.length) return setStatus("Select at least one Data Model object group."); const canUseCreatedDataModelObject = steps.includes("dataModel") && dataModelGroups.includes(state.dataModelAttributeGroup) && !state.dataModelOptions.dryRun; if (steps.includes("dataModelAttributes") && !state.dataModelAttributeObjectName.trim() && !canUseCreatedDataModelObject) return setStatus("Enter the Data Model object name, or create that same type in this live flow."); const staggerJobs = flowHasBothJobs(); const customDataViewer = { recordsPerTable: 1, sourceId: "UI", saveRecords: true, dataViewerOverrides: state.dataViewerOverrides }; const dataModelAttributeGroups = steps.includes("dataModel") && !state.dataModelOptions.dryRun ? selectedDataModelAttributeGroups() : []; const columnGroups = [...new Set([...(steps.includes("dataModelAttributes") ? [state.dataModelAttributeGroup] : []), ...dataModelAttributeGroups])]; const dataModelParents = steps.includes("dataModel") && !state.dataModelOptions.dryRun ? dataModelParentsForRun(dataModelGroups) : {}; send({ type: "run-custom-flow", flow: { steps, importTableIds: selectedTableIds(), exportPayloadName: state.exportPayloadName, exportSchedule: schedulerConfig("flowExport"), importSchedule: schedulerConfig("flowImport"), staggerJobs, dataViewerTableIds, dataModelGroups, dataModelAttributeGroups, dataModelParents, dataModelAttributeGroup: state.dataModelAttributeGroup, dataModelAttributeObjectName: state.dataModelAttributeObjectName.trim(), dataModelColumnOverrides: dataModelColumnOverridesForRun(columnGroups), saveDataModelObjects: !state.dataModelOptions.dryRun, ...customDataViewer } }, "Custom Flow", { summary: `Custom Flow — ${steps.length} steps`, details: `Custom Flow — ${steps.join(" → ")}` }); } catch (error) { setStatus(`Failed: ${error.message || error}`); } });
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
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { closeSheets(); showView(button.dataset.view); }));
document.querySelectorAll("[data-activity-section]").forEach((button) => button.addEventListener("click", () => showActivitySection(button.dataset.activitySection)));
document.querySelectorAll("[data-open-sheet]").forEach((button) => button.addEventListener("click", () => { attributeEditorForCreationGroup = ""; pendingFlowConfigurationStep = button.dataset.flowConfig || ""; if (button.dataset.openSheet === "dataModel") dataModelConfigurationContext = button.dataset.flowConfig === "dataModel" ? "flow" : "standalone"; if (button.dataset.openSheet === "dataModelAttributes") dataModelConfigurationContext = button.dataset.flowConfig ? "flow" : "standalone"; openSheet(button.dataset.openSheet); renderAll(); }));
document.querySelectorAll(".sheet-head .back").forEach((button) => { button.textContent = "Save & Return"; });
document.querySelectorAll("[data-close-sheet]").forEach((button) => button.addEventListener("click", async () => { commitFlowConfiguration(); await persistDraft(); closeSheets(); }));
document.getElementById("quickImportSearch").addEventListener("input", renderTableChoices); document.getElementById("quickExportSearch").addEventListener("input", renderPayloadChoices); document.getElementById("flowImportSearch").addEventListener("input", renderTableChoices); document.getElementById("flowExportSearch").addEventListener("input", renderPayloadChoices); document.getElementById("dataViewerSearch").addEventListener("input", renderDataViewerChoices); document.getElementById("flowDataViewerSearch").addEventListener("input", renderDataViewerChoices);
document.getElementById("dataViewerRecordsPerTable").addEventListener("input", (event) => { state.dataViewerOptions.recordsPerTable = event.target.value; persistDraft(); renderDataViewerChoices(); });
document.getElementById("dataViewerSourceId").addEventListener("input", (event) => { state.dataViewerOptions.sourceId = event.target.value; persistDraft(); });
document.getElementById("dataViewerParentCustomerId").addEventListener("input", (event) => { state.dataViewerOptions.parentSourceCustomerId = event.target.value; persistDraft(); });
document.getElementById("dataViewerDryRun").addEventListener("change", (event) => { state.dataViewerOptions.dryRun = event.target.checked; document.getElementById("runDataViewerBtn").textContent = event.target.checked ? "▶ Test Data Viewer Record" : "▶ Save Data Viewer Record"; persistDraft(); });
document.getElementById("dataModelDryRun").addEventListener("change", (event) => { state.dataModelOptions.dryRun = event.target.checked; persistDraft(); renderDataModelChoices(); renderFlow(); });
document.getElementById("removeDataModelCreationAttributesBtn").addEventListener("click", () => { if (!attributeEditorForCreationGroup) return; delete state.dataModelAttributeEnabled[attributeEditorForCreationGroup]; attributeEditorForCreationGroup = ""; persistDraft(); openSheet("dataModel"); renderAll(); });
document.getElementById("applyDataModelCreationAttributesBtn").addEventListener("click", async () => { if (!attributeEditorForCreationGroup) return; await persistDraft(); attributeEditorForCreationGroup = ""; openSheet("dataModel"); renderAll(); });
document.getElementById("dataModelAttributeBack").addEventListener("click", async () => { const returnToDataModel = Boolean(attributeEditorForCreationGroup); if (!returnToDataModel) commitFlowConfiguration(); await persistDraft(); attributeEditorForCreationGroup = ""; if (returnToDataModel) { openSheet("dataModel"); renderAll(); } else closeSheets(); });
document.getElementById("dataModelAttributeGroup").addEventListener("change", (event) => { state.dataModelAttributeGroup = event.target.value; chrome.storage.local.set({ lastDataModelAttributeGroup: state.dataModelAttributeGroup }); persistDraft(); renderDataModelAttributeChoices(); renderFlow(); });
document.getElementById("dataModelAttributeObjectName").addEventListener("input", (event) => { state.dataModelAttributeObjectName = event.target.value; chrome.storage.local.set({ lastDataModelAttributeObjectName: state.dataModelAttributeObjectName }); persistDraft(); renderDataModelAttributeChoices(); renderFlow(); });
document.getElementById("dataViewerEditorBack").addEventListener("click", saveDataViewerEditor);
document.getElementById("dataViewerAddValue").addEventListener("click", () => { dataViewerEditorDraft?.values.push({ field: "", value: "" }); renderDataViewerEditor(); });
document.getElementById("dataViewerAddRelationship").addEventListener("click", () => { dataViewerEditorDraft?.relationships.push({ field: "", table: "" }); renderDataViewerEditor(); });
document.getElementById("dataViewerUseDefaults").addEventListener("click", () => { if (!dataViewerEditorDraft) return; delete state.dataViewerOverrides[dataViewerEditorDraft.tableName]; persistDraft(); closeDataViewerEditor(); });
document.getElementById("dataViewerApplyEditor").addEventListener("click", saveDataViewerEditor);
function clearImportSelection() { state.importSettings = {}; persistDraft(); renderAll(); }
function clearDataViewerSelection() { state.dataViewerSettings = {}; state.dataViewerOptions.contactPointExplicitlyUnselected = false; persistDraft(); renderAll(); }
document.getElementById("clearImportBtn").addEventListener("click", clearImportSelection);
document.getElementById("flowImportClearBtn").addEventListener("click", clearImportSelection);
document.getElementById("dataViewerClearBtn").addEventListener("click", clearDataViewerSelection);
document.getElementById("flowDataViewerClearBtn").addEventListener("click", clearDataViewerSelection);
DEFAULT_FLOW.forEach((step) => document.getElementById(`flow-${step}`).addEventListener("change", () => { persistDraft(); renderAll(); }));
async function initialize() {
  try {
    await Promise.all([loadCatalog(), loadTemplates(), loadDataViewerRecordDefaults(), loadDataModelColumnDefaults(), loadPresets()]);
    const { flowDraft, e2eStatus, lastRun, runHistory, pendingRun, popupView, lastConnectionPurpose, lastDataModelAttributeGroup, lastDataModelAttributeObjectName } = await chrome.storage.local.get({ flowDraft: null, e2eStatus: "", lastRun: null, runHistory: [], pendingRun: null, popupView: "run", lastConnectionPurpose: "", lastDataModelAttributeGroup: "Profile", lastDataModelAttributeObjectName: "" });
    activeLogRun = pendingRun;
    state.connectionPurpose = flowDraft?.connectionPurpose ?? lastConnectionPurpose;
    connectionPurposeInput.value = state.connectionPurpose;
    if (flowDraft) { state.importSettings = flowDraft.importSettings || {}; state.exportPayloadName = EXPORT_PAYLOAD_OPTIONS.includes(flowDraft.exportPayloadName) ? flowDraft.exportPayloadName : "Customer"; state.dataViewerSettings = flowDraft.dataViewerSettings || { Customer: true, ContactPoint: true }; state.dataViewerOptions = { ...state.dataViewerOptions, ...(flowDraft.dataViewerOptions || {}) }; state.dataViewerOverrides = flowDraft.dataViewerOverrides || {}; state.dataModelSettings = flowDraft.dataModelSettings || {}; state.dataModelOptions = { ...state.dataModelOptions, ...(flowDraft.dataModelOptions || {}) }; state.dataModelAttributeEnabled = flowDraft.dataModelAttributeEnabled || {}; state.dataModelParents = flowDraft.dataModelParents || state.dataModelParents; if (!flowDraft.dataModelAttributeEnabled && flowDraft.dataModelOptions?.addAttributes) DATA_MODEL_GROUPS.forEach((group) => { if (state.dataModelSettings[group]) state.dataModelAttributeEnabled[group] = true; }); state.dataModelAttributeGroup = DATA_MODEL_GROUPS.includes(flowDraft.dataModelAttributeGroup) ? flowDraft.dataModelAttributeGroup : "Profile"; state.dataModelAttributeObjectName = flowDraft.dataModelAttributeObjectName || ""; state.dataModelAttributeColumns = flowDraft.dataModelAttributeColumns || Object.fromEntries(Object.entries(flowDraft.dataModelColumnOverrides || {}).map(([group, additions]) => [group, [...dataModelDefaultColumns(group), ...(Array.isArray(additions) ? additions : [])]])); if (state.dataViewerSettings.customer && !state.dataViewerSettings.Customer) { state.dataViewerSettings.Customer = true; delete state.dataViewerSettings.customer; } if (state.dataViewerSettings.Customer && !state.dataViewerSettings.ContactPoint && !state.dataViewerOptions.contactPointExplicitlyUnselected) state.dataViewerSettings.ContactPoint = true; const savedSchedulers = flowDraft.schedulers || {}; state.schedulers = Object.fromEntries(Object.keys(state.schedulers).map((key) => [key, normalizeScheduler(key, savedSchedulers[key]) ])); if (Array.isArray(flowDraft.flowSteps)) { const legacyDefaultSteps = ["dataViewer", "source", "destination", "export", "import", "publish", "verify"]; const isLegacyDefault = legacyDefaultSteps.every((step) => flowDraft.flowSteps.includes(step)); const keepRunningFlow = /^Running:/.test(e2eStatus || ""); DEFAULT_FLOW.forEach((step) => { document.getElementById(`flow-${step}`).checked = !isLegacyDefault || keepRunningFlow ? flowDraft.flowSteps.includes(step) : false; }); } }
    // The target object is a reusable user choice, unlike a one-run column
    // draft. Keep it after terminal cleanup and restore it on popup reload.
    if (!flowDraft?.dataModelAttributeObjectName && lastDataModelAttributeObjectName) state.dataModelAttributeObjectName = lastDataModelAttributeObjectName;
    if (!flowDraft?.dataModelAttributeGroup && DATA_MODEL_GROUPS.includes(lastDataModelAttributeGroup)) state.dataModelAttributeGroup = lastDataModelAttributeGroup;
    // Drafts saved before the Custom Flow picker had a first-use selection
    // contain an empty import map. Migrate those drafts so the default flow
    // can be launched rather than presenting a permanently disabled button.
    if (!flowDraft?.importSettings && document.getElementById("flow-import").checked && !selectedTableIds().length) state.importSettings = { customer: true };
    // The same first-use default applies to the independent Data Viewer step.
    // Older drafts did not contain its selection state, which made the Custom
    // Flow handler stop before it sent the automation message.
    if (!flowDraft?.dataViewerSettings && document.getElementById("flow-dataViewer").checked && !selectedDataViewerTables().length) state.dataViewerSettings = { Customer: true, ContactPoint: true };
    if (!selectedDataModelGroups().length) {
      state.dataModelSettings = { Profile: true };
      state.dataModelAttributeEnabled = { Profile: true };
    }
    // One-time, non-destructive migration: retain a user's current draft as
    // an explicitly named starting point for the new reusable preset system.
    if (flowDraft && !jobPresets.some((preset) => preset?.config?.kind === "import")) jobPresets.unshift({ id: crypto.randomUUID(), name: "Imported Import draft", savedAt: Date.now(), config: jobPresetConfig("import") });
    if (flowDraft && !jobPresets.some((preset) => preset?.config?.kind === "export")) jobPresets.unshift({ id: crypto.randomUUID(), name: "Imported Export draft", savedAt: Date.now(), config: jobPresetConfig("export") });
    if (flowDraft && !flowPresets.length) flowPresets.unshift({ id: crypto.randomUUID(), name: "Imported Flow draft", savedAt: Date.now(), config: flowPresetConfig() });
    if (flowDraft) await persistPresets();
    document.getElementById("dataViewerRecordsPerTable").value = state.dataViewerOptions.recordsPerTable;
    document.getElementById("dataViewerSourceId").value = state.dataViewerOptions.sourceId;
    document.getElementById("dataViewerParentCustomerId").value = state.dataViewerOptions.parentSourceCustomerId;
    document.getElementById("dataViewerDryRun").checked = state.dataViewerOptions.dryRun;
    document.getElementById("runDataViewerBtn").textContent = state.dataViewerOptions.dryRun ? "▶ Test Data Viewer Record" : "▶ Save Data Viewer Record";
    await chrome.storage.local.remove("popupAccordionState");
    const history = Array.isArray(runHistory) && runHistory.length ? runHistory : (lastRun ? [{ ...lastRun, outcome: lastRun.outcome || "completed" }] : []);
    if (!runHistory?.length && history.length) await chrome.storage.local.set({ runHistory: history.slice(0, 5) });
    setStatus(e2eStatus); renderRunHistory(history); showActivitySection("runs"); showView(["run", "flow", "activity"].includes(popupView) ? popupView : "run", false); renderAll(); renderPresetRows();
  } catch (error) {
    setStatus(`Catalog error: ${error.message || error}`);
  }
}
initialize();
chrome.storage.onChanged.addListener((changes, area) => { if (area !== "local") return; if (changes.e2eStatus) setStatus(changes.e2eStatus.newValue || ""); if (changes.pendingRun) { activeLogRun = changes.pendingRun.newValue || null; if (activitySection === "logs" && !selectedLogRun) renderActivityLogs(); } if (changes.runHistory) renderRunHistory(changes.runHistory.newValue || []); });
