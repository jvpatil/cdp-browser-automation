importScripts("templateStore.js");

const CDP_CONNECTION_SEQUENCE_KEY = "cdpConfirmedConnectionSequencesV2";

const TASKS = {
  "source.js": {
    script: "connectionForm.js",
    dependencies: ["connectionAdapters.js"],
    path: "/integration/",
    root: "sources",
    saveSelector: "#create-source-saveClose",
    createLabel: "Create Source",
    typeDropdownId: "oj-select-choice-source-type",
    formInputIds: ["source-name-input|input"]
  },
  "destination.js": {
    script: "connectionForm.js",
    dependencies: ["connectionAdapters.js"],
    path: "/integration/",
    root: "destinations",
    saveSelector: "#dst-saveClose-btn",
    createLabel: "Create Destination",
    typeDropdownId: "oj-select-choice-destination-type",
    formInputIds: ["source-name-input|input"]
  },
  "importJob.js": { path: "/data/", root: "createConnectJob", readySelector: "div[class*='create-connect-job-body']", saveSelector: "#saveNclose-create-job" },
  // One configurable Import Job is used for every table-based import.
  "importContacts.js": {
    path: "/data/",
    root: "createConnectJob",
    readySelector: "div[class*='create-connect-job-body']",
    saveSelector: "#saveNclose-create-job",
    dependencies: ["cdpCustomerFieldMapping.js"]
  },
  "exportJob.js": { path: "/data/", root: "createExportJob", readySelector: "div[class*='create-export-job-body']", saveSelector: "#saveNclose-create-job" },
  // The Oracle JET input ID contains `|`, which must be escaped when queried
  // as CSS by waitForPageElement.
  "dataViewer.js": { path: "/data/", root: "dataViewer", readySelector: "#data-object-dropdown\\|input" },
  // Handles both object creation and attribute creation on the Data Model page.
  "dataModel.js": { path: "/data/", root: "dataModel", readySelector: ".oj-cxu-side-nav .data-obj-list" },
  "publish.js": { path: "/data/", root: "publishChanges" },
  "integrationStatus.js": { path: "/data/", root: "integrations" }
};

let tableCatalogPromise;
let dataViewerRecordConfigPromise;
let dataModelColumnConfigPromise;

async function loadDataModelColumnConfig() {
  if (!dataModelColumnConfigPromise) {
    dataModelColumnConfigPromise = fetch(chrome.runtime.getURL("config/data-model-columns.json"))
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not read config/data-model-columns.json.");
        return response.json();
      })
      .then((config) => {
        const groups = config?.groups && typeof config.groups === "object" && !Array.isArray(config.groups) ? config.groups : null;
        if (!groups) throw new Error("config/data-model-columns.json must contain a groups object.");
        return { groups };
      });
  }
  return dataModelColumnConfigPromise;
}

async function loadDataViewerRecordConfig() {
  if (!dataViewerRecordConfigPromise) {
    dataViewerRecordConfigPromise = fetch(chrome.runtime.getURL("config/data-viewer-records.json"))
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not read config/data-viewer-records.json.");
        return response.json();
      })
      .then((config) => {
        const tables = config?.tables && typeof config.tables === "object" && !Array.isArray(config.tables) ? config.tables : {};
        return { tables };
      });
  }
  return dataViewerRecordConfigPromise;
}

async function loadTableCatalog() {
  if (!tableCatalogPromise) {
    tableCatalogPromise = fetch(chrome.runtime.getURL("config/tables.json"))
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not read config/tables.json.");
        return response.json();
      })
      .then((catalog) => {
        const imports = Array.isArray(catalog?.importTables) ? catalog.importTables : [];
        const exports = Array.isArray(catalog?.exportPayloads) ? catalog.exportPayloads : [];
        const dataViewerTables = Array.isArray(catalog?.dataViewerTables) ? catalog.dataViewerTables : [];
        const validImports = imports.length && imports.every((table) =>
          typeof table?.id === "string" && table.id &&
          typeof table.label === "string" && table.label &&
          typeof table.cdpTable === "string" && table.cdpTable &&
          (table.csvFile === undefined || typeof table.csvFile === "string")
        );
        const uniqueIds = new Set(imports.map((table) => table.id)).size === imports.length;
        const validExports = exports.length && exports.every((payload) => typeof payload === "string" && payload);
        const validDataViewerTables = dataViewerTables.length && dataViewerTables.every((table) => typeof table === "string" && table);
        if (!validImports || !uniqueIds || !validExports || !validDataViewerTables) throw new Error("config/tables.json has an invalid table or payload entry.");
        return {
          importsById: Object.fromEntries(imports.map((table) => [table.id, table])),
          exportPayloads: exports,
          dataViewerTables: [...new Set(dataViewerTables)]
        };
      });
  }
  return tableCatalogPromise;
}

const E2E_IMPORT_FALLBACK = {
  targetTables: ["Customer", "ContactPoint"],
  fieldToTable: {
    sourcecustomerid: ["Customer", "ContactPoint"],
    firstname: ["Customer"], lastname: ["Customer"], gender: ["Customer"],
    birthdate: ["Customer"], jobtitle: ["Customer"],
    sourcecontactpointid: ["ContactPoint"], email: ["ContactPoint"],
    mobilephone: ["ContactPoint"], optinstatus: ["ContactPoint"], isdeliverable: ["ContactPoint"]
  },
  csvContent: "sourcecustomerid,firstname,lastname,gender,birthdate,jobtitle,sourcecontactpointid,email,mobilephone,optinstatus,isdeliverable\n1,Sachin,Tendulkar,M,07/10/26,Sales Executive,cp-1,jagan.test01@yahoo.com,16504522260,In,TRUE\n"
};

function importFallbackConfig(delimiter = ",") {
  const separator = csvDelimiter(delimiter);
  const rows = E2E_IMPORT_FALLBACK.csvContent.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
  return {
    ...E2E_IMPORT_FALLBACK,
    csvContent: `${rows.map((row) => row.map((value) => csvCell(value, separator)).join(separator)).join("\n")}\n`
  };
}

function parseCsvRow(row) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === '"' && row[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

function csvDelimiter(value) {
  return { tab: "\t", ";": ";", "|": "|", ",": "," }[value] || ",";
}

function csvCell(value, delimiter) {
  const text = String(value ?? "");
  return /["\r\n]/.test(text) || text.includes(delimiter)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

async function loadCsvFields(table) {
  if (!table.csvFile) throw new Error(`${table.label} has no sample CSV configured. Add its csvFile in config/tables.json before creating an Import job.`);
  const response = await fetch(chrome.runtime.getURL(table.csvFile));
  if (!response.ok) throw new Error(`Could not read ${table.csvFile}.`);
  const lines = (await response.text()).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error(`${table.csvFile} must contain a header row and one sample row.`);
  const headers = parseCsvRow(lines[0]);
  const values = parseCsvRow(lines[1]);
  if (!headers.length || headers.length !== values.length || headers.some((header) => !header)) {
    throw new Error(`${table.csvFile} has invalid headers or sample values.`);
  }
  return headers.map((header, index) => ({ header, value: values[index], table: table.cdpTable }));
}

async function buildImportConfig(tableIds, delimiter = ",") {
  const catalog = await loadTableCatalog();
  const selected = [...new Set(tableIds || [])].map((id) => catalog.importsById[id]);
  if (!selected.length || selected.some((table) => !table)) throw new Error("Select at least one supported import table.");
  const fields = (await Promise.all(selected.map(loadCsvFields))).flat();
  const uniqueFields = [];
  const fieldsByHeader = new Map();
  for (const field of fields) {
    const existing = fieldsByHeader.get(field.header);
    if (!existing) {
      fieldsByHeader.set(field.header, { ...field, tables: [field.table] });
      uniqueFields.push(fieldsByHeader.get(field.header));
      continue;
    }
    // A combined mapping CSV has one column for a repeated header. Retain the
    // first selected example value and map that column to every selected table.
    existing.tables.push(field.table);
  }
  const separator = csvDelimiter(delimiter);
  return {
    targetTables: selected.map((table) => table.cdpTable),
    // Preserve the author-provided CSV header verbatim. The field-mapping
    // script receives the same literal value from Oracle's source-field row.
    fieldToTable: Object.fromEntries(uniqueFields.map((field) => [field.header, field.tables])),
    csvContent: `${uniqueFields.map((field) => csvCell(field.header, separator)).join(separator)}\n${uniqueFields.map((field) => csvCell(field.value, separator)).join(separator)}\n`
  };
}

function runStamp() {
  const now = new Date();
  const part = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
}

async function selectedTransferTemplate(templateId) {
  const vault = await cdpReadTemplates();
  const template = vault.templates.find((item) => item.id === templateId);
  if (!template) throw new Error("Select a valid transfer template before running automation.");
  if (!template.source?.type || !template.destination?.type) throw new Error("The selected transfer template is incomplete.");
  const profiles = await cdpReadConnectionProfiles();
  const resolve = (side) => {
    const profileId = template[side]?.profileId;
    if (!profileId) return template[side]; // Existing templates remain usable.
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error(`The ${side} connection profile selected by this template no longer exists.`);
    return { type: profile.type, fields: profile.fields || {}, profileId: profile.id, profileName: profile.name };
  };
  return { ...template, source: resolve("source"), destination: resolve("destination") };
}

async function nextConnectionSequence(templateId) {
  const dateTag = dateTagForName();
  // CDP is the authority for collisions. A local counter can be advanced by
  // an interrupted attempt, so always begin with the unsuffixed base name.
  return { dateTag, ordinal: 1 };
}

async function rememberConnectionSequence(templateId, sequence) {
  if (!templateId || !sequence?.dateTag || !sequence?.ordinal) return;
  const { [CDP_CONNECTION_SEQUENCE_KEY]: saved = {} } = await chrome.storage.local.get(CDP_CONNECTION_SEQUENCE_KEY);
  const previous = saved[templateId];
  const currentOrdinal = previous && previous.dateTag === sequence.dateTag ? Number(previous.ordinal || 0) : 0;
  if (currentOrdinal >= sequence.ordinal) return;
  await chrome.storage.local.set({ [CDP_CONNECTION_SEQUENCE_KEY]: { ...saved, [templateId]: { dateTag: sequence.dateTag, ordinal: sequence.ordinal } } });
}

function connectionProviderCode(type) {
  return {
    "Oracle Object Storage": "OOS",
    "Secure FTP": "SFTP",
    "Google Cloud Storage": "GCS",
    "Salesforce CRM": "SFDC",
    "CX Sales": "CX",
    AWS: "AWS"
  }[type] || "CDP";
}

function dateTagForName(date = new Date()) {
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

function templateShortName(template, providerCode) {
  const parts = String(template.name || "Transfer").split(/[-_\s]+/).filter(Boolean);
  if (parts.length && parts[0].toUpperCase() === providerCode) parts.shift();
  const shortName = parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`).join("");
  return shortName || "Transfer";
}

function transferJobName(template, connection, operation, sequence) {
  const provider = connectionProviderCode(connection.type);
  const purpose = String(template.connectionPurpose || "")
    .replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  const dateTag = sequence?.dateTag || dateTagForName();
  const actualConnectionSuffix = String(connection?.name || "").match(/_(\d{2})$/)?.[1];
  const repeat = actualConnectionSuffix
    ? `_${actualConnectionSuffix}`
    : Number(sequence?.ordinal || 1) > 1 ? `_${String(sequence.ordinal).padStart(2, "0")}` : "";
  return [operation, provider, purpose, templateShortName(template, provider), `${dateTag}${repeat}`].filter(Boolean).join("_");
}

function connectionRuntime(template, side, sequence = null) {
  const connection = template[side];
  const purpose = String(template.connectionPurpose || "")
    .replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  const dateTag = sequence?.dateTag || dateTagForName();
  const ordinal = Number(sequence?.ordinal || 1);
  const name = [connectionProviderCode(connection.type), purpose, `${dateTag}${ordinal > 1 ? `_${String(ordinal).padStart(2, "0")}` : ""}`].filter(Boolean).join("_");
  return {
    side,
    type: connection.type,
    fields: connection.fields || {},
    fileContract: template.fileContract || {},
    name
  };
}

function jobRuntime(template, side) {
  const stamp = runStamp();
  const prefix = `${template.name || "CDP"}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "CDP";
  const contract = template.fileContract || {};
  return {
    name: `${prefix}-${side === "source" ? "Import" : "Export"}-${stamp}`,
    description: template.description || `${template.name} automated transfer`,
    notification: template.notification || "",
    sourceName: side === "source" ? connectionRuntime(template, "source").name : "",
    destinationName: side === "destination" ? connectionRuntime(template, "destination").name : "",
    sourceObjectName: "",
    fileName: "",
    compression: contract.compression || "none",
    filePattern: contract.filePattern || "",
    fileContract: contract
  };
}

const sequenceStepState = new Map();
const activeSequences = new Map();

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.warn("Could not enable CDP Automation Side Panel", error));
}

async function setE2EStatus(status = "", tabId) {
  const activeRun = activeSequences.get(tabId);
  if (activeRun) activeRun.status = status;
  await chrome.storage.local.set({ e2eStatus: status });
  if (status) await appendRunLog(status, status.startsWith("Failed:") ? "error" : "info");
}

async function clearFlowDraft() {
  await chrome.storage.local.remove("flowDraft");
}

async function appendRunLog(message, level = "info", group = "", action = "") {
  const { pendingRun = null } = await chrome.storage.local.get({ pendingRun: null });
  if (!pendingRun || !message) return;
  const logs = Array.isArray(pendingRun.logs) ? pendingRun.logs : [];
  const previous = logs.at(-1);
  if (previous?.message === message && previous?.group === group && previous?.action === action) return;
  await chrome.storage.local.set({
    pendingRun: { ...pendingRun, logs: [...logs, { at: Date.now(), level, group, action, message: String(message) }].slice(-500) }
  });
}

async function appendDataViewerRunLog(result, tables, { recordsPerTable, sourceId, saveRecords }) {
  const names = tables.map((table) => table.cdpTable).join(", ");
  await appendRunLog(`Data Viewer selection: ${names} · ${recordsPerTable} record${recordsPerTable === 1 ? "" : "s"} per table · Source ID: ${sourceId}.`);
  for (const record of result?.records || []) {
    const group = `${record.table} · Record ${record.sequence}`;
    await appendRunLog(`${record.outcome || "Completed"} · Object ID: ${record.objectId || "—"}.`, "info", group);
    for (const item of record.actions || []) {
      const detail = [item.target, item.value ? `= ${item.value}` : ""].filter(Boolean).join(" ");
      await appendRunLog(detail, item.action === "Skip" ? "warning" : "info", group, item.action || "Action");
    }
  }
}

async function finalizeRunHistory(outcome, detail = "") {
  const { pendingRun = null, runHistory = [], runSnapshots = [], activeRunSnapshotId = "" } = await chrome.storage.local.get({ pendingRun: null, runHistory: [], runSnapshots: [], activeRunSnapshotId: "" });
  if (!pendingRun) return;
  const terminalMessage = outcome === "completed" ? "Run completed." : outcome === "stopped" ? "Run stopped." : `Run failed: ${detail || pendingRun.details || "Unknown error"}`;
  const logs = Array.isArray(pendingRun.logs) ? pendingRun.logs : [];
  const entry = {
    ...pendingRun,
    outcome,
    detail: detail || pendingRun.details || "",
    finishedAt: Date.now(),
    logs: [...logs, { at: Date.now(), level: outcome === "failed" ? "error" : outcome, message: terminalMessage }].slice(-500)
  };
  const snapshot = Array.isArray(runSnapshots) ? runSnapshots.find((item) => item?.runId === activeRunSnapshotId) : null;
  if (snapshot) entry.snapshot = { ...snapshot, outcome, finishedAt: entry.finishedAt };
  await chrome.storage.local.set({ runHistory: [entry, ...(Array.isArray(runHistory) ? runHistory : [])].slice(0, 5), lastRun: entry });
  await chrome.storage.local.remove(["pendingRun", "activeRunSnapshotId"]);
}

async function installStopGuard(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      window.__cdpAutomationStopped = false;
      if (window.__cdpStopGuardInstalled) return;
      window.__cdpStopGuardInstalled = true;
      document.addEventListener("click", (event) => {
        if (!window.__cdpAutomationStopped) return;
        if (event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
  });
}

// CDP routes in place, so a cancelled run's click guard may survive the next
// navigation. Reset it before any new scripted Create/Save interaction and
// expose the active run ID to make older monitor listeners harmless.
async function activatePageAutomationRun(tabId, runId = "") {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [runId],
    func: (nextRunId) => {
      window.__cdpAutomationStopped = false;
      window.__cdpPublishCancelled = false;
      document.documentElement.dataset.cdpAutomationRunId = nextRunId || "";
    }
  });
}

function navigationUrl(tabUrl, path, root) {
  const hostKey = new URL(tabUrl).hostname.split(".")[0];
  if (!hostKey) throw new Error("Could not determine the CDP host key from the active tab.");

  const url = new URL(`https://${hostKey}.cdp.ocs.oc-test.com${path}`);
  url.searchParams.set("root", root);
  return url.href;
}

async function captureCreatedEntity(tabId, runMetadata, filename) {
  const creation = {
    "source.js": { section: "sources", label: "Source", inputId: "source-name-input|input" },
    "destination.js": { section: "destinations", label: "Destination", inputId: "source-name-input|input" },
    "exportJob.js": { section: "jobs", role: "export", label: "Export Job", inputId: "job-name-input|input" },
    "importContacts.js": { section: "jobs", role: "import", label: "Import Job", inputId: "job-name-input|input" },
    "importJob.js": { section: "jobs", role: "import", label: "Responsys Import", inputId: "job-name-input|input" }
  }[filename];
  if (!creation) return;

  const [{ result: capturedEntity }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [creation.inputId],
    func: (inputId) => ({
      name: document.getElementById(inputId)?.value?.trim() || "",
      scheduledAt: Number(window.__cdpScheduledRunAt) || null
    })
  });
  const { name: jobName, scheduledAt: capturedScheduledAt } = capturedEntity || {};
  const scheduledAt = capturedScheduledAt || (filename === "exportJob.js" ? runMetadata.exportScheduledAt : null);
  if (!jobName) throw new Error(`The saved ${creation.label} name could not be captured.`);
  const savedEntity = {
    label: creation.label,
    name: jobName,
    savedAt: Date.now()
  };
  if (creation.section === "jobs" && scheduledAt) savedEntity.scheduledAt = scheduledAt;
  if (creation.section === "jobs") {
    runMetadata.creations.jobs[creation.role] = savedEntity;
  } else {
    const collection = runMetadata.creations[creation.section];
    const existingIndex = collection.findIndex((entity) => entity.name === savedEntity.name);
    if (existingIndex >= 0) collection[existingIndex] = savedEntity;
    else collection.push(savedEntity);
  }
  runMetadata.jobNames = [
    runMetadata.creations.jobs.export?.name,
    runMetadata.creations.jobs.import?.name
  ].filter(Boolean);
  await chrome.storage.local.set({ e2eRun: runMetadata });
  return savedEntity;
}

