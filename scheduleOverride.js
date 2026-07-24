(function () {
  if (window.__cdpScheduleOverrideInstalled) return;
  window.__cdpScheduleOverrideInstalled = true;

  const originalQuerySelectorAll = Document.prototype.querySelectorAll;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => Boolean(element?.getClientRects().length);
  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const config = () => ({ schedulerUi: "legacy", mode: "scheduled", frequency: "Daily", startTime: "immediate", ...(window.__cdpSchedule || {}) });
  const click = (element) => {
    element.scrollIntoView?.({ block: "center" });
    element.focus?.();
    const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
    if (typeof PointerEvent !== "undefined") element.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
    element.click();
  };

  function scheduledRun() {
    const schedule = config();
    const explicit = Number(schedule.scheduledAt);
    if (Number.isFinite(explicit) && explicit > Date.now()) return new Date(explicit);
    const run = new Date();
    run.setHours(run.getHours() + 1 + (schedule.startTime === "plusOneHour" ? 1 : 0), 0, 0, 0);
    return run;
  }

  Document.prototype.querySelectorAll = function (selector) {
    const hourlyQuery = typeof selector === "string" && /^oj-buttonset-many#recurring-hourly-(?:am|pm) input\[value="\d+"\]$/.test(selector);
    if (!hourlyQuery || window.__cdpScheduleApplied || config().mode === "onDemand" || config().schedulerUi === "new") {
      return originalQuerySelectorAll.call(this, selector);
    }
    const run = scheduledRun();
    window.__cdpScheduleApplied = true;
    window.__cdpScheduledRunAt = run.getTime();
    const buttonset = run.getHours() < 12 ? "recurring-hourly-am" : "recurring-hourly-pm";
    return originalQuerySelectorAll.call(this, `oj-buttonset-many#${buttonset} input[value="${run.getHours()}"]`);
  };

  async function applyWeeklyDay() {
    const day = String(new Date().getDay());
    const input = document.querySelector(`oj-buttonset-many#recurring-weekly input[value="${day}"]`);
    if (!input || input.checked) return;
    (document.querySelector(`label[for="${CSS.escape(input.id)}"]`) || input).click();
  }

  async function applyManualSchedule() {
    const manual = document.querySelector("oj-radioset#recurring-or-manual input[value='Manual'], oj-radioset#recurring-or-manual input[value='OnDemand']");
    if (!manual) throw new Error("The On-demand schedule option is not available.");
    const label = document.querySelector(`label[for="${CSS.escape(manual.id)}"]`) || manual.closest("label") || manual;
    click(label);
    await sleep(300);
    if (!manual.checked) {
      click(manual);
      manual.dispatchEvent(new Event("input", { bubbles: true }));
      manual.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(300);
    }
    if (!manual.checked) throw new Error("Could not select the On-demand schedule option.");
  }

  async function applyConfiguredFrequency() {
    const schedule = config();
    if (schedule.mode !== "scheduled" || schedule.frequency === "Daily" || window.__cdpFrequencyOverrideApplying) return;
    window.__cdpFrequencyOverrideApplying = true;
    try {
      const chooser = document.querySelector("#oj-select-choice-frequency");
      if (!visible(chooser)) throw new Error("The job frequency dropdown is not available.");
      const arrow = chooser.querySelector(".oj-select-arrow");
      // Import and Export render different JET arrow elements. The outer
      // chooser is the reliable click target when its inner arrow is hidden.
      click(visible(arrow) ? arrow : chooser);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const option = [...document.querySelectorAll("#oj-listbox-results-frequency [role='option']")]
          .find((element) => visible(element) && text(element).toLowerCase() === schedule.frequency.toLowerCase());
        if (option) {
          click(option);
          await sleep(350);
          if (text(document.querySelector("#frequency_selected")).toLowerCase() === schedule.frequency.toLowerCase()) break;
        }
        await sleep(100);
      }
      const selected = text(document.querySelector("#frequency_selected")).toLowerCase();
      if (selected !== schedule.frequency.toLowerCase()) {
        throw new Error(`Could not select ${schedule.frequency} from the job frequency dropdown.`);
      }
      if (schedule.frequency === "Weekly") await sleep(250).then(applyWeeklyDay);
    } finally {
      window.__cdpFrequencyOverrideApplying = false;
    }
  }

  document.addEventListener("click", (event) => {
    const schedule = config();
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (schedule.schedulerUi === "legacy" && schedule.mode === "onDemand" && !window.__cdpManualScheduleApplied && target.closest("oj-button#saveNclose-create-job, #saveNclose-create-job")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.__cdpManualScheduleApplied = true;
      applyManualSchedule()
        .then(() => setTimeout(() => (document.querySelector("oj-button#saveNclose-create-job button, #saveNclose-create-job button") || target).click(), 350))
        .catch((error) => {
          window.__cdpManualScheduleApplied = false;
          console.error("CDP On-demand override failed", error);
          alert(error.message || "Could not apply the On-demand schedule.");
        });
      return;
    }

    if (schedule.schedulerUi === "legacy" && schedule.mode === "scheduled" && schedule.frequency !== "Daily" && !window.__cdpFrequencySaveDeferred && !window.__cdpFrequencyOverrideSaved && target.closest("oj-button#saveNclose-create-job, #saveNclose-create-job")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.__cdpFrequencySaveDeferred = true;
      applyConfiguredFrequency()
        .then(() => {
          window.__cdpFrequencyOverrideSaved = true;
          setTimeout(() => (document.querySelector("oj-button#saveNclose-create-job button, #saveNclose-create-job button") || target).click(), 250);
        })
        .catch((error) => {
          window.__cdpFrequencySaveDeferred = false;
          console.error("CDP frequency override failed", error);
          alert(error.message || "Could not apply the selected job frequency.");
        });
      return;
    }

  }, true);
})();
