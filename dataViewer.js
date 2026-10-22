(() => {
  const visible = (element) => Boolean(element?.getClientRects().length);
  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const normalize = (value) => String(value || "").replace(/\s+/g, "").trim().toLowerCase();
  const isAuditField = (field) => /^(?:column)?(createdby|createddate|createdts|creationdate|creationts|modifiedby|modifieddate|modifiedts|lastmodifiedby|lastmodifieddate|lastmodifiedts|rowcreatedtimestamp|rowmodifiedtimestamp)$/.test(normalize(field));
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
    // Identifier-only custom objects can show only optional audit fields on
    // page one. They still have a valid Next action and their required PK/FK
    // inputs appear on page two, so do not require a writable first-page key.
    if (!drawer || drawerIsLoading(drawer)) return false;
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
    // Selecting an object commits the combobox before Data Viewer finishes
    // loading that object's metadata.  Clicking Add during that interval
    // opens a drawer that remains on skeleton/grey fields. Require the
    // selected state and enabled Add action to remain stable before proceeding.
    const addIsReady = () => {
      const host = document.getElementById("add");
      const button = host?.querySelector("button") || host;
      return visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true";
    };
    await wait(() => addIsReady() ? input : null, `${tableName} metadata to become available`, 30000);
    await sleep(2500);
    if (!selected() || !addIsReady()) {
      throw new Error(`${tableName} did not remain ready after object selection.`);
    }
  };

  const valueContext = (sequence, tableSequence, sourceId, objectId, runDate = new Date()) => {
    const now = runDate;
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
      ddmmyy: `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}`,
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
    const rootName = String(tableName || "").split(/[\s_-]+/)[0];
    const configured = { Customer: "CU", ContactPoint: "CP", Address: "AD", Account: "AC", Product: "PR", Profile: "PR", Behavioral: "BH", Transactional: "TR", Other: "OT" }[rootName];
    if (configured) return configured;
    const words = String(tableName || "").replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_-]+/).filter(Boolean);
    if (words.length === 1) return (words[0].slice(0, 2) || "UI").toUpperCase();
    return (words.map((word) => word[0]).join("") || "UI").toUpperCase();
  };
  const sourceObjectIdFor = (_tableName, context, tableSequence) => cdpRecordProfiles.sourceKey(
    Math.max(1, Number(tableSequence) || 1), context.runDate, Math.max(1, Number(tableSequence) || 1), context.recordCount
  );
  const canonicalSourceKey = (field) => String(field || "")
    .replace(/^field-/, "")
    .replace(/^Column[-_ ]*/i, "")
    // Custom-table foreign keys are physical attributes such as
    // SourceCustomerID_c. Keep the actual field ID for DOM input lookup, but
    // remove this suffix when deciding which parent key it represents.
    .replace(/_c$/i, "");
  const sourceKeyComparable = (field) => canonicalSourceKey(field).replace(/[^a-z0-9]/gi, "").toLowerCase();
  const sourceKeyFieldNames = (drawer) => [...drawer.querySelectorAll("input[id$='|input'], textarea[id$='|input']")]
    .filter((input) => !input.disabled)
    .map((input) => input.id.replace(/\|input$/, "").replace(/^field-/, ""))
    .filter((field, index, fields) => /^Source(?:[A-Za-z0-9_]+)?ID$/i.test(canonicalSourceKey(field)) && fields.indexOf(field) === index);
  const referencedTableFromKey = (field) => String(canonicalSourceKey(field) || "")
    .replace(/^Source/i, "")
    .replace(/ID$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  const recordEmailForSequence = (sequence) => {
    const recordNumber = Math.max(1, Number.parseInt(sequence, 10) || 1);
    const seededEmails = [
      "jagannath.patil@oracle.com",
      "jagan.test01@gmail.com",
      "jagan.test01@yahoo.com",
      "jagan.test02@gmail.com",
      "jagan.test02@yahoo.com"
    ];
    if (recordNumber <= seededEmails.length) return seededEmails[recordNumber - 1];
    return `jagan.record.${Date.now().toString(36)}${recordNumber}@example.com`;
  };
  const defaultFieldValue = (field, context, table = {}) => {
    const known = {
      Email: "jagannath.patil@oracle.com", FirstName: "Jagannath", MiddleName: "Kumar", LastName: "Patil",
      Prefix: "Mr", Suffix: "Jr", Title: "Mr", Gender: "M", PrimaryLanguage: "English",
      Phone: "9999999999", BusinessPhone: "9999999999", MobilePhone: "9999999999", MobileNumber: "9999999999", Fax: "9999999999",
      ChannelType: "Email", OptInStatus: "In", IsDeliverable: "True", IsActive: "True", CountryCode: "US", Country: "United States",
      Browser: "Chrome", BrowserType: "Desktop", DeviceType: "Desktop", OperatingSystem: "Windows", PlatformKey: "WEB-PORTAL", PlatformType: "Desktop",
      UserAgent: "Mozilla/5.0", ISP: "Oracle", MobileCarrier: "Airtel", MobileCode: "WELCOME10", MobileKeyword: "JOIN",
      Status: "Active", Type: "Standard",
      AddressLine1: "500 Oracle Parkway", City: "Redwood City", State: "CA", ZipCode: "94065", Description: "Enterprise customer profile for product engagement",
      Name: "Northwind Enterprise", Industry: "Technology", JobTitle: "Product Manager", JobDepartment: "Product", JobSpeciality: "Customer Data Platform",
      EventName: "Product Demo Requested", ProductName: "Oracle CX Unity", ProductCode: "OCX-UNITY-001", ProductCategory: "Customer Experience",
      JobTitleDescription: "Product management for customer data experiences", JobTitleLevel: "2", JobCode: "PM-002",
      Region: "North America", CurrencyCode: "USD", CountryCode_ISOAlpha2: "US", CountryCode_ISOAlpha3: "USA", CompanyName: "Oracle"
    };
    const logicalField = String(field || "").replace(/^field-/, "").replace(/_c$/i, "");
    const fieldKey = logicalField.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const profileValue = cdpRecordProfiles.value(fieldKey, {
      position: Number(context.tableSequence), count: context.recordCount,
      sequence: Number(context.tableSequence), runDate: context.runDate, ui: true
    });
    if (profileValue !== undefined) return Array.isArray(profileValue) ? profileValue.join(", ") : String(profileValue);
    const fieldType = String(table.liveFields?.find((item) => item.fieldId === field)?.dataType || "string").toLowerCase();
    const knownByKey = Object.fromEntries(Object.entries(known).map(([key, value]) => [key.replace(/[^a-z0-9]/gi, "").toLowerCase(), value]));
    const pick = (values) => values[(Math.max(1, Number(context.tableSequence) || 1) - 1) % values.length];
    const group = String(table.cdpTable || "").split(/[_\s-]/)[0].toLowerCase();
    const examples = {
      profile: { tags: "Loyalty member, Email subscriber", note: "Customer prefers product updates by email.", number: 25, amount: 149.95 },
      behavioral: { tags: "Product view, Web visit", note: "Customer viewed the Oracle CX product page.", number: 3, amount: 4.75 },
      transactional: { tags: "Online order, Paid", note: "Order completed through the web store.", number: 2, amount: 249.95 },
      product: { tags: "Cloud service, Subscription", note: "Annual Oracle Cloud subscription.", number: 40, amount: 99.95 },
      other: { tags: "Enterprise account, Renewal", note: "Account renewal is scheduled this quarter.", number: 12, amount: 499.95 }
    };
    const example = examples[group] || examples.other;
    const ordinal = Number(context.tableSequence) || 1;
    const typeCoverageValues = {
      arraystringvalues: example.tags, bigintvalue: String(1000000 + ordinal), booleanvalue: "True",
      datevalue: context.date, decimalvalue: (example.amount + ordinal).toFixed(2),
      doublevalue: (0.8 + ordinal / 1000).toFixed(3), floatvalue: (4 + ordinal / 10).toFixed(1),
      intvalue: String(example.number + ordinal), smallintvalue: String(2 + ordinal % 5),
      textvalue: example.note, timestampvalue: context.timestamp, tinyintvalue: String(ordinal % 2)
    };
    if (Object.hasOwn(typeCoverageValues, fieldKey)) return typeCoverageValues[fieldKey];
    const semanticValues = {
      customertype: ["B2B", "B2C"], loyaltytier: ["Gold", "Silver", "Platinum"], preferredchannel: ["Email", "SMS", "Push"],
      lifecyclestage: ["Prospect", "Lead", "Customer", "Advocate"], channel: ["Email", "SMS", "Push"], channeltype: ["Email", "SMS", "Push"],
      status: ["Active", "Qualified", "Engaged"], segment: ["Enterprise", "Growth", "Strategic"], priority: ["High", "Medium", "Low"],
      industry: ["Technology", "Financial Services", "Retail"], productcategory: ["Customer Experience", "Cloud Services", "Analytics"],
      productname: ["Oracle CX Unity", "Oracle CX Platform", "Oracle Analytics Cloud"], eventname: ["Product Viewed", "Form Submitted", "Webinar Registered"],
      campaignname: ["Q3 Nurture Campaign", "Product Adoption Campaign", "Customer Expansion Campaign"], campaigncode: ["CMP-1001", "CMP-1002", "CMP-1003"],
      currencycode: ["USD", "INR", "GBP"], country: ["United States", "India", "United Kingdom"], countrycode: ["US", "IN", "GB"],
      city: ["Redwood City", "Bengaluru", "London"], state: ["CA", "KA", "London"], region: ["North America", "Asia Pacific", "Europe"]
    };
    if (/email/i.test(fieldKey)) return recordEmailForSequence(context.sequence);
    if (/^sourceid$/i.test(fieldKey)) return context.sourceId;
    if (/^source.*id$/i.test(fieldKey)) return sourceObjectIdFor("", context, context.tableSequence);
    if (knownByKey[fieldKey] !== undefined) return knownByKey[fieldKey];
    if (semanticValues[fieldKey]) return pick(semanticValues[fieldKey]);
    if (fieldKey === "transactionid") return `ORD-${context.ddmmyy}${String(context.tableSequence).padStart(3, "0")}`;
    if (fieldKey === "orderstatus") return "Completed";
    if (fieldKey === "accountname") return "Northwind Enterprise";
    if (fieldKey === "accounttier") return "Gold";
    if (fieldKey === "unitprice" || fieldKey === "orderamount") return (example.amount + ordinal).toFixed(2);
    if (/birthday$/i.test(fieldKey)) return context.day;
    if (/birthmonth$/i.test(fieldKey)) return context.month;
    if (/birthyear$/i.test(fieldKey)) return context.year;
    if (/(timestamp|(?:ts|dt))$/i.test(fieldKey)) return context.timestamp;
    if (/date/i.test(fieldKey)) return context.date;
    if (/bool/.test(fieldType)) return "True";
    if (/(?:bigint|smallint|tinyint|int|decimal|double|float|number)/.test(fieldType)) return String(example.number + ordinal);
    if (/(flag|^is|deliverable|active|enabled)/i.test(fieldKey)) return "True";
    if (/(age|amount|revenue|score|rank|count|number|quantity|year|month|day|level)/i.test(fieldKey)) return "1";
    if (/(phone|mobile|fax)/i.test(fieldKey)) return "9999999999";
    if (/cookie/i.test(fieldKey)) return `session_${context.ddmmyy}${String(context.tableSequence).padStart(3, "0")}`;
    if (/url/i.test(fieldKey)) return "https://www.oracle.com/cx/";
    if (/name/i.test(fieldKey)) return `Enterprise ${logicalField.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()} ${context.tableSequence}`;
    if (/description|comment|note/i.test(fieldKey)) return `${logicalField.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()} for customer engagement record ${context.tableSequence}`;
    if (/code/i.test(fieldKey)) return `CDP${String(context.tableSequence).padStart(3, "0")}`;
    return `${logicalField.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim() || "Customer attribute"} ${context.ddmmyy}${String(context.tableSequence).padStart(3, "0")}`;
  };

  // Oracle JET hosts (oj-input-date, oj-select-single, etc.) are not native
  // inputs. Always resolve their editable child first; assigning HTMLInput's
  // value setter to a JET host causes an Illegal invocation and ends the run.
  const findField = (drawer, field) => drawer.querySelector(`#${CSS.escape(`${field}|input`)}`)
    || drawer.querySelector(`#${CSS.escape(`field-${field}|input`)}`)
    || drawer.querySelector(`#${CSS.escape(`field-${field}`)} input, #${CSS.escape(`field-${field}`)} textarea, #${CSS.escape(`field-${field}`)} [role='combobox']`)
    || drawer.querySelector(`[fieldid="${CSS.escape(field)}"] input, [fieldid="${CSS.escape(field)}"] textarea, [fieldid="${CSS.escape(field)}"] [role='combobox']`);
  const entryFieldKeys = (drawer) => [...drawer.querySelectorAll("oj-input-text[id^='field-'],oj-text-area[id^='field-'],oj-select-single[id^='field-'],oj-combobox-one[id^='field-'],oj-input-date[id^='field-'],oj-input-date-time[id^='field-']")]
    .map((host) => host.id.replace(/^field-/, ""))
    .filter((field, index, fields) => field && fields.indexOf(field) === index && !findField(drawer, field)?.disabled);
  const isChoiceInput = (input) => {
    const host = input?.closest("oj-select-single,oj-combobox-one,oj-combobox-many,oj-input-date,oj-input-date-time") || input?.parentElement;
    return input?.getAttribute("role") === "combobox" || /oj-(select|combobox)/i.test(host?.tagName || "") || /combobox/i.test(input?.className || "");
  };
  const suffixEligible = (field, input) => !isChoiceInput(input)
    && !/(date|timestamp|(?:ts|dt)$|birth(day|month|year)|age|amount|revenue|score|rank|count|number|quantity|year|month|day|level|^is|flag)/i.test(field);
  const configuredValueFor = (entry, field, tableName, drawer, context, repeatCount, liveFields = []) => {
    const rawValue = entry && typeof entry === "object" && !Array.isArray(entry) ? entry.value : entry;
    // A comma-separated ARRAY<STRING> editor value is one record's collection,
    // not a per-record override list.
    if (liveFields.some((item) => item.fieldId === field && item.dataType === "array")) return resolveValue(rawValue, context);
    const delimiters = String(tableName || "").toLowerCase() === "address" ? /\r?\n/ : /[\n,]+/;
    const suppliedValues = String(rawValue ?? "").split(delimiters).map((value) => value.trim()).filter(Boolean);
    if (suppliedValues.length > 1) {
      if (suppliedValues.length < repeatCount) throw new Error(`${field} has ${suppliedValues.length} supplied values but ${repeatCount} records were requested.`);
      return resolveValue(suppliedValues[context.tableSequence - 1], context);
    }
    const base = resolveValue(suppliedValues[0] || rawValue, context);
    const input = findField(drawer, field);
    // Email values are already sequenced by defaultFieldValue. Do not append a
    // second suffix before the @ sign (for example, jagan.test01-2@gmail.com).
    if (repeatCount <= 1 || !base || /email/i.test(field) || !suffixEligible(field, input)) return base;
    const marker = context.tableSequence;
    const at = base.indexOf("@");
    return at > 0 ? `${base.slice(0, at)}-${marker}${base.slice(at)}` : `${base}-${marker}`;
  };

  const chooseValue = async (drawer, field, value) => {
    const input = findField(drawer, field);
    if (!input) return;
    const host = input.closest("oj-select-single,oj-combobox-one,oj-combobox-many,oj-input-date,oj-input-date-time") || input.parentElement;
    // Date/time JET controls accept ISO input; opening a choice popup after
    // setting them can replace the typed value with a calendar selection.
    if (host?.matches?.("oj-input-date,oj-input-date-time")) return setValue(input, value);
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
  const auditValue = (field, value) => {
    if (/(password|secret|token|private.?key|auth.*key)/i.test(field)) return "[redacted]";
    const textValue = String(value ?? "").replace(/\s+/g, " ").trim();
    return textValue.length > 120 ? `${textValue.slice(0, 117)}...` : textValue;
  };

  window.runCdpDataViewer = async ({ tables = [], recordsPerTable = 1, sourceId = "UI", parentSourceCustomerId = "", saveRecords = false } = {}) => {
    if (!Array.isArray(tables) || !tables.length || tables.some((table) => !table?.cdpTable)) throw new Error("At least one Data Viewer table is required.");
    if (!Number.isSafeInteger(recordsPerTable) || recordsPerTable < 1) throw new Error("Records per table must be a positive whole number.");
    const resolvedSourceId = String(sourceId || "").trim() || "CDP";
    const resolvedParentSourceCustomerId = String(parentSourceCustomerId || "").trim();
    const dummySourceRunDate = new Date();
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
        const audit = { table: table.cdpTable, sequence: tableSequence, fields: [], keys: [], actions: [] };
        if (tableSequence === 1) audit.actions.push({ action: "Select", target: "Data object", value: table.cdpTable });
        setProgress(`${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
        const add = await wait(() => {
          const host = document.getElementById("add");
          const button = host?.querySelector("button") || host;
          return visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true" ? button : null;
        }, "the Add record button", 15000);
        click(add);
        audit.actions.push({ action: "Click", target: "Add record" });
        // CDP can take substantially longer than the visible page shell to
        // resolve a table's metadata and create the Add record drawer.
        const drawer = await wait(currentDrawer, "the record drawer", 60000);
        setProgress(`Loading ${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
        await wait(() => drawerFormReady(drawer) ? drawer : null, `${table.cdpTable} record form to finish loading`, 60000);
        await chooseDrawerMode(drawer);
        const context = valueContext(tableSequence, tableSequence, resolvedSourceId, "", dummySourceRunDate);
        context.recordCount = recordsPerTable;
        context.runDate = dummySourceRunDate;
        context.profile = cdpRecordProfiles.kind(tableSequence, recordsPerTable);
        const sourceObjectId = sourceObjectIdFor(table.cdpTable, context, tableSequence);
        context.objectId = sourceObjectId;
        const configuredValues = table.recordConfig?.values || {};
        const allowedFields = Array.isArray(table.enterableFieldIds) ? table.enterableFieldIds.map(normalize) : [];
        const fields = entryFieldKeys(drawer).filter((field) => !isAuditField(field) && (!allowedFields.length || allowedFields.includes(normalize(field))));
        setProgress(fields.length
          ? `Filling ${table.cdpTable} record ${tableSequence}/${recordsPerTable}`
          : `Skipping optional first-page fields for ${table.cdpTable}`);
        const skippedFields = [];
        for (const field of fields) {
          const liveField = table.liveFields?.find((item) => item.fieldId === field);
          const control = findField(drawer, field);
          const required = liveField?.required || control?.required || control?.getAttribute("aria-required") === "true"
            || control?.closest("[aria-required='true'],[required]");
          if (context.profile === "sparse" && !required) {
            if (control?.value) await chooseValue(drawer, field, "");
            audit.actions.push({ action: "Leave blank", target: field, value: "optional sparse field" });
            continue;
          }
          // Primary Email is the meaningful contact value for Customer and
          // ContactPoint. Do not invent an alternate address unless the user
          // explicitly configured one in the per-table editor/JSON.
          if (/^alternateemails?$/i.test(field) && !Object.hasOwn(configuredValues, field)) {
            audit.actions.push({ action: "Skip", target: field, value: "not configured" });
            continue;
          }
          const profileField = field.replace(/_c$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
          const profileValue = cdpRecordProfiles.value(profileField, {
            position: tableSequence, count: recordsPerTable, sequence: tableSequence,
            runDate: dummySourceRunDate, ui: true
          });
          const hasConfiguredValue = Object.hasOwn(configuredValues, field);
          const configuredValue = hasConfiguredValue && profileValue === undefined
            ? configuredValues[field]
            : defaultFieldValue(field, context, table);
          // Generated values already carry their meaningful per-record value;
          // reserve automatic suffixing for an explicit user-configured value.
          const value = hasConfiguredValue && profileValue === undefined
            ? configuredValueFor(configuredValue, field, table.cdpTable, drawer, context, recordsPerTable, table.liveFields)
            : configuredValue;
          try {
            await chooseValue(drawer, field, value);
            audit.fields.push({ field, value: auditValue(field, value) });
            audit.actions.push({ action: "Type", target: field, value: auditValue(field, value) });
          } catch (error) {
            // First-page attributes are optional. Some masked/JET-only controls
            // cannot be written through the DOM, but must not block Next.
            skippedFields.push(field);
            audit.fields.push({ field, value: auditValue(field, value), skipped: true });
            audit.actions.push({ action: "Skip", target: field, value: auditValue(field, value) });
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
        audit.actions.push({ action: "Click", target: "Next" });
        setProgress(`Filling ${table.cdpTable} key fields`);
        await wait(() => findField(drawer, "SourceID") || findField(drawer, "Column_SourceID") || sourceKeyFieldNames(drawer).length, "the source ID fields", 60000);
        const currentTableKey = String(table.sourceAttribute || `Source${table.cdpTable.replace(/[^A-Za-z0-9]/g, "")}ID`);
        // Parent IDs are stored by sequence. A child record at sequence 2 uses
        // the parent table's sequence-2 ID, even though all parent records are
        // intentionally created before the child table is selected. CDP can
        // enable relationship keys only after SourceID and the table key have
        // been committed, so discover and fill the live key set in stages.
        const filledKeyFields = new Set();
        const keyPriority = (field) => {
          const canonicalField = canonicalSourceKey(field);
          if (/^SourceID$/i.test(canonicalField)) return 0;
          if (sourceKeyComparable(canonicalField) === sourceKeyComparable(currentTableKey)) return 1;
          return 2;
        };
        for (let keyPass = 0; keyPass < 5; keyPass += 1) {
          const keyFields = sourceKeyFieldNames(drawer)
            .filter((field) => !filledKeyFields.has(field))
            .sort((left, right) => keyPriority(left) - keyPriority(right));
          if (!keyFields.length) {
            await sleep(400);
            continue;
          }
          for (const field of keyFields) {
            const canonicalField = canonicalSourceKey(field);
            let value;
            if (/^SourceID$/i.test(canonicalField)) value = resolvedSourceId;
            else if (sourceKeyComparable(canonicalField) === sourceKeyComparable(currentTableKey)) value = sourceObjectId;
            else if (table.cdpTable === "ContactPoint" && /^SourceCustomerID$/i.test(canonicalField) && resolvedParentSourceCustomerId && !generatedObjectIds.Customer?.length) value = resolvedParentSourceCustomerId;
            else {
              const referencedTable = referencedTableFromKey(canonicalField).replace(/\s+/g, "");
              value = generatedObjectIds[referencedTable]?.[tableSequence - 1]
                || sourceObjectIdFor(referencedTable, context, tableSequence);
            }
            await chooseValue(drawer, field, value);
            filledKeyFields.add(field);
            audit.keys.push({ field, value: auditValue(field, value) });
            audit.actions.push({ action: "Type", target: field, value: auditValue(field, value) });
          }
          await sleep(500);
        }
        for (const [field, referencedTable] of Object.entries(table.recordConfig?.relationships || {})) {
          const referencedId = generatedObjectIds[referencedTable]?.[tableSequence - 1];
          if (referencedId) {
            await chooseValue(drawer, field, referencedId);
            audit.actions.push({ action: "Type", target: field, value: auditValue(field, referencedId) });
          }
        }
        await sleep(1000);
        if (saveRecords) {
          setProgress(`Saving ${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
          await clickDrawerAction("Save");
          audit.actions.push({ action: "Click", target: "Save" });
        } else {
          setProgress(`Discarding test ${table.cdpTable} record ${tableSequence}/${recordsPerTable}`);
          await discardDrawerChanges();
          audit.actions.push({ action: "Click", target: "Discard changes" });
        }
        await wait(() => drawerClosed() ? true : null, "the saved record drawer to close", 30000);
        generatedObjectIds[table.cdpTable][tableSequence - 1] = sourceObjectId;
        completed.push({ ...audit, objectId: sourceObjectId, outcome: saveRecords ? "Saved" : "Dry run discarded" });
      }
    }
    return { records: completed, recordsPerTable, sourceId: resolvedSourceId, saved: Boolean(saveRecords) };
  };
})();
