const TASKS = {
  "source.js": {
    path: "/integration/",
    root: "sources",
    saveSelector: "#create-source-saveClose",
    createLabel: "Create Source",
    typeDropdownId: "oj-select-choice-source-type",
    formInputIds: [
      "source-name-input|input",
      "oos-path|input",
      "oos-storeEndpoint|input",
      "oos-storeKey|input",
      "oos-storeSecret|input"
    ]
  },
  "destination.js": {
    path: "/integration/",
    root: "destinations",
    saveSelector: "#dst-saveClose-btn",
    createLabel: "Create Destination",
    typeDropdownId: "oj-select-choice-destination-type",
    formInputIds: [
      "source-name-input|input",
      "oos-path|input",
      "oos-storeEndpoint|input",
      "oos-storeKey|input",
      "oos-storeSecret|input"
    ]
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

// Add future tables here. The UI sends only an id; CSV samples and CDP mapping
// tables stay centralized in the background worker.
const IMPORT_TABLES = {
  customer: {
    id: "customer",
    label: "Customer",
    cdpTable: "Customer",
    csvFile: "sample-csv/customer.csv"
  },
  contactPoint: {
    id: "contactPoint",
    label: "Contacts",
    cdpTable: "ContactPoint",
    csvFile: "sample-csv/contactpoint.csv"
  },
  address: {
    id: "address",
    label: "Address",
    cdpTable: "Address",
    csvFile: "sample-csv/address.csv"
  }
};

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

async function buildImportConfig(tableIds) {
  const selected = [...new Set(tableIds || [])].map((id) => IMPORT_TABLES[id]);
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
  return {
    targetTables: selected.map((table) => table.cdpTable),
    fieldToTable: Object.fromEntries(uniqueFields.map((field) => [field.header, field.tables])),
    csvContent: `${uniqueFields.map((field) => field.header).join(",")}\n${uniqueFields.map((field) => field.value).join(",")}\n`
  };
}

const FULL_SEQUENCE = [
  { filename: "source.js", label: "Create Source", saveSelector: "#create-source-saveClose" },
  { filename: "destination.js", label: "Create Destination", saveSelector: "#dst-saveClose-btn" },
  { filename: "exportJob.js", label: "Create Export Job", saveSelector: "#saveNclose-create-job" },
  { filename: "importContacts.js", label: "Import Contacts", importTableIds: ["customer", "contactPoint"], saveSelector: "#saveNclose-create-job" }
];

const sequenceStepState = new Map();
const activeSequences = new Map();

async function setE2EStatus(status = "", tabId) {
  const activeRun = activeSequences.get(tabId);
  if (activeRun) activeRun.status = status;
  await chrome.storage.local.set({ e2eStatus: status });
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
  if (creation.section === "jobs" && !scheduledAt) {
    throw new Error(`The scheduled hour for ${creation.label} could not be captured.`);
  }
  const savedEntity = {
    label: creation.label,
    name: jobName,
    savedAt: Date.now()
  };
  if (creation.section === "jobs") savedEntity.scheduledAt = scheduledAt;
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

async function prepareConnectionForm(tabId, { createLabel, typeDropdownId, formInputIds }) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [createLabel, typeDropdownId, formInputIds],
    func: async (label, dropdownId, inputIds) => {
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
          .find((element) => visible(element) && text(element) === "Oracle Object Storage"),
      "Oracle Object Storage option");
      await click(option.closest("[role='option'], oj-option, li") || option);

      await waitFor(() => text(document.getElementById(dropdownId)) === "Oracle Object Storage",
        "Oracle Object Storage selection");

      await waitFor(() => inputIds.every((id) => {
        const input = document.getElementById(id);
        return input && visible(input) && !input.disabled;
      }), "Oracle Object Storage form fields");
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

async function runTask(tabId, filename, monitor, schedule, importConfig, exportPayloadName, importTableIds) {
  const task = TASKS[filename];
  if (!task) throw new Error(`Unsupported automation script: ${filename}`);

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith("http")) {
    throw new Error("Open your Oracle CDP tenant in the active tab first.");
  }

  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  if (task.createLabel) await prepareConnectionForm(tabId, task);
  if (task.readySelector) await waitForPageElement(tabId, task.readySelector);

  // In E2E, navigate first. This ensures the Export→Import handoff is visible
  // even if a user-edited CSV fragment has a configuration error.
  if (filename === "importContacts.js" && !importConfig && importTableIds) {
    try {
      importConfig = await buildImportConfig(importTableIds);
    } catch (error) {
      console.warn("Could not load editable E2E import CSV files; using the bundled Customer + ContactPoint fallback.", error);
      importConfig = E2E_IMPORT_FALLBACK;
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
        args: [schedule || { offsetHours: 0 }],
        func: (scheduleConfig) => {
          window.__cdpSchedule = scheduleConfig;
          window.__cdpScheduledRunAt = null;
          window.__cdpScheduleApplied = false;
          window.__cdpManualScheduleApplied = false;
        }
      });
      await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["scheduleOverride.js"] });
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

async function runFullSequence(tabId) {
  if (activeSequences.has(tabId)) throw new Error("An E2E flow is already running in this tab.");

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
    for (const step of FULL_SEQUENCE) {
      await setE2EStatus(`Running: ${step.label}`, tabId);
      if (step.filename === "exportJob.js" && !runMetadata.exportScheduledAt) {
        const exportHour = new Date();
        exportHour.setHours(exportHour.getHours() + 1, 0, 0, 0);
        runMetadata.exportScheduledAt = exportHour.getTime();
      }
      const schedule = step.filename === "exportJob.js"
        ? { scheduledAt: runMetadata.exportScheduledAt }
        : step.filename === "importContacts.js"
          ? { scheduledAt: (runMetadata.creations.jobs.export?.scheduledAt || runMetadata.exportScheduledAt) + 3600000 }
          : undefined;
      await runTask(tabId, step.filename, {
        runId,
        stepId: step.filename,
        saveSelector: step.saveSelector
      }, schedule, undefined, undefined, step.importTableIds);
      await waitForStep(tabId, step.label, step.saveSelector, runId, step.filename);
      await captureCreatedEntity(tabId, runMetadata, step.filename);
    }
    if (runMetadata.jobNames.length !== 2) {
      throw new Error("Both saved job names are required before publishing.");
    }
    if (activeSequences.get(tabId)?.cancelled) throw new Error("Publish E2E Jobs was stopped by the user.");
    await setE2EStatus("Running: Publish E2E Jobs", tabId);
    await runPublish(tabId, { mode: "e2e", ...runMetadata, runId, label: "Publish E2E Jobs" });
    await setE2EStatus("Running: Verify Published Jobs", tabId);
    await verifyPublishedJobs(tabId, { jobNames: runMetadata.jobNames, runId });
    completed = true;
  } catch (error) {
    console.error("CDP E2E flow failed", error);
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
  }
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
  }
}

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
    setE2EStatus("", tabId);
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
    runImportJob(message.tabId, message.tableIds, message.schedule)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("CDP import batch failed", error);
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
  if (message?.type !== "run-task") return;

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

  runTask(message.tabId, message.filename, undefined, { ...message.schedule, runId }, undefined, message.exportPayloadName)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      if (activeSequences.get(message.tabId)?.runId === runId) activeSequences.delete(message.tabId);
      setE2EStatus(`Failed: ${label}`, message.tabId);
      console.error("CDP automation failed", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "run-full-sequence") return;

  runFullSequence(message.tabId)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("CDP sequence failed", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});
