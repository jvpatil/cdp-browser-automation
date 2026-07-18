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
  "importCustomer.js": { path: "/data/", root: "createConnectJob", readySelector: "div[class*='create-connect-job-body']", saveSelector: "#saveNclose-create-job", dependencies: ["cdpCustomerFieldMapping.js"] },
  "importContacts.js": { path: "/data/", root: "createConnectJob", readySelector: "div[class*='create-connect-job-body']", saveSelector: "#saveNclose-create-job", dependencies: ["cdpContactsFieldMapping.js"] },
  "importContactAndAddress.js": {
    path: "/data/",
    root: "createConnectJob",
    saveSelector: "#saveNclose-create-job",
    readySelector: "div[class*='create-connect-job-body']",
    dependencies: ["cdpContactAndAddressFieldMapping.js"]
  },
  "exportJob.js": { path: "/data/", root: "createExportJob", readySelector: "div[class*='create-export-job-body']", saveSelector: "#saveNclose-create-job" },
  "publish.js": { path: "/data/", root: "publishChanges" },
  "integrationStatus.js": { path: "/data/", root: "integrations" }
};

const FULL_SEQUENCE = [
  { filename: "source.js", label: "Create Source", saveSelector: "#create-source-saveClose" },
  { filename: "destination.js", label: "Create Destination", saveSelector: "#dst-saveClose-btn" },
  { filename: "exportJob.js", label: "Create Export Job", saveSelector: "#saveNclose-create-job" },
  { filename: "importContacts.js", label: "Import Contacts", saveSelector: "#saveNclose-create-job" }
];

const sequenceStepState = new Map();
const activeSequences = new Map();

async function showRunStatus(tabId, status = "") {
  return;
  if (!tabId) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [status],
    func: (message) => {
      const id = "cdp-automation-status";
      let panel = document.getElementById(id);
      if (!message) {
        panel?.remove();
        return;
      }
      if (!panel) {
        panel = document.createElement("div");
        panel.id = id;
        panel.style.cssText = "position:fixed;right:18px;top:12px;z-index:2147483647;max-width:310px;padding:10px 14px;border:1px solid #526987;border-radius:9px;background:#0b2038;color:#f1f2f0;font:600 12px/1.35 Inter,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:none;";
        document.documentElement.append(panel);
      }
      panel.textContent = message;
    }
  }).catch(() => undefined);
}

async function setE2EStatus(status = "", tabId) {
  const activeRun = activeSequences.get(tabId);
  if (activeRun) activeRun.status = status;
  await chrome.storage.local.set({ e2eStatus: status });
  await showRunStatus(tabId, status);
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

function currentDateTag() {
  const date = new Date();
  return `${String(date.getDate()).padStart(2, "0")}${date.toLocaleString("en-US", { month: "short" }).toUpperCase()}${String(date.getFullYear()).slice(-2)}`;
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
  const { name: jobName, scheduledAt } = capturedEntity || {};
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

async function waitForStep(tabId, label, _saveSelector, runId, _stepId, timeout = 180000) {
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
      if (result?.success) return;
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

async function runTask(tabId, filename, monitor, schedule) {
  const task = TASKS[filename];
  if (!task) throw new Error(`Unsupported automation script: ${filename}`);

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith("http")) {
    throw new Error("Open your Oracle CDP tenant in the active tab first.");
  }

  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  if (task.createLabel) await prepareConnectionForm(tabId, task);
  if (task.readySelector) await waitForPageElement(tabId, task.readySelector);

  await installStopGuard(tabId);
  if (monitor) await installStepMonitor(tabId, monitor);
  if (!monitor && task.saveSelector && schedule?.runId) {
    await installTaskCompletionMonitor(tabId, schedule.runId, task.saveSelector);
  }

  const activeRun = activeSequences.get(tabId);
  if (activeRun?.status) await showRunStatus(tabId, activeRun.status);

  if (["exportJob.js", "importJob.js", "importCustomer.js", "importContacts.js", "importContactAndAddress.js"].includes(filename)) {
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
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["scheduleOverride.js"]
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
    files: [filename]
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
  await showRunStatus(tabId, activeSequences.get(tabId)?.status || "Running: Publish");
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
  await showRunStatus(tabId, activeSequences.get(tabId)?.status || "Running: Verify Published Jobs");
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
  try {
    for (const step of FULL_SEQUENCE) {
      await setE2EStatus(`Running: ${step.label}`, tabId);
      const schedule = step.filename === "exportJob.js"
        ? { offsetHours: 0 }
        : step.filename === "importContacts.js"
          ? { scheduledAt: runMetadata.creations.jobs.export?.scheduledAt + 3600000 }
          : undefined;
      await runTask(tabId, step.filename, {
        runId,
        stepId: step.filename,
        saveSelector: step.saveSelector
      }, schedule);
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
  } finally {
    sequenceStepState.delete(runId);
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    await setE2EStatus("", tabId);
    await chrome.storage.local.remove("e2eRun");
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
    "importCustomer.js": "Import Customer",
    "importContacts.js": "Import Contacts",
    "importContactAndAddress.js": "Import Contacts and Address"
  }[message.filename] || message.filename;
  activeSequences.set(message.tabId, { runId, cancelled: false, individual: true, status: `Running: ${label}` });
  setE2EStatus(`Running: ${label}`, message.tabId);

  runTask(message.tabId, message.filename, undefined, { ...message.schedule, runId })
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
