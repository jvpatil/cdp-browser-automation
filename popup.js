const statusEl = document.getElementById("status");
const importScheduleIds = [
  "importProfileSchedule",
  "importCustomerSchedule",
  "importContactsSchedule",
  "importContactAddressSchedule"
];

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

chrome.storage.local.get({ e2eStatus: "" }).then(({ e2eStatus }) => {
  statusEl.textContent = e2eStatus;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.e2eStatus) {
    statusEl.textContent = changes.e2eStatus.newValue || "";
  }
});

async function runScript(filename, label, schedule) {
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
      schedule
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

document.getElementById("importCustomerBtn").addEventListener("click", () => {
  runScript("importCustomer.js", "Import Customer", importSchedule("importCustomerSchedule"));
});

document.getElementById("importContactsBtn").addEventListener("click", () => {
  runScript("importContacts.js", "Import Contacts", importSchedule("importContactsSchedule"));
});

document.getElementById("importContactAndAddressBtn").addEventListener("click", () => {
  runScript("importContactAndAddress.js", "Import Contacts and Address", importSchedule("importContactAddressSchedule"));
});

function importSchedule(selectId) {
  const value = document.getElementById(selectId).value;
  return value === "-1" ? { mode: "onDemand" } : { offsetHours: Number(value) };
}

document.getElementById("exportBtn").addEventListener("click", () => {
  runScript("exportJob.js", "ExportJob");
});