function navigateAndWait(tabId, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("The target page did not finish loading within 30 seconds."));
    }, 30000);

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      // CDP's SPA reports the route load before its JET controls are reliably
      // interactive. Apply one consistent post-navigation stability window to
      // every automation route before its next action begins.
      setTimeout(resolve, 3000);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url }).catch((error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(error);
    });
  });
}

async function waitForPageElement(tabId, selector, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const [{ result: ready }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [selector],
      func: (pageSelector) => {
        const element = document.querySelector(pageSelector);
        return Boolean(element?.getClientRects().length);
      }
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${selector}.`);
}

async function prepareConnectionForm(tabId, { createLabel, typeDropdownId, formInputIds }, connectionType = "Oracle Object Storage") {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [createLabel, typeDropdownId, formInputIds, connectionType],
    func: async (label, dropdownId, inputIds, selectedType) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // The Sources/Destinations list can report page-ready while Oracle is
      // still rendering its JET action bar. Allow the full form transition.
      const deadline = Date.now() + 60000;
      const visible = (element) => Boolean(element?.getClientRects().length);
      const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
      const enabled = (element) =>
        !element.disabled &&
        element.getAttribute("aria-disabled") !== "true" &&
        !element.closest("oj-button")?.classList.contains("oj-disabled");
      const waitFor = async (find, description) => {
        while (Date.now() < deadline) {
          const element = find();
          if (element) return element;
          await sleep(200);
        }
        throw new Error(`Timed out waiting for ${description}.`);
      };
      const click = async (element) => {
        element.scrollIntoView({ block: "center" });
        element.focus?.();
        const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
        if (typeof PointerEvent !== "undefined") {
          element.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerType: "mouse" }));
        }
        element.dispatchEvent(new MouseEvent("mousedown", options));
        element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
        element.click();
        await sleep(250);
      };

      const create = await waitFor(() =>
        [...document.querySelectorAll("button, oj-button, [role='button']")].find((element) => {
          const nativeButton = element.matches("button") ? element : element.querySelector("button");
          return visible(element) && enabled(nativeButton || element) && text(element).toLowerCase() === label.toLowerCase();
        }), label);
      // Click the real button where JET exposes one. Calling click() on the
      // custom-element wrapper alone is unreliable after a slow navigation.
      await click(create.matches("button") ? create : (create.querySelector("button") || create));

      const chooser = await waitFor(() => {
        const element = document.getElementById(dropdownId);
        return visible(element) ? element : null;
      }, "connection type dropdown");
      await click(chooser);

      const option = await waitFor(() =>
        [...document.querySelectorAll("[role='option'], oj-option, li")]
          .find((element) => visible(element) && text(element) === selectedType),
      `${selectedType} option`);
      await click(option.closest("[role='option'], oj-option, li") || option);

      await waitFor(() => text(document.getElementById(dropdownId)).toLowerCase().includes(selectedType.toLowerCase()),
        `${selectedType} selection`);

      await waitFor(() => inputIds.every((id) => {
        const input = document.getElementById(id);
        return input && visible(input) && !input.disabled;
      }), `${selectedType} form fields`);
    }
  });
}

async function connectionNameState(tabId, side) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [side],
    func: (connectionSide) => {
      const input = document.getElementById("source-name-input|input");
      const host = document.getElementById("source-name-input");
      const id = document.getElementById(connectionSide === "destination" ? "destination-id-input|input" : "source-id-input|input");
      const messages = [...document.querySelectorAll("[role=alert], [role=tooltip], .oj-message, .oj-message-detail, .oj-messages, .oj-popup-content")]
        .filter((element) => element.getClientRects().length)
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
      return { name: input?.value || "", jetValue: host?.value || "", invalid: input?.getAttribute("aria-invalid") === "true", id: id?.value || "", messages };
    }
  });
  return result || {};
}

async function typeJetConnectionName(tabId, value) {
  return typeJetInput(tabId, "source-name-input|input", value, "Connection Name");
}

async function typeJetInput(tabId, inputId, value, label = "input", commitKey = "Tab") {
  await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [inputId, label],
    func: (targetId, inputLabel) => {
      const input = document.getElementById(targetId);
      if (!input || input.disabled || input.readOnly) throw new Error(`${inputLabel} input is unavailable.`);
      input.scrollIntoView({ block: "center" });
      input.focus();
      input.select();
    }
  });
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    // Oracle JET's generated-ID listener requires keyboard transition events,
    // not only the trusted `input` event emitted by Input.insertText.
    for (const character of String(value)) {
      const upper = character.toUpperCase();
      const isLetter = /^[A-Z]$/.test(upper);
      const isDigit = /^\d$/.test(character);
      const isUnderscore = character === "_";
      const code = isLetter ? `Key${upper}` : isDigit ? `Digit${character}` : isUnderscore ? "Minus" : "Unidentified";
      const keyCode = isLetter ? upper.charCodeAt(0) : isDigit ? character.charCodeAt(0) : isUnderscore ? 189 : 0;
      const modifiers = isUnderscore ? 8 : 0; // Shift for `_` on the Minus key.
      const event = { key: character, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "char", ...event, text: character, unmodifiedText: character });
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...event });
    }
    // JET requires a trusted completion key. Most form inputs commit on Tab;
    // the Data Model object search intentionally filters only on Enter.
    const completion = commitKey === "Enter"
      ? { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0 }
      : { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 0 };
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...completion });
    // JET's valueChanged handler is attached to the DOM keydown/focus
    // transition. rawKeyDown alone types correctly but can leave Object ID
    // blank on the Data Model drawer; include the normal trusted keydown so
    // the browser performs the same Tab transition as a user.
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", ...completion });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...completion });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

const schedulerSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newSchedulerRunAt(schedule, presetKey, customTimeKey) {
  const preset = presetKey === "custom" ? "custom" : schedule[presetKey];
  const customTime = schedule[customTimeKey];
  const result = new Date();
  if (preset === "custom") {
    if (!/^\d{2}:\d{2}$/.test(String(customTime || ""))) throw new Error("Enter a custom schedule time.");
    const [hours, minutes] = customTime.split(":").map(Number);
    result.setHours(hours, minutes, 0, 0);
    if (result <= new Date()) result.setDate(result.getDate() + 1);
    return result;
  }
  if (preset === "nextHour") {
    // Backward compatibility for saved pre-change drafts only.
    result.setHours(result.getHours() + 1, 0, 0, 0);
  } else if (preset === "plusOneHour") {
    // The popup's +1 hour means exactly 60 minutes from now.
    result.setHours(result.getHours() + 1);
  } else {
    result.setMinutes(result.getMinutes() + (preset === "in30" ? 30 : 15), 0, 0);
  }
  return result;
}

function newSchedulerTimeText(date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function normalizeNewSchedulerConfig(schedule = {}, kind = "import") {
  // A Custom Flow saved before the New Scheduler UI existed can omit its
  // per-step schedule. Treat a missing schedule as the new safe default;
  // retain an explicitly selected Legacy scheduler unchanged.
  if (schedule?.schedulerUi === "legacy") return schedule;
  const isExport = kind === "export";
  const mode = !isExport && schedule?.mode === "onDemand" ? "onDemand" : "scheduled";
  return {
    schedulerUi: "new",
    mode: "scheduled",
    frequency: "Daily",
    timeMode: "specific",
    specificPreset: isExport ? "in15" : "in30",
    intervalHours: "1",
    intervalStartPreset: isExport ? "in15" : "in30",
    intervalEndTime: "23:59",
    ...schedule,
    // Import's new schedule page retains the existing On-demand choice.
    // Export's recurrence is determined by its payload/filter behavior.
    mode
  };
}

function normalizeExportFilter(value) {
  const normalized = String(value || "UPDATED").trim().toUpperCase();
  return ["UPDATED", "CREATED", "ALL"].includes(normalized) ? normalized : "UPDATED";
}

function normalizeExportPayloadType(value) {
  return String(value || "data-object").trim().toLowerCase() === "segment"
    ? "segment"
    : "data-object";
}

async function readNewSchedulerState(tabId, probe) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [probe],
    func: (requestedProbe) => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const rectangle = (element) => {
        if (!element || !visible(element)) return null;
        const box = element.getBoundingClientRect();
        return { x: box.left + (box.width / 2), y: box.top + (box.height / 2) };
      };
      if (requestedProbe.type === "ready") {
        // Import starts with On demand, which renders the outer settings
        // component but deliberately withholds #times and the recurring
        // controls until the user selects Recurring.
        return Boolean(document.querySelector("oj-cx-unity-job-schedule-settings") || document.querySelector("oj-cx-unity-job-schedule-recurring"));
      }
      if (requestedProbe.type === "frequency-input") {
        const input = [...document.querySelectorAll("input[aria-controls='lovDropdown_requency']")]
          .find((element) => visible(element) || visible(element.closest("oj-select-single")));
        return rectangle(input?.closest("oj-select-single, .oj-text-field-container") || input);
      }
      if (requestedProbe.type === "import-frequency-input") {
        const input = document.getElementById("requency|input")
          || [...document.querySelectorAll("input[aria-controls='lovDropdown_requency']")].find(visible);
        return rectangle(input);
      }
      if (requestedProbe.type === "frequency-option") {
        const wanted = String(requestedProbe.value || "").replace(/\s+/g, " ").trim().toLowerCase();
        const list = [...document.querySelectorAll("#lovDropdown_requency, #oj-listbox-results-requency")]
          .find(visible);
        const options = [...(list?.querySelectorAll("[role='option'], [role='gridcell'], li, oj-option") || [])]
          .filter(visible);
        const option = options.find((element) => (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === wanted)
          || options.find((element) => (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase().startsWith(wanted));
        return rectangle(option?.closest("[role='option'], [role='gridcell'], li, oj-option") || option);
      }
      if (requestedProbe.type === "frequency-value") {
        const input = [...document.querySelectorAll("input[aria-controls='lovDropdown_requency']")]
          .find((element) => visible(element) || visible(element.closest("oj-select-single")));
        return input?.value || "";
      }
      if (requestedProbe.type === "recurring-run") {
        // CDP/JET generates the radio id dynamically and can reflect its
        // selected state on the visible choice wrapper before it mirrors the
        // native input's checked property. Read both representations.
        const runType = [...document.querySelectorAll("oj-cx-unity-job-schedule-settings oj-radioset#recurring-or-manual, oj-radioset#recurring-or-manual")]
          .find(visible)
          || [...document.querySelectorAll("oj-radioset")].find((element) => visible(element) && [...element.querySelectorAll("input")].some((input) => /recurr/i.test(input.value || input.name || "")))
          || [...document.querySelectorAll("oj-cx-unity-job-schedule-settings")].find(visible);
        const inputs = [...(runType?.querySelectorAll("input") || [])];
        const input = inputs.find((candidate) => /recurr/i.test(candidate.value || candidate.name || "")) || null;
        const manual = inputs.find((candidate) => /ondemand|manual/i.test(candidate.value || "")) || null;
        const labelFor = (control) => [...document.querySelectorAll("label")].find((label) => label.htmlFor === control?.id) || control?.closest(".oj-choice-item, label") || control;
        const manualExists = Boolean(manual);
        if (!input) {
          const recurringLabel = [...(runType?.querySelectorAll("label,span,.option-recurring") || [])]
            .find((element) => visible(element) && /^recurring$/i.test((element.textContent || "").replace(/\s+/g, " ").trim()));
          return {
            exists: Boolean(recurringLabel),
            manualExists,
            checked: Boolean(recurringLabel),
            rect: rectangle(recurringLabel?.closest(".oj-choice-item") || recurringLabel)
          };
        }
        const choice = input.closest(".oj-choice-item") || labelFor(input);
        // The icon is the interactive hit target in JET. The native input is
        // visually hidden and the wider wrapper can be covered by layout
        // elements on the Import schedule page.
        const target = choice?.querySelector(".oj-radiocheckbox-icon") || choice;
        const checked = Boolean(input.checked) || [input, choice, labelFor(input), choice?.parentElement]
          .some((element) => element?.getAttribute?.("aria-checked") === "true" || element?.classList?.contains("oj-selected"));
        return { exists: true, manualExists, checked, rect: rectangle(target) };
      }
      if (requestedProbe.type === "time-mode") {
        const input = [...document.querySelectorAll(`#specific_or_interval input[value="${requestedProbe.value}"], input[name="specific_or_interval"][value="${requestedProbe.value}"]`)]
          .find((element) => visible(element) || visible(element.closest("oj-radioset, .oj-choice-item")));
        const choice = input?.closest(".oj-choice-item");
        const checked = Boolean(input?.checked)
          || choice?.classList.contains("oj-selected")
          || choice?.getAttribute("aria-checked") === "true";
        return {
          checked,
          rect: rectangle(choice?.querySelector(".oj-radiocheckbox-icon") || document.querySelector(`label[for="${input?.id || ""}"]`) || choice || input)
        };
      }
      if (requestedProbe.type === "time-input") {
        const input = [...document.querySelectorAll("#times oj-input-time.specific-time-length input, #times .specific-time-length input")]
          .find((element) => visible(element) && !element.id.startsWith("interval_"));
        return input?.id || "";
      }
      if (requestedProbe.type === "interval-input") return document.getElementById(`${requestedProbe.id}|input`)?.id || "";
      if (requestedProbe.type === "calendar-choice") {
        const root = document.querySelector("oj-cx-unity-job-schedule-recurring, oj-cx-unity-job-schedule-settings");
        const input = [...(root?.querySelectorAll(`input[value="${requestedProbe.value}"]`) || [])]
          .find((element) => visible(element) || visible(element.closest("oj-buttonset-many, .oj-choice-item")));
        return { checked: Boolean(input?.checked), rect: rectangle(root?.querySelector(`label[for="${input?.id || ""}"]`) || input?.closest(".oj-button-toggle,.oj-choice-item") || input) };
      }
      return null;
    }
  });
  return result;
}

