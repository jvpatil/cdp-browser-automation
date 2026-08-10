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

  function groupTab(group) {
    return [...document.querySelectorAll("oj-tab-bar a, oj-tab-bar button, [role=tab], a, button")]
      .find((element) => visible(element) && normal(text(element)) === normal(group));
  }

  function addObjectControl() {
    const list = document.querySelector(".oj-cxu-side-nav .data-obj-list") || document.querySelector(".data-obj-list");
    if (!list) return null;
    const controls = [...list.querySelectorAll("button, oj-button, [role=button], a, span")];
    return controls.find((element) => {
      const target = element.querySelector?.("button") || element;
      const descriptor = `${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${element.className || ""} ${target.className || ""}`;
      return visible(element) && !target.disabled && /(^|[-_\s])plus($|[-_\s])|add.*(?:object|data)|create.*(?:object|data)/i.test(descriptor);
    }) || null;
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

  function addAttributeControl() {
    const control = document.getElementById("attribute-plus-icon");
    return visible(control) ? control : null;
  }

  function dataObjectSearchInput() {
    return document.querySelector("#cd-do-search input[placeholder='Enter Keyword']") || null;
  }

  function dataObjectSearchToggle() {
    const control = document.querySelector("#cd-do-search .search-icon");
    return visible(control) ? control : null;
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
      const cancel = document.querySelector("#btnCancel button");
      // CDP enables Object ID only after Name is committed. Waiting for the
      // generated ID here deadlocks the drawer before Name can be entered.
      return visible(drawer) && drawer.classList.contains("oj-complete") &&
        visible(name) && visible(objectId) && !name.disabled &&
        cancel && !cancel.disabled && !hasVisibleLoading();
    }, "fully rendered Create data object drawer");
    // Oracle can expose the inputs just before its Knockout/JET bindings are
    // ready. Require a short stable window instead of typing into that state.
    await sleep(2000);
    await waitFor(() => !hasVisibleLoading() && document.getElementById("objNameInput|input")?.getClientRects().length,
      "Create data object drawer to become stable", 15000);
  }

  function drawerReady(expectedGroup) {
    const objectName = document.getElementById("objNameInput|input")?.value || "";
    const objectId = document.getElementById("objIdInput|input")?.value || "";
    // JET's combobox value lives on the inner input. textContent is empty,
    // which previously made this validation wait forever on page one.
    const groupInput = document.getElementById("objGroupInput|input");
    const groupValues = [groupInput?.value, document.getElementById("objGroupInput")?.value,
      ...[...document.querySelectorAll("oj-select-single, oj-combobox-one, [role=combobox]")].filter(visible).map((element) => element.value || text(element))];
    const groupMatches = groupValues.some((value) => normal(value).includes(normal(expectedGroup)));
    const next = namedButton("Next");
    return objectName && objectId && groupMatches && !(next?.querySelector("button") || next)?.disabled
      ? { objectName, objectId }
      : null;
  }

  window.cdpDataModelOpenGroup = async (group) => {
    if (!GROUPS.includes(group)) throw new Error(`Unsupported Data Model group: ${group}.`);
    await click(await waitFor(() => groupTab(group), `${group} tab`));
    await click(await waitFor(addObjectControl, `${group} add object control`));
    await waitForDrawerInteractive();
    return { group };
  };

  // The object search is an Oracle JET component: the field is not in the
  // live DOM until its icon is opened, and filtering happens on a committed
  // Enter key rather than on a plain value assignment. Background supplies
  // that trusted key sequence after this prepares the control.
  window.cdpDataModelPrepareObjectSearch = async (group) => {
    if (!GROUPS.includes(group)) throw new Error(`Unsupported Data Model group: ${group}.`);
    await click(await waitFor(() => groupTab(group), `${group} tab`));
    let search = dataObjectSearchInput();
    if (!visible(search)) {
      await click(await waitFor(dataObjectSearchToggle, "Data Model object search icon"));
      search = await waitFor(dataObjectSearchInput, "Data Model object search");
    }
    if (!visible(search) || search.disabled) throw new Error("Data Model object search is unavailable.");
    return { inputId: search.id };
  };

  window.cdpDataModelValidateAndAdvance = async (group) => {
    const ready = await waitFor(() => drawerReady(group), `${group} object name, generated ID, and group`);
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
    await sleep(4000);
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

  window.cdpDataModelOpenAttribute = async (group, objectName, groupAlreadySelected = false) => {
    if (!GROUPS.includes(group)) throw new Error(`Unsupported Data Model group: ${group}.`);
    if (!groupAlreadySelected) await click(await waitFor(() => groupTab(group), `${group} tab`));
    if (!objectTab(objectName)) {
      await waitFor(() => objectTab(objectName), `${objectName} search result`);
    }
    await click(await waitFor(() => objectTab(objectName), `${objectName} data object`));
    // CDP loads the selected object's attributes/details panel asynchronously.
    // Let the panel settle before looking for its Create-attribute control.
    await sleep(2000);
    await click(await waitFor(addAttributeControl, "Create attribute control"));
    await waitFor(() => {
      const name = document.getElementById("attrNameInput|input");
      const attributeId = document.getElementById("attrIdInput|input");
      const type = document.getElementById("attrDataTypeInput|input");
      const cancel = namedButton("Cancel");
      return visible(name) && visible(attributeId) && visible(type) && cancel && !cancel.disabled && !hasVisibleAttributeLoading() ? name : null;
    }, "fully rendered Create attribute drawer");
    await sleep(1000);
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
    await sleep(800);
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

  // A toast can appear before JET has finished closing the drawer and
  // reloading the selected object's detail panel.  Do not let the next
  // attribute reuse this stale drawer.
  await waitFor(
    () => !visible(document.getElementById("attrNameInput|input")),
    "attribute drawer to close after Save",
    60000
  );
  await sleep(4000);
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

  async function waitForRelationshipDialog() {
    return waitFor(relationshipDialog, "Create relationship dialog");
  }

  function detailsTab() {
    const tab = document.getElementById("dataObjDetails-tab");
    return visible(tab) ? tab : null;
  }

  function createRelationshipControl() {
    const control = document.getElementById("create-foreign-key-plus");
    return visible(control) ? control : null;
  }

  window.cdpDataModelCreateRelationship = async (objectName, parentName) => {
    if (!String(objectName || "").trim() || !String(parentName || "").trim()) {
      throw new Error("Relationship requires both a child object and a parent object.");
    }
    await click(await waitFor(() => objectTab(objectName), `${objectName} data object`));
    await sleep(2000);
    // The add-relationship affordance is only available in Details.  Using a
    // text-only "Create relationship" lookup could target a stale control on
    // the Attributes view and report a false save.
    await click(await waitFor(detailsTab, "Data Model Details tab"));
    await waitFor(createRelationshipControl, "Create relationship control in Details");
    await sleep(800);
    await click(createRelationshipControl());
    const dialog = await waitForRelationshipDialog();
    const childRadio = await waitFor(() => {
      const input = dialog.querySelector('input[name="object-one"][value="child"]');
      return visible(input) ? input : null;
    }, "child relationship radio button");
    await click(childRadio);
    const picker = await waitFor(() => {
      const input = dialog.querySelector("#oj-combobox-input-selectDataObjectTwo");
      return visible(input) && !input.disabled ? input : null;
    }, "parent object selector");
    await setInputValue(picker, parentName);
    const option = await waitFor(() => [...document.querySelectorAll("[role=option], oj-option, li")]
      .filter(visible)
      .find((element) => normal(text(element)) === normal(parentName)) || null,
    `parent object ${parentName}`);
    await click(option.closest("[role=option], li, oj-option") || option);
    await waitFor(() => {
      const next = relationshipButton(dialog, "Next");
      return next && !next.disabled ? next : null;
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
