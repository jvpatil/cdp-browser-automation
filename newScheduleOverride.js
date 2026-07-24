(function () {
  if (window.__cdpNewScheduleOverrideInstalled || window.__cdpSchedule?.schedulerUi !== "new") return;
  window.__cdpNewScheduleOverrideInstalled = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => Boolean(element?.getClientRects?.().length);
  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const config = () => ({ frequency: "Daily", timeMode: "specific", specificPreset: "in15", intervalHours: "1", intervalStartPreset: "in15", intervalEndTime: "23:59", ...(window.__cdpSchedule || {}) });
  const click = (element) => {
    element?.scrollIntoView?.({ block: "center" });
    element?.focus?.();
    const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
    element?.dispatchEvent?.(new MouseEvent("mousedown", options));
    element?.dispatchEvent?.(new MouseEvent("mouseup", { ...options, buttons: 0 }));
    element?.click?.();
  };
  const wait = async (fn, label, timeout = 12000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = fn();
      if (value) return value;
      await sleep(150);
    }
    throw new Error(`New scheduler: timed out waiting for ${label}.`);
  };
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  // The new CDP schedule markup deliberately has no stable id on the recurring
  // section. Its component tag is stable across Import and Export job pages.
  const scheduleRoot = () => document.querySelector("oj-cx-unity-job-schedule-recurring")
    || document.querySelector("oj-cx-unity-job-schedule-settings");
  const setValue = (input, value) => {
    if (!input) throw new Error("New scheduler: a required time control was not available.");
    input.scrollIntoView?.({ block: "center" });
    input.focus?.();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter ? setter.call(input, value) : input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    ["change", "focusout"].forEach((type) => input.dispatchEvent(new Event(type, { bubbles: true })));
    input.blur?.();
  };
  const labelFor = (input) => document.querySelector(`label[for="${CSS.escape(input.id)}"]`) || input;
  const timeForPreset = (preset, customTime) => {
    if (preset === "custom") {
      if (!/^\d{2}:\d{2}$/.test(customTime || "")) throw new Error("Enter a custom schedule time.");
      const [hour, minute] = customTime.split(":").map(Number);
      const result = new Date(); result.setHours(hour, minute, 0, 0);
      if (result <= new Date()) result.setDate(result.getDate() + 1);
      return result;
    }
    const result = new Date();
    if (preset === "nextHour" || preset === "plusOneHour") {
      result.setHours(result.getHours() + (preset === "plusOneHour" ? 2 : 1), 0, 0, 0);
    } else {
      result.setMinutes(result.getMinutes() + (preset === "in30" ? 30 : 15), 0, 0);
    }
    return result;
  };
  const formatTime = (date) => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  function legacyCompatibilityBridge() {
    const original = Document.prototype.querySelectorAll;
    const make = (tag, value = "") => {
      const element = document.createElement(tag);
      element.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;";
      element.textContent = value;
      document.documentElement.append(element);
      return element;
    };
    const recurringHost = make("oj-radioset");
    const recurring = document.createElement("input"); recurring.type = "radio"; recurringHost.append(recurring); recurring.addEventListener("click", () => { recurring.checked = true; });
    const hourlyHost = make("oj-buttonset-many");
    const hourly = document.createElement("input"); hourly.type = "checkbox"; hourlyHost.append(hourly); hourly.addEventListener("click", () => { hourly.checked = true; });
    const choice = make("div"); const arrow = document.createElement("span"); arrow.className = "oj-select-arrow"; choice.append(arrow);
    const selected = make("span", config().frequency);
    const list = make("div"); const option = document.createElement("div"); option.setAttribute("role", "option"); option.textContent = config().frequency; list.append(option);
    Document.prototype.querySelectorAll = function (selector) {
      if (window.__cdpSchedule?.schedulerUi !== "new") return original.call(this, selector);
      if (selector === ".schedule-job-container") return original.call(this, "oj-cx-unity-job-schedule-settings");
      if (selector === "#oj-select-choice-frequency") return [choice];
      if (selector === "#oj-listbox-results-frequency") return [list];
      if (selector === "#frequency_selected") { selected.textContent = config().frequency; return [selected]; }
      if (/^oj-buttonset-many#recurring-hourly-(?:am|pm) input\[value="\d+"\]$/.test(selector)) return [hourly];
      if (selector.includes("oj-radioset#recurring-or-manual")) return [recurring];
      if (selector.includes("oj-buttonset-many#recurring-weekly")) return [hourly];
      return original.call(this, selector);
    };
  }

  async function chooseFrequency(value) {
    const host = await wait(() => document.getElementById("requency"), "frequency selector");
    const input = await wait(() => document.getElementById("requency|input"), "frequency input");
    const trigger = host.querySelector(".oj-searchselect-arrow") || input;
    click(trigger);
    const filter = await wait(() => {
      const field = document.getElementById("oj-searchselect-filter-requency|input");
      return visible(field) ? field : null;
    }, "frequency options");
    setValue(filter, value);
    const option = await wait(() => [...document.querySelectorAll("#lovDropdown_requency [role='option'], #lovDropdown_requency [role='gridcell'], #lovDropdown_requency li, [role='option'], oj-option, li")]
      .find((element) => visible(element) && normalize(text(element)) === normalize(value)), `${value} frequency option`);
    click(option.closest("[role='option'], li, oj-option") || option);
    await wait(() => normalize(input.value) === normalize(value) ? input : null, `${value} frequency selected`);
  }

  async function selectCalendarRule(frequency) {
    if (frequency === "Daily") return;
    await sleep(250);
    const now = new Date();
    const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
    const day = String(now.getDate());
    const root = await wait(scheduleRoot, "recurring schedule controls");
    const labels = [...root.querySelectorAll("label")].filter(visible);
    const wanted = frequency === "Weekly, on selected Days" ? weekday : day;
    const label = labels.find((element) => normalize(text(element)) === normalize(wanted));
    if (label) { click(label); return; }
    // JET renders the week/day selectors differently between CDP releases.  When
    // there is no readable label, use the stable button value convention instead.
    const numericValue = frequency === "Weekly, on selected Days"
      ? String(now.getDay() + 1) // Oracle's week buttons are Sunday=1 … Saturday=7.
      : day;
    const choice = [...root.querySelectorAll(`input[value="${numericValue}"]`)]
      .find((element) => visible(element) || visible(element.closest("oj-buttonset-many, oj-radioset, .oj-choice-item")));
    if (choice) { click(labelFor(choice)); await wait(() => choice.checked, `${frequency} calendar choice`); return; }
    if (frequency === "Monthly, on selected Dates") {
      const dateInput = root.querySelector("oj-input-date input, input[type='date']");
      if (dateInput) { setValue(dateInput, now.toISOString().slice(0, 10)); return; }
    }
    throw new Error(`New scheduler: CDP did not expose a ${frequency} calendar choice.`);
  }

  async function chooseTimeMode(mode) {
    const input = await wait(() => document.querySelector(`input[name="specific_or_interval"][value="${mode}"]`), `${mode} time mode`);
    if (!input.checked) click(labelFor(input));
    await wait(() => input.checked, `${mode} mode selected`);
    await sleep(250);
  }

  async function applyNewSchedule() {
    const schedule = config();
    // This override is installed on the first job page, before the form has moved
    // through payload/mapping.  Imports can legitimately take longer than 12s to
    // reach Schedule, so keep the watcher alive until the job reaches this step.
    // Import can initially be On demand. Its time/frequency controls do not
    // exist until the trusted worker has switched Run to Recurring.
    await wait(scheduleRoot, "new schedule controls", 120000);
    // CDP accepts the scheduler's own trusted browser interactions only. The
    // isolated-world relay sends this request to the worker, which performs
    // those interactions through Chrome's debugger protocol and reports back.
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("New scheduler: trusted schedule action timed out.")), 90000);
      const handleResult = (event) => {
        window.removeEventListener("cdp-new-scheduler-result", handleResult);
        clearTimeout(timeout);
        try { resolve(JSON.parse(String(event.detail || "{}"))); }
        catch (_) { reject(new Error("New scheduler: invalid trusted action response.")); }
      };
      window.addEventListener("cdp-new-scheduler-result", handleResult, { once: true });
      window.dispatchEvent(new CustomEvent("cdp-new-scheduler-request", { detail: JSON.stringify(schedule) }));
    });
    if (!result?.ok) throw new Error(result?.error || "New scheduler: CDP did not accept the requested schedule.");
    if (Number.isFinite(result.scheduledAt)) window.__cdpScheduledRunAt = result.scheduledAt;
    window.__cdpNewScheduleApplied = true;
  }

  legacyCompatibilityBridge();
  // The worker owns the actual, trusted CDP interactions. This file remains
  // only as a compatibility bridge for the original job bookmark selectors.
  if (window.__cdpUseWorkerScheduler) return;
  // The old bookmark reaches Save immediately after its legacy schedule routine. Start
  // the real CDP configuration as soon as the new controls are rendered, then the
  // Save listener below will wait for its verified completion if it is still running.
  const applyWhenReady = applyNewSchedule().catch((error) => {
    window.__cdpNewScheduleError = error;
    console.error("CDP new schedule override failed", error);
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || window.__cdpNewScheduleApplying || window.__cdpNewScheduleSaved) return;
    if (!target.closest("oj-button#saveNclose-create-job, #saveNclose-create-job")) return;
    event.preventDefault(); event.stopImmediatePropagation();
    window.__cdpNewScheduleApplying = true;
    Promise.resolve(window.__cdpNewScheduleApplied ? null : applyWhenReady).then(() => {
      if (window.__cdpNewScheduleError) throw window.__cdpNewScheduleError;
      window.__cdpNewScheduleSaved = true;
      window.__cdpNewScheduleApplying = false;
      setTimeout(() => (document.querySelector("oj-button#saveNclose-create-job button, #saveNclose-create-job button") || target).click(), 250);
    }).catch((error) => {
      window.__cdpNewScheduleApplying = false;
      console.error("CDP new schedule override failed", error);
      alert(error.message || "Could not apply the new job schedule.");
    });
  }, true);
})();
