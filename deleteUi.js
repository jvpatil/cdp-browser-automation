/* Oracle Unity's visible segment and Delete-job wizards. No deletion is run here. */
(() => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => Boolean(element && element.getClientRects().length);
  async function waitFor(find, label, timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (window.__cdpAutomationStopped) throw new Error("Delete preparation stopped by the user.");
      const result = find();
      if (result) return result;
      await delay(200);
    }
    throw new Error(`Delete UI did not show ${label}. Check the open page before retrying.`);
  }
  function button(label, parent = document) {
    const choices = [...parent.querySelectorAll("button")].filter((element) => visible(element) && !element.disabled && element.textContent.trim() === label);
    return label === "Continue" ? choices.at(-1) : choices[0];
  }
  function setInput(element, value) {
    if (!element) throw new Error("A required Delete UI input is missing.");
    element.scrollIntoView({ block: "center" });
    element.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter.call(element, String(value));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function click(element) {
    element.scrollIntoView({ block: "center" });
    element.focus?.();
    element.click();
  }
  async function openDropdown(element, choices, label) {
    click(element);
    try { return await waitFor(choices, label, 2500); }
    catch (_) {
      if (choices()) return choices();
      // Some Oracle JET selects listen to mousedown instead of click. Send
      // that only if the first click did not open the list, never both at once.
      const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
      element.dispatchEvent(new MouseEvent("mousedown", options));
      element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
      return waitFor(choices, label, 8000);
    }
  }
  function option(label, parent = document) {
    return [...parent.querySelectorAll('[role="option"], [role="row"]')].find((element) => visible(element) && element.textContent.trim() === label);
  }
  function destinationKey(value) {
    return String(value || "").normalize("NFKC").trim().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
  }
  function destinationOption(name) {
    const list = document.getElementById("oj-searchselect-results-delete-report-destination");
    const rows = [...(list?.querySelectorAll('[role="row"]') || [])].filter(visible);
    const exact = rows.filter((row) => row.textContent.trim() === name);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error(`Report destination ${name} is ambiguous.`);
    const compatible = rows.filter((row) => destinationKey(row.textContent) === destinationKey(name));
    if (compatible.length > 1) throw new Error(`Report destination ${name} matches multiple visible options; choose an exact destination name.`);
    return compatible[0] || null;
  }
  function errors() {
    return [...document.querySelectorAll('.oj-message-error, .oj-message-banner-item.oj-message-error, [role="alert"]')]
      .filter(visible).map((element) => element.textContent.trim()).filter(Boolean);
  }
  function checkErrors(context) {
    const found = errors();
    if (found.length) throw new Error(`${context}: ${found.join("; ").slice(0, 500)}`);
  }
  function inputIn(row, selector) {
    return [...row.querySelectorAll(selector)].find(visible);
  }
  async function chooseOperator(row, operator) {
    const label = operatorLabels[operator];
    if (!label) throw new Error(`Unsupported segment operator ${operator}.`);
    const control = row.querySelector("oj-select-single.canvas-operator");
    if (!control) throw new Error("Segment operator control is missing.");
    await delay(300);
    if (control.getAttribute("title") === label) return {};
    if (!control.classList.contains("oj-listbox-dropdown-open")) {
      const opener = control.querySelector(".oj-searchselect-open-icon") || control;
      opener.scrollIntoView({ block: "center" });
      const rect = opener.getBoundingClientRect();
      return { controlPoint: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    }
    const ready = await waitFor(() => {
      if (control.getAttribute("title") === label) return { selected: true };
      const popup = document.getElementById(`oj-searchselect-results-${control.id}`);
      const item = [...(popup?.querySelectorAll('[role="row"]') || [])]
        .find((element) => visible(element) && element.textContent.trim() === label);
      return item?.id ? { optionId: item.id } : null;
    }, `operator ${label}`, 20000);
    return ready;
  }
  const conditionRows = () => [...document.querySelectorAll(".enc-condition-container")];
  const operatorLabels = { matches: "Matches", startsWith: "Begins with", beginsWith: "Begins with", contains: "Contains", doesNotContain: "Does not contain", endsWith: "Ends with" };
  function assertBuilder(config) {
    if (!location.search.includes("root=segmentBuilder")) throw new Error("The segment builder did not open after Continue.");
    if (!document.querySelector("h1")?.textContent.includes(config.segmentName)) throw new Error("Segment builder opened the wrong segment.");
  }
  async function locateCondition({ tableName, field, index }) {
    if (!location.search.includes("root=segmentBuilder")) throw new Error("Segment builder is not open.");
    await waitFor(() => document.getElementById("segment-data-model-browsermbtree"), "My Data tree");
    if (conditionRows().length !== index) throw new Error("Segment has an unexpected condition row; refusing to widen the delete scope.");
    const key = `${tableName}.${field.fieldId}`;
    // JET keeps filtered-out nodes mounted. The plus icon itself can be
    // hover-hidden; its containing tree row must be genuinely visible.
    let plus;
    try {
      plus = await waitFor(() => [...document.querySelectorAll(".oj-ux-ico-plus[id]")]
        .find((element) => element.id === key && visible(element.closest('li[role="treeitem"]'))), `visible attribute ${key}`, 15000);
    } catch (error) {
      const exact = [...document.querySelectorAll(".oj-ux-ico-plus[id]")].filter((element) => element.id === key);
      throw new Error(`${error.message} Exact icons: ${exact.length}; visible tree rows: ${exact.filter((element) => visible(element.closest('li[role="treeitem"]'))).length}.`);
    }
    return { attributeReady: Boolean(plus) };
  }
  async function prepareCondition({ tableName, field, operator, index }) {
    const key = `${tableName}.${field.fieldId}`;
    const row = await waitFor(() => {
      const rows = conditionRows();
      return rows.length === index + 1 ? rows[index] : null;
    }, `condition row ${key}`);
    if (row.querySelector(".canvas-item-type-labels")?.textContent.trim() !== tableName) throw new Error(`Segment added the wrong table for ${key}.`);
    return await chooseOperator(row, operator);
  }
  async function conditionInput({ tableName, field, operator, index }) {
    const key = `${tableName}.${field.fieldId}`;
    await waitFor(() => conditionRows()[index]?.querySelector("oj-select-single.canvas-operator")?.getAttribute("title") === operatorLabels[operator], `selected operator ${operatorLabels[operator]}`, 15000);
    const input = await waitFor(() => inputIn(conditionRows()[index], operator === "matches"
      ? 'oj-combobox-many input[role="combobox"]'
      : 'oj-input-text input:not([id*="searchselect"]), .oj-inputtext-input:not([id*="searchselect"])'), `value input ${key}`);
    if (!input.id) throw new Error(`Segment value input for ${key} has no stable current ID.`);
    return { inputId: input.id };
  }
  async function verifyCondition({ tableName, field, operator, value, index }) {
    const row = conditionRows()[index];
    if (!row || row.querySelector(".canvas-item-type-labels")?.textContent.trim() !== tableName) throw new Error(`Segment condition ${index + 1} is missing or belongs to another table.`);
    const selectedOperator = row.querySelector("oj-select-single.canvas-operator")?.getAttribute("title");
    if (selectedOperator !== operatorLabels[operator]) throw new Error(`Segment condition ${field.fieldId} has the wrong operator.`);
    if (operator === "matches") {
      await waitFor(() => [...row.querySelectorAll("oj-combobox-many .oj-combobox-selected-choice-label")]
        .some((element) => element.textContent.trim() === String(value)), `committed match value ${value}`, 5000);
    } else {
      const input = inputIn(row, 'oj-input-text input:not([id*="searchselect"]), .oj-inputtext-input:not([id*="searchselect"])');
      if (!input || input.value !== String(value)) throw new Error(`Segment condition ${field.fieldId} did not retain value ${value}.`);
    }
    return { verified: true };
  }
  async function startSegment(config) {
    if (!location.pathname.startsWith("/segmentation/") || !location.search.includes("root=segments")) throw new Error("Open the Segments list before creating a segment.");
    click(await waitFor(() => button("Create"), "Segments Create button"));
    await waitFor(() => document.getElementById("segment-save-form"), "New segment form");
    const name = await waitFor(() => document.getElementById("segNameInput|input"), "segment name");
    setInput(name, config.segmentName);
    return { nameInputId: name.id };
  }
  async function baseObjectState(config) {
    const selector = await waitFor(() => {
      const form = document.getElementById("segment-save-form");
      const control = form?.querySelector('[role="combobox"][id="oj-select-choice-master-entity-dropdown"]');
      return visible(control) ? control : null;
    }, "Base Object selector in the New segment form");
    if (selector.getAttribute("aria-expanded") === "true") {
      await waitFor(() => [...document.querySelectorAll('#oj-listbox-results-master-entity-dropdown [role="option"]')]
        .some((element) => visible(element) && element.textContent.trim() === config.tableName), `base object ${config.tableName}`, 20000);
      return { baseOptionReady: true };
    }
    selector.scrollIntoView({ block: "center" });
    const rect = selector.getBoundingClientRect();
    return { controlPoint: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
  }
  async function continueSegment(config) {
    const form = await waitFor(() => document.getElementById("segment-save-form"), "New segment form");
    const selected = form.querySelector("#master-entity-dropdown_selected")?.textContent.trim();
    if (selected !== config.tableName) throw new Error(`Base Object is ${selected || "empty"}, not ${config.tableName}; no segment was created.`);
    click(await waitFor(() => {
      return button("Continue", form);
    }, "segment Continue button"));
    return { formSubmitted: true };
  }
  async function finishSegment(config) {
    assertBuilder(config);
    await waitFor(() => document.getElementById("data-model-search-field|input"), "segment builder");
    const requests = [
      { tableName: config.tableName, field: config.sourceIdField, operator: "matches", value: config.sourceId },
      ...config.conditions.map((condition) => ({ tableName: config.tableName, field: condition, operator: condition.operator, value: condition.value }))
    ];
    if (requests.length < 2 || conditionRows().length !== requests.length) throw new Error("Segment condition count did not match the requested scope; no segment was saved.");
    for (const [index, request] of requests.entries()) await verifyCondition({ ...request, index });
    const countButton = await waitFor(() => [...document.querySelectorAll("#segment-canvas-container button, .segment-canvas-container button")].find((element) => visible(element) && !element.disabled && element.textContent.trim() === "Count"), "segment Count preview", 15000);
    click(countButton);
    await delay(500);
    checkErrors("Segment count preview failed");
    const saveMenu = await waitFor(() => [...document.querySelectorAll('button[aria-haspopup="true"]')].find((element) => visible(element) && element.querySelector('.oj-button-text')?.textContent.trim() === "Save"), "segment Save menu");
    const saveOption = await openDropdown(saveMenu, () => [...document.querySelectorAll('[role="menuitem"], oj-option')].find((element) => visible(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true" && element.textContent.trim() === "Save"), "enabled segment Save menu item");
    click(saveOption);
    await delay(1200);
    checkErrors("Segment save failed");
    return { saveSubmitted: true };
  }
  async function verifySegment(segmentName) {
    if (!location.search.includes("root=segments")) throw new Error("Open Segments to verify the saved segment.");
    await waitFor(() => [...document.querySelectorAll("#segment-table a")].some((element) => element.textContent.trim() === segmentName), `saved segment ${segmentName}`, 30000);
    return { segmentName };
  }
  async function startDeleteJob(config) {
    if (!location.pathname.startsWith("/data/") || !location.search.includes("root=createDeleteJob")) throw new Error("Open Create delete job before preparing the job.");
    const name = await waitFor(() => document.getElementById("job-name-input|input"), "Delete job name");
    setInput(name, config.jobName);
    return { nameInputId: name.id };
  }
  async function openDeleteJobSegment(config) {
    click(await waitFor(() => {
      const element = document.querySelector("#job-details-continue-editjob button");
      return visible(element) && !element.disabled ? element : null;
    }, "enabled Job details Continue"));
    const segmentRadio = await waitFor(() => document.querySelector('input[name="delete-type"][value="DELETE_SEGMENT"]'), "Delete via segments option");
    click(segmentRadio.closest("label") || segmentRadio);
    if (!segmentRadio.checked) throw new Error("Delete via segments was not selected.");
    const segmentPicker = await waitFor(() => document.getElementById("segmentsList"), "segment picker");
    await openDropdown(segmentPicker.querySelector(".oj-select-accessible-container") || segmentPicker, () => {
      const listId = segmentPicker.querySelector('[role="combobox"][aria-controls]')?.getAttribute("aria-controls");
      const list = document.getElementById(listId);
      return list && option(config.segmentName, list);
    }, `segment option ${config.segmentName}`);
    return { optionReady: true };
  }
  async function continueDeleteJob(config) {
    const segmentPicker = await waitFor(() => document.getElementById("segmentsList"), "segment picker");
    await waitFor(() => {
      const selected = [...segmentPicker.querySelectorAll(".oj-select-selected-choice-label")].map((item) => item.textContent.trim());
      return selected.length === 1 && selected[0] === config.segmentName;
    }, `selected segment chip ${config.segmentName}`, 10000);
    const preferences = await waitFor(() => {
      const element = document.getElementById("additionalPreferences");
      return visible(element) ? element : null;
    }, "Delete additional preferences");
    for (const key of ["deleteLinked", "truncateCustomer360", "truncateCube"]) {
      const checkbox = preferences.querySelector(`input[type="checkbox"][value="${key}"]`);
      if (!checkbox || !visible(checkbox) || checkbox.disabled) throw new Error(`Delete preference ${key} is unavailable; refusing to save an unverified job.`);
      const requested = config.additionalPreferences?.[key] === true;
      if (checkbox.checked !== requested) click(checkbox);
      await waitFor(() => checkbox.checked === requested, `Delete preference ${key} = ${requested}`, 3000);
    }
    click(await waitFor(() => {
      const element = document.querySelector("#data-selection-continue button");
      return visible(element) && !element.disabled ? element : null;
    }, "Data to be deleted Continue"));
    const destination = await waitFor(() => document.getElementById("delete-report-destination|input"), "report destination picker");
    await openDropdown(destination, () => document.getElementById("oj-searchselect-filter-delete-report-destination|input"), "report destination search");
    let match = destinationOption(config.destinationName);
    if (!match) {
      const filter = await waitFor(() => document.getElementById("oj-searchselect-filter-delete-report-destination|input"), "report destination search");
      const prefix = config.destinationName.split(/[-_\s]/)[0];
      setInput(filter, prefix.length >= 3 ? prefix : config.destinationName);
      match = await waitFor(() => destinationOption(config.destinationName), `selectable report destination ${config.destinationName}`, 12000);
    }
    return { destinationOptionReady: true, actualDestinationName: match.textContent.trim() };
  }
  async function prepareDeleteJobSchedule(config) {
    const destination = await waitFor(() => document.getElementById("delete-report-destination|input"), "report destination picker");
    await waitFor(() => destinationKey(destination.value) === destinationKey(config.destinationName), `selected report destination ${config.destinationName}`);
    const filename = await waitFor(() => document.getElementById("deleteReportFileName|input"), "Delete report filename");
    setInput(filename, config.reportFileName);
    return { filenameInputId: filename.id, actualDestinationName: destination.value };
  }
  async function openDeleteJobSchedule() {
    click(await waitFor(() => {
      const element = document.querySelector("#delete-report-continue button");
      return visible(element) && !element.disabled ? element : null;
    }, "Confirmation report Continue"));
    await waitFor(() => document.querySelector("#recurring-or-manual"), "Delete schedule controls");
    return { scheduleReady: true };
  }
  async function finishDeleteJob() {
    checkErrors("Delete job form validation failed");
    const save = await waitFor(() => button("Save and close"), "Delete job Save and close");
    save.scrollIntoView({ block: "center" });
    const rect = save.getBoundingClientRect();
    return { savePoint: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
  }
  async function confirmDeleteJobSave() {
    const dialog = await waitFor(() => {
      const element = document.getElementById("deleteJobConfirmDialog");
      return visible(element) ? element : null;
    }, "Delete job Save warning", 15000);
    const message = dialog.textContent.replace(/\s+/g, " ");
    if (!message.includes("Once the delete job runs, data would be permanently deleted and cannot be recovered.")) {
      throw new Error(`Unexpected Delete job confirmation: ${message.slice(0, 300)}`);
    }
    const buttons = [...dialog.querySelectorAll("button")].filter(visible);
    const save = buttons.filter((element) => element.textContent.trim() === "Save" && !element.disabled);
    if (save.length !== 1 || buttons.filter((element) => element.textContent.trim() === "Cancel").length !== 1) {
      throw new Error("Delete job warning did not expose one Save and one Cancel action.");
    }
    click(save[0]);
    await waitFor(() => !visible(dialog) || [...document.querySelectorAll("oj-message")].some((message) => {
      if (!visible(message)) return false;
      const title = message.querySelector(".oj-message-leading-header[title]")?.getAttribute("title") || "";
      return /^(error|success|confirmation)$/i.test(title);
    }), "warning Save action to close the dialog or show a status toast", 10000);
    return { saveSubmitted: true };
  }
  async function verifyJob(jobName) {
    if (!location.search.includes("root=integrations")) throw new Error("Open Integrations to verify the saved Delete job.");
    await waitFor(() => [...document.querySelectorAll("a, td, span, div")].some((element) => visible(element)
      && element.textContent.trim() === jobName
      && !element.closest("oj-message, [role='dialog'], oj-dialog")), `saved Delete job ${jobName}`, 30000);
    return { jobName };
  }
  window.CdpDeleteUi = { startSegment, baseObjectState, continueSegment, locateCondition, prepareCondition, conditionInput, verifyCondition, finishSegment, verifySegment, startDeleteJob, openDeleteJobSegment, continueDeleteJob, prepareDeleteJobSchedule, openDeleteJobSchedule, finishDeleteJob, confirmDeleteJobSave, verifyJob };
})();