async function waitForNewSchedulerState(tabId, probe, label, predicate = Boolean, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await readNewSchedulerState(tabId, probe);
    if (predicate(state)) return state;
    await schedulerSleep(150);
  }
  throw new Error(`New scheduler: timed out waiting for ${label}.`);
}

async function trustedSchedulerClick(tabId, point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`New scheduler: ${label} is not available.`);
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const x = Math.round(point.x); const y = Math.round(point.y);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function trustedSelectRecurring(tabId, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("New scheduler: Recurring run option is not available.");
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const x = Math.round(point.x); const y = Math.round(point.y);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

// Import's New Scheduler is a JET radioset.  Its stable native radio is the
// only control we need to activate; do not set the component value or infer
// selection from dynamic ui-id values.
async function clickImportRecurringRadio(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const group = [...document.querySelectorAll("oj-radioset#recurring-or-manual")]
        .find(visible)
        || document.querySelector("oj-radioset#recurring-or-manual");
      const recurring = group?.querySelector("input[name='recurring-or-manual'][value='recurring']");
      if (!recurring) return { found: false, checked: false };
      if (!recurring.checked) recurring.click();
      return { found: true, checked: Boolean(recurring.checked) };
    }
  });
  if (!result?.found) throw new Error("New scheduler: Recurring run option is not available.");
  return Boolean(result.checked);
}

async function clickImportOnDemandRadio(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const group = [...document.querySelectorAll("oj-radioset#recurring-or-manual")]
        .find(visible)
        || document.querySelector("oj-radioset#recurring-or-manual");
      const onDemand = group?.querySelector("input[name='recurring-or-manual'][value='onDemand'], input[name='recurring-or-manual'][value='manual']");
      if (!onDemand) return { found: false, checked: false };
      if (!onDemand.checked) onDemand.click();
      return { found: true, checked: Boolean(onDemand.checked) };
    }
  });
  if (!result?.found) throw new Error("New scheduler: On-demand run option is not available.");
  return Boolean(result.checked);
}

// Import's Frequency and Times controls are Oracle JET components that sit
// behind a transient mapping overlay. The component accepts this native JET
// event sequence reliably, whereas a debugger-coordinate click can land on
// the overlay. Keep the behavior in the shared scheduler—not the Import job.
async function selectImportSchedulerFrequency(tabId, frequency) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [frequency],
    func: async (requestedFrequency) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const normalized = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const click = (element) => {
        element.scrollIntoView({ block: "center" });
        element.focus?.();
        const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
        if (typeof PointerEvent !== "undefined") element.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerType: "mouse" }));
        element.dispatchEvent(new MouseEvent("mousedown", options));
        element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
        element.click();
      };
      const input = document.getElementById("requency|input");
      if (!input || !visible(input) || input.disabled) return { ok: false, error: "Import Frequency input is unavailable." };
      click(input);
      const wanted = normalized(requestedFrequency);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const menu = document.getElementById("lovDropdown_requency");
        const choices = [...(menu?.querySelectorAll("[role='option'],[role='gridcell'],li,oj-option") || [])].filter(visible);
        const option = choices.find((item) => normalized(item.textContent) === wanted)
          || choices.find((item) => normalized(item.textContent).startsWith(wanted));
        if (option) {
          click(option.closest("[role='option'],[role='gridcell'],li,oj-option") || option);
          return { ok: true };
        }
        await sleep(100);
      }
      return { ok: false, error: `Import Frequency option ${requestedFrequency} was not available.` };
    }
  });
  if (!result?.ok) throw new Error(result?.error || "New scheduler: Import Frequency could not be selected.");
}

async function selectImportSchedulerTimeMode(tabId, timeMode) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [timeMode],
    func: (requestedMode) => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const input = [...document.querySelectorAll("oj-radioset#specific_or_interval input")]
        .find((element) => visible(element.closest("oj-radioset")) && String(element.value || "").toLowerCase() === String(requestedMode).toLowerCase());
      if (!input) return { ok: false, error: `Import ${requestedMode} option is unavailable.` };
      const target = document.querySelector(`label[for="${CSS.escape(input.id)}"]`) || input.closest(".oj-choice-item") || input;
      const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
      target.dispatchEvent(new MouseEvent("mousedown", options));
      target.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
      target.click();
      return { ok: Boolean(input.checked) };
    }
  });
  if (!result?.ok) throw new Error(result?.error || `New scheduler: Import ${timeMode} could not be selected.`);
}

async function trustedSchedulerSpace(tabId) {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const space = { key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 };
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...space });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...space });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function activateRecurringMode(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const root = [...document.querySelectorAll("oj-cx-unity-job-schedule-settings oj-radioset#recurring-or-manual, oj-radioset#recurring-or-manual")]
        .find(visible)
        || [...document.querySelectorAll("oj-radioset")].find((element) => visible(element) && [...element.querySelectorAll("input")].some((input) => /recurr/i.test(input.value || input.name || "")));
      if (!root) return { found: false, activated: false };
      const input = [...root.querySelectorAll("input")].find((candidate) => /recurr/i.test(candidate.value || candidate.name || ""));
      const current = () => Boolean(input?.checked) || /recurr/i.test(String(root.value || ""));
      if (current()) return { found: true, activated: true };
      // JET exposes the radioset value as a component property. Setting it
      // first lets its own valueChanged handler render the recurring panel;
      // the native event path below covers older CDP builds.
      for (const value of [["recurring"], "recurring"]) {
        try { root.setProperty?.("value", value); } catch (_) {}
        try { root.value = value; } catch (_) {}
        if (current()) break;
      }
      if (!current() && input) {
        input.checked = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return { found: true, activated: current() };
    }
  });
  return Boolean(result?.activated);
}

