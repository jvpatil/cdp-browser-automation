const statusEl = document.getElementById("status");
const importScheduleIds = ["importProfileSchedule"];
const IMPORT_JOB_TYPES = [
  { id: "customer", label: "Customer" },
  { id: "contactPoint", label: "Contacts" },
  { id: "address", label: "Address" }
];
const EXPORT_PAYLOAD_OPTIONS = ["Customer", "Master Customer", "Account", "Master Account", "ContactPoint", "Address", "Order", "Product"];

function scheduleLabel(value) {
  return value === "-1" ? "On-demand" : value === "1" ? "+1h" : "Next";
}

function updateScheduleIndicator(select) {
  document.getElementById(`${select.id}Indicator`).textContent = scheduleLabel(select.value);
  select.title = `Import schedule: ${scheduleLabel(select.value)}`;
}

chrome.storage.local.get({ importSchedules: {} }).then(({ importSchedules }) => {
  importScheduleIds.forEach((id) => {
    const select = document.getElementById(id);
    if (importSchedules[id] !== undefined) select.value = String(importSchedules[id]);
    updateScheduleIndicator(select);
    select.addEventListener("change", async () => {
      const updatedSchedules = { ...importSchedules, [id]: select.value };
      importSchedules = updatedSchedules;
      updateScheduleIndicator(select);
      await chrome.storage.local.set({ importSchedules: updatedSchedules });
    });
  });
});

let importJobSettings = {};
const importJobList = document.getElementById("importJobList");

function renderImportJobs(filter = "") {
  const query = filter.trim().toLowerCase();
  importJobList.replaceChildren(...IMPORT_JOB_TYPES
    .filter((job) => job.label.toLowerCase().includes(query))
    .map((job) => {
      const setting = importJobSettings[job.id] || { selected: false };
      const row = document.createElement("label");
      row.className = "import-job-row";
      const check = document.createElement("span");
      check.className = "import-job-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(setting.selected);
      input.addEventListener("change", () => saveImportJobSetting(job.id, { selected: input.checked }));
      check.append(input, document.createTextNode(job.label));
      row.append(check);
      return row;
    }));
}

async function saveImportJobSetting(id, update) {
  importJobSettings[id] = { selected: false, ...importJobSettings[id], ...update };
  await chrome.storage.local.set({ importJobSettings });
}

chrome.storage.local.get({ importJobSettings: {} }).then(({ importJobSettings: saved }) => {
  importJobSettings = saved;
  renderImportJobs();
});

const importJobScheduleEl = document.getElementById("importJobSchedule");
chrome.storage.local.get({ importJobSchedule: "0" }).then(({ importJobSchedule }) => {
  importJobScheduleEl.value = String(importJobSchedule);
});
importJobScheduleEl.addEventListener("change", () => {
  chrome.storage.local.set({ importJobSchedule: importJobScheduleEl.value });
});

const exportPayloadList = document.getElementById("exportPayloadList");
const exportScheduleEl = document.getElementById("exportJobSchedule");
let exportPayloadName = "Customer";
function renderExportPayloads() {
  exportPayloadList.replaceChildren(...EXPORT_PAYLOAD_OPTIONS.map((name) => {
    const row = document.createElement("label");
    row.className = "import-job-row";
    const choice = document.createElement("span");
    choice.className = "import-job-check";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "exportPayload";
    input.value = name;
    input.checked = name === exportPayloadName;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      exportPayloadName = name;
      chrome.storage.local.set({ exportPayloadName: name });
    });
    choice.append(input, document.createTextNode(name));
    row.append(choice);
    return row;
  }));
}
chrome.storage.local.get({ exportPayloadName: "Customer", exportJobSchedule: "0" }).then((saved) => {
  exportPayloadName = EXPORT_PAYLOAD_OPTIONS.includes(saved.exportPayloadName) ? saved.exportPayloadName : "Customer";
  exportScheduleEl.value = String(saved.exportJobSchedule);
  renderExportPayloads();
});
exportScheduleEl.addEventListener("change", () => chrome.storage.local.set({ exportJobSchedule: exportScheduleEl.value }));

chrome.storage.local.get({ e2eStatus: "" }).then(({ e2eStatus }) => {
  statusEl.textContent = e2eStatus;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.e2eStatus) {
    statusEl.textContent = changes.e2eStatus.newValue || "";
  }
});

async function runScript(filename, label, schedule, options = {}) {
  try {
    statusEl.textContent = `Starting ${label}...`;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    chrome.runtime.sendMessage({
      type: "run-task",
      tabId: tab.id,
      filename,
      schedule,
      ...options
    }).catch((error) => {
      console.error(`[CDP Job Assistant] ${label} failed`, error);
    });
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    setTimeout(() => window.close(), 2000);
  } catch (error) {
    console.error(`[CDP Job Assistant] ${label} failed`, error);
    statusEl.textContent = `${label} failed: ${error.message || error}`;
  }
}

