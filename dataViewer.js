(() => {
  const visible = (element) => Boolean(element?.getClientRects().length);
  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const normalize = (value) => String(value || "").replace(/\s+/g, "").trim().toLowerCase();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (find, label, timeout = 30000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (window.__cdpAutomationStopped) throw new Error("Data Viewer automation was stopped by the user.");
      const result = find();
      if (result) return result;
      await sleep(200);
    }
    throw new Error(`Data Viewer did not load ${label}.`);
  };
  const setValue = (element, value) => {
    if (!element) return;
    // JET's inside labels float only after a genuine focus/blur lifecycle.
    // Dispatching focusout alone leaves the label over the programmatic value.
    element.focus?.({ preventScroll: true });
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter ? setter.call(element, value) : element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: String(value), inputType: "insertText" }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    element.blur?.();
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  };
  const typeValue = (element, value) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter ? setter.call(element, value) : element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: String(value), inputType: "insertText" }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: String(value).slice(-1), bubbles: true, composed: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { key: String(value).slice(-1), bubbles: true, composed: true }));
  };
  const click = (element) => {
    if (!element) return;
    element.scrollIntoView?.({ block: "center" });
    element.focus?.();
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerType: "mouse", isPrimary: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerType: "mouse", isPrimary: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    element.click();
  };
  const requestTrustedNextClick = (button) => new Promise((resolve) => {
    const rect = button?.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
      resolve(false);
      return;
    }
    const requestId = `data-viewer-next-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let finished = false;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("cdp-data-viewer-trusted-click-result", onResult);
      resolve(Boolean(ok));
    };
    const onResult = () => {
      try {
        const result = JSON.parse(document.documentElement.dataset.cdpDataViewerTrustedClickResult || "{}");
        if (result.requestId === requestId) finish(result.ok);
      } catch (_error) {
        finish(false);
      }
    };
    window.addEventListener("cdp-data-viewer-trusted-click-result", onResult);
    document.documentElement.dataset.cdpDataViewerTrustedClick = JSON.stringify({
      action: "next",
      requestId,
      rect: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    });
    window.dispatchEvent(new Event("cdp-data-viewer-trusted-click"));
    setTimeout(() => finish(false), 2500);
  });
  const currentDrawer = () => {
    const drawer = document.getElementById("ingestRecordsCanvas");
    return visible(drawer) ? drawer : null;
  };
  // The drawer container and header render before the record form. While CDP
  // fetches metadata it keeps an `oj-cx-unity-loader` with skeleton fields in
  // the body and disables Next. Do not interact with that intermediate state.
  const drawerIsLoading = (drawer) => [...(drawer?.querySelectorAll("oj-cx-unity-loader, .table-skeleton-container, .oj-animation-skeleton") || [])]
    .some((element) => visible(element));
  const drawerFormReady = (drawer) => {
    if (!drawer || drawerIsLoading(drawer) || !entryFieldKeys(drawer).length) return false;
    const next = [...drawer.querySelectorAll("button")]
      .find((button) => visible(button) && /^next$/i.test(text(button)));
    return Boolean(next && !next.disabled && next.getAttribute("aria-disabled") !== "true");
  };
  const setProgress = (stage) => {
    document.documentElement.dataset.cdpDataViewerProgress = stage;
  };

  const selectDataObject = async (tableName) => {
    const input = await wait(() => document.getElementById("data-object-dropdown|input"), "the data-object selector", 30000);
    const host = input.closest("oj-combobox-one");
    if (!host) throw new Error("The Data Viewer data-object selector component was not available.");
    click(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true, bubbles: true, composed: true }));
    typeValue(input, "");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, composed: true }));
    typeValue(input, tableName);
    const list = await wait(() => {
      const candidate = document.getElementById(input.getAttribute("aria-controls") || "");
      return visible(candidate) ? candidate : null;
    }, "the data-object results", 10000);
    // CDP renders the data object name in this nested title element; the option's
    // complete text also includes its description, so a generic text match is unsafe.
    const option = await wait(() => [...list.querySelectorAll("[role='option']")]
      .find((item) => visible(item) && normalize(item.querySelector(".oj-flex-item.oj-sm-5 .clip-text[title]")?.getAttribute("title")) === normalize(tableName)), `${tableName} in the data-object results`, 10000);
    click(option);
    const selected = () => normalize(input.value) === normalize(tableName)
      && normalize(host.value) === normalize(tableName)
      && input.getAttribute("aria-invalid") !== "true";
    // The visible input and the Oracle JET combobox value are distinct.  CDP can
    // update only the text for an extension-generated option click, leaving the
    // field invalid. Set the component value as the fallback; Oracle JET emits
    // its normal valueChanged event, which invokes the page's dataObjChange.
    await sleep(350);
    if (!selected()) {
      host.value = tableName;
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      input.dispatchEvent(new FocusEvent("blur", { bubbles: true, composed: true }));
    }
    await wait(() => selected() ? input : null, `${tableName} to be selected`, 20000);
    await sleep(1000);
  };

  const valueContext = (sequence, tableSequence, sourceId, objectId) => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timestamp = `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    return {
      date,
      timestamp,
      day: String(now.getDate()),
      month: String(now.getMonth() + 1),
      year: String(now.getFullYear()),
      ddmm: `${pad(now.getDate())}${pad(now.getMonth() + 1)}`,
      sequence: String(sequence),
      tableSequence: String(tableSequence),
      sourceId,
      objectId
    };
  };
  const resolveValue = (value, context) => String(value ?? "").replace(/\{\{(date|timestamp|day|month|year|ddmm|sequence|tableSequence|sourceId|objectId)\}\}/g, (_, key) => context[key] ?? "");
  const tableShortCode = (tableName) => {
    // Keep generated source-object IDs short but unambiguous.  Single-word
    // tables use their first two letters; multi-word tables use initials.
    const configured = { Customer: "CU", ContactPoint: "CP", Address: "AD", Account: "AC", Product: "PR" }[tableName];
    if (configured) return configured;
    const words = String(tableName || "").replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_-]+/).filter(Boolean);
    if (words.length === 1) return (words[0].slice(0, 2) || "UI").toUpperCase();
    return (words.map((word) => word[0]).join("") || "UI").toUpperCase();
  };
  const sourceObjectIdFor = (tableName, context, tableSequence) => {
    const prefix = tableShortCode(tableName);
    const base = `${prefix}-${context.ddmm}`;
    return tableSequence > 1 ? `${base}-${tableSequence - 1}` : base;
  };
  const sourceKeyFieldNames = (drawer) => [...drawer.querySelectorAll("input[id$='|input'], textarea[id$='|input']")]
    .filter((input) => !input.disabled)
    .map((input) => input.id.replace(/\|input$/, "").replace(/^field-/, ""))
    .filter((field, index, fields) => /^Source(?:[A-Za-z0-9]+)?ID$/i.test(field) && fields.indexOf(field) === index);
  const referencedTableFromKey = (field) => String(field || "")
    .replace(/^Source/i, "")
    .replace(/ID$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const defaultFieldValue = (field, context) => {
    const known = {
      Email: "jagannath.patil@oracle.com", FirstName: "Jagannath", MiddleName: "Kumar", LastName: "Patil",
      Prefix: "Mr", Suffix: "Jr", Title: "Mr", Gender: "M", PrimaryLanguage: "English",
      Phone: "9999999999", BusinessPhone: "9999999999", MobilePhone: "9999999999", MobileNumber: "9999999999", Fax: "9999999999",
      ChannelType: "Email", OptInStatus: "In", IsDeliverable: "True", IsActive: "True", CountryCode: "US", Country: "United States",
      Browser: "Chrome", BrowserType: "Desktop", DeviceType: "Desktop", OperatingSystem: "Windows", PlatformKey: "PK-001", PlatformType: "Desktop",
      UserAgent: "Mozilla/5.0", ISP: "Oracle", MobileCarrier: "Oracle", MobileCode: "M1", MobileKeyword: "keyword1",
      CreatedBy: "Automation User", ModifiedBy: "Automation User", Status: "Active", Type: "Standard",
      AddressLine1: "500 Oracle Parkway", City: "Redwood City", State: "CA", ZipCode: "94065", Description: "Created by CDP Browser Automation",
      Name: "Automation Test Record", Industry: "Technology", JobTitle: "Software Engineer", JobDepartment: "Engineering", JobSpeciality: "Automation",
      JobTitleDescription: "Software engineering and test automation", JobTitleLevel: "2", JobCode: "SE-002", SourceAppID: "APP-001", SourcePushID: "PUSH-001", SourceUserID: "USER-001",
      Region: "North America", CurrencyCode: "USD", CountryCode_ISOAlpha2: "US", CountryCode_ISOAlpha3: "USA", CompanyName: "Oracle"
    };
    if (known[field] !== undefined) return known[field];
    if (/birthday$/i.test(field)) return context.day;
    if (/birthmonth$/i.test(field)) return context.month;
    if (/birthyear$/i.test(field)) return context.year;
    if (/(timestamp|(?:ts|dt))$/i.test(field)) return context.timestamp;
    if (/date/i.test(field)) return context.date;
    if (/(flag|^is|deliverable|active|enabled)/i.test(field)) return "True";
    if (/(age|amount|revenue|score|rank|count|number|quantity|year|month|day|level)/i.test(field)) return "1";
    if (/(email)/i.test(field)) return "jagannath.patil@oracle.com";
    if (/(phone|mobile|fax)/i.test(field)) return "9999999999";
    if (/(^source.*id$|\bid$)/i.test(field)) return `${field}-${context.sequence}`;
    if (/name/i.test(field)) return `Sample ${field.replace(/([A-Z])/g, " $1").trim()}`;
    if (/description|comment|note/i.test(field)) return `Sample ${field.replace(/([A-Z])/g, " $1").trim()} for automation testing`;
    if (/code/i.test(field)) return "AUTO-001";
    return "Sample Value";
  };

  // Oracle JET hosts (oj-input-date, oj-select-single, etc.) are not native
  // inputs. Always resolve their editable child first; assigning HTMLInput's
  // value setter to a JET host causes an Illegal invocation and ends the run.
  const findField = (drawer, field) => drawer.querySelector(`#${CSS.escape(`${field}|input`)}`)
    || drawer.querySelector(`#${CSS.escape(`field-${field}|input`)}`)
    || drawer.querySelector(`#${CSS.escape(`field-${field}`)} input, #${CSS.escape(`field-${field}`)} textarea, #${CSS.escape(`field-${field}`)} [role='combobox']`)
    || drawer.querySelector(`[fieldid="${CSS.escape(field)}"] input, [fieldid="${CSS.escape(field)}"] textarea, [fieldid="${CSS.escape(field)}"] [role='combobox']`);
  const entryFieldKeys = (drawer) => [...drawer.querySelectorAll("oj-input-text[id^='field-'],oj-text-area[id^='field-'],oj-select-single[id^='field-'],oj-combobox-one[id^='field-'],oj-input-date[id^='field-']")]
    .map((host) => host.id.replace(/^field-/, ""))
    .filter((field, index, fields) => field && fields.indexOf(field) === index && !findField(drawer, field)?.disabled);
  const isChoiceInput = (input) => {
    const host = input?.closest("oj-select-single,oj-combobox-one,oj-combobox-many,oj-input-date,oj-input-date-time") || input?.parentElement;
    return input?.getAttribute("role") === "combobox" || /oj-(select|combobox)/i.test(host?.tagName || "") || /combobox/i.test(input?.className || "");
  };
  const suffixEligible = (field, input) => !isChoiceInput(input)
    && !/(date|timestamp|(?:ts|dt)$|birth(day|month|year)|age|amount|revenue|score|rank|count|number|quantity|year|month|day|level|^is|flag)/i.test(field);
  const configuredValueFor = (entry, field, drawer, context, repeatCount) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return resolveValue(entry, context);
    const base = resolveValue(entry.value, context);
    const input = findField(drawer, field);
    if (repeatCount <= 1 || !base || !suffixEligible(field, input)) return base;
    const suffix = String(entry.suffix || "").trim();
    const marker = suffix ? `${suffix}-${context.tableSequence}` : context.tableSequence;
    const at = base.indexOf("@");
    return at > 0 ? `${base.slice(0, at)}-${marker}${base.slice(at)}` : `${base}-${marker}`;
  };

  const chooseValue = async (drawer, field, value) => {
    const input = findField(drawer, field);
    if (!input) return;
    const host = input.closest("oj-select-single,oj-combobox-one,oj-combobox-many,oj-input-date,oj-input-date-time") || input.parentElement;
    const isChoice = isChoiceInput(input);
    if (!isChoice) return setValue(input, value);
    setValue(input, value);
    click(host?.querySelector(".oj-searchselect-arrow,.oj-combobox-arrow,.oj-select-arrow,.oj-text-field-end") || input);
    await sleep(180);
    const option = [...document.querySelectorAll("[role='option'],oj-option,li,.oj-listbox-result")]
      .find((item) => visible(item) && (normalize(text(item)) === normalize(value) || normalize(item.getAttribute("value")) === normalize(value)));
    if (option) click(option.closest("[role='option'],oj-option,li") || option);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  };

  const chooseDrawerMode = async (drawer) => {
    const mode = [...drawer.querySelectorAll("#dbset label")].find((element) => visible(element) && /^data warehouse$/i.test(text(element)));
    if (!mode) throw new Error("The Data warehouse mode was not available in the Add record drawer.");
    click(mode);
    await sleep(700);
  };
  const clickDrawerAction = async (label) => {
    const button = await wait(() => [...document.querySelectorAll("#ingestRecordsCanvas button")]
      .find((element) => visible(element) && new RegExp(`^${label}$`, "i").test(text(element)) && !element.disabled && element.getAttribute("aria-disabled") !== "true"), `${label} in the record drawer`, 15000);
    const usedTrustedClick = /^next$/i.test(label) && await requestTrustedNextClick(button);
    if (!usedTrustedClick) click(button);
    // Oracle JET sometimes ignores an untrusted native click from an extension.
    // Retry through its oj-button host only when the first click has not
    // advanced. This avoids accidentally advancing two pages.
    if (/^next$/i.test(label)) {
      const nextIsStillVisible = () => [...document.querySelectorAll("#ingestRecordsCanvas button")]
        .find((element) => visible(element) && /^next$/i.test(text(element)));
      await sleep(350);
      let stillOnNext = nextIsStillVisible();
      if (stillOnNext) {
        const nextHost = stillOnNext.closest("oj-button");
        click(nextHost);
        await sleep(350);
        stillOnNext = nextIsStillVisible();
        if (stillOnNext) nextHost?.dispatchEvent(new CustomEvent("ojAction", { bubbles: true, composed: true, detail: { originalEvent: null } }));
      }
      await wait(() => findField(currentDrawer(), "SourceID") || [...document.querySelectorAll("#ingestRecordsCanvas button")]
        .find((element) => visible(element) && /^back$/i.test(text(element))), "the primary and foreign-key page", 15000);
    }
  };
  const drawerClosed = () => !visible(document.getElementById("ingestRecordsCanvas"));
  const discardDrawerChanges = async () => {
    await clickDrawerAction("Cancel");
    await sleep(250);
    if (drawerClosed()) return;
    const discard = await wait(() => [...document.querySelectorAll("oj-dialog button, [role='dialog'] button")]
      .find((button) => visible(button) && /^discard changes$/i.test(text(button)) && !button.disabled), "Discard changes confirmation", 10000);
    click(discard);
  };

  window.runCdpDataViewer = async ({ tables = [], recordsPerTable = 1, sourceId = "UI", saveRecords = false } = {}) => {
    if (!Array.isArray(tables) || !tables.length || tables.some((table) => !table?.cdpTable)) throw new Error("At least one Data Viewer table is required.");
    if (!Number.isSafeInteger(recordsPerTable) || recordsPerTable < 1) throw new Error("Records per table must be a positive whole number.");
    const resolvedSourceId = String(sourceId || "").trim() || "UI";
    const generatedObjectIds = {};
    const completed = [];
    // Keep a table selected while creating all of its records. This avoids
    // reloading Data Viewer's metadata for every record, while the per-table
    // ID arrays below still allow child FKs to use the matching sequence.
    for (const table of tables) {
      setProgress(`Selecting ${table.cdpTable}`);
      await selectDataObject(table.cdpTable);
      generatedObjectIds[table.cdpTable] = [];
      for (let tableSequence = 1; tableSequence <= recordsPerTable; tableSequence += 1) {
        setProgress(`${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
        const add = await wait(() => {
          const host = document.getElementById("add");
          const button = host?.querySelector("button") || host;
          return visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true" ? button : null;
        }, "the Add record button", 15000);
        click(add);
        // CDP can take substantially longer than the visible page shell to
        // resolve a table's metadata and create the Add record drawer.
        const drawer = await wait(currentDrawer, "the record drawer", 60000);
        setProgress(`Loading ${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
        await wait(() => drawerFormReady(drawer) ? drawer : null, `${table.cdpTable} record form to finish loading`, 60000);
        await chooseDrawerMode(drawer);
        const context = valueContext(tableSequence, tableSequence, resolvedSourceId, "");
        const sourceObjectId = sourceObjectIdFor(table.cdpTable, context, tableSequence);
        context.objectId = sourceObjectId;
        const configuredValues = table.recordConfig?.values || {};
        const fields = entryFieldKeys(drawer);
        if (!fields.length) throw new Error(`${table.cdpTable} has no editable fields in the Add record drawer.`);
        setProgress(`Filling ${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
        const skippedFields = [];
        for (const field of fields) {
          const value = Object.hasOwn(configuredValues, field)
            ? configuredValueFor(configuredValues[field], field, drawer, context, recordsPerTable)
            : defaultFieldValue(field, context);
          try {
            await chooseValue(drawer, field, value);
          } catch (error) {
            // First-page attributes are optional. Some masked/JET-only controls
            // cannot be written through the DOM, but must not block Next.
            skippedFields.push(field);
            console.warn(`Data Viewer skipped optional ${field}`, error);
          }
        }
        const unfilled = fields.filter((field) => {
          const input = findField(drawer, field);
          return input && !input.disabled && !String(input.value || "").trim();
        });
        document.documentElement.dataset.cdpDataViewerSkippedFields = [...new Set([...skippedFields, ...unfilled])].join(", ");
        await sleep(1000);
        setProgress(`Clicking Next for ${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
        await clickDrawerAction("Next");
        setProgress(`Filling ${table.cdpTable} key fields`);
        await wait(() => findField(drawer, "SourceID"), "the source ID fields", 60000);
        const keyFields = sourceKeyFieldNames(drawer);
        const currentTableKey = `Source${table.cdpTable.replace(/[^A-Za-z0-9]/g, "")}ID`;
        // Parent IDs are stored by sequence. A child record at sequence 2 uses
        // the parent table's sequence-2 ID, even though all parent records are
        // intentionally created before the child table is selected.
        for (const field of keyFields) {
          let value;
          if (/^SourceID$/i.test(field)) value = resolvedSourceId;
          else if (normalize(field) === normalize(currentTableKey)) value = sourceObjectId;
          else {
            const referencedTable = referencedTableFromKey(field).replace(/\s+/g, "");
            value = generatedObjectIds[referencedTable]?.[tableSequence - 1]
              || sourceObjectIdFor(referencedTable, context, tableSequence);
          }
          await chooseValue(drawer, field, value);
        }
        for (const [field, referencedTable] of Object.entries(table.recordConfig?.relationships || {})) {
          const referencedId = generatedObjectIds[referencedTable]?.[tableSequence - 1];
          if (referencedId) await chooseValue(drawer, field, referencedId);
        }
        await sleep(1000);
        if (saveRecords) {
          setProgress(`Saving ${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
          await clickDrawerAction("Save");
        } else {
          setProgress(`Discarding test ${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
          await discardDrawerChanges();
        }
        await wait(() => drawerClosed() ? true : null, "the saved record drawer to close", 30000);
        generatedObjectIds[table.cdpTable][tableSequence - 1] = sourceObjectId;
        completed.push(`${table.cdpTable} #${tableSequence}`);
      }
    }
    return { tables: completed, recordsPerTable, sourceId: resolvedSourceId, saved: true };
  };
})();