async function applyTrustedNewScheduler(tabId, schedule = {}) {
  const normalized = { frequency: "Daily", timeMode: "specific", specificPreset: "in15", intervalHours: "1", intervalStartPreset: "in15", intervalEndTime: "23:59", ...schedule };
  const isImportJob = normalized.jobKind === "import";
  const schedulerGroup = `Scheduler · ${isImportJob ? "Import" : "Export"}`;
  await waitForNewSchedulerState(tabId, { type: "ready" }, "schedule controls", Boolean, 120000);
  await appendRunLog("Schedule and Notify controls are ready.", "info", schedulerGroup, "Ready");

  // Only Import exposes an explicit On-demand radio in the New Scheduler.
  // Export's schedule mode is determined by its payload/filter selection.
  if (isImportJob && String(normalized.mode || "scheduled").toLowerCase() === "ondemand") {
    await clickImportOnDemandRadio(tabId);
    await appendRunLog("Run mode = On-demand.", "info", schedulerGroup, "Select");
    return { ok: true, mode: "onDemand" };
  }

  // Import jobs can open with Manual selected; Export has Recurring fixed. In
  // both cases, a New Scheduler configuration must explicitly be recurring.
  const recurring = await waitForNewSchedulerState(
    tabId,
    { type: "recurring-run" },
    "Run selection",
    (state) => Boolean(state?.exists || state?.manualExists || state?.rect),
    120000
  );
  if (recurring?.manualExists && !recurring.exists) {
    let activated = false;
    if (isImportJob) activated = await clickImportRecurringRadio(tabId);
    if (!isImportJob) activated = await activateRecurringMode(tabId);
    if (!activated && !isImportJob && recurring.rect) {
      await trustedSelectRecurring(tabId, recurring.rect);
      activated = true;
    }
    if (!activated) throw new Error("New scheduler: CDP exposed On-demand but not an activatable Recurring option.");
    await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "Recurring schedule controls", Boolean);
  }
  if (recurring?.exists && !recurring.checked) {
    if (isImportJob) {
      await clickImportRecurringRadio(tabId);
    } else {
      const activated = await activateRecurringMode(tabId);
      if (!activated) await trustedSelectRecurring(tabId, recurring.rect);
    }
    // The recurrence controls are the authoritative signal. JET can delay
    // rendering them just after the radio's click handler runs.
    try {
      await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "Recurring schedule controls", Boolean, 2500);
    } catch (_) {
      if (isImportJob) {
        await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "Recurring schedule controls", Boolean);
      } else {
        // The visible radio icon receives focus after the mouse action. Some
        // JET builds need its standard keyboard activation to commit the value.
        await trustedSchedulerSpace(tabId);
        await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "Recurring schedule controls", Boolean);
      }
    }
  }
  await appendRunLog("Run mode = Recurring.", "info", schedulerGroup, "Select");

  if (isImportJob) {
    await selectImportSchedulerFrequency(tabId, normalized.frequency);
  } else {
    await trustedSchedulerClick(tabId, await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "frequency selector"), "frequency selector");
    await trustedSchedulerClick(tabId, await waitForNewSchedulerState(tabId, { type: "frequency-option", value: normalized.frequency }, `${normalized.frequency} option`), "frequency option");
  }
  await waitForNewSchedulerState(tabId, { type: "frequency-value" }, `${normalized.frequency} selection`, (value) => String(value).trim().toLowerCase() === String(normalized.frequency).trim().toLowerCase());
  await appendRunLog(`Frequency = ${normalized.frequency}.`, "info", schedulerGroup, "Select");

  if (normalized.frequency !== "Daily") {
    const now = new Date();
    const value = normalized.frequency === "Weekly, on selected Days" ? String(now.getDay() + 1) : String(now.getDate());
    const calendar = await waitForNewSchedulerState(tabId, { type: "calendar-choice", value }, "calendar choice", (state) => state?.rect);
    if (!calendar.checked) await trustedSchedulerClick(tabId, calendar.rect, "calendar choice");
    await waitForNewSchedulerState(tabId, { type: "calendar-choice", value }, "calendar selection", (state) => state?.checked);
    await appendRunLog(`Calendar selection = ${value}.`, "info", schedulerGroup, "Select");
  }

  const timeMode = await waitForNewSchedulerState(tabId, { type: "time-mode", value: normalized.timeMode }, `${normalized.timeMode} option`, (state) => state?.rect);
  if (!timeMode.checked) {
    if (isImportJob) await selectImportSchedulerTimeMode(tabId, normalized.timeMode);
    else await trustedSchedulerClick(tabId, timeMode.rect, `${normalized.timeMode} option`);
  }
  await waitForNewSchedulerState(tabId, { type: "time-mode", value: normalized.timeMode }, `${normalized.timeMode} selection`, (state) => state?.checked);
  await appendRunLog(`Times = ${normalized.timeMode === "interval" ? "Interval" : "Specific"}.`, "info", schedulerGroup, "Select");

  if (normalized.timeMode === "interval") {
    const hours = Number.parseInt(normalized.intervalHours, 10);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new Error("Interval must be a whole number from 1 to 24 hours.");
    const intervalId = await waitForNewSchedulerState(tabId, { type: "interval-input", id: "interval" }, "interval input", Boolean);
    await typeJetInput(tabId, intervalId, String(hours), "Interval");
    const startId = await waitForNewSchedulerState(tabId, { type: "interval-input", id: "interval_start_time" }, "interval start time", Boolean);
    await typeJetInput(tabId, startId, newSchedulerTimeText(newSchedulerRunAt(normalized, "intervalStartPreset", "intervalStartTime")), "Interval start time");
    const endId = await waitForNewSchedulerState(tabId, { type: "interval-input", id: "interval_end_time" }, "interval end time", Boolean);
    await typeJetInput(tabId, endId, newSchedulerTimeText(newSchedulerRunAt({ ...normalized, customTime: normalized.intervalEndTime || "23:59" }, "custom", "customTime")), "Interval end time");
    await appendRunLog(`Interval = ${hours} hour(s); start = ${newSchedulerTimeText(newSchedulerRunAt(normalized, "intervalStartPreset", "intervalStartTime"))}; end = ${newSchedulerTimeText(newSchedulerRunAt({ ...normalized, customTime: normalized.intervalEndTime || "23:59" }, "custom", "customTime"))}.`, "info", schedulerGroup, "Type");
  } else {
    const timeInputId = await waitForNewSchedulerState(tabId, { type: "time-input" }, "specific time", Boolean);
    const runAt = newSchedulerRunAt(normalized, "specificPreset", "customTime");
    await typeJetInput(tabId, timeInputId, newSchedulerTimeText(runAt), "Specific time");
    await appendRunLog(`Specific time = ${newSchedulerTimeText(runAt)}.`, "info", schedulerGroup, "Type");
    return { ok: true, scheduledAt: runAt.getTime() };
  }
  return { ok: true };
}

async function installNewSchedulerRelay(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId }, world: "ISOLATED",
    func: () => {
      if (window.__cdpNewSchedulerRelayInstalled) return;
      window.__cdpNewSchedulerRelayInstalled = true;
      window.addEventListener("cdp-new-scheduler-request", async (event) => {
        try {
          const schedule = JSON.parse(String(event.detail || "{}"));
          const result = await chrome.runtime.sendMessage({ type: "apply-new-scheduler", schedule });
          window.dispatchEvent(new CustomEvent("cdp-new-scheduler-result", { detail: JSON.stringify(result || {}) }));
        } catch (error) {
          window.dispatchEvent(new CustomEvent("cdp-new-scheduler-result", { detail: JSON.stringify({ ok: false, error: error.message || String(error) }) }));
        }
      });
      window.addEventListener("message", async (event) => {
        const message = event.data;
        if (event.source !== window || message?.source !== "cdp-import-scheduler" || message?.type !== "apply") return;
        let result;
        try {
          result = await chrome.runtime.sendMessage({ type: "apply-new-scheduler", schedule: message.schedule || {} });
        } catch (error) {
          result = { ok: false, error: error.message || String(error) };
        }
        window.postMessage({
          source: "cdp-import-scheduler",
          type: "result",
          requestId: message.requestId,
          result: result || { ok: false, error: "New scheduler did not return a result." }
        }, "*");
      });
    }
  });
}

async function dataModelObjectState(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    func: () => {
      const name = document.getElementById("objNameInput|input");
      const objectId = document.getElementById("objIdInput|input");
      const messages = [...document.querySelectorAll("[role=alert], [role=tooltip], .oj-message, .oj-message-detail, .oj-messages, .oj-popup-content")]
        .filter((element) => element.getClientRects().length)
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
      return { name: name?.value || "", objectId: objectId?.value || "", invalid: name?.getAttribute("aria-invalid") === "true", messages };
    }
  });
  return result || {};
}

async function commitJetDataModelObjectName(tabId, objectName) {
  const candidate = String(objectName || "").replace(/_\d{2}$/, "");
  await typeJetInput(tabId, "objNameInput|input", candidate, "Object name");
  for (let attempt = 0; attempt < 28; attempt += 1) {
    const state = await dataModelObjectState(tabId);
    if (String(state.objectId || "").trim() && !state.invalid) return { ...state, name: candidate };
    if (state.invalid) return { ...state, name: candidate, skipped: true, reason: state.messages || "CDP rejected this Data Model object name." };
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  const state = await dataModelObjectState(tabId);
  if (state.invalid) return { ...state, name: candidate, skipped: true, reason: state.messages || "CDP rejected this Data Model object name." };
  throw new Error(`CDP did not generate an Object ID for ${candidate}${state.messages ? `: ${state.messages}` : ""}`);
}

async function dataModelAttributeState(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    func: () => {
      const name = document.getElementById("attrNameInput|input");
      const attributeId = document.getElementById("attrIdInput|input");
      const messages = [...document.querySelectorAll("[role=alert], [role=tooltip], .oj-message, .oj-message-detail, .oj-messages, .oj-popup-content")]
        .filter((element) => element.getClientRects().length)
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
      return { name: name?.value || "", attributeId: attributeId?.value || "", invalid: name?.getAttribute("aria-invalid") === "true", messages };
    }
  });
  return result || {};
}

async function commitJetDataModelAttributeName(tabId, attributeName) {
  await typeJetInput(tabId, "attrNameInput|input", attributeName, "Attribute name");
  const expectedName = String(attributeName || "").trim().toLowerCase();
  for (let attempt = 0; attempt < 84; attempt += 1) {
    const state = await dataModelAttributeState(tabId);
    const actualName = String(state.name || "").trim().toLowerCase();
    if (
      actualName === expectedName &&
      String(state.attributeId || "").trim() &&
      !state.invalid
    ) {
      return { ...state, name: attributeName };
    }
    if (state.invalid) {
      return { ...state, name: attributeName, skipped: true, reason: "Attribute name is already unavailable in CDP." };
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  const state = await dataModelAttributeState(tabId);
  if (state.invalid) {
    return { ...state, name: attributeName, skipped: true, reason: state.messages || "Attribute name is already unavailable in CDP." };
  }
  throw new Error(`CDP did not generate an Attribute ID for ${attributeName}${state.messages ? `: ${state.messages}` : ""}`);
}

async function commitJetConnectionName(tabId, connectionConfig) {
  const baseName = String(connectionConfig.name || "").replace(/_\d{2}$/, "");
  for (let index = 1; index <= 99; index += 1) {
    const candidate = index === 1 ? baseName : `${baseName}_${String(index).padStart(2, "0")}`;
    await typeJetConnectionName(tabId, candidate);
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const state = await connectionNameState(tabId, connectionConfig.side);
      if (String(state.id || "").trim()) return { ...connectionConfig, name: candidate, nameCommitted: true };
      const duplicate = state.invalid && /(?:source|destination|connection)?\s*(?:with\s+this\s+)?name\s+already\s+exists|name\s+must\s+be\s+unique|try\s+another/i.test(state.messages || "");
      if (duplicate) break;
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    const finalState = await connectionNameState(tabId, connectionConfig.side);
    const duplicate = finalState.invalid && /(?:source|destination|connection)?\s*(?:with\s+this\s+)?name\s+already\s+exists|name\s+must\s+be\s+unique|try\s+another/i.test(finalState.messages || "");
    if (!duplicate) throw new Error(`CDP did not generate the required ${connectionConfig.side === "destination" ? "Destination" : "Source"} ID after typing the connection name.`);
  }
  throw new Error(`No available connection name suffix was found for ${baseName}.`);
}

async function installStepMonitor(tabId, { runId, stepId, saveSelector }) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [runId, stepId, saveSelector],
    func: (activeRunId, activeStepId, selector) => {
      const visible = (element) => Boolean(element?.getClientRects().length);
      const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
      const plainSaveButton = () => [...document.querySelectorAll("button, oj-button, [role='button']")]
        .find((element) => visible(element) && text(element) === "Save" && !element.disabled);

      document.addEventListener("click", (event) => {
        if (document.documentElement.dataset.cdpAutomationRunId !== activeRunId) return;
        if (!(event.target instanceof Element) || !event.target.closest(selector)) return;

        // New Scheduler jobs configure the actual CDP controls from their
        // Save gate. Do not redirect their Save and close click around it.
        if (document.documentElement.dataset.cdpNewScheduler === "true") return;

        const saveButton = plainSaveButton();
        if (saveButton) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setTimeout(() => {
            (saveButton.querySelector("button") || saveButton).click();
            chrome.runtime.sendMessage({
              type: "sequence-step-saved",
              runId: activeRunId,
              stepId: activeStepId
            });
          }, 0);
        } else {
          chrome.runtime.sendMessage({
            type: "sequence-step-save-missing",
            runId: activeRunId,
            stepId: activeStepId
          });
        }
      }, true);
    }
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [saveSelector],
    func: (selector) => {
      const state = { status: "running", error: "", saveClickedAt: 0 };
      window.__cdpSequenceStep = state;
      const originalAlert = window.alert.bind(window);
      window.alert = (message) => {
        state.status = "failed";
        state.error = String(message);
        return originalAlert(message);
      };
      document.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest(selector)) {
          state.status = "saved";
          state.saveClickedAt = Date.now();
        }
      }, true);
    }
  });
}

async function installTaskCompletionMonitor(tabId, runId, saveSelector) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [runId, saveSelector],
    func: (activeRunId, selector) => {
      document.addEventListener("click", (event) => {
        if (document.documentElement.dataset.cdpAutomationRunId !== activeRunId) return;
        if (event.target instanceof Element && event.target.closest(selector)) {
          chrome.runtime.sendMessage({ type: "individual-task-finished", runId: activeRunId });
        }
      }, true);
    }
  });
}

async function waitForStep(tabId, label, saveSelector, runId, stepId, timeout = 180000) {
  const deadline = Date.now() + timeout;
  const isJobSave = /Create (Import|Export) Job/i.test(label);
  let saveRetryAttempted = false;
  let saveRetryDeadline = 0;
  while (Date.now() < deadline) {
    try {
      const activeSequence = activeSequences.get(tabId);
      if (!activeSequence || activeSequence.runId !== runId || activeSequence.cancelled) {
        throw new Error(`${label} was stopped by the user.`);
      }
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          const visible = (element) => Boolean(element?.getClientRects().length);
          const messages = [...document.querySelectorAll(
            "[data-bind='text: message.data.detail'], [role='alert'], .oj-message, .oj-message-summary, .oj-messages, [class*='toast'], [class*='notification']"
          )]
            .filter(visible)
            .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean);
          const saveHost = saveSelector ? document.querySelector(saveSelector) : null;
          const saveButton = saveHost?.matches("button") ? saveHost : saveHost?.querySelector("button");
          const saveEnabled = Boolean(
            saveHost && saveButton && visible(saveHost) && !saveButton.disabled &&
            !saveHost.classList.contains("oj-disabled") && saveHost.getAttribute("aria-disabled") !== "true"
          );
          return {
            monitor: window.__cdpSequenceStep || null,
            saveEnabled,
            success: messages.some((message) =>
              /\byour\s+changes\s+have\s+been\s+saved\b/i.test(message) ||
              /\bjob\s+was\s+saved\s+successfully\b/i.test(message)
            )
          };
        }
      });
      if (result?.success) {
        // Do not treat a Save click as completion. CDP can still be validating
        // or persisting the source/destination while the next navigation would
        // cancel the request. Advance only after its visible success message.
        await appendRunLog(`${label} saved.`);
        return;
      }
      if (!result?.monitor) {
        throw new Error(`${label} was interrupted before Oracle confirmed it was saved successfully.`);
      }
      const saveClickedAt = Number(result.monitor.saveClickedAt || 0);
      const elapsedSinceSave = saveClickedAt ? Date.now() - saveClickedAt : 0;
      if (isJobSave && saveClickedAt && !saveRetryAttempted && elapsedSinceSave >= 4000) {
        saveRetryAttempted = true;
        saveRetryDeadline = Date.now() + 5000;
        if (result.saveEnabled) {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            args: [saveSelector],
            func: (selector) => {
              const host = document.querySelector(selector);
              const button = host?.matches("button") ? host : host?.querySelector("button");
              if (!host || !button || button.disabled || host.classList.contains("oj-disabled") || host.getAttribute("aria-disabled") === "true") return false;
              button.click();
              return true;
            }
          });
          await appendRunLog(`${label}: Save remained enabled after 4 seconds; retried Save.`, "warn", label, "Retry");
        } else {
          await appendRunLog(`${label}: Save became unavailable; waiting briefly for CDP confirmation.`, "info", label, "Wait");
        }
      }
      if (isJobSave && saveRetryAttempted && Date.now() >= saveRetryDeadline) {
        throw new Error(`${label} did not show a save confirmation after the Save retry.`);
      }
    } catch (error) {
      throw new Error(`${label} failed: ${error.message || error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out waiting for CDP's save confirmation.`);
}

