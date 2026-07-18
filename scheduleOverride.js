(function () {
  if (window.__cdpScheduleOverrideInstalled) return;
  window.__cdpScheduleOverrideInstalled = true;

  const originalQuerySelectorAll = Document.prototype.querySelectorAll;
  Document.prototype.querySelectorAll = function (selector) {
    const isHourlyScheduleQuery = typeof selector === "string" &&
      /^oj-buttonset-many#recurring-hourly-(?:am|pm) input\[value="\d+"\]$/.test(selector);

    if (!isHourlyScheduleQuery || window.__cdpScheduleApplied) {
      return originalQuerySelectorAll.call(this, selector);
    }

    const configuredTime = Number(window.__cdpSchedule?.scheduledAt);
    const scheduledRun = Number.isFinite(configuredTime) && configuredTime > Date.now()
      ? new Date(configuredTime)
      : (() => {
        const offsetHours = Math.max(0, Number(window.__cdpSchedule?.offsetHours) || 0);
        const nextHour = new Date();
        nextHour.setHours(nextHour.getHours() + 1 + offsetHours, 0, 0, 0);
        return nextHour;
      })();

    window.__cdpScheduleApplied = true;
    window.__cdpScheduledRunAt = scheduledRun.getTime();
    const buttonset = scheduledRun.getHours() < 12 ? "recurring-hourly-am" : "recurring-hourly-pm";
    return originalQuerySelectorAll.call(this,
      `oj-buttonset-many#${buttonset} input[value="${scheduledRun.getHours()}"]`);
  };

  document.addEventListener("click", (event) => {
    if (window.__cdpSchedule?.mode !== "onDemand" || window.__cdpManualScheduleApplied) return;
    if (!(event.target instanceof Element) || !event.target.closest("oj-button#saveNclose-create-job, #saveNclose-create-job")) return;

    const manual = document.querySelector(
      "oj-radioset#recurring-or-manual input[value='Manual'], oj-radioset#recurring-or-manual input[value='OnDemand']"
    );
    if (!manual) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.__cdpManualScheduleApplied = true;
    const label = document.querySelector(`label[for="${CSS.escape(manual.id)}"]`) || manual.closest("label") || manual;
    label.click();
    setTimeout(() => (document.querySelector("oj-button#saveNclose-create-job button, #saveNclose-create-job button") || manual).click(), 350);
  }, true);
})();
