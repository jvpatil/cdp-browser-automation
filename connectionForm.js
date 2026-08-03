(async () => {
  const config = window.__cdpConnectionConfig;
  if (!config?.name || !config?.type) throw new Error("A transfer-template connection configuration is required.");
  const adapter = window.CDP_CONNECTION_ADAPTERS?.[config.type];
  if (!adapter) throw new Error(`No connection adapter is registered for ${config.type}.`);
  if (adapter.status !== "ready") throw new Error(`${config.type} is registered but not yet enabled. ${adapter.note || "Capture its live CDP form selectors first."}`);
  // Keep the established OOS interaction sequence intact. It has proved more
  // reliable with Oracle JET than generic DOM filling; only the values now
  // come from the selected connection profile/template.
  if (config.type === "Oracle Object Storage") {
    const d = document, f = config.fields || {}, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const ids = [
      ...(config.nameCommitted ? [] : [["source-name-input|input", config.name]]),
      ["oos-path|input", f.path || ""], ["oos-storeEndpoint|input", f.endpoint || ""], ["oos-storeKey|input", f.key || ""], ["oos-storeSecret|input", f.secret || ""]
    ];
    const missing = [];
    const set = (input, value) => { const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set; setter ? setter.call(input, value) : input.value = value; input.setAttribute("value", value); };
    const commitJetValue = (input, value) => {
      // `source-name-input` uses on-value-changed to call generateUniqueId.
      // Writing only its native inner input bypasses that JET lifecycle.
      const host = input.closest("oj-input-text, oj-text-area");
      if (!host) return;
      try {
        host.rawValue = value;
        host.value = value;
      } catch (_) {
        // The native input events below remain a compatibility fallback for
        // controls that have not finished upgrading to an Oracle JET host.
      }
    };
    const fire = (input, type, options = {}) => { const EventType = /^(blur|focus|focusout|focusin)$/.test(type) ? FocusEvent : type === "input" && typeof InputEvent === "function" ? InputEvent : Event; input.dispatchEvent(new EventType(type, { bubbles:true, cancelable:true, composed:true, ...options })); };
    const touch = (input, value) => { input.scrollIntoView({ block:"center" }); input.focus(); fire(input,"focus"); set(input,value); fire(input,"input",{inputType:"insertText",data:String(value)}); commitJetValue(input,value); fire(input,"change"); input.blur(); fire(input,"focusout"); };
    const enabled = (button) => Boolean(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true" && !button.closest("oj-button")?.classList.contains("oj-disabled");
    const realButton = (item) => item?.tagName?.toLowerCase() === "oj-button" ? item.querySelector("button") || item : item;
    const clickButton = (button) => { const target = realButton(button); target.scrollIntoView({ block:"center" }); target.focus(); target.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,view:window,button:0})); target.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true,view:window,button:0})); target.click(); };
    // CDP runs its unique-name validator asynchronously. An invalid state by
    // itself can be transient, so only its explicit duplicate-name message
    // authorizes a suffix. Source/Destination ID remains irrelevant here.
    const resolveDuplicateName = async () => {
      const nameInput = d.getElementById("source-name-input|input");
      if (!nameInput || nameInput.disabled || nameInput.readOnly) return;
      const duplicateName = async () => {
        await sleep(2000);
        if (nameInput.getAttribute("aria-invalid") !== "true") return false;
        const messages = [...d.querySelectorAll("[role=alert], [role=tooltip], .oj-message, .oj-message-detail, .oj-messages, .oj-popup-content")]
          .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join(" ");
        return /(?:source|destination|connection)?\s*(?:with\s+this\s+)?name\s+already\s+exists|name\s+must\s+be\s+unique|try\s+another/i.test(messages);
      };
      if (!(await duplicateName())) return;
      const baseName = String(config.name).replace(/_\d{2}$/, "");
      for (let index = 2; index <= 99; index += 1) {
        const candidate = `${baseName}_${String(index).padStart(2, "0")}`;
        touch(nameInput, candidate);
        if (!(await duplicateName())) { config.name = candidate; return; }
      }
      throw new Error(`CDP kept the connection name invalid for ${baseName}; no available suffix was found.`);
    };
    // A successful Verify Connection result is not a prerequisite for this
    // automation. Use plain Save rather than Save and Close: CDP keeps the
    // form alive long enough to publish "Your changes have been saved.",
    // which is the flow's actual completion gate.
    const plainSave = () => [...d.querySelectorAll("button, oj-button, [role=button]")]
      .find((item) => (item.getClientRects().length) && (item.textContent || "").replace(/\s+/g, " ").trim() === "Save" && enabled(realButton(item)));
    const waitSave = async () => {
      for (let tries = 0; tries < 120; tries += 1) {
        const save = plainSave();
        if (save) {
          clickButton(save);
          return;
        }
        await sleep(250);
      }
      throw new Error("Save did not become available after filling the connection form.");
    };
    const selectOption = async (input, value) => { if (!input || input.disabled) return; clickButton(input.closest("oj-select-single,oj-combobox-one")?.querySelector(".oj-searchselect-arrow,.oj-select-arrow") || input); for (let tries = 0; tries < 20; tries += 1) { const option = [...d.querySelectorAll("[role=option],oj-option,li")].find((item) => item.getClientRects().length && (item.textContent || "").replace(/\s+/g," ").trim().toLowerCase().includes(String(value).toLowerCase())); if (option) { clickButton(option); d.activeElement?.blur?.(); return; } await sleep(100); } };
    const chooseCsvParser = async (parser) => {
      const group = d.getElementById("csv-parsers");
      if (!group) return;
      const choice = [...group.querySelectorAll(".oj-choice-item")].find((item) => (item.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === String(parser).toLowerCase());
      const input = choice?.querySelector('input[type="radio"]');
      if (!input) throw new Error(`CSV parser option is unavailable: ${parser}`);
      clickButton(input);
      for (let tries = 0; tries < 40; tries += 1) {
        if (input.checked || String(group.value || "").replace(/[^a-z]/gi, "").toLowerCase() === String(parser).replace(/[^a-z]/gi, "").toLowerCase()) return;
        await sleep(100);
      }
      throw new Error(`CSV parser did not switch to ${parser}`);
    };
    const chooseDestinationCompression = async (value) => {
      const expected = String(value || "none");
      const input = d.getElementById("compressFormat|input") || [...d.querySelectorAll("input, [role=combobox]")]
        .find((element) => /compressformat|compressionformat/i.test(`${element.id || ""} ${element.getAttribute?.("aria-label") || ""}`));
      if (!input) throw new Error("Destination Compression format control was not found.");
      const host = input.closest("oj-select-single,oj-combobox-one") || input;
      const trigger = host.querySelector?.(".oj-searchselect-arrow,.oj-select-arrow,.oj-searchselect-main-field,[role=combobox]") || input;
      clickButton(trigger);
      const field = (input.id || "").replace(/\|input$/, "");
      const filter = d.getElementById(`oj-searchselect-filter-${field}|input`);
      if (filter && filter !== input) touch(filter, expected);
      let option;
      for (let tries = 0; tries < 40; tries += 1) {
        option = [...d.querySelectorAll("[role=option],oj-option,li")].find((item) => item.getClientRects().length && (item.textContent || "").replace(/\s+/g, "").trim().toLowerCase() === expected.toLowerCase());
        if (option) break;
        await sleep(100);
      }
      if (!option) throw new Error(`Compression format option was not available: ${expected}`);
      clickButton(option.closest("[role=option],oj-option,li") || option);
      for (let tries = 0; tries < 40; tries += 1) {
        const selected = `${input.value || ""} ${host.value || ""} ${host.getAttribute?.("value") || ""}`.toLowerCase();
        if (selected.includes(expected.toLowerCase())) return;
        await sleep(100);
      }
      throw new Error(`Compression format did not switch to ${expected}`);
    };
    const applyContract = async () => {
      const contract = config.fileContract || {};
      if (contract.format === "JSON") await selectOption(d.getElementById("file-type|input"), "JSON");
      const parser = contract.csvParser || "RFC 4180";
      await chooseCsvParser(parser);
      const delimiterValue = { ",":"Comma", ";":"Semicolon", "tab":"Tab", "|":"Pipe" }[contract.delimiter] || "Comma";
      const delimiter = d.getElementById("delimiter|input");
      if (/open csv/i.test(parser) && delimiter) {
        for (let tries = 0; tries < 40 && delimiter.disabled; tries += 1) await sleep(100);
        if (delimiter.disabled) throw new Error("Field delimiter stayed disabled after selecting Open CSV.");
        await selectOption(delimiter, delimiterValue);
      }
      if (config.side === "destination") {
        // OOS treats None as its default state and does not consistently show
        // it as a selectable list option. Leave that default untouched.
        const compression = String(contract.compression || "none").trim().toLowerCase();
        if (compression && compression !== "none") await chooseDestinationCompression(compression);
      }
    };
    const waitForGeneratedId = async () => {
      const id = () => d.getElementById(config.side === "destination" ? "destination-id-input|input" : "source-id-input|input");
      const nameInput = d.getElementById("source-name-input|input");
      // CDP derives the required ID asynchronously after it accepts Name.
      // Do not treat an enabled Save as a substitute for this required state.
      for (let tries = 0; tries < 40; tries += 1) {
        if (String(id()?.value || "").trim()) return;
        await sleep(150);
      }
      // A second focused commit handles the occasional JET render where the
      // first input event lands during the form's post-type initialization.
      if (nameInput) touch(nameInput, config.name);
      for (let tries = 0; tries < 40; tries += 1) {
        if (String(id()?.value || "").trim()) return;
        await sleep(150);
      }
      if (nameInput?.getAttribute("aria-invalid") === "true") {
        throw new Error("CDP rejected the connection name, so it did not generate a Source ID.");
      }
      throw new Error("CDP did not generate the required Source ID after entering the connection name.");
    };
    for (const [id, value] of ids) {
      const input = d.getElementById(id);
      if (!input) missing.push(id);
      else touch(input, value);
      await sleep(450);
    }
    if (missing.length) throw new Error(`Missing OOS fields: ${missing.join(", ")}`);
    if (!config.nameCommitted) await resolveDuplicateName();
    await waitForGeneratedId();
    await applyContract();
    await waitSave();
    return;
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => Boolean(element?.getClientRects().length);
  const normalize = (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const wait = async (find, label, timeout = 60000) => { const end = Date.now() + timeout; while (Date.now() < end) { const result = find(); if (result) return result; await sleep(180); } throw new Error(`Not available: ${label}`); };
  const click = async (element) => { element.scrollIntoView({ block:"center" }); element.focus?.(); element.dispatchEvent(new MouseEvent("mousedown", { bubbles:true, cancelable:true })); element.dispatchEvent(new MouseEvent("mouseup", { bubbles:true, cancelable:true })); element.click(); await sleep(250); };
  const setValue = async (element, value) => {
    element.scrollIntoView({ block:"center" }); element.focus();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter ? setter.call(element, value) : element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles:true, composed:true, inputType:"insertText", data:String(value) }));
    const jetHost = element.closest("oj-input-text, oj-text-area");
    if (jetHost) {
      try {
        jetHost.rawValue = value;
        jetHost.value = value;
      } catch (_) { /* Native events below remain the fallback. */ }
    }
    element.dispatchEvent(new Event("change", { bubbles:true }));
    element.blur(); element.dispatchEvent(new FocusEvent("focusout", { bubbles:true }));
    await sleep(180);
  };
  // Oracle JET can transiently mark the name invalid while its asynchronous
  // validator runs. Require CDP's duplicate-name message before adding a
  // suffix; do not infer validity from the generated ID.
  const resolveDuplicateName = async () => {
    const nameInput = document.getElementById("source-name-input|input");
    if (!nameInput || !visible(nameInput) || nameInput.disabled || nameInput.readOnly) return;
    const duplicateName = async () => {
      await sleep(2000);
      if (nameInput.getAttribute("aria-invalid") !== "true") return false;
      const messages = [...document.querySelectorAll("[role=alert], [role=tooltip], .oj-message, .oj-message-detail, .oj-messages, .oj-popup-content")]
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
      return /(?:source|destination|connection)?\s*(?:with\s+this\s+)?name\s+already\s+exists|name\s+must\s+be\s+unique|try\s+another/i.test(messages);
    };
    if (!(await duplicateName())) return;
    const baseName = String(config.name).replace(/_\d{2}$/, "");
    for (let index = 2; index <= 99; index += 1) {
      const candidate = `${baseName}_${String(index).padStart(2, "0")}`;
      await setValue(nameInput, candidate);
      if (!(await duplicateName())) { config.name = candidate; return; }
    }
    throw new Error(`CDP kept the connection name invalid for ${baseName}; no available suffix was found.`);
  };
  const aliases = { path:["oos-path|input","path"], endpoint:["oos-storeEndpoint|input","endpoint","storageendpoint"], key:["oos-storeKey|input","storagekey"], secret:["oos-storeSecret|input","storagesecret"], server:["sftp-server-name|input","sftpservername","server"], folder:["sftp-folder-name|input","foldername","folder"], region:["region"], accessKey:["accesskey"], secretKey:["secretkey"], instanceUrl:["instanceurl"], serviceUrl:["serviceurl"], username:["username"], password:["password"], securityToken:["securitytoken"], fileName:["file-name|input","filename"], dateFormat:["date-format|input","dateformat"], delimiter:["fielddelimiter","delimiter"] };
  const findField = (key) => { const candidates = aliases[key] || [key]; for (const candidate of candidates) { const direct = document.getElementById(candidate); if (visible(direct)) return direct; const input = [...document.querySelectorAll("input,textarea")].find((item) => visible(item) && [item.id,item.name,item.getAttribute("aria-label"),item.placeholder].some((value) => normalize(value).includes(normalize(candidate)))); if (input) return input; } const label = [...document.querySelectorAll("label")].find((item) => visible(item) && normalize(text(item)).includes(normalize(key))); if (label) return document.getElementById(label.htmlFor) || label.querySelector("input,textarea"); return null; };
  const selectText = async (labelText, value) => { const label = [...document.querySelectorAll("label")].find((item) => visible(item) && normalize(text(item)).includes(normalize(labelText))); const host = label?.parentElement?.querySelector("oj-select-single,oj-combobox-one,[role=combobox],input[role=combobox]") || [...document.querySelectorAll("oj-select-single,oj-combobox-one,input[role=combobox]")].find((item) => normalize(item.id).includes(normalize(labelText))); if (!host) return; await click(host.querySelector?.("input,[role=combobox],.oj-select-arrow") || host); const option = await wait(() => [...document.querySelectorAll("[role=option],oj-option,li")].find((item) => visible(item) && normalize(text(item)) === normalize(value)), `${labelText} ${value}`); await click(option); document.activeElement?.blur?.(); await sleep(180); };
  const upload = async (element, stored) => {
    if (!element || !stored?.data) return;
    let blob;
    if (typeof stored.data === "string" && stored.data.startsWith("data:")) {
      // CDP's page CSP can reject fetch(data:...) even though the file was
      // safely captured by the extension. Decode the stored data URI locally.
      const comma = stored.data.indexOf(",");
      if (comma < 0) throw new Error("The saved key file is not a valid data URI.");
      const header = stored.data.slice(0, comma);
      const payload = stored.data.slice(comma + 1);
      const mime = (header.match(/^data:([^;,]+)/i) || [])[1] || "application/octet-stream";
      const bytes = header.includes(";base64")
        ? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(payload));
      blob = new Blob([bytes], { type: mime });
    } else {
      blob = await (await fetch(stored.data)).blob();
    }
    const file = new File([blob], stored.fileName || "key", { type: blob.type || "application/octet-stream" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (element.matches?.("oj-file-picker")) {
      const nativeInput = element.querySelector('input[type="file"]') || element.shadowRoot?.querySelector('input[type="file"]');
      if (nativeInput) {
        nativeInput.files = transfer.files;
        nativeInput.dispatchEvent(new Event("change", { bubbles:true, composed:true }));
      }
      // Oracle JET exposes the selected files to the Knockout handler through
      // this component event; this is required when its native input is in a
      // shadow tree or has not yet been rendered.
      element.dispatchEvent(new CustomEvent("ojSelect", { bubbles:true, composed:true, detail:{ files: transfer.files } }));
      const fileControl = element.closest(".form-control") || element.parentElement;
      for (let tries = 0; tries < 40; tries += 1) {
        const clearLink = fileControl?.querySelector("[id$='-click']");
        if (clearLink?.getClientRects().length) return;
        await sleep(100);
      }
      throw new Error("CDP did not finish accepting the selected authentication key file.");
    }
    element.files = transfer.files;
    element.dispatchEvent(new Event("change", { bubbles:true }));
  };
  // Defensive recovery for Oracle's delayed list-to-form transition. The
  // background normally opens Create and selects the provider first; this
  // handles a list that re-rendered after that operation instead of failing
  // with an unhelpful missing-name error.
  const ensureConnectionForm = async () => {
    const nameInput = () => {
      const input = document.getElementById("source-name-input|input");
      return visible(input) && !input.disabled ? input : null;
    };
    if (nameInput()) return nameInput();
    const createLabel = config.side === "destination" ? "Create Destination" : "Create Source";
    const dropdownId = config.side === "destination" ? "oj-select-choice-destination-type" : "oj-select-choice-source-type";
    const end = Date.now() + 60000;
    let createRequested = false;
    while (Date.now() < end) {
      if (nameInput()) return nameInput();
      const create = [...document.querySelectorAll("button,oj-button,[role=button]")].find((element) => {
        const nativeButton = element.matches("button") ? element : element.querySelector("button");
        return visible(element) && !createRequested && normalize(text(element)) === normalize(createLabel) && !(nativeButton || element).disabled;
      });
      if (create) { createRequested = true; await click(create.matches("button") ? create : (create.querySelector("button") || create)); await sleep(350); continue; }
      const chooser = document.getElementById(dropdownId);
      if (visible(chooser)) {
        if (!normalize(text(chooser)).includes(normalize(config.type))) {
          await click(chooser.querySelector("input,[role=combobox],.oj-select-arrow,.oj-searchselect-arrow") || chooser);
          const option = await wait(() => [...document.querySelectorAll("[role=option],oj-option,li")].find((item) => visible(item) && normalize(text(item)) === normalize(config.type)), `${config.type} option`, 10000);
          await click(option);
        }
      }
      await sleep(180);
    }
    throw new Error("Not available: connection name after opening the Create form.");
  };
  const nameInput = await ensureConnectionForm();
  if (!config.nameCommitted) {
    await setValue(nameInput, config.name);
    await resolveDuplicateName();
  }
  const authKeyPicker = () => {
    const textArea = document.getElementById("auth-key|input") || findField("authenticationKey");
    return textArea?.closest(".form-control")?.querySelector("oj-file-picker") || null;
  };
  for (const [key, value] of Object.entries(config.fields || {})) { const element = key === "authenticationKey" && value?.data ? authKeyPicker() : findField(key); if (!element) { if (value) throw new Error(`The ${config.type} form does not expose a field for ${key}.`); continue; } if (value?.data) await upload(element, value); else await setValue(element, value); }
  const contract = config.fileContract || {};
  if (config.type !== "CX Sales") {
    await selectText("File type", contract.format || "CSV"); await selectText("Format", contract.format || "CSV");
    await selectText("Character set", contract.charset || "UTF-8"); await selectText("CSV parser", contract.csvParser || "RFC 4180");
    await selectText("Field delimiter", contract.delimiter || ",");
    const compression = String(contract.compression || "none").trim().toLowerCase();
    if (compression && compression !== "none") await selectText("Compression format", compression);
    const destinationFile = findField("fileName"); if (destinationFile && contract.destinationFileName) await setValue(destinationFile, contract.destinationFileName);
    const dateFormat = findField("dateFormat"); if (dateFormat && contract.dateFormat) await setValue(dateFormat, contract.dateFormat);
    const encryption = [...document.querySelectorAll("input[type=file]")].find((item) => visible(item) && /encryption/i.test(item.id + item.name + item.getAttribute("aria-label"))); if (encryption) await upload(encryption, contract.encryptionFile);
  }
  const deadline = Date.now() + 60000;
  let save;
  while (Date.now() < deadline && !save) {
    save = [...document.querySelectorAll("button,oj-button,[role=button]")].find((item) => {
      const button = item.matches("button") ? item : item.querySelector("button");
      return visible(item) && /^save$/i.test(text(item)) && !(button || item).disabled && (button || item).getAttribute("aria-disabled") !== "true";
    });
    if (!save) await sleep(250);
  }
  if (!save) throw new Error("Save did not become available after filling the connection form.");
  await click(save.querySelector("button") || save);
})().catch((error) => { console.error("Connection template automation failed", error); alert(`Connection template automation failed: ${error.message || error}`); });