async function runE2EFlow() {
  try {
    statusEl.textContent = "Starting E2E flow...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    chrome.runtime.sendMessage({
      type: "run-full-sequence",
      tabId: tab.id
    }).catch((error) => {
      console.error("[CDP Job Assistant] E2E flow failed", error);
    });
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    setTimeout(() => window.close(), 2000);
  } catch (error) {
    console.error("[CDP Job Assistant] E2E flow failed", error);
    statusEl.textContent = `E2E flow failed: ${error.message || error}`;
  }
}

async function runPublishAll() {
  try {
    statusEl.textContent = "Starting Publish All Data Feeds...";

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    chrome.runtime.sendMessage({
      type: "run-publish-all",
      tabId: tab.id
    }).catch((error) => {
      console.error("[CDP Job Assistant] Publish All Data Feeds failed", error);
    });
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    setTimeout(() => window.close(), 2000);
  } catch (error) {
    console.error("[CDP Job Assistant] Publish All Data Feeds failed", error);
    statusEl.textContent = `Publish All Data Feeds failed: ${error.message || error}`;
  }
}

async function stopE2EFlow() {
  try {
    statusEl.textContent = "Stopping current flow...";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    await chrome.runtime.sendMessage({ type: "stop-full-sequence", tabId: tab.id });
    document.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    setTimeout(() => window.close(), 1000);
  } catch (error) {
    console.error("[CDP Job Assistant] Could not stop current flow", error);
    statusEl.textContent = `Stop failed: ${error.message || error}`;
  }
}

document.getElementById("runE2EBtn").addEventListener("click", runE2EFlow);
document.getElementById("publishAllBtn").addEventListener("click", runPublishAll);
document.getElementById("stopE2EBtn").addEventListener("click", stopE2EFlow);

document.getElementById("sourceBtn").addEventListener("click", () => {
  runScript("source.js", "Create Source");
});

document.getElementById("destinationBtn").addEventListener("click", () => {
  runScript("destination.js", "Create Destination");
});

document.getElementById("importBtn").addEventListener("click", () => {
  runScript("importJob.js", "Import Responsys Profile", importSchedule("importProfileSchedule"));
});

document.getElementById("importJobsBtn").addEventListener("click", () => {
  document.body.classList.add("import-picker-open");
  document.getElementById("importJobSearch").focus();
});
document.getElementById("importJobsBackBtn").addEventListener("click", () => {
  document.body.classList.remove("import-picker-open");
});
document.getElementById("exportBtn").addEventListener("click", () => {
  document.body.classList.add("export-picker-open");
  renderExportPayloads();
});
document.getElementById("exportJobsBackBtn").addEventListener("click", () => {
  document.body.classList.remove("export-picker-open");
});
document.getElementById("runExportJobBtn").addEventListener("click", () => {
  const schedule = exportScheduleEl.value;
  runScript("exportJob.js", "Export Job", schedule === "-1" ? { mode: "onDemand" } : { offsetHours: Number(schedule) }, { exportPayloadName });
});
document.getElementById("importJobSearch").addEventListener("input", (event) => renderImportJobs(event.target.value));
document.getElementById("selectAllImportsBtn").addEventListener("click", async () => {
  IMPORT_JOB_TYPES.forEach((job) => { importJobSettings[job.id] = { selected: true, ...importJobSettings[job.id] }; });
  await chrome.storage.local.set({ importJobSettings });
  renderImportJobs(document.getElementById("importJobSearch").value);
});
document.getElementById("clearImportsBtn").addEventListener("click", async () => {
  IMPORT_JOB_TYPES.forEach((job) => { importJobSettings[job.id] = { selected: false, ...importJobSettings[job.id] }; });
  await chrome.storage.local.set({ importJobSettings });
  renderImportJobs(document.getElementById("importJobSearch").value);
});
document.getElementById("runSelectedImportsBtn").addEventListener("click", async () => {
  const tableIds = IMPORT_JOB_TYPES.filter((job) => importJobSettings[job.id]?.selected).map((job) => job.id);
  if (!tableIds.length) {
    statusEl.textContent = "Select at least one table.";
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  const schedule = importJobScheduleEl.value;
  statusEl.textContent = "Starting Import Job...";
  chrome.runtime.sendMessage({
    type: "run-import-job",
    tabId: tab.id,
    tableIds,
    schedule: schedule === "-1" ? { mode: "onDemand" } : { offsetHours: Number(schedule) }
  });
  document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  setTimeout(() => window.close(), 2000);
});

function importSchedule(selectId) {
  const value = document.getElementById(selectId).value;
  return value === "-1" ? { mode: "onDemand" } : { offsetHours: Number(value) };
}
