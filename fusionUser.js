(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normal = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const text = (element) => String(element?.textContent || "").replace(/\s+/g, " ").trim();
  const visible = (element) => Boolean(element?.getClientRects?.().length) && getComputedStyle(element).visibility !== "hidden";
  const enabled = (element) => Boolean(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true";

  async function waitFor(find, description, timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (window.__cdpAutomationStopped) throw new Error("Fusion user preparation was stopped by the user.");
      const element = find();
      if (element) return element;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }

  async function click(element) {
    if (!element) throw new Error("A required Fusion Security Console control is unavailable.");
    const target = element.matches?.("button,a,input") ? element : (element.querySelector?.("button,a,input") || element);
    target.scrollIntoView({ block: "center", inline: "center" });
    target.focus?.();
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
    target.click();
    await sleep(350);
  }

  function exactControl(label, root = document) {
    const expected = normal(label);
    return [...root.querySelectorAll("button,a,[role=button]")].find((element) => visible(element) && enabled(element) && normal(text(element)) === expected) || null;
  }

  function field(label) {
    const adfFieldSuffix = {
      "first name": ":auFirstName::content",
      "last name": ":auLastName::content",
      "email": ":auEmail::content",
      "phone": ":auPhone::content",
      "user name": ":itUsrLoginAdd::content",
      "password": ":itPasswd::content",
      "confirm password": ":itConfPasswd::content"
    }[normal(label)];
    if (adfFieldSuffix) {
      const exactAdfField = document.querySelector(`input[id$="${adfFieldSuffix}"]`);
      if (exactAdfField && visible(exactAdfField) && !exactAdfField.disabled) return exactAdfField;
    }
    const expected = normal(label);
    const labels = [...document.querySelectorAll("label")].filter((element) => visible(element) && normal(text(element)) === expected);
    for (const labelElement of labels) {
      const byFor = labelElement.htmlFor && document.getElementById(labelElement.htmlFor);
      if (byFor?.matches?.("input,textarea")) return byFor;
      const local = labelElement.parentElement?.querySelector("input,textarea") || labelElement.closest("div")?.querySelector("input,textarea");
      if (local && visible(local) && !local.disabled) return local;
    }
    return [...document.querySelectorAll("input,textarea")].find((element) => visible(element) && !element.disabled && [element.getAttribute("aria-label"), element.name, element.placeholder, element.id].some((value) => normal(value) === expected)) || null;
  }

  function checkbox(label) {
    const expected = normal(label);
    return [...document.querySelectorAll("input[type=checkbox]")].find((element) => {
      if (!visible(element) || element.disabled) return false;
      const container = element.closest("label,div,span");
      return normal(text(container)).includes(expected) || normal(element.getAttribute("aria-label")) === expected;
    }) || null;
  }

  function setValue(input, value) {
    if (!input) throw new Error("A required Fusion user field is unavailable.");
    input.focus();
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    input.blur();
  }

  function setSearchValue(input, value) {
    if (!input) throw new Error("A required Fusion search field is unavailable.");
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function fillField(label, value, required = false) {
    if (!required && !value) return;
    const input = field(label);
    if (!input) throw new Error(`Fusion field unavailable: ${label}.`);
    setValue(input, value);
    // ADF commits the value-change event after the field loses focus.  Let the
    // partial-page lifecycle finish before interacting with the next control.
    await sleep(180);
  }

  function roleDialog() {
    const dialogs = [...document.querySelectorAll("div")]
      .filter((element) => visible(element) && normal(text(element)).includes("add role membership from role"));
    return dialogs.find((element) => element.querySelector('input[id$=":urSrcBx::content"]')) || null;
  }

  function dialogSearchInput(dialog) {
    const adfRoleSearch = dialog.querySelector('input[id$=":urSrcBx::content"]');
    if (adfRoleSearch && visible(adfRoleSearch) && !adfRoleSearch.disabled) return adfRoleSearch;
    return [...dialog.querySelectorAll("input")].find((input) => visible(input) && !input.disabled && input.type !== "hidden") || null;
  }

  function dialogSearchAction(dialog) {
    return dialog.querySelector('[id$=":f1:cil121"]')
      || exactControl("Search", dialog)
      || [...dialog.querySelectorAll("a,button")].find((element) => visible(element) && /search/i.test(`${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""} ${element.id || ""}`))
      || null;
  }

  function roleResult(dialog, role) {
    const expected = normal(role);
    return [...dialog.querySelectorAll("td,div,span,a")].filter((element) => visible(element) && normal(text(element)) === expected).sort((a, b) => text(a).length - text(b).length)[0] || null;
  }

  function visibleSelector(selector, root = document) {
    return [...root.querySelectorAll(selector)].find((element) => visible(element) && enabled(element)) || null;
  }

  function textControl(label, root = document) {
    const expected = normal(label);
    return [...root.querySelectorAll("a,button,[role=button],[role=option]")]
      .filter((element) => visible(element) && enabled(element))
      .find((element) => normal(element.getAttribute("aria-label") || element.getAttribute("title") || text(element)) === expected) || null;
  }

  function menuItem(label, root = document) {
    const expected = normal(label);
    return [...root.querySelectorAll('[role="menuitem"], [role="option"], div, span, a')]
      .filter((element) => visible(element) && enabled(element) && normal(text(element)) === expected)
      // Prefer the smallest matching element, so a menu item wins over its
      // containing popup/layer.
      .sort((a, b) => text(a).length - text(b).length)[0] || null;
  }

  function xpathControl(expression) {
    const result = document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    return visible(result) && enabled(result) ? result : null;
  }

  async function beginInstanceAdminAssignment() {
    const rolesTab = await waitFor(
      () => visibleSelector('[id*="ASE_FUSE_RM_WORKAREA"][id$="::disAcr"]'),
      "Security Console Roles tab"
    );
    await click(rolesTab);

    const roleTypeDrop = await waitFor(() => visibleSelector('[id$=":selectStore::drop"]'), "Roles and Privileges dropdown");
    await click(roleTypeDrop);
    await click(await waitFor(() => textControl("Roles and Permission Groups"), "Roles and Permission Groups option"));

    const roleSearch = await waitFor(() => visibleSelector('input[id$=":srchBox::content"]'), "Instance Admin role search");
    return { inputId: roleSearch.id };
  }

  async function finishInstanceAdminAssignment(userName) {
    const roleSearch = await waitFor(() => visibleSelector('input[id$=":srchBox::content"]'), "Instance Admin role search");
    const searchButtonId = roleSearch.id.replace(/:srchBox::content$/, ":cil1");
    const roleSearchAction = await waitFor(
      () => {
        const button = document.getElementById(searchButtonId);
        return visible(button) && enabled(button) ? button : null;
      },
      "Instance Admin role search action"
    );
    await click(roleSearchAction);
    const roleRow = await waitFor(() => roleResult(document, "instance-admin"), "Instance Admin role result", 20000);
    const actions = await waitFor(() => visibleSelector('[id*="resList:0:cb1"]') || textControl("Actions", roleRow.closest("tr") || document), "Instance Admin actions menu");
    await click(actions);
    await click(await waitFor(() => menuItem("Edit Role"), "Edit Role action"));

    const usersStep = await waitFor(
      () => visibleSelector('[aria-label*="Users Step"]') || textControl("Users"),
      "role Users step"
    );
    await click(usersStep);
    const addUser = await waitFor(() => textControl("Add User"), "Add User button");
    await click(addUser);
    const userDialogSearch = await waitFor(() => visibleSelector('input[id$=":usSrcBx::content"]'), "created-user search");
    setValue(userDialogSearch, userName);
    // This popup has its own search command. Scope it to the user-search input
    // so it cannot resolve to a similarly named control elsewhere in Fusion.
    await sleep(2000);
    const userSearchButtonId = userDialogSearch.id.replace(/:usSrcBx::content$/, ":cil1");
    await click(await waitFor(() => {
      const button = document.getElementById(userSearchButtonId);
      return visible(button) && enabled(button) ? button : null;
    }, "created-user search action"));
    const userResult = await waitFor(() => roleResult(document, userName), `created user ${userName}`);
    await click(userResult.closest("tr,[role=row]") || userResult.parentElement || userResult);
    const addUserToRole = await waitFor(() => visibleSelector('button[id$=":usAddUs"]'), "Add User to Role button");
    await click(addUserToRole);
    await click(await waitFor(() => visibleSelector('button[id$=":cb4"]') || textControl("Next"), "role wizard Next button"));
    await waitFor(
      () => xpathControl("//button[@title='Save and Close' and contains(@id, 'cb1') ]"),
      "Instance Admin Save and Close button"
    );
    return { roleSaveReady: true };
  }

  async function addRoles(roles) {
    if (!roles.length) return;
    await click(await waitFor(() => exactControl("Add Role"), "Add Role button"));
    const dialog = await waitFor(roleDialog, "Add Role Membership dialog");
    await sleep(2000);
    for (const role of roles) {
      const search = await waitFor(() => dialogSearchInput(dialog), "role search field");
      setSearchValue(search, role);
      await sleep(300);
      const searchAction = dialogSearchAction(dialog);
      if (searchAction) await click(searchAction);
      const result = await waitFor(() => roleResult(dialog, role), `role result ${role}`);
      await click(result.closest("tr,[role=row]") || result.parentElement || result);
      await click(await waitFor(() => exactControl("Add Role Membership", dialog), "Add Role Membership button"));
      await sleep(400);
    }
    await click(await waitFor(() => exactControl("Done", dialog), "Done button"));
    // ADF leaves the closed dialog's markup visible to DOM queries during its
    // partial-page refresh. Waiting for that markup to vanish can stall the run
    // for 45 seconds even though Done succeeded. The caller instead waits for
    // the exact live Save control on the restored user form.
    await sleep(800);
  }

  window.cdpFusionPrepareUser = async (user) => {
    await click(await waitFor(() => exactControl("Add User Account"), "Add User Account button"));
    await waitFor(() => field("Last Name") && field("Email") && field("User Name"), "Add User Account form");
    // ADF accepts only trusted keyboard input for these fields. The background
    // worker supplies that input after this form has settled.
    return { formReady: true };
  };

  window.cdpFusionAddUserRoles = async (roles) => {
    const selectedRoles = [...new Set(roles || [])];
    await addRoles(selectedRoles);
    // Closing the role modal starts an ADF partial-page refresh. Do not hand
    // control back until the *new-user form's* Save and Close command is live.
    await waitFor(
      () => xpathControl("//button[@title='Save and Close' and contains(@id, ':sp1:saveBtn') ]"),
      "new-user Save and Close button",
      60000
    );
    return { roles: selectedRoles, rolesReady: true };
  };

  window.cdpFusionAssignInstanceAdmin = async (userName) => {
    const { inputId } = await beginInstanceAdminAssignment();
    setValue(document.getElementById(inputId), "instance-admin");
    await sleep(3000);
    await finishInstanceAdminAssignment(userName);
    return { instanceAdminAdded: true };
  };

  window.cdpFusionBeginInstanceAdminAssignment = beginInstanceAdminAssignment;
  window.cdpFusionFinishInstanceAdminAssignment = async (userName) => {
    return finishInstanceAdminAssignment(userName);
  };
})();