async function runTask(tabId, filename, monitor, schedule, importConfig, exportPayloadName, importTableIds, connectionConfig, jobConfig) {
  const task = TASKS[filename];
  if (!task) throw new Error(`Unsupported automation script: ${filename}`);
  if (filename === "exportJob.js") {
    const catalog = await loadTableCatalog();
    const payload = exportPayloadName || "Customer";
    if (!catalog.exportPayloads.includes(payload)) throw new Error(`Unsupported export payload: ${payload}.`);
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith("http")) {
    throw new Error("Open your Oracle CDP tenant in the active tab first.");
  }

  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  await activatePageAutomationRun(tabId, monitor?.runId || schedule?.runId || "");
  let runtimeConnectionConfig = connectionConfig;
  if (task.createLabel) {
    await prepareConnectionForm(tabId, task, connectionConfig?.type);
    if (connectionConfig?.name) runtimeConnectionConfig = await commitJetConnectionName(tabId, connectionConfig);
  }
  if (task.readySelector) await waitForPageElement(tabId, task.readySelector);

  // In E2E, navigate first. This ensures the Export→Import handoff is visible
  // even if a user-edited CSV fragment has a configuration error.
  if (filename === "importContacts.js" && !importConfig && importTableIds) {
    try {
      importConfig = await buildImportConfig(importTableIds, jobConfig?.fileContract?.delimiter);
    } catch (error) {
      console.warn("Could not load editable E2E import CSV files; using the bundled Customer + ContactPoint fallback.", error);
      importConfig = importFallbackConfig(jobConfig?.fileContract?.delimiter);
    }
  }

  // Oracle sometimes reports the page complete just before its JET form accepts
  // MAIN-world injections. Retry that short transition rather than leaving an
  // empty form open and silently abandoning the E2E flow.
  const installAutomation = async () => {
    await installStopGuard(tabId);
    if (monitor) await installStepMonitor(tabId, monitor);
    if (!monitor && task.saveSelector && schedule?.runId) {
      await installTaskCompletionMonitor(tabId, schedule.runId, task.saveSelector);
    }

    if (["exportJob.js", "importJob.js", "importContacts.js"].includes(filename)) {
      // The worker scheduler needs to distinguish Import's JET radio group
      // (which must receive a real click) from Export's schedule controls.
      // Keep this explicit rather than inferring it from DOM labels.
      const jobSchedule = {
        ...(schedule || { mode: "scheduled", frequency: "Daily", startTime: "immediate" }),
        jobKind: filename === "exportJob.js" ? "export" : "import"
      };
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [jobSchedule],
        func: (scheduleConfig) => {
          window.__cdpSchedule = scheduleConfig;
          window.__cdpScheduledRunAt = null;
          window.__cdpScheduleApplied = false;
          window.__cdpManualScheduleApplied = false;
          window.__cdpFrequencySaveDeferred = false;
          window.__cdpFrequencyOverrideSaved = false;
          window.__cdpFrequencyOverrideApplying = false;
          window.__cdpNewScheduleApplied = false;
          window.__cdpUseWorkerScheduler = scheduleConfig?.schedulerUi === "new";
          document.documentElement.dataset.cdpNewScheduler = scheduleConfig?.schedulerUi === "new" ? "true" : "false";
        }
      });
      if (schedule?.schedulerUi === "legacy") {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          files: ["scheduleOverride.js"]
        });
      }
      // New Scheduler is one shared scheduler for Import, Export, and
      // Responsys. Legacy scheduler scripts remain page-specific.
      if (schedule?.schedulerUi === "new") {
        await installNewSchedulerRelay(tabId);
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          files: ["jobSchedulerBridge.js"]
        });
      }
    }

    if (runtimeConnectionConfig) {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [runtimeConnectionConfig],
        func: (config) => { window.__cdpConnectionConfig = config; }
      });
    }
    if (jobConfig) {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [jobConfig],
        func: (config) => {
          window.__cdpJobConfig = config;
          const set = (id, value) => {
            if (!value) return;
            const input = document.getElementById(id);
            if (!input || input.value === value) return;
            const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
            setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
          };
          const apply = () => { set("job-name-input|input", config.name); set("job-desc-text-area|input", config.description); set("job-details-fileName|input", config.fileName); set("notify-input|input", config.notification); };
          const applyCompression = () => {
            if (!config.compression || config.compression === "none") return;
            const input = [...document.querySelectorAll("input[role=combobox]")].find((item) => /compressformat/i.test(item.getAttribute("aria-label") || item.id));
            if (!input || input.value === config.compression || input.dataset.cdpTemplateCompression === config.compression) return;
            input.dataset.cdpTemplateCompression = config.compression;
            (input.closest("oj-select-single")?.querySelector(".oj-searchselect-arrow,.oj-searchselect-main-field") || input).click();
            setTimeout(() => {
              const option = [...document.querySelectorAll("[role=option],oj-option,li")].find((item) => item.getClientRects().length && (item.textContent || "").trim().toLowerCase() === String(config.compression).toLowerCase());
              option?.click();
            }, 180);
          };
          apply(); const timer = setInterval(() => { apply(); applyCompression(); }, 80); setTimeout(() => clearInterval(timer), 120000);
        }
      });
    }

    if (filename === "importContacts.js") {
      if (!importConfig?.csvContent || !Array.isArray(importConfig.targetTables) || !importConfig.fieldToTable) importConfig = E2E_IMPORT_FALLBACK;
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [importConfig],
        func: (config) => { window.__cdpImportConfig = config; }
      });
    }
  };

  let installError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await installAutomation();
      installError = undefined;
      break;
    } catch (error) {
      installError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (installError) throw new Error(`Could not attach ${filename} after the page loaded: ${installError.message || installError}`);

  if (filename === "exportJob.js") {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [exportPayloadName || "Customer"],
      func: (payloadName) => { window.__cdpExportPayloadName = payloadName; }
    });
  }

  if (false && filename === "exportJob.js") {
    if (!exportPayloadName && exportPayloadName !== undefined) throw new Error("Export payload selection is missing.");
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [exportPayloadName || "Customer"],
      func: (payloadName) => {
        window.__cdpExportPayloadName = payloadName;
        if (window.__cdpExportPayloadOverrideInstalled) return;
        window.__cdpExportPayloadOverrideInstalled = true;
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const visible = (element) => Boolean(element?.getClientRects().length);
        const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
        const setValue = (element, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter ? setter.call(element, value) : element.value = value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const click = (element) => {
          const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
          element.dispatchEvent(new MouseEvent("mousedown", options));
          element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
          element.click();
        };
        const chooseConfiguredPayload = async () => {
          const payloadName = window.__cdpExportPayloadName;
          if (!payloadName || payloadName === "Customer" || window.__cdpApplyingExportPayload) return;
          window.__cdpApplyingExportPayload = true;
          const input = document.getElementById("data-object-selection-dropdown|input");
          try {
            if (!input || !visible(input)) return;
            const host = input.closest("oj-select-single,oj-combobox-one,oj-combobox-many");
            const trigger = host?.querySelector(".oj-searchselect-arrow,.oj-searchselect-main-field,.oj-text-field-container,[role=combobox]") || input;
            click(trigger);
            await sleep(80);
            const filter = document.getElementById("oj-searchselect-filter-data-object-selection-dropdown|input") || input;
            setValue(filter, payloadName);
            const deadline = Date.now() + 1200;
            let option = null;
            while (Date.now() < deadline && !option) {
              option = [...document.querySelectorAll("[role='option'],oj-option,li.oj-listbox-result-selectable")].find((element) => {
                const label = text(element);
                return visible(element) && (label === payloadName || label.includes(payloadName) || element.getAttribute("value") === payloadName);
              });
              if (!option) await sleep(60);
            }
            if (!option) throw new Error(`Export payload option ${payloadName} was not found.`);
            click(option.closest("[role='option'],oj-option,li") || option);
          } finally {
            await sleep(100);
            window.__cdpApplyingExportPayload = false;
          }
        };
        document.addEventListener("click", (event) => {
          const option = event.target instanceof Element && event.target.closest("[role='option'],oj-option,li");
          if (!option || window.__cdpExportPayloadName === "Customer" || window.__cdpApplyingExportPayload) return;
          if (!document.getElementById("data-object-selection-dropdown|input")) return;
          setTimeout(() => chooseConfiguredPayload().catch(() => undefined), 0);
        }, true);
      }
    });
  }

  if (task.dependencies?.length) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: task.dependencies
    });
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [task.script || filename]
  });
}

// Every job entry point builds one of these requests. The page scripts remain
// provider-specific, while scheduling, save confirmation and flow handoff live
// in these two runners only.
function normalizeJobRunRequest(request = {}) {
  const kind = request.kind === "export" ? "export" : "import";
  const variant = kind === "import" && request.variant === "responsys" ? "responsys" : "generic";
  if (!request.runId) throw new Error("A job run requires a run ID.");
  if (!request.template) throw new Error("A job run requires a transfer template.");
  if (kind === "export" && !String(request.payloadName || "").trim()) throw new Error("Select an Export payload.");
  if (kind === "import" && variant === "generic" && (!Array.isArray(request.tableIds) || !request.tableIds.length)) throw new Error("Select at least one Import table.");
  return {
    origin: request.origin || "independent",
    kind,
    variant,
    runId: request.runId,
    template: request.template,
    connectionSequence: request.connectionSequence,
    connection: request.connection,
    schedule: kind === "export"
      ? normalizeNewSchedulerConfig(request.schedule, "export")
      : normalizeNewSchedulerConfig(request.schedule, "import"),
    filterRecords: kind === "export" ? normalizeExportFilter(request.filterRecords || request.filter) : "UPDATED",
    payloadType: kind === "export" ? normalizeExportPayloadType(request.payloadType) : "data-object",
    payloadName: request.payloadName || "Customer",
    tableIds: Array.isArray(request.tableIds) ? [...request.tableIds] : [],
    jobName: request.jobName || "",
    description: request.description || "",
    notification: request.notification || "",
    monitor: request.monitor || null,
    runMetadata: request.runMetadata || null,
    allowImportFallback: Boolean(request.allowImportFallback)
  };
}

function buildJobRuntimeConfig(request) {
  const isExport = request.kind === "export";
  const connection = request.connection;
  const operation = isExport ? "Export" : "Import";
  return isExport ? {
    name: request.jobName || transferJobName(request.template, connection, operation, request.connectionSequence),
    description: request.description || request.template.description || `${request.template.name} export`,
    destinationName: connection.name,
    fileName: "",
    compression: request.template.fileContract?.compression || "none",
    fileContract: request.template.fileContract || {},
    filterRecords: request.filterRecords,
    payloadType: request.payloadType,
    notification: request.notification || ""
  } : {
    name: request.jobName || transferJobName(request.template, connection, operation, request.connectionSequence),
    description: request.description || request.template.description || `${request.template.name} import`,
    sourceName: connection.name,
    sourceObjectName: "",
    notification: request.notification || "",
    filePattern: request.template.fileContract?.filePattern || "",
    fileContract: request.template.fileContract || {}
  };
}

async function runImportJobRequest(tabId, rawRequest) {
  const request = normalizeJobRunRequest({ ...rawRequest, kind: "import" });
  const filename = request.variant === "responsys" ? "importJob.js" : "importContacts.js";
  const task = TASKS[filename];
  let importConfig;
  if (request.variant === "generic") {
    try {
      importConfig = await buildImportConfig(request.tableIds, request.template.fileContract?.delimiter);
    } catch (error) {
      if (!request.allowImportFallback) throw error;
      console.warn("Could not load editable Import CSV files; using bundled fallback.", error);
      importConfig = importFallbackConfig(request.template.fileContract?.delimiter);
    }
  }
  const jobConfig = buildJobRuntimeConfig(request);
  await appendRunLog(`Import runner: ${request.variant} · ${request.tableIds.join(", ") || "Responsys Profile"}.`, "info", "Import", "Configure");
  await appendRunLog(`Job name = ${jobConfig.name}; Source = ${jobConfig.sourceName || "—"}.`, "info", "Import", "Plan");
  if (request.variant === "generic") {
    const headerCount = String(importConfig?.csvContent || "").split(/\r?\n/, 1)[0].split(",").filter(Boolean).length;
    await appendRunLog(`Tables = ${request.tableIds.join(", ")}; generated mapping CSV = ${headerCount} fields.`, "info", "Import", "Map");
  }
  await appendRunLog(`File contract = ${jobConfig.fileContract?.fileFormat || "CSV"} · ${jobConfig.fileContract?.charset || "UTF-8"} · ${jobConfig.fileContract?.csvParser || "RFC 4180"} · ${jobConfig.fileContract?.delimiter || "Comma"}.`, "info", "Import", "Configure");
  await appendRunLog(`Import scheduler: ${request.schedule.schedulerUi === "new" ? `New · ${request.schedule.frequency} · ${request.schedule.timeMode}` : `Legacy · ${request.schedule.mode} · ${request.schedule.frequency}`}.`, "info", "Scheduler · Import", "Configure");
  await appendRunLog("Opening Create Ingest Job.", "info", "Import", "Navigate");
  await runTask(tabId, filename, request.monitor, request.schedule, importConfig, undefined, request.tableIds, undefined, jobConfig);
  await waitForStep(tabId, request.variant === "responsys" ? "Responsys Import" : "Import Job", task.saveSelector, request.runId, request.monitor?.stepId || filename);
  const saved = request.runMetadata ? await captureCreatedEntity(tabId, request.runMetadata, filename) : null;
  return { request: { ...request, jobName: jobConfig.name }, saved };
}

