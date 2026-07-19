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
  "publish.js": { path: "/data/", root: "publishChanges" },
  "integrationStatus.js": { path: "/data/", root: "integrations" }
};

let tableCatalogPromise;

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
        const validImports = imports.length && imports.every((table) =>
          typeof table?.id === "string" && table.id &&
          typeof table.label === "string" && table.label &&
          typeof table.cdpTable === "string" && table.cdpTable &&
          typeof table.csvFile === "string" && table.csvFile
        );
        const uniqueIds = new Set(imports.map((table) => table.id)).size === imports.length;
        const validExports = exports.length && exports.every((payload) => typeof payload === "string" && payload);
        if (!validImports || !uniqueIds || !validExports) throw new Error("config/tables.json has an invalid table or payload entry.");
        return { importsById: Object.fromEntries(imports.map((table) => [table.id, table])), exportPayloads: exports };
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
  const { [CDP_CONNECTION_SEQUENCE_KEY]: saved = {} } = await chrome.storage.local.get(CDP_CONNECTION_SEQUENCE_KEY);
  const now = new Date();
  const dateTag = `${String(now.getDate()).padStart(2, "0")}${now.toLocaleString("en-US", { month: "short" }).toUpperCase()}${String(now.getFullYear()).slice(-2)}`;
  const previous = saved[templateId];
  const ordinal = previous && typeof previous === "object" && previous.dateTag === dateTag
    ? Number(previous.ordinal || 0) + 1
    : 1;
  return { dateTag, ordinal };
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
  return `${String(date.getDate()).padStart(2, "0")}${date.toLocaleString("en-US", { month: "short" }).toUpperCase()}${String(date.getFullYear()).slice(-2)}`;
}

