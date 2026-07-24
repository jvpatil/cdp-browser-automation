// Shared page-side scheduler bridge. The job bookmark fills the form and
// calls this before Save. New Scheduler requests are performed by the
// background worker through a trusted browser interaction; Legacy Scheduler
// remains entirely in the page-specific bookmark logic.
(function installJobSchedulerBridge() {
  if (window.__cdpJobSchedulerBridgeInstalled) return;
  window.__cdpJobSchedulerBridgeInstalled = true;

  window.__cdpApplyConfiguredSchedule = async function applyConfiguredSchedule() {
    const schedule = window.__cdpSchedule || {};
    if (schedule.schedulerUi !== "new") return { ok: true, skipped: true };

    if (window.__cdpJobSchedulePromise) return window.__cdpJobSchedulePromise;

    window.__cdpJobSchedulePromise = new Promise((resolve, reject) => {
      const useImportMessageBridge = schedule.jobKind === "import";
      const requestId = `cdp-scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = window.setTimeout(() => {
        window.removeEventListener("cdp-new-scheduler-result", onResult);
        window.removeEventListener("message", onMessageResult);
        reject(new Error("New scheduler timed out before it was applied."));
      }, 120000);

      function finish(result) {
        window.clearTimeout(timeout);
        window.removeEventListener("cdp-new-scheduler-result", onResult);
        window.removeEventListener("message", onMessageResult);
        if (!result?.ok) {
          reject(new Error(result?.error || "New scheduler could not be applied."));
          return;
        }
        window.__cdpScheduledRunAt = result.scheduledAt || null;
        window.__cdpNewScheduleApplied = true;
        resolve(result);
      }

      function onResult(event) {
        let result;
        try {
          result = JSON.parse(String(event.detail || "{}"));
        } catch (_) {
          reject(new Error("New scheduler returned an invalid result."));
          return;
        }
        finish(result);
      }

      function onMessageResult(event) {
        const message = event.data;
        if (event.source !== window || message?.source !== "cdp-import-scheduler" || message?.type !== "result" || message?.requestId !== requestId) return;
        finish(message.result || {});
      }

      if (useImportMessageBridge) {
        window.addEventListener("message", onMessageResult);
        window.postMessage({ source: "cdp-import-scheduler", type: "apply", requestId, schedule }, "*");
      } else {
        // Preserve Export's existing bridge path unchanged.
        window.addEventListener("cdp-new-scheduler-result", onResult, { once: true });
        window.dispatchEvent(new CustomEvent("cdp-new-scheduler-request", {
          detail: JSON.stringify(schedule)
        }));
      }
    });

    try {
      return await window.__cdpJobSchedulePromise;
    } finally {
      window.__cdpJobSchedulePromise = null;
    }
  };
})();