async function runExportJobRequest(tabId, rawRequest) {
  const request = normalizeJobRunRequest({ ...rawRequest, kind: "export" });
  const task = TASKS["exportJob.js"];
  const catalog = await loadTableCatalog();
  if (!catalog.exportPayloads.includes(request.payloadName)) throw new Error(`Unsupported export payload: ${request.payloadName}.`);
  const jobConfig = buildJobRuntimeConfig(request);
  await appendRunLog(`Export runner: ${request.payloadName}.`, "info", "Export", "Configure");
  await appendRunLog(`Job name = ${jobConfig.name}; Destination = ${jobConfig.destinationName || "—"}.`, "info", "Export", "Plan");
  await appendRunLog(`Payload = ${request.payloadName}; type = ${request.payloadType}; records = ${request.filterRecords}.`, "info", "Export", "Select");
  await appendRunLog(`File contract = ${jobConfig.fileContract?.fileFormat || "CSV"} · compression = ${jobConfig.compression || "none"}.`, "info", "Export", "Configure");
  await appendRunLog(`Export scheduler: ${request.schedule.schedulerUi === "new" ? `New · ${request.schedule.frequency} · ${request.schedule.timeMode}` : `Legacy · ${request.schedule.mode} · ${request.schedule.frequency}`}.`, "info", "Scheduler · Export", "Configure");
  await appendRunLog("Opening Create Export Job.", "info", "Export", "Navigate");
  await runTask(tabId, "exportJob.js", request.monitor, request.schedule, undefined, request.payloadName, undefined, undefined, jobConfig);
  await waitForStep(tabId, "Export Job", task.saveSelector, request.runId, request.monitor?.stepId || "exportJob.js");
  const saved = request.runMetadata ? await captureCreatedEntity(tabId, request.runMetadata, "exportJob.js") : null;
  return { request: { ...request, jobName: jobConfig.name }, saved };
}

async function saveRunSnapshot(snapshot) {
  const { runSnapshots = [] } = await chrome.storage.local.get({ runSnapshots: [] });
  const next = [snapshot, ...runSnapshots.filter((item) => item?.runId !== snapshot.runId)].slice(0, 5);
  await chrome.storage.local.set({ runSnapshots: next });
}

function assertSequenceActive(tabId, runId, label) {
  const activeSequence = activeSequences.get(tabId);
  if (!activeSequence || activeSequence.runId !== runId || activeSequence.cancelled) {
    throw new Error(`${label} was stopped by the user.`);
  }
}

async function runPublish(tabId, options) {
  const task = TASKS["publish.js"];
  assertSequenceActive(tabId, options.runId, options.label || "Publishing");
  const tab = await chrome.tabs.get(tabId);
  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  assertSequenceActive(tabId, options.runId, options.label || "Publishing");
  const cancelled = activeSequences.get(tabId)?.cancelled === true;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [cancelled],
    func: (isCancelled) => {
      window.__cdpPublishCancelled = isCancelled;
    }
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["publish.js"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [options],
    func: async (publishOptions) => {
      if (typeof window.runCdpPublish !== "function") {
        throw new Error("Publish automation did not load.");
      }
      return window.runCdpPublish(publishOptions);
    }
  });
}

async function verifyPublishedJobs(tabId, options) {
  const task = TASKS["integrationStatus.js"];
  assertSequenceActive(tabId, options.runId, "Verify Published Jobs");
  const tab = await chrome.tabs.get(tabId);
  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  assertSequenceActive(tabId, options.runId, "Verify Published Jobs");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["integrationStatus.js"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [options.jobNames],
    func: async (jobNames) => {
      if (typeof window.runCdpIntegrationStatusCheck !== "function") {
        throw new Error("Integration status automation did not load.");
      }
      return window.runCdpIntegrationStatusCheck({ jobNames });
    }
  });
}

async function runDataViewerStep(tabId, flow, runId) {
  const recordsPerTable = flow.recordsPerTable ?? 1;
  if (!Number.isSafeInteger(recordsPerTable) || recordsPerTable < 1) throw new Error("Records per table must be a positive whole number.");
  const sourceId = String(flow.sourceId || "").trim() || "UI";
  const [catalog, recordConfig] = await Promise.all([loadTableCatalog(), loadDataViewerRecordConfig()]);
  const tableIds = [...new Set(flow.dataViewerTableIds || ["Customer"])];
  const inheritCustomerValues = tableIds.includes("Customer") && tableIds.includes("ContactPoint");
  const tables = tableIds.map((tableName) => catalog.dataViewerTables.includes(tableName)
    ? { id: tableName, label: tableName, cdpTable: tableName, recordConfig: dataViewerRecordConfigFor(tableName, recordConfig, flow.dataViewerOverrides, inheritCustomerValues) }
    : null);
  if (!tables.length || tables.some((table) => !table)) throw new Error("Select valid Data Viewer tables.");
  const tab = await chrome.tabs.get(tabId);
  await navigateAndWait(tabId, navigationUrl(tab.url, TASKS["dataViewer.js"].path, TASKS["dataViewer.js"].root));
  await activatePageAutomationRun(tabId, runId);
  await waitForPageElement(tabId, TASKS["dataViewer.js"].readySelector, 60000);
  await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: ["dataViewerClickBridge.js"] });
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["dataViewer.js"] });
  const [{ result: dataViewerResult }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    args: [tables, { recordsPerTable, sourceId, saveRecords: Boolean(flow.saveRecords) }],
    func: async (dataViewerTables, options) => {
      if (typeof window.runCdpDataViewer !== "function") throw new Error("Data Viewer automation did not load.");
      return window.runCdpDataViewer({ tables: dataViewerTables, ...options });
    }
  });
  await appendDataViewerRunLog(dataViewerResult, tables, { recordsPerTable, sourceId, saveRecords: Boolean(flow.saveRecords) });
}

const DATA_MODEL_GROUPS = ["Profile", "Behavioral", "Transactional", "Product", "Other"];
const DATA_MODEL_ATTRIBUTE_TYPES = new Set(["string", "int", "bigint", "decimal", "date", "timestamp", "boolean"]);

function dataModelDryRunName(group, purpose = "") {
  // This is never saved. Keep the visible name aligned with jobs/connections
  // so the drawer is easy to identify while a test is running.
  const cleanPurpose = String(purpose || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  return [group, cleanPurpose, dateTagForName()].filter(Boolean).join("_").slice(0, 50);
}

function normalizedDataModelColumnName(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function validateDataModelColumns(columns, group) {
  if (!Array.isArray(columns) || !columns.length) throw new Error(`${group} requires at least one configured column.`);
  const usedNames = new Set();
  return columns.map((column, index) => {
    const name = String(column?.name || "").trim();
    const dataType = String(column?.dataType || "string").trim().toLowerCase();
    if (!name || name.length > 50) throw new Error(`${group} column ${index + 1} must have a name of 1–50 characters.`);
    if (!/^[a-z][a-z0-9 ]*$/i.test(name)) throw new Error(`${group} column ${name} has unsupported characters.`);
    if (!DATA_MODEL_ATTRIBUTE_TYPES.has(dataType)) throw new Error(`${group} column ${name} uses unsupported data type ${dataType}.`);
    const key = normalizedDataModelColumnName(name);
    if (!key || usedNames.has(key)) throw new Error(`${group} has duplicate column ${name}.`);
    usedNames.add(key);
    return { name, dataType };
  });
}

async function dataModelColumnsForGroup(group, columnOverrides = {}) {
  const config = await loadDataModelColumnConfig();
  const defaults = config.groups[group];
  if (!Array.isArray(defaults)) throw new Error(`No default columns are configured for ${group}.`);
  // The popup sends the complete, reviewed list for a group. This lets users
  // edit or remove JSON defaults without the runner silently adding them back.
  const configured = Array.isArray(columnOverrides?.[group]) ? columnOverrides[group] : defaults;
  return validateDataModelColumns(configured, group);
}

async function runDataModelStep(tabId, runId, { purpose = "", groups = DATA_MODEL_GROUPS, saveObjects = false, attributeGroups = [], addAttributes = false, columnOverrides = {}, parentByGroup = {} } = {}) {
  const tab = await chrome.tabs.get(tabId);
  const task = TASKS["dataModel.js"];
  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  await activatePageAutomationRun(tabId, runId);
  await waitForPageElement(tabId, task.readySelector, 60000);
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["dataModel.js"] });

  const selectedGroups = [...new Set(groups)].filter((group) => DATA_MODEL_GROUPS.includes(group));
  if (!selectedGroups.length) throw new Error("Select at least one Data Model object group.");
  const createdObjects = {};
  for (const group of selectedGroups) {
    assertSequenceActive(tabId, runId, "Data Model dry run");
    await appendRunLog(`${group}: opening Create data object.`, "info", `Data Model · ${group}`, "Click");
    let saved = false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [group],
        func: async (selectedGroup) => window.cdpDataModelOpenGroup(selectedGroup)
      });
      const name = dataModelDryRunName(group, purpose);
      const generated = await commitJetDataModelObjectName(tabId, name);
      if (generated.skipped) {
        await appendRunLog(`Skipped: ${generated.name}. ${generated.reason}`, "warn", `Data Model · ${group}`, "Skip");
        continue;
      }
      await appendRunLog(`Object name = ${generated.name}; Object ID = ${generated.objectId}.`, "info", `Data Model · ${group}`, "Type");
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [group],
        func: async (selectedGroup) => window.cdpDataModelValidateAndAdvance(selectedGroup)
      });
      await appendRunLog(`Object group = ${result.group}; settings page opened.`, "info", `Data Model · ${group}`, "Validate");
      if (saveObjects) {
        const [{ result: prepared }] = await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelPrepareForSave()
        });
        await appendRunLog(`Expected number of records = ${prepared.expectedRecords} million; Save enabled.`, "info", `Data Model · ${group}`, "Click");
        await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelSave()
        });
        saved = true;
        createdObjects[group] = generated.name;
        await appendRunLog("Object saved successfully.", "info", `Data Model · ${group}`, "Save");
      }
    } finally {
      if (!saved) {
        await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelCancel?.()
        }).catch(() => undefined);
      }
    }
  }
  const configuredAttributeGroups = new Set((attributeGroups.length ? attributeGroups : (addAttributes ? selectedGroups : [])).filter((group) => DATA_MODEL_GROUPS.includes(group)));
  if (saveObjects && configuredAttributeGroups.size) {
    for (const [group, objectName] of Object.entries(createdObjects)) {
      if (!configuredAttributeGroups.has(group)) continue;
      assertSequenceActive(tabId, runId, "Data Model attribute creation");
      await appendRunLog(`Adding configured ${group} attributes to ${objectName}.`, "info", `Data Model · ${group}`, "Attributes");
      await runDataModelAttributesStep(tabId, runId, { group, objectName, columnOverrides });
    }
  }
  if (saveObjects) {
    for (const [group, objectName] of Object.entries(createdObjects)) {
      const parentName = String(parentByGroup?.[group] || "").trim();
      if (!parentName) continue;
      if (parentName.toLowerCase() === objectName.toLowerCase()) {
        throw new Error(`${group} cannot be its own parent object.`);
      }
      assertSequenceActive(tabId, runId, "Data Model relationship creation");
      await appendRunLog(`Creating relationship: ${objectName} → ${parentName}.`, "info", `Relationship · ${group}`, "Plan");
      const [{ result: relationshipResult }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [objectName, parentName],
        func: async (childObjectName, relationshipParentName) => window.cdpDataModelCreateRelationship(childObjectName, relationshipParentName)
      });
      if (!relationshipResult?.saved || !relationshipResult?.verified) {
        throw new Error(`CDP did not verify the relationship ${objectName} → ${parentName}.`);
      }
      await appendRunLog(`Relationship verified: ${objectName} → ${parentName}.`, "info", `Relationship · ${group}`, "Save");
    }
  }
  await appendRunLog(saveObjects ? "Selected Data Model objects were saved." : "Selected Data Model groups validated without saving objects.");
  return { createdObjects };
}

