(() => {
  const GROUPS = ["Profile", "Behavioral", "Transactional", "Product", "Other"];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => Boolean(element?.getClientRects().length);
  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const normal = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const assertActive = () => { if (window.__cdpAutomationStopped) throw new Error("Data Model dry run was stopped by the user."); };

  async function waitFor(find, description, timeout = 60000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      assertActive();
      const element = find();
      if (element) return element;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }

  async function click(element) {
    if (!element) throw new Error("A required Data Model control is unavailable.");
    const target = element.querySelector?.("button") || element;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.focus?.();
    const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
    if (typeof PointerEvent !== "undefined") target.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mousedown", options));
    target.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
    target.click();
    await sleep(300);
  }

  async function clickOnce(element) {
    if (!element) throw new Error("A required Data Model control is unavailable.");
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    await sleep(300);
  }

  function groupTab(group) {
    return [...document.querySelectorAll("oj-tab-bar a, oj-tab-bar button, [role=tab], a, button")]
      .find((element) => visible(element) && normal(text(element)) === normal(group));
  }

  function addObjectControl() {
    const control = document.getElementById("do-plus-icon");
    return control?.isConnected && visible(control) && control.getAttribute("aria-disabled") !== "true" ? control : null;
  }

  function namedButton(label) {
    return [...document.querySelectorAll("button, oj-button, [role=button]")]
      .find((element) => visible(element) && normal(text(element)) === normal(label));
  }

  function objectTab(objectName) {
    return [...document.querySelectorAll("[role=tab]")].find((element) => {
      const heading = element.querySelector("h4[title], h4");
      return visible(element) && normal(heading?.getAttribute("title") || text(heading)) === normal(objectName);
    }) || null;
  }

  async function findObjectInList(objectName) {
    if (objectTab(objectName)) return true;
    const list = document.getElementById("data-object-navigation-list");
    let scroller = list;
    while (scroller && scroller !== document.body) {
      if (scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight + 8) break;
      scroller = scroller.parentElement;
    }
    if (!scroller || scroller === document.body) return false;
    scroller.scrollTop = 0;
    const deadline = Date.now() + 60000;
    let bottomSignature = "";
    let bottomSince = 0;
    while (Date.now() < deadline) {
      assertActive();
      await sleep(250);
      if (objectTab(objectName)) return true;
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (scroller.scrollTop < maxScroll - 2) {
        bottomSince = 0;
        scroller.scrollTop = Math.min(maxScroll, scroller.scrollTop + Math.max(100, scroller.clientHeight * 0.8));
        continue;
      }
      // A virtualized list can fetch the next page at the bottom. Consider
      // the end reached only when both its extent and rendered rows stay
      // unchanged long enough for that fetch to finish.
      const rendered = [...list.querySelectorAll("[role=tab] h4")]
        .map((heading) => heading.getAttribute("title") || text(heading));
      const signature = `${maxScroll}|${rendered.join("|")}`;
      if (signature !== bottomSignature) {
        bottomSignature = signature;
        bottomSince = Date.now();
      } else if (Date.now() - bottomSince >= 2000) {
        break;
      }
    }
    return Boolean(objectTab(objectName));
  }

  function addAttributeControl() {
    const control = document.getElementById("attribute-plus-icon");
    return visible(control) ? control : null;
  }

  function attributesTab() {
    const details = document.getElementById("dataObjDetails-tab");
    const tabBar = details?.closest("oj-tab-bar, [role=tablist]") || details?.parentElement?.parentElement;
    return [...(tabBar?.querySelectorAll("[role=tab], oj-option, a") || [])]
      .find((element) => visible(element) && normal(text(element)) === "attributes") || null;
  }

  function dataObjectSearchInput() {
    return document.getElementById("search-input-text|input") || null;
  }

  function dataObjectSearchToggle() {
    const control = document.querySelector("#cd-do-search .search-icon");
    return visible(control) ? control : null;
  }

  function dataObjectSearchDone() {
    const control = document.querySelector("#cd-do-search .close-container");
    return visible(control) ? control : null;
  }

  function dataObjectSearchExpanded() {
    return document.querySelector("#cd-do-search .search-box-container")?.getAttribute("aria-pressed") === "true";
  }

  function dataObjectSearchOpen() {
    return dataObjectSearchExpanded() || visible(dataObjectSearchInput());
  }

  async function selectGroup(group) {
    const tab = await waitFor(() => groupTab(group), `${group} tab`);
    // Clicking the already-selected JET tab can re-render the object list and
    // reopen its search after we have just closed it.
    if (tab.getAttribute("aria-selected") !== "true") await click(tab);
    await waitFor(() => groupTab(group)?.getAttribute("aria-selected") === "true" ? true : null,
      `${group} tab selection`, 15000);
  }

  async function closeDataObjectSearch() {
    if (!dataObjectSearchOpen()) return;
    await click(await waitFor(dataObjectSearchDone, "Data Model object search close control", 10000));
    await waitFor(() => !dataObjectSearchOpen() ? true : null,
      "Data Model object search to close", 10000);
  }

  function attributeDrawer() {
    const name = document.getElementById("attrNameInput|input");
    return name?.closest("oj-cxu-attribute-management, oj-dialog, .oj-offcanvas, .oj-cxu-offcanvas") || name?.parentElement?.parentElement?.parentElement || null;
  }

  function hasVisibleAttributeLoading() {
    const drawer = attributeDrawer();
    return [...(drawer?.querySelectorAll("[aria-busy='true'], .oj-skeleton, [class*='skeleton'], [class*='loading'], [class*='loader'], [class*='spinner'], .oj-progress") || [])]
      .some((element) => visible(element) && element.getAttribute("aria-hidden") !== "true" && getComputedStyle(element).display !== "none");
  }

  function attributeSaveState() {
    const name = document.getElementById("attrNameInput|input");
    const attributeId = document.getElementById("attrIdInput|input");
    const dataType = document.getElementById("attrDataTypeInput|input");
    const save = document.querySelector("#attr-save-btn button");
    const invalid = [name, attributeId, dataType].some((input) => input?.getAttribute("aria-invalid") === "true");
    return {
      name: name?.value?.trim() || "",
      attributeId: attributeId?.value?.trim() || "",
      dataType: dataType?.value?.trim() || "",
      invalid,
      save,
      saveEnabled: Boolean(visible(save) && !save.disabled)
    };
  }

  async function waitForAttributeDrawerStable() {
    let lastSignature = "";
    let unchangedSince = 0;
    return waitFor(() => {
      const state = attributeSaveState();
      const signature = [state.name, state.attributeId, state.dataType, state.invalid, state.saveEnabled, hasVisibleAttributeLoading()].join("|");
      if (!hasVisibleAttributeLoading()) {
        if (signature !== lastSignature) {
          lastSignature = signature;
          unchangedSince = Date.now();
        }
        // JET can expose the fields a little before its value bindings are
        // attached. Require a stable rendered drawer, instead of a blind wait.
        if (unchangedSince && Date.now() - unchangedSince >= 1200) return state;
      }
      return null;
    }, "Create attribute drawer bindings to settle", 15000);
  }

  async function setInputValue(input, value) {
    input.focus();
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function hasVisibleLoading() {
    const drawer = document.getElementById("data-object-management");
    // Scope this to the off-canvas component. The extension's persistent
    // status pill has its own visible spinner while a run is active.
    return [...(drawer?.querySelectorAll("[aria-busy='true'], .oj-skeleton, [class*='skeleton'], [class*='loading'], [class*='loader'], [class*='spinner'], .oj-progress") || [])]
      .some((element) => visible(element) && element.getAttribute("aria-hidden") !== "true" && getComputedStyle(element).display !== "none");
  }

  async function waitForDrawerInteractive() {
    await waitFor(() => {
      const drawer = document.getElementById("data-object-management");
      const name = document.getElementById("objNameInput|input");
      const objectId = document.getElementById("objIdInput|input");
      const resourceName = document.getElementById("objResNameInput|input");
      const cancel = document.querySelector("#btnCancel button");
      // CDP enables Object ID only after Name is committed. Waiting for the
      // generated ID here deadlocks the drawer before Name can be entered.
      return visible(drawer) && drawer.classList.contains("oj-complete") &&
        visible(name) && visible(objectId) && visible(resourceName) && !name.disabled && !resourceName.disabled &&
        cancel && !cancel.disabled && !hasVisibleLoading();
    }, "fully rendered Create data object drawer");
    // Oracle can expose the inputs just before its Knockout/JET bindings are
    // ready. Require a short stable window instead of typing into that state.
    await sleep(2000);
    await waitFor(() => !hasVisibleLoading() && document.getElementById("objNameInput|input")?.getClientRects().length,
      "Create data object drawer to become stable", 15000);
  }

  function drawerReady(expectedGroup, expectedResourceName = "") {
    const objectName = document.getElementById("objNameInput|input")?.value || "";
    const objectId = document.getElementById("objIdInput|input")?.value || "";
    const resourceName = document.getElementById("objResNameInput|input")?.value || "";
    // JET's combobox value lives on the inner input. textContent is empty,
    // which previously made this validation wait forever on page one.
    const groupInput = document.getElementById("objGroupInput|input");
    const groupValues = [groupInput?.value, document.getElementById("objGroupInput")?.value,
      ...[...document.querySelectorAll("oj-select-single, oj-combobox-one, [role=combobox]")].filter(visible).map((element) => element.value || text(element))];
    const groupMatches = groupValues.some((value) => normal(value).includes(normal(expectedGroup)));
    const next = namedButton("Next");
    const resourceMatches = !expectedResourceName || normal(resourceName) === normal(expectedResourceName);
    return objectName && objectId && resourceMatches && groupMatches && !(next?.querySelector("button") || next)?.disabled
      ? { objectName, objectId, resourceName }
      : null;
  }

  window.cdpDataModelOpenGroup = async (group) => {
    if (!GROUPS.includes(group)) throw new Error(`Unsupported Data Model group: ${group}.`);
    await selectGroup(group);
    // Search replaces the Data objects Create icon. The icon is not merely
    // hidden: JET removes it from the DOM until search is closed.
    await closeDataObjectSearch();
    let add = null;
    try {
      add = await waitFor(addObjectControl, `${group} Data objects Create icon`, 10000);
    } catch (_) {
      // If JET left the header in an inconsistent state, switching groups
      // forces a fresh header render. Never wait indefinitely for an absent +.
      const otherGroup = GROUPS.find((candidate) => candidate !== group);
      await selectGroup(otherGroup);
      await selectGroup(group);
      await closeDataObjectSearch();
      add = await waitFor(addObjectControl, `${group} Data objects Create icon after group refresh`, 10000);
    }
    await click(add);
    await waitForDrawerInteractive();
    return { group };
  };

  // The object search is an Oracle JET component: the field is not in the
  // live DOM until its icon is opened, and filtering happens on a committed
  // Enter key rather than on a plain value assignment. Background supplies
  // that trusted key sequence after this prepares the control.
  window.cdpDataModelPrepareObjectSearch = async (group, objectName = "") => {
    if (!GROUPS.includes(group)) throw new Error(`Unsupported Data Model group: ${group}.`);
    await selectGroup(group);
    // A just-created object is normally already in the navigation list. Use
    // that exact row instead of opening JET search: its async search commit
    // can reset the query and select the first object (Account) mid-run.
    // Walk a virtualized/continuously loaded list before using search, so
    // this also works when the target is beyond the first rendered page.
    await closeDataObjectSearch();
    if (objectName) {
      if (await findObjectInList(objectName)) return { mode: "direct" };
    }
    let search = dataObjectSearchInput();
    if (!visible(search)) {
      await click(await waitFor(dataObjectSearchToggle, "Data Model object search icon"));
      search = await waitFor(() => dataObjectSearchExpanded() && visible(dataObjectSearchInput())
        ? dataObjectSearchInput() : null, "expanded Data Model object search");
    }
    if (!visible(search) || search.disabled) throw new Error("Data Model object search is unavailable.");
    return { mode: "search", inputId: search.id };
  };

  window.cdpDataModelWaitForObjectSearchResult = async (objectName) => {
    let matchedSince = 0;
    await waitFor(() => {
      const query = dataObjectSearchInput()?.value?.trim();
      const names = [...document.querySelectorAll("#data-object-navigation-list [role=tab] h4")]
        .filter(visible).map((heading) => heading.getAttribute("title") || text(heading));
      const matched = dataObjectSearchOpen() && normal(query) === normal(objectName) &&
        names.length === 1 && normal(names[0]) === normal(objectName);
      if (!matched) { matchedSince = 0; return null; }
      if (!matchedSince) matchedSince = Date.now();
      return Date.now() - matchedSince >= 500 ? true : null;
    }, `Data Model search to filter to ${objectName}`, 20000);
    return { found: true };
  };

  window.cdpDataModelFinishObjectSearch = async () => {
    // Keep the search untouched while attributes are being added. Only close
    // it once that object is complete; the next create step owns + recovery.
    await closeDataObjectSearch();
    return { searchClosed: true };
  };

  window.cdpDataModelValidateAndAdvance = async (group, expectedResourceName = "") => {
    const ready = await waitFor(() => drawerReady(group, expectedResourceName), "Data Model object name, Resource Name, generated ID, and group");
    await click(namedButton("Next"));
    await waitFor(() => {
      const back = namedButton("Back");
      const pageText = document.body.textContent || "";
      return back && /bucketing strategy|partition strategy/i.test(pageText) ? true : null;
    }, `${group} object settings`);
    return { group, ...ready, settingsReady: true };
  };

  window.cdpDataModelPrepareForSave = async () => {
    const increment = await waitFor(() => {
      const element = document.getElementById("plus");
      return visible(element) ? element : null;
    }, "Expected number of records increment");
    await click(increment);
    const save = await waitFor(() => {
      const button = document.querySelector("#data-object-save-btn button");
      return visible(button) && !button.disabled ? button : null;
    }, "Save to become enabled after setting expected records");
    return { expectedRecords: document.querySelector(".record-count-value")?.textContent?.trim() || "5", saveEnabled: !save.disabled };
  };

  window.cdpDataModelSave = async () => {
    await click(await waitFor(() => {
      const button = document.querySelector("#data-object-save-btn button");
      return visible(button) && !button.disabled ? button : null;
    }, "enabled Save button"));
    await waitFor(() => {
      const drawer = document.getElementById("data-object-management");
      const savedMessage = [...document.querySelectorAll("[role=alert], .oj-message, .oj-message-detail, [class*='toast'], [class*='notification']")]
        .filter(visible).some((element) => /saved successfully|changes have been saved|created successfully/i.test(text(element)));
      return !visible(drawer) || savedMessage;
    }, "Data Model object save confirmation", 60000);
    // CDP displays its toast before it has closed the creation drawer and
    // restored the object list. Do not let the next object/attribute step run
    // against this still-closing form.
    await waitFor(
      () => !visible(document.getElementById("data-object-management")),
      "Data Model object drawer to close after Save",
      60000
    );
    await waitFor(
      () => {
        const list = document.querySelector(".oj-cxu-side-nav .data-obj-list");
        return visible(list) ? list : null;
      },
      "Data Model object list to reload after Save",
      60000
    );
    return { saved: true };
  };

  window.cdpDataModelOpenAttribute = async (group, objectName, groupAlreadySelected = false, targetConfirmed = false) => {
    if (!GROUPS.includes(group)) throw new Error(`Unsupported Data Model group: ${group}.`);
    if (!groupAlreadySelected) await click(await waitFor(() => groupTab(group), `${group} tab`));
    if (!objectTab(objectName)) {
      await waitFor(() => objectTab(objectName), `${objectName} search result`);
    }
    const object = await waitFor(() => objectTab(objectName), `${objectName} data object`);
    if (!targetConfirmed || object.getAttribute("aria-selected") !== "true") {
      // A single click is enough for the navigation item. The generic helper
      // dispatches a mouse sequence and then click(), which can trigger this
      // JET navigation handler twice and reset its active search.
      await clickOnce(object);
    }
    await waitFor(() => objectTab(objectName)?.getAttribute("aria-selected") === "true" ? true : null,
      `${objectName} to become the selected data object`, 10000);
    // A relationship leaves the object on Details. Explicitly return to
    // Attributes; do not trust a stale tab selection from the prior object.
    const attributes = await waitFor(attributesTab, "Data Model Attributes tab");
    if (!targetConfirmed || attributes.getAttribute("aria-selected") !== "true") await clickOnce(attributes);
    // Oracle can highlight the new row while its drawer still binds to the
    // previous object (often Account). Validate the drawer itself, and retry
    // once after closing the stale drawer. Never enter a field on that object.
    let correctDrawer = false;
    for (let attempt = 0; attempt < 2 && !correctDrawer; attempt++) {
      await clickOnce(await waitFor(addAttributeControl, "Create attribute control"));
      const name = await waitFor(() => {
        const input = document.getElementById("attrNameInput|input");
        return visible(input) && !hasVisibleAttributeLoading() ? input : null;
      }, "Create attribute drawer", 15000);
      const drawer = attributeDrawer();
      const selectedTitle = text(drawer?.querySelector?.(".data-object-title"));
      correctDrawer = normal(selectedTitle) === normal(`Data object : ${objectName}`);
      if (correctDrawer) break;
      await window.cdpDataModelCancelAttribute();
      if (attempt === 1) throw new Error(`Create attribute opened for ${selectedTitle || "another object"}, not ${objectName}. No field was entered.`);
      await clickOnce(await waitFor(() => objectTab(objectName), `${objectName} data object`));
      await waitFor(() => objectTab(objectName)?.getAttribute("aria-selected") === "true" ? true : null,
        `${objectName} to become the selected data object`, 10000);
      await clickOnce(await waitFor(attributesTab, "Data Model Attributes tab"));
    }
    await waitFor(() => {
      const name = document.getElementById("attrNameInput|input");
      const attributeId = document.getElementById("attrIdInput|input");
      const type = document.getElementById("attrDataTypeInput|input");
      return visible(name) && visible(attributeId) && visible(type) && !hasVisibleAttributeLoading() ? name : null;
    }, "fully rendered Create attribute drawer");
    await waitForAttributeDrawerStable();
    return { opened: true };
  };

  window.cdpDataModelSelectAttributeDataType = async (dataType) => {
    const input = await waitFor(() => {
      const element = document.getElementById("attrDataTypeInput|input");
      return visible(element) && !element.disabled ? element : null;
    }, "Attribute data type dropdown");
    const host = input.closest("oj-select-single, oj-combobox-one");
    const trigger = host?.querySelector(".oj-searchselect-arrow,.oj-searchselect-main-field,.oj-text-field-container,[role=combobox]") || input;
    await click(trigger);
    const filter = await waitFor(() => {
      const element = document.getElementById("oj-searchselect-filter-attrDataTypeInput|input");
      return visible(element) ? element : null;
    }, "Attribute data type filter");
    await setInputValue(filter, dataType);
    const option = await waitFor(() => [...document.querySelectorAll("[role=option], oj-option, li")]
      .filter(visible)
      .find((element) => normal(text(element)) === normal(dataType) || normal(element.getAttribute("value")) === normal(dataType)) || null,
    `Attribute data type ${dataType}`);
    await click(option.closest("[role=option], li, oj-option") || option);
    await waitFor(() => normal(input.value || host?.value || host?.getAttribute("value")) === normal(dataType) ? input : null,
      `selected Attribute data type ${dataType}`);
    return { dataType: input.value || dataType };
  };

window.cdpDataModelSaveAttribute = async () => {
    const save = await waitFor(() => {
      const state = attributeSaveState();
      return state.name && state.attributeId && state.dataType && !state.invalid && !hasVisibleAttributeLoading() && state.saveEnabled
        ? state.save
        : null;
    }, "attribute validation and enabled Save", 60000);
    // The button may become enabled a fraction before JET completes its
    // validation/render pass. Require it to remain usable before saving.
    await sleep(250);
    const ready = attributeSaveState();
    if (!ready.saveEnabled || ready.invalid || !ready.name || !ready.attributeId || !ready.dataType) {
      throw new Error("Attribute Save did not remain enabled after validation.");
    }
  await click(save);
  await waitFor(() => {
      const savedMessage = [...document.querySelectorAll("[role=alert], .oj-message, .oj-message-detail, [class*='toast'], [class*='notification']")]
        .filter(visible).some((element) => /saved successfully|changes have been saved|created successfully/i.test(text(element)));
      return !visible(document.getElementById("attrNameInput|input")) || savedMessage;
  }, "attribute save confirmation", 60000);

  // CDP shows its save banner before JET has fully committed the attribute
  // and regenerated the next drawer's Attribute ID binding. Keep a small
  // explicit settle window before the existing readiness checks.
  await sleep(2000);

  // A toast can appear before JET has finished closing the drawer and
  // reloading the selected object's detail panel.  Do not let the next
  // attribute reuse this stale drawer.
  await waitFor(
    () => !visible(document.getElementById("attrNameInput|input")),
    "attribute drawer to close after Save",
    60000
  );
  await waitFor(
    () => {
      const addControl = document.getElementById("attribute-plus-icon");
      return addControl && visible(addControl) && !hasVisibleAttributeLoading()
        ? addControl
        : null;
    },
    "attribute details panel to reload",
    60000
  );
  return { saved: true };
};

  window.cdpDataModelCancelAttribute = async () => {
    const name = document.getElementById("attrNameInput|input");
    if (!visible(name)) return { cancelled: false };
    const drawer = attributeDrawer() || document;
    const cancel = [...drawer.querySelectorAll("button, oj-button, [role=button]")]
      .find((element) => visible(element) && normal(text(element)) === "cancel");
    if (!cancel) return { cancelled: false };
    await click(cancel);
    await waitFor(() => !visible(document.getElementById("attrNameInput|input")), "Create attribute drawer to close", 15000);
    return { cancelled: true };
  };

  function relationshipDialog() {
    return [...document.querySelectorAll("[role=dialog], oj-dialog, .oj-dialog, .oj-offcanvas")]
      .find((element) => visible(element) && /create relationship/i.test(text(element))) || null;
  }

  function relationshipButton(dialog, label) {
    return [...(dialog?.querySelectorAll("button, oj-button, [role=button]") || [])]
      .find((element) => visible(element) && normal(text(element)) === normal(label)) || null;
  }

  async function waitForRelationshipDialog(timeout = 60000) {
    return waitFor(relationshipDialog, "Create relationship dialog", timeout);
  }

  function detailsTab() {
    const tab = document.getElementById("dataObjDetails-tab");
    return visible(tab) ? tab : null;
  }

  function createRelationshipControl() {
    const control = document.getElementById("create-foreign-key-plus");
    const target = control?.querySelector?.("button") || control;
    return control?.isConnected && visible(control) && target && !target.disabled ? control : null;
  }

  window.cdpDataModelPrepareRelationship = async (group, objectName, parentName) => {
    if (!GROUPS.includes(group)) throw new Error(`Unsupported Data Model group: ${group}.`);
    if (!String(objectName || "").trim() || !String(parentName || "").trim()) {
      throw new Error("Relationship requires both a child object and a parent object.");
    }
    // Relationships are created after all attribute sets. Return to this
    // object’s group first; otherwise only the last group’s object list exists.
    await click(await waitFor(() => groupTab(group), `${group} tab`));
    await click(await waitFor(() => objectTab(objectName), `${objectName} data object`));
    await waitFor(() => objectTab(objectName)?.getAttribute("aria-selected") === "true" ? true : null,
      `${objectName} to become the selected relationship child`, 10000);
    // The add-relationship affordance is only available in Details.  Using a
    // text-only "Create relationship" lookup could target a stale control on
    // the Attributes view and report a false save.
    await click(await waitFor(detailsTab, "Data Model Details tab"));
    // The Details panel can re-render after selecting an object. Click the
    // exact connected instance that satisfied the wait, not a later lookup.
    let relationshipControl = await waitFor(createRelationshipControl, "Create relationship control in Details");
    await click(relationshipControl);

    let dialog = null;
    try {
      dialog = await waitForRelationshipDialog(8000);
    } catch (_) {
      // One fresh-control retry covers the Details-panel re-render race
      // without repeatedly creating dialogs or leaving the runner looping.
      relationshipControl = await waitFor(createRelationshipControl, "refreshed Create relationship control in Details");
      await click(relationshipControl);
      dialog = await waitForRelationshipDialog();
    }
    const childRadio = await waitFor(() => {
      const input = dialog.querySelector('input[name="object-one"][value="child"]');
      return visible(input) ? input : null;
    }, "child relationship radio button");
    await click(childRadio);
    const picker = await waitFor(() => {
      const input = dialog.querySelector("#oj-combobox-input-selectDataObjectTwo");
      return visible(input) && !input.disabled ? input : null;
    }, "parent object selector");
    return { inputId: picker.id };
  };

  window.cdpDataModelCompleteRelationship = async (objectName, parentName) => {
    const dialog = await waitForRelationshipDialog();
    const picker = dialog.querySelector("#oj-combobox-input-selectDataObjectTwo");
    if (!visible(picker)) throw new Error("Relationship parent selector is no longer available.");
    const option = await waitFor(() => [...document.querySelectorAll("#oj-listbox-results-selectDataObjectTwo [role=option]")]
      .filter(visible)
      .find((element) => normal(element.getAttribute("aria-label") || text(element)) === normal(parentName)) || null,
    `parent object ${parentName}`);
    await click(option);
    await waitFor(() => {
      const next = relationshipButton(dialog, "Next");
      return normal(picker.value) === normal(parentName) && next && !next.disabled ? next : null;
    }, "relationship Next button");
    await click(relationshipButton(dialog, "Next"));
    const addToObject = await waitFor(() => {
      const checkbox = relationshipDialog()?.querySelector('input[type="checkbox"]');
      return visible(checkbox) ? checkbox : null;
    }, "relationship attribute compatibility step");
    if (!addToObject.checked) await click(addToObject);
    const save = await waitFor(() => {
      const button = relationshipButton(relationshipDialog(), "Save");
      return button && !button.disabled ? button : null;
    }, "enabled relationship Save button", 60000);
    await sleep(500);
    await click(save);
    await waitFor(() => {
      return [...document.querySelectorAll("[role=alert], .oj-message, .oj-message-detail, [class*='toast'], [class*='notification']")]
        .filter(visible)
        .some((element) => /your changes have been saved\.?/i.test(text(element)));
    }, "CDP relationship save confirmation: Your changes have been saved.", 60000);
    await waitFor(() => !visible(relationshipDialog()), "relationship dialog to close after save", 60000);
    // CDP rerenders Details asynchronously and does not expose a stable
    // parent-relationship text container. Its success toast is the
    // authoritative persistence signal; a text scan caused false failures
    // even when CDP had created the relationship.
    return { child: objectName, parent: parentName, saved: true, verified: true };
  };

  window.cdpDataModelCancel = async () => {
    const cancel = namedButton("Cancel");
    if (!cancel) return { cancelled: false };
    await click(cancel);
    await waitFor(() => !visible(document.getElementById("objNameInput|input")), "Create data object drawer to close", 15000);
    return { cancelled: true };
  };
})();