function templateShortName(template, providerCode) {
  const parts = String(template.name || "Transfer").split(/[-_\s]+/).filter(Boolean);
  if (parts.length && parts[0].toUpperCase() === providerCode) parts.shift();
  const shortName = parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`).join("");
  return shortName || "Transfer";
}

function transferJobName(template, connection, operation, sequence) {
  const provider = connectionProviderCode(connection.type);
  const purpose = String(template.connectionPurpose || "Transfer")
    .replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 28) || "Transfer";
  const dateTag = sequence?.dateTag || dateTagForName();
  const repeat = Number(sequence?.ordinal || 1) > 1 ? `_${String(sequence.ordinal).padStart(2, "0")}` : "";
  return `${operation}_${provider}_${purpose}_${templateShortName(template, provider)}_${dateTag}${repeat}`;
}

function connectionRuntime(template, side, sequence = null) {
  const connection = template[side];
  const fallbackPurpose = String(connection.profileName || "Transfer")
    .replace(connection.type || "", "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  const purpose = String(template.connectionPurpose || fallbackPurpose || "Transfer")
    .replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 28) || "Transfer";
  const now = new Date();
  const fallbackDate = `${String(now.getDate()).padStart(2, "0")}${now.toLocaleString("en-US", { month: "short" }).toUpperCase()}${String(now.getFullYear()).slice(-2)}`;
  const dateTag = sequence?.dateTag || fallbackDate;
  const ordinal = Number(sequence?.ordinal || 1);
  const name = `${connectionProviderCode(connection.type)}_${purpose}_${dateTag}${ordinal > 1 ? `_${String(ordinal).padStart(2, "0")}` : ""}`;
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

async function setE2EStatus(status = "", tabId) {
  const activeRun = activeSequences.get(tabId);
  if (activeRun) activeRun.status = status;
  await chrome.storage.local.set({ e2eStatus: status });
}

async function clearFlowDraft() {
  await chrome.storage.local.remove("flowDraft");
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
    "importContacts.js": { section: "jobs", role: "import", label: "Import Job", inputId: "job-name-input|input" }
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
      resolve();
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
      const deadline = Date.now() + 30000;
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
        [...document.querySelectorAll("button, oj-button, [role='button']")].find((element) =>
          visible(element) && enabled(element) && text(element) === label
        ), label);
      await click(create.querySelector("button") || create);

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

      await waitFor(() => text(document.getElementById(dropdownId)) === selectedType,
        `${selectedType} selection`);

      await waitFor(() => inputIds.every((id) => {
        const input = document.getElementById(id);
        return input && visible(input) && !input.disabled;
      }), `${selectedType} form fields`);
    }
  });
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
        if (!(event.target instanceof Element) || !event.target.closest(selector)) return;

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
      const state = { status: "running", error: "" };
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
        if (event.target instanceof Element && event.target.closest(selector)) {
          chrome.runtime.sendMessage({ type: "individual-task-finished", runId: activeRunId });
        }
      }, true);
    }
  });
}

async function waitForStep(tabId, label, _saveSelector, runId, stepId, timeout = 180000) {
  const deadline = Date.now() + timeout;
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
          return {
            monitor: window.__cdpSequenceStep || null,
            success: messages.some((message) =>
              /\byour\s+changes\s+have\s+been\s+saved\b/i.test(message) ||
              /\bjob\s+was\s+saved\s+successfully\b/i.test(message)
            )
          };
        }
      });
      const saveWasTriggered = sequenceStepState.get(runId)?.has(stepId);
      if (result?.success || saveWasTriggered) {
        // Oracle has received the explicit Save action. Give the page a moment
        // to persist before navigating to the next E2E stage.
        if (saveWasTriggered && !result?.success) await new Promise((resolve) => setTimeout(resolve, 1000));
        return;
      }
      if (!result?.monitor) {
        throw new Error(`${label} was interrupted before Oracle confirmed it was saved successfully.`);
      }
    } catch (error) {
      throw new Error(`${label} failed: ${error.message || error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out before Save and Close.`);
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
  if (task.createLabel) await prepareConnectionForm(tabId, task, connectionConfig?.type);
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
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [schedule || { mode: "scheduled", frequency: "Daily", startTime: "immediate" }],
        func: (scheduleConfig) => {
          window.__cdpSchedule = scheduleConfig;
          window.__cdpScheduledRunAt = null;
          window.__cdpScheduleApplied = false;
          window.__cdpManualScheduleApplied = false;
          window.__cdpFrequencySaveDeferred = false;
          window.__cdpFrequencyOverrideSaved = false;
          window.__cdpFrequencyOverrideApplying = false;
        }
      });
      await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["scheduleOverride.js"] });
    }

    if (connectionConfig) {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [connectionConfig],
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

async function runConfiguredFlow(tabId, flow = {}) {
  if (activeSequences.has(tabId)) throw new Error("An E2E flow is already running in this tab.");
  const selectedTemplate = await selectedTransferTemplate(flow.templateId);
  const template = { ...selectedTemplate, connectionPurpose: flow.connectionPurpose || "" };
  const connectionSequence = await nextConnectionSequence(template.id);
  const sourceConfig = connectionRuntime(template, "source", connectionSequence);
  const destinationConfig = connectionRuntime(template, "destination", connectionSequence);
  const selectedSteps = new Set(flow.steps || ["source", "destination", "export", "import", "publish", "verify"]);
  // A job always owns its prerequisite connection, even when the user did not
  // select the connection card explicitly in a custom flow.
  if (selectedSteps.has("import")) selectedSteps.add("source");
  if (selectedSteps.has("export")) selectedSteps.add("destination");
  const stepDefinitions = [
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
  sequenceStepState.set(runId, new Set());
  activeSequences.set(tabId, { runId, cancelled: false });
  await chrome.storage.local.set({ e2eRun: runMetadata });
  let completed = false;
  try {
    for (const step of stepDefinitions) {
      await setE2EStatus(`Running: ${step.label}`, tabId);
      if (step.id === "export" && flow.staggerJobs && !runMetadata.exportScheduledAt) {
        const exportHour = new Date();
        exportHour.setHours(exportHour.getHours() + 1, 0, 0, 0);
        runMetadata.exportScheduledAt = exportHour.getTime();
      }
      const schedule = step.id === "export"
        ? (flow.staggerJobs ? { ...flow.exportSchedule, scheduledAt: runMetadata.exportScheduledAt } : flow.exportSchedule)
        : step.id === "import"
          ? (flow.staggerJobs ? { ...flow.importSchedule, scheduledAt: runMetadata.exportScheduledAt + 3600000 } : flow.importSchedule)
          : undefined;
      let importConfig;
      if (step.id === "import") {
        try {
          importConfig = await buildImportConfig(flow.importTableIds || ["customer", "contactPoint"], template.fileContract?.delimiter);
        } catch (error) {
          if (!flow.allowImportFallback) throw error;
          console.warn("Could not load editable E2E import CSV files; using the bundled fallback.", error);
          importConfig = importFallbackConfig(template.fileContract?.delimiter);
        }
      }
      const jobConfig = step.id === "export" ? {
        name: flow.exportJobName || transferJobName(template, destinationConfig, "Export", connectionSequence),
        description: flow.exportDescription || template.description || `${template.name} export`,
        destinationName: destinationConfig.name,
        // Keep the established file name on both job types: PROFILE_<hostKey>.
        // exportJob.js supplies it directly when no runtime override is sent.
        fileName: "",
        compression: template.fileContract?.compression || "none",
        fileContract: template.fileContract || {},
        notification: flow.notification || ""
      } : step.id === "import" ? {
        name: flow.importJobName || transferJobName(template, sourceConfig, "Import", connectionSequence),
        description: flow.importDescription || template.description || `${template.name} import`,
        sourceName: sourceConfig.name,
        sourceObjectName: "",
        notification: flow.notification || "",
        filePattern: template.fileContract?.filePattern || "",
        fileContract: template.fileContract || {}
      } : undefined;
      const connectionConfig = step.id === "source" ? sourceConfig : step.id === "destination" ? destinationConfig : undefined;
      await runTask(tabId, step.filename, {
        runId,
        stepId: step.filename,
        saveSelector: step.saveSelector
      }, schedule, importConfig, flow.exportPayloadName, flow.importTableIds, connectionConfig, jobConfig);
      await waitForStep(tabId, step.label, step.saveSelector, runId, step.filename);
      if (step.id === "source" || step.id === "destination") {
        await rememberConnectionSequence(template.id, connectionSequence);
      }
      await captureCreatedEntity(tabId, runMetadata, step.filename);
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
    await clearFlowDraft();
  }
}

async function runFullSequence(tabId, templateId, connectionPurpose) {
  return runConfiguredFlow(tabId, {
    templateId,
    connectionPurpose,
    steps: ["source", "destination", "export", "import", "publish", "verify"],
    importTableIds: ["customer", "contactPoint"],
    exportPayloadName: "Customer",
    staggerJobs: true,
    allowImportFallback: true
  });
}

async function runImportJob(tabId, tableIds, schedule) {
  if (activeSequences.has(tabId)) throw new Error("An automation flow is already running in this tab.");
  const runId = crypto.randomUUID();
  activeSequences.set(tabId, { runId, cancelled: false });
  let failed = false;
  try {
    // Keep standalone Import Job dependent on the selected editable CSVs.
    // Unlike E2E, it must never silently substitute a different table set.
    const importConfig = await buildImportConfig(tableIds);
    const task = TASKS["importContacts.js"];
    await setE2EStatus("Running: Import Job", tabId);
    await runTask(tabId, "importContacts.js", { runId, stepId: "import-job", saveSelector: task.saveSelector }, schedule, importConfig);
    await waitForStep(tabId, "Import Job", task.saveSelector, runId, "import-job");
  } catch (error) {
    if (!/stopped by the user/i.test(error.message || "")) {
      failed = true;
      await setE2EStatus(`Failed: Import Job — ${error.message || error}`, tabId);
    }
    throw error;
  } finally {
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (!failed) await setE2EStatus("", tabId);
    await clearFlowDraft();
  }
}

async function runPublishAll(tabId) {
  if (activeSequences.has(tabId)) throw new Error("An E2E flow is already running in this tab.");
  const runId = crypto.randomUUID();
  activeSequences.set(tabId, { runId, cancelled: false });
  await setE2EStatus("Running: Publish All Data Feeds", tabId);
  try {
    await runPublish(tabId, { mode: "all", runId, label: "Publish All Data Feeds" });
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    await setE2EStatus("", tabId);
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
  if (message?.type !== "stop-full-sequence" && message?.type !== "stop-current-flow") return;
  const tabId = message.tabId ?? sender.tab?.id;
  const activeSequence = activeSequences.get(tabId);
  if (activeSequence) activeSequence.cancelled = true;
  const cancelPublish = activeSequence
    ? chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        window.__cdpPublishCancelled = true;
        window.__cdpAutomationStopped = true;
      }
    }).catch(() => undefined)
    : Promise.resolve();
  if (activeSequence && activeSequences.get(tabId)?.runId === activeSequence.runId) {
    activeSequences.delete(tabId);
  }
  Promise.all([setE2EStatus("", tabId), cancelPublish])
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
  if (message?.type === "run-import-job") {
    runConfiguredFlow(message.tabId, {
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
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
  if (message?.type !== "run-task") return;

  if (["exportJob.js", "importJob.js", "importContacts.js"].includes(message.filename)) {
    const isExport = message.filename === "exportJob.js";
    const isResponsys = message.filename === "importJob.js";
    const flow = {
      templateId: message.templateId,
      connectionPurpose: message.connectionPurpose,
      steps: [isExport ? "export" : "import"],
      exportPayloadName: message.exportPayloadName || "Customer",
      importTableIds: isResponsys ? ["customer"] : (message.tableIds || ["customer"]),
      exportSchedule: message.schedule,
      importSchedule: message.schedule,
      staggerJobs: false
    };
    runConfiguredFlow(message.tabId, flow).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
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
      clearFlowDraft();
      console.error("CDP automation failed", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "run-custom-flow") {
    runConfiguredFlow(message.tabId, { ...message.flow, templateId: message.templateId, connectionPurpose: message.connectionPurpose })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("CDP custom flow failed", error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
  if (message?.type !== "run-full-sequence") return;

  runFullSequence(message.tabId, message.templateId, message.connectionPurpose)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("CDP sequence failed", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});