async function runDataModel(tabId, { purpose = "", groups = DATA_MODEL_GROUPS, saveObjects = false, attributeGroups = [], addAttributes = false, columnOverrides = {}, parentByGroup = {} } = {}) {
  if (activeSequences.has(tabId)) throw new Error("An automation flow is already running in this tab.");
  const runId = crypto.randomUUID();
  let failed = false;
  let failureDetail = "";
  const runLabel = saveObjects ? "Create Data Model Objects" : "Data Model Dry Run";
  activeSequences.set(tabId, { runId, cancelled: false, status: `Running: ${runLabel}` });
  await setE2EStatus(`Running: ${runLabel}`, tabId);
  try {
    await runDataModelStep(tabId, runId, { purpose, groups, saveObjects, attributeGroups, addAttributes, columnOverrides, parentByGroup });
  } catch (error) {
    failed = true;
    failureDetail = error.message || String(error);
    if (!/stopped by the user/i.test(error.message || "")) await setE2EStatus(`Failed: ${runLabel} — ${error.message || error}`, tabId);
    throw error;
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (!failed) await setE2EStatus("", tabId);
    if (failed) await finalizeRunHistory("failed", failureDetail);
    else if (cancelled) await finalizeRunHistory("stopped");
    else await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

async function runDataModelAttributesStep(tabId, runId, { group, objectName, columnOverrides = {} } = {}) {
  if (!DATA_MODEL_GROUPS.includes(group)) throw new Error("Select a valid Data Model object group.");
  const targetObjectName = String(objectName || "").trim();
  if (!targetObjectName) throw new Error("Enter the existing Data Model object name.");
  const columns = await dataModelColumnsForGroup(group, columnOverrides);
  const tab = await chrome.tabs.get(tabId);
  const task = TASKS["dataModel.js"];
  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  await activatePageAutomationRun(tabId, runId);
  await waitForPageElement(tabId, task.readySelector, 60000);
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["dataModel.js"] });
  const [{ result: objectSearch }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [group],
    func: async (selectedGroup) => window.cdpDataModelPrepareObjectSearch(selectedGroup)
  });
  await typeJetInput(tabId, objectSearch?.inputId || "search-input-text|input", targetObjectName,
    "Data Model object search", "Enter");
  await appendRunLog(`Target object = ${targetObjectName}; ${columns.length} attributes configured.`, "info", `Attributes · ${group}`, "Plan");
  for (const column of columns) {
    assertSequenceActive(tabId, runId, "Data Model attribute creation");
    let attributeSaved = false;
    let attributeDrawerOpened = false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [group, targetObjectName],
        func: async (selectedGroup, selectedObjectName) => window.cdpDataModelOpenAttribute(selectedGroup, selectedObjectName, true)
      });
      attributeDrawerOpened = true;
      const attribute = await commitJetDataModelAttributeName(tabId, column.name);
      if (attribute.skipped) {
        await appendRunLog(
          `Skipped: an attribute named ${column.name} already exists or CDP rejected the duplicate name.`,
          "warn",
          `Attributes · ${targetObjectName} · ${column.name}`,
          "Skip"
        );
        await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelCancelAttribute?.()
        });
        attributeSaved = true; // drawer is intentionally closed; continue to the next configured attribute.
        continue;
      }
      await appendRunLog(`${column.name}: Attribute ID = ${attribute.attributeId}.`, "info", `Attributes · ${targetObjectName} · ${column.name}`, "Type");
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [column.dataType],
        func: async (dataType) => window.cdpDataModelSelectAttributeDataType(dataType)
      });
      await appendRunLog(`Data type = ${column.dataType}.`, "info", `Attributes · ${targetObjectName} · ${column.name}`, "Select");
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: async () => window.cdpDataModelSaveAttribute()
      });
      attributeSaved = true;
      await appendRunLog("Attribute saved successfully.", "info", `Attributes · ${targetObjectName} · ${column.name}`, "Save");
    } finally {
      // Leave a failed attribute drawer open so its CDP validation message is
      // visible to the user. Closing it used to make a validation timeout look
      // like an ordinary successful completion and obscured the root cause.
      if (!attributeSaved && !attributeDrawerOpened) {
        await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelCancelAttribute?.()
        }).catch(() => undefined);
      }
    }
  }
  await appendRunLog(`Attributes saved for ${targetObjectName}.`, "info", `Attributes · ${group}`, "Complete");
}

async function runDataModelAttributes(tabId, options = {}) {
  if (activeSequences.has(tabId)) throw new Error("An automation flow is already running in this tab.");
  const runId = crypto.randomUUID();
  let failed = false;
  let failureDetail = "";
  activeSequences.set(tabId, { runId, cancelled: false, status: "Running: Add New Attributes" });
  await setE2EStatus("Running: Add New Attributes", tabId);
  try {
    await runDataModelAttributesStep(tabId, runId, options);
  } catch (error) {
    failed = true;
    failureDetail = error.message || String(error);
    if (!/stopped by the user/i.test(error.message || "")) await setE2EStatus(`Failed: Add New Attributes — ${error.message || error}`, tabId);
    throw error;
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (!failed) await setE2EStatus("", tabId);
    if (failed) await finalizeRunHistory("failed", failureDetail);
    else if (cancelled) await finalizeRunHistory("stopped");
    else await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

async function runConfiguredFlow(tabId, flow = {}) {
  if (activeSequences.has(tabId)) throw new Error("An E2E flow is already running in this tab.");
  const selectedSteps = new Set(flow.steps || ["dataViewer", "source", "destination", "export", "import", "publish", "verify"]);
  const usesTransfer = [...selectedSteps].some((step) => ["source", "destination", "export", "import"].includes(step));
  const selectedTemplate = usesTransfer ? await selectedTransferTemplate(flow.templateId) : null;
  const template = selectedTemplate ? { ...selectedTemplate, connectionPurpose: flow.connectionPurpose || "" } : null;
  const connectionSequence = template ? await nextConnectionSequence(template.id) : 0;
  const sourceConfig = template ? connectionRuntime(template, "source", connectionSequence) : null;
  const destinationConfig = template ? connectionRuntime(template, "destination", connectionSequence) : null;
  // A job always owns its prerequisite connection, even when the user did not
  // select the connection card explicitly in a custom flow.
  if (selectedSteps.has("import")) selectedSteps.add("source");
  if (selectedSteps.has("export")) selectedSteps.add("destination");
  const stepDefinitions = [
    { id: "dataModel", label: "Data Models" },
    { id: "dataModelAttributes", label: "Add New Attributes" },
    { id: "dataViewer", label: "Data Viewer" },
    { id: "source", filename: "source.js", label: "Create Source", saveSelector: "#create-source-saveClose" },
    { id: "destination", filename: "destination.js", label: "Create Destination", saveSelector: "#dst-saveClose-btn" },
    { id: "export", filename: "exportJob.js", label: "Create Export Job", saveSelector: "#saveNclose-create-job" },
    { id: "import", filename: "importContacts.js", label: "Create Import Job", saveSelector: "#saveNclose-create-job" }
  ].filter((step) => selectedSteps.has(step.id));
  const selectedJobSteps = stepDefinitions.filter((step) => step.id === "export" || step.id === "import");
  if (!stepDefinitions.length && !selectedSteps.has("publish") && !selectedSteps.has("verify")) {
    throw new Error("Select at least one flow step.");
  }
  if (selectedSteps.has("import") && !(flow.importTableIds || ["customer", "contactPoint"]).length) {
    throw new Error("Select at least one import table.");
  }

  const runId = crypto.randomUUID();
  const runMetadata = {
    startedAt: Date.now(),
    exportScheduledAt: null,
    jobNames: [],
    creations: {
      sources: [],
      destinations: [],
      jobs: {
        export: null,
        import: null
      }
    }
  };
  const useLegacyStagger = Boolean(flow.staggerJobs && flow.exportSchedule?.schedulerUi === "legacy" && flow.importSchedule?.schedulerUi === "legacy");
  sequenceStepState.set(runId, new Set());
  activeSequences.set(tabId, { runId, cancelled: false });
  await chrome.storage.local.set({ e2eRun: runMetadata });
  const runSnapshot = {
    runId,
    startedAt: runMetadata.startedAt,
    origin: flow.origin || "custom-flow",
    template: template ? { id: template.id, name: template.name, sourceType: template.sourceType, destinationType: template.destinationType, fileContract: template.fileContract || {} } : null,
    purpose: flow.connectionPurpose || "",
    steps: [...selectedSteps],
    connections: {},
    jobs: []
  };
  await saveRunSnapshot(runSnapshot);
  await chrome.storage.local.set({ activeRunSnapshotId: runId });
  let completed = false;
  let failure;
  const createdDataModelObjects = {};
  try {
    for (const step of stepDefinitions) {
      await setE2EStatus(`Running: ${step.label}`, tabId);
      if (step.id === "dataModel") {
        const result = await runDataModelStep(tabId, runId, { purpose: flow.connectionPurpose || "", groups: flow.dataModelGroups, saveObjects: Boolean(flow.saveDataModelObjects), attributeGroups: flow.dataModelAttributeGroups || [], addAttributes: Boolean(flow.addDataModelAttributes), columnOverrides: flow.dataModelColumnOverrides || {}, parentByGroup: flow.dataModelParents || {} });
        Object.assign(createdDataModelObjects, result.createdObjects || {});
        continue;
      }
      if (step.id === "dataModelAttributes") {
        await runDataModelAttributesStep(tabId, runId, { group: flow.dataModelAttributeGroup, objectName: flow.dataModelAttributeObjectName || createdDataModelObjects[flow.dataModelAttributeGroup], columnOverrides: flow.dataModelColumnOverrides || {} });
        continue;
      }
      if (step.id === "dataViewer") {
        await runDataViewerStep(tabId, flow, runId);
        continue;
      }
      if (step.id === "export" && useLegacyStagger && !runMetadata.exportScheduledAt) {
        const exportHour = new Date();
        exportHour.setHours(exportHour.getHours() + 1, 0, 0, 0);
        runMetadata.exportScheduledAt = exportHour.getTime();
      }
      const schedule = step.id === "export"
        ? (useLegacyStagger ? { ...flow.exportSchedule, scheduledAt: runMetadata.exportScheduledAt } : normalizeNewSchedulerConfig(flow.exportSchedule, "export"))
        : step.id === "import"
          ? (useLegacyStagger ? { ...flow.importSchedule, scheduledAt: runMetadata.exportScheduledAt + 3600000 } : normalizeNewSchedulerConfig(flow.importSchedule, "import"))
          : undefined;
      if (step.id === "export" || step.id === "import") {
        await appendRunLog(`${step.label} scheduler: ${schedule.schedulerUi === "new" ? `New · ${schedule.frequency} · ${schedule.timeMode} · ${schedule.specificPreset || schedule.intervalStartPreset}` : `Legacy · ${schedule.mode} · ${schedule.frequency}`}.`, "info", `Scheduler · ${step.label}`, "Configure");
      }
      if (step.id === "export" || step.id === "import") {
        const monitor = { runId, stepId: step.filename, saveSelector: step.saveSelector };
        const result = step.id === "export"
          ? await runExportJobRequest(tabId, {
            origin: flow.origin || "custom-flow",
            runId,
            template,
            connectionSequence,
            connection: destinationConfig,
            schedule,
            filterRecords: flow.exportFilterRecords,
            payloadType: flow.exportPayloadType,
            payloadName: flow.exportPayloadName || "Customer",
            jobName: flow.exportJobName,
            description: flow.exportDescription,
            notification: flow.notification,
            monitor,
            runMetadata
          })
          : await runImportJobRequest(tabId, {
            origin: flow.origin || "custom-flow",
            runId,
            template,
            connectionSequence,
            connection: sourceConfig,
            schedule,
            variant: flow.importVariant || "generic",
            tableIds: flow.importTableIds || ["customer", "contactPoint"],
            jobName: flow.importJobName,
            description: flow.importDescription,
            notification: flow.notification,
            monitor,
            runMetadata,
            allowImportFallback: flow.allowImportFallback
          });
        runSnapshot.jobs.push({
          kind: step.id,
          variant: result.request.variant || "generic",
          name: result.saved?.name || result.request.jobName,
          connectionName: result.request.connection?.name || "",
          payloadName: result.request.payloadName || "",
          tableIds: result.request.tableIds || [],
          scheduler: result.request.schedule
        });
        await saveRunSnapshot({ ...runSnapshot, jobs: [...runSnapshot.jobs] });
        continue;
      }
      const connectionConfig = step.id === "source" ? sourceConfig : step.id === "destination" ? destinationConfig : undefined;
      await runTask(tabId, step.filename, {
        runId,
        stepId: step.filename,
        saveSelector: step.saveSelector
      }, undefined, undefined, undefined, undefined, connectionConfig);
      await waitForStep(tabId, step.label, step.saveSelector, runId, step.filename);
      if (step.id === "source" || step.id === "destination") {
        await rememberConnectionSequence(template.id, connectionSequence);
      }
      const savedEntity = await captureCreatedEntity(tabId, runMetadata, step.filename);
      // The connection form may have added a suffix only after CDP rejected a
      // duplicate name. Carry that actual saved name into the later job's
      // source/destination selector.
      if (step.id === "source" && savedEntity?.name) sourceConfig.name = savedEntity.name;
      if (step.id === "destination" && savedEntity?.name) destinationConfig.name = savedEntity.name;
      if (step.id === "source" || step.id === "destination") {
        runSnapshot.connections[step.id] = savedEntity?.name || connectionConfig?.name || "";
        await saveRunSnapshot({ ...runSnapshot, connections: { ...runSnapshot.connections } });
      }
    }
    if (selectedSteps.has("publish")) {
      if (!selectedJobSteps.length || !runMetadata.jobNames.length) throw new Error("Publish requires an Export or Import job in the flow.");
      if (activeSequences.get(tabId)?.cancelled) throw new Error("Publishing was stopped by the user.");
      await setE2EStatus("Running: Publish Created Jobs", tabId);
      await runPublish(tabId, { mode: "e2e", ...runMetadata, runId, label: "Publish Created Jobs" });
    }
    if (selectedSteps.has("verify")) {
      if (!selectedSteps.has("publish")) throw new Error("Verify Published requires Publish to be selected.");
      await setE2EStatus("Running: Verify Published Jobs", tabId);
      await verifyPublishedJobs(tabId, { jobNames: runMetadata.jobNames, runId });
    }
    completed = true;
  } catch (error) {
    failure = error;
    console.error("CDP flow failed", error);
    await setE2EStatus(`Failed: ${error.message || error}`, tabId);
    throw error;
  } finally {
    sequenceStepState.delete(runId);
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (completed || cancelled) {
      await setE2EStatus("", tabId);
      await chrome.storage.local.remove("e2eRun");
    }
    if (failure) await finalizeRunHistory("failed", failure.message || String(failure));
    else if (cancelled) await finalizeRunHistory("stopped");
    else if (completed) await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

async function runFullSequence(tabId, templateId, connectionPurpose) {
  return runConfiguredFlow(tabId, {
    origin: "sanity",
    templateId,
    connectionPurpose,
    steps: ["dataModel", "dataViewer", "source", "destination", "export", "import", "publish", "verify"],
    dataModelGroups: ["Profile"],
    dataModelAttributeGroups: ["Profile"],
    saveDataModelObjects: true,
    dataViewerTableIds: ["Customer", "ContactPoint"],
    recordsPerTable: 1,
    sourceId: "UI",
    saveRecords: true,
    importTableIds: ["customer", "contactPoint"],
    exportPayloadName: "Customer",
    exportSchedule: { schedulerUi: "new", frequency: "Daily", timeMode: "specific", specificPreset: "in15" },
    importSchedule: { schedulerUi: "new", frequency: "Daily", timeMode: "specific", specificPreset: "in30" },
    staggerJobs: true,
    allowImportFallback: true
  });
}

async function runPublishAll(tabId) {
  if (activeSequences.has(tabId)) throw new Error("An E2E flow is already running in this tab.");
  const runId = crypto.randomUUID();
  activeSequences.set(tabId, { runId, cancelled: false });
  await setE2EStatus("Running: Publish All Data Feeds", tabId);
  let completed = false;
  let failure;
  try {
    await runPublish(tabId, { mode: "all", runId, label: "Publish All Data Feeds" });
    completed = true;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    await setE2EStatus("", tabId);
    if (failure) await finalizeRunHistory("failed", failure.message || String(failure));
    else if (cancelled) await finalizeRunHistory("stopped");
    else if (completed) await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

function dataViewerRecordConfigFor(tableName, defaults, overrides, inheritCustomerValues = false) {
  const base = defaults.tables?.[tableName] || {};
  const override = overrides && typeof overrides === "object" ? overrides[tableName] : null;
  const customerOverrideValues = { ...(overrides?.Customer?.values || {}) };
  const customerValues = inheritCustomerValues && tableName === "ContactPoint"
    ? { ...(defaults.tables?.Customer?.values || {}), ...customerOverrideValues }
    : {};
  const contactPointValues = { ...(override?.values || {}) };
  const inheritedCustomerEmail = customerValues.Email;
  if (inheritCustomerValues && tableName === "ContactPoint" && inheritedCustomerEmail) {
    // A Customer + ContactPoint run represents one related person. Reuse the
    // corresponding primary Customer Email for ContactPoint, including lists.
    contactPointValues.Email = inheritedCustomerEmail;
  }
  return {
    ...base,
    values: { ...(base.values || {}), ...customerValues, ...contactPointValues, ...(tableName === "Customer" ? customerOverrideValues : {}) },
    relationships: { ...(base.relationships || {}), ...(override?.relationships || {}) }
  };
}

async function runDataViewer(tabId, tableIds, { recordsPerTable = 1, sourceId = "UI", parentSourceCustomerId = "", saveRecords = false, dataViewerOverrides = {} } = {}) {
  if (activeSequences.has(tabId)) throw new Error("An automation flow is already running in this tab.");
  if (!Number.isSafeInteger(recordsPerTable) || recordsPerTable < 1) throw new Error("Records per table must be a positive whole number.");
  const resolvedSourceId = String(sourceId || "").trim() || "UI";
  const [catalog, recordConfig] = await Promise.all([loadTableCatalog(), loadDataViewerRecordConfig()]);
  const selectedTableIds = [...new Set(tableIds || [])];
  const inheritCustomerValues = selectedTableIds.includes("Customer") && selectedTableIds.includes("ContactPoint");
  const tables = selectedTableIds.map((tableName) => catalog.dataViewerTables.includes(tableName)
    ? { id: tableName, label: tableName, cdpTable: tableName, recordConfig: dataViewerRecordConfigFor(tableName, recordConfig, dataViewerOverrides, inheritCustomerValues) }
    : null);
  if (!tables.length || tables.some((table) => !table)) throw new Error("Select valid tables from config/tables.json.");
  const runId = crypto.randomUUID();
  let failed = false;
  activeSequences.set(tabId, { runId, cancelled: false, status: "Running: Data Viewer Record" });
  await setE2EStatus("Running: Data Viewer Record", tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    await navigateAndWait(tabId, navigationUrl(tab.url, TASKS["dataViewer.js"].path, TASKS["dataViewer.js"].root));
    await activatePageAutomationRun(tabId, runId);
    await waitForPageElement(tabId, TASKS["dataViewer.js"].readySelector, 60000);
    await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: ["dataViewerClickBridge.js"] });
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["dataViewer.js"] });
    const [{ result: dataViewerResult }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [tables.map((table) => ({ id: table.id, label: table.label, cdpTable: table.cdpTable, recordConfig: table.recordConfig })), { recordsPerTable, sourceId: resolvedSourceId, parentSourceCustomerId: String(parentSourceCustomerId || "").trim(), saveRecords: Boolean(saveRecords) }],
      func: async (dataViewerTables, options) => {
        if (typeof window.runCdpDataViewer !== "function") throw new Error("Data Viewer automation did not load.");
        return window.runCdpDataViewer({ tables: dataViewerTables, ...options });
      }
    });
    await appendDataViewerRunLog(dataViewerResult, tables, { recordsPerTable, sourceId: resolvedSourceId, saveRecords: Boolean(saveRecords) });
  } catch (error) {
    failed = true;
    if (!/stopped by the user/i.test(error.message || "")) await setE2EStatus(`Failed: Data Viewer Record — ${error.message || error}`, tabId);
    throw error;
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (!failed) await setE2EStatus("", tabId);
    if (failed) await finalizeRunHistory("failed");
    else if (cancelled) await finalizeRunHistory("stopped");
    else await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "connection-profile-list") {
    cdpReadConnectionProfiles().then((profiles) => sendResponse({ profiles }));
    return true;
  }
  if (message?.type === "connection-profile-save") {
    cdpWriteConnectionProfiles(message.profiles || []).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type === "template-list-private") {
    cdpReadTemplates().then((vault) => sendResponse({ locked: vault.locked, templates: vault.templates }));
    return true;
  }
  if (message?.type === "template-list") {
    cdpReadTemplates().then((vault) => sendResponse({ locked: vault.locked, templates: vault.templates.map(cdpTemplateSummary) }));
    return true;
  }
  if (message?.type === "template-save") {
    cdpWriteTemplates(message.templates || []).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  return undefined;
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "sequence-step-saved") return;
  const state = sequenceStepState.get(message.runId);
  if (state) state.add(message.stepId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "apply-new-scheduler") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "New scheduler could not determine the CDP tab." });
      return undefined;
    }
    applyTrustedNewScheduler(tabId, message.schedule || {})
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type === "trusted-data-viewer-next") {
    const tabId = sender.tab?.id;
    const rect = message.rect;
    if (!tabId || !rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) {
      sendResponse({ ok: false, error: "Missing Data Viewer Next button bounds." });
      return undefined;
    }
    const target = { tabId };
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    (async () => {
      let attached = false;
      try {
        await chrome.debugger.attach(target, "1.3");
        attached = true;
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
        if (attached) await chrome.debugger.detach(target);
        sendResponse({ ok: true });
      } catch (error) {
        if (attached) await chrome.debugger.detach(target).catch(() => undefined);
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  }
  if (message?.type !== "stop-full-sequence" && message?.type !== "stop-current-flow") return;
  const tabId = message.tabId ?? sender.tab?.id;
  const activeSequence = activeSequences.get(tabId);
  if (activeSequence) activeSequence.cancelled = true;
  if (activeSequence && activeSequences.get(tabId)?.runId === activeSequence.runId) {
    activeSequences.delete(tabId);
  }
  // A flow has several long-running MAIN-world scripts. Removing the
  // background sequence alone cannot cancel JavaScript already executing in
  // the CDP SPA, and those stale scripts can leave the form unusable. Reload
  // the current route after Stop so the old automation is actually terminated
  // and the user can immediately start another run without a manual refresh.
  // Start reloading first. A long-running MAIN-world automation can prevent a
  // follow-up executeScript from being scheduled, which used to leave Stop
  // waiting indefinitely on the disabled form.
  const reload = chrome.tabs.reload(tabId).catch(() => undefined);
  Promise.all([setE2EStatus("", tabId), reload])
    .then(() => finalizeRunHistory("stopped"))
    .then(clearFlowDraft)
    .finally(() => sendResponse({ ok: true, stopped: Boolean(activeSequence) }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "get-current-run-status") return;
  sendResponse({ status: activeSequences.get(sender.tab?.id)?.status || "" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "individual-task-finished") return;
  for (const [tabId, activeRun] of activeSequences) {
    if (activeRun.runId !== message.runId || !activeRun.individual) continue;
    activeSequences.delete(tabId);
    rememberConnectionSequence(activeRun.connectionTemplateId, activeRun.connectionSequence).catch((error) => console.warn("Could not record confirmed connection name", error));
    setE2EStatus("", tabId);
    finalizeRunHistory("completed");
    clearFlowDraft();
    break;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "run-publish-all") return;

  runPublishAll(message.tabId)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("CDP publish failed", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "run-data-model") {
    runDataModel(message.tabId, { purpose: message.connectionPurpose, groups: message.groups, saveObjects: message.saveObjects, attributeGroups: message.attributeGroups || [], addAttributes: message.addAttributes, columnOverrides: message.columnOverrides || {}, parentByGroup: message.parentByGroup || {} })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => { finalizeRunHistory("failed", error.message || String(error)); sendResponse({ ok: false, error: error.message || String(error) }); });
    return true;
  }
  if (message?.type === "run-data-model-attributes") {
    runDataModelAttributes(message.tabId, { group: message.group, objectName: message.objectName, columnOverrides: message.columnOverrides || {} })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => { finalizeRunHistory("failed", error.message || String(error)); sendResponse({ ok: false, error: error.message || String(error) }); });
    return true;
  }
  if (message?.type === "run-data-viewer") {
    runDataViewer(message.tabId, message.tableIds, { recordsPerTable: message.recordsPerTable, sourceId: message.sourceId, parentSourceCustomerId: message.parentSourceCustomerId, saveRecords: message.saveRecords, dataViewerOverrides: message.dataViewerOverrides })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => { finalizeRunHistory("failed", error.message || String(error)); sendResponse({ ok: false, error: error.message || String(error) }); });
    return true;
  }
  if (message?.type === "run-import-job") {
    runConfiguredFlow(message.tabId, {
      origin: "independent",
      templateId: message.templateId,
      connectionPurpose: message.connectionPurpose,
      steps: ["import"],
      importTableIds: message.tableIds,
      importSchedule: message.schedule,
      staggerJobs: false
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("CDP import batch failed", error);
        finalizeRunHistory("failed", error.message || String(error));
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
  if (message?.type !== "run-task") return;

  if (["exportJob.js", "importJob.js", "importContacts.js"].includes(message.filename)) {
    const isExport = message.filename === "exportJob.js";
    const isResponsys = message.filename === "importJob.js";
    const flow = {
      origin: "independent",
      templateId: message.templateId,
      connectionPurpose: message.connectionPurpose,
      steps: [isExport ? "export" : "import"],
      exportPayloadName: message.exportPayloadName || "Customer",
      exportFilterRecords: message.filterRecords || message.filterRec || "UPDATED",
      exportPayloadType: message.exportPayloadType || message.payloadType || "data-object",
      importTableIds: isResponsys ? ["customer"] : (message.tableIds || ["customer"]),
      exportSchedule: message.schedule,
      importSchedule: message.schedule,
      importVariant: isResponsys ? "responsys" : "generic",
      staggerJobs: false
    };
    runConfiguredFlow(message.tabId, flow).then(() => sendResponse({ ok: true })).catch((error) => { finalizeRunHistory("failed", error.message || String(error)); sendResponse({ ok: false, error: error.message || String(error) }); });
    return true;
  }

  if (activeSequences.has(message.tabId)) {
    sendResponse({ ok: false, error: "An automation flow is already running in this tab." });
    return;
  }
  const runId = crypto.randomUUID();
  const label = {
    "source.js": "Create Source",
    "destination.js": "Create Destination",
    "exportJob.js": "Create Export Job",
    "importJob.js": "Import Responsys Profile",
    "importContacts.js": "Import Job"
  }[message.filename] || message.filename;
  activeSequences.set(message.tabId, { runId, cancelled: false, individual: true, status: `Running: ${label}` });
  setE2EStatus(`Running: ${label}`, message.tabId);

  selectedTransferTemplate(message.templateId)
    .then(async (template) => {
      template = { ...template, connectionPurpose: message.connectionPurpose || "" };
      const sequence = await nextConnectionSequence(template.id);
      const activeRun = activeSequences.get(message.tabId);
      if (activeRun) Object.assign(activeRun, { connectionTemplateId: template.id, connectionSequence: sequence });
      return runTask(message.tabId, message.filename, undefined, { ...message.schedule, runId }, undefined, message.exportPayloadName, undefined, message.filename === "source.js" ? connectionRuntime(template, "source", sequence) : connectionRuntime(template, "destination", sequence));
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      if (activeSequences.get(message.tabId)?.runId === runId) activeSequences.delete(message.tabId);
      setE2EStatus(`Failed: ${label}`, message.tabId);
      finalizeRunHistory("failed", error.message || String(error));
      clearFlowDraft();
      console.error("CDP automation failed", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "run-custom-flow") {
    runConfiguredFlow(message.tabId, { ...message.flow, origin: "custom-flow", templateId: message.templateId, connectionPurpose: message.connectionPurpose })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("CDP custom flow failed", error);
        finalizeRunHistory("failed", error.message || String(error));
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
  if (message?.type !== "run-full-sequence") return;

  runFullSequence(message.tabId, message.templateId, message.connectionPurpose)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("CDP sequence failed", error);
      finalizeRunHistory("failed", error.message || String(error));
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});
