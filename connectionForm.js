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
    const ids = [["source-name-input|input", config.name], ["oos-path|input", f.path || ""], ["oos-storeEndpoint|input", f.endpoint || ""], ["oos-storeKey|input", f.key || ""], ["oos-storeSecret|input", f.secret || ""]];
    const missing = [];
    const set = (input, value) => { const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set; setter ? setter.call(input, value) : input.value = value; input.setAttribute("value", value); };
    const fire = (input, type, options = {}) => { const EventType = /^(blur|focus|focusout|focusin)$/.test(type) ? FocusEvent : type === "input" && typeof InputEvent === "function" ? InputEvent : Event; input.dispatchEvent(new EventType(type, { bubbles:true, cancelable:true, composed:true, ...options })); };
    const touch = (input, value) => { input.scrollIntoView({ block:"center" }); input.focus(); fire(input,"focus"); set(input,value); fire(input,"keydown",{key:"a",code:"KeyA",keyCode:65,which:65}); fire(input,"input",{inputType:"insertText",data:String(value).slice(-1)}); fire(input,"keyup",{key:"a",code:"KeyA",keyCode:65,which:65}); fire(input,"change"); input.blur(); fire(input,"focusout"); };
    const enabled = (button) => Boolean(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true" && !button.closest("oj-button")?.classList.contains("oj-disabled");
    const realButton = (item) => item?.tagName?.toLowerCase() === "oj-button" ? item.querySelector("button") || item : item;
    const clickButton = (button) => { const target = realButton(button); target.scrollIntoView({ block:"center" }); target.focus(); target.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,view:window,button:0})); target.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true,view:window,button:0})); target.click(); };
    const saveId = config.side === "destination" ? "dst-saveClose-btn" : "create-source-saveClose";
    const waitSave = async () => { for (let tries = 0; tries < 120; tries += 1) { const save = realButton(d.getElementById(saveId)); if (enabled(save)) { clickButton(save); return; } await sleep(250); } throw new Error("Connection verification did not enable Save and Close. Check the profile path, endpoint, key, and secret."); };
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
        await chooseDestinationCompression(contract.compression || "none");
      }
    };
    const verify = async () => { for (let tries = 0; tries < 40; tries += 1) { const button = realButton([...d.querySelectorAll("button,.oj-button-button,oj-button")].find((item) => /verify connection/i.test((item.textContent || "").replace(/\s+/g," ").trim()))); if (button && enabled(button)) { clickButton(button); await sleep(2000); return waitSave(); } await sleep(250); } throw new Error("Verify Connection is disabled. Check the profile values were committed."); };
    ids.forEach(([id,value], index) => setTimeout(() => { const input = d.getElementById(id); if (!input) missing.push(id); else touch(input,value); if (index === ids.length - 1) { if (missing.length) throw new Error(`Missing OOS fields: ${missing.join(", ")}`); setTimeout(() => applyContract().then(verify).catch((error) => { alert(`Connection template automation failed: ${error.message || error}`); }),700); } }, 300 * index));
    return;
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => Boolean(element?.getClientRects().length);
  const normalize = (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const wait = async (find, label, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { const result = find(); if (result) return result; await sleep(180); } throw new Error(`Not available: ${label}`); };
  const click = async (element) => { element.scrollIntoView({ block:"center" }); element.focus?.(); element.dispatchEvent(new MouseEvent("mousedown", { bubbles:true, cancelable:true })); element.dispatchEvent(new MouseEvent("mouseup", { bubbles:true, cancelable:true })); element.click(); await sleep(250); };
  const setValue = async (element, value) => {
    element.scrollIntoView({ block:"center" }); element.focus();
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter ? setter.call(element, value) : element.value = value;
    element.dispatchEvent(new KeyboardEvent("keydown", { key:"a", code:"KeyA", keyCode:65, which:65, bubbles:true }));
    element.dispatchEvent(new Event("input", { bubbles:true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { key:"a", code:"KeyA", keyCode:65, which:65, bubbles:true }));
    element.dispatchEvent(new Event("change", { bubbles:true }));
    element.blur(); element.dispatchEvent(new FocusEvent("focusout", { bubbles:true }));
    await sleep(180);
  };
  const aliases = { path:["oos-path|input","path"], endpoint:["oos-storeEndpoint|input","endpoint","storageendpoint"], key:["oos-storeKey|input","storagekey"], secret:["oos-storeSecret|input","storagesecret"], server:["sftp-server-name|input","sftpservername","server"], folder:["sftp-folder-name|input","foldername","folder"], region:["region"], accessKey:["accesskey"], secretKey:["secretkey"], instanceUrl:["instanceurl"], serviceUrl:["serviceurl"], username:["username"], password:["password"], securityToken:["securitytoken"], fileName:["file-name|input","filename"], dateFormat:["date-format|input","dateformat"], delimiter:["fielddelimiter","delimiter"] };
  const findField = (key) => { const candidates = aliases[key] || [key]; for (const candidate of candidates) { const direct = document.getElementById(candidate); if (visible(direct)) return direct; const input = [...document.querySelectorAll("input,textarea")].find((item) => visible(item) && [item.id,item.name,item.getAttribute("aria-label"),item.placeholder].some((value) => normalize(value).includes(normalize(candidate)))); if (input) return input; } const label = [...document.querySelectorAll("label")].find((item) => visible(item) && normalize(text(item)).includes(normalize(key))); if (label) return document.getElementById(label.htmlFor) || label.querySelector("input,textarea"); return null; };
  const selectText = async (labelText, value) => { const label = [...document.querySelectorAll("label")].find((item) => visible(item) && normalize(text(item)).includes(normalize(labelText))); const host = label?.parentElement?.querySelector("oj-select-single,oj-combobox-one,[role=combobox],input[role=combobox]") || [...document.querySelectorAll("oj-select-single,oj-combobox-one,input[role=combobox]")].find((item) => normalize(item.id).includes(normalize(labelText))); if (!host) return; await click(host.querySelector?.("input,[role=combobox],.oj-select-arrow") || host); const option = await wait(() => [...document.querySelectorAll("[role=option],oj-option,li")].find((item) => visible(item) && normalize(text(item)) === normalize(value)), `${labelText} ${value}`); await click(option); document.activeElement?.blur?.(); await sleep(180); };
  const upload = async (element, stored) => { if (!element || !stored?.data) return; const blob = await (await fetch(stored.data)).blob(); const file = new File([blob], stored.fileName || "key", { type: blob.type || "application/octet-stream" }); const transfer = new DataTransfer(); transfer.items.add(file); element.files = transfer.files; element.dispatchEvent(new Event("change", { bubbles:true })); };
  const nameInput = await wait(() => document.getElementById("source-name-input|input"), "connection name"); await setValue(nameInput, config.name);
  for (const [key, value] of Object.entries(config.fields || {})) { const element = findField(key); if (!element) { if (value) throw new Error(`The ${config.type} form does not expose a field for ${key}.`); continue; } if (value?.data) await upload(element, value); else await setValue(element, value); }
  const contract = config.fileContract || {};
  if (config.type !== "CX Sales") {
    await selectText("File type", contract.format || "CSV"); await selectText("Format", contract.format || "CSV");
    await selectText("Character set", contract.charset || "UTF-8"); await selectText("CSV parser", contract.csvParser || "RFC 4180");
    await selectText("Field delimiter", contract.delimiter || ","); await selectText("Compression format", contract.compression || "none");
    const destinationFile = findField("fileName"); if (destinationFile && contract.destinationFileName) await setValue(destinationFile, contract.destinationFileName);
    const dateFormat = findField("dateFormat"); if (dateFormat && contract.dateFormat) await setValue(dateFormat, contract.dateFormat);
    const encryption = [...document.querySelectorAll("input[type=file]")].find((item) => visible(item) && /encryption/i.test(item.id + item.name + item.getAttribute("aria-label"))); if (encryption) await upload(encryption, contract.encryptionFile);
  }
  const verify = await wait(() => [...document.querySelectorAll("button,oj-button")].find((item) => visible(item) && /verify connection/i.test(text(item))), "Verify Connection");
  const verifyButton = verify.querySelector("button") || verify;
  if (verifyButton.disabled || verifyButton.getAttribute("aria-disabled") === "true") throw new Error("Verify Connection is disabled. Check the required connection-profile fields.");
  await click(verifyButton);
  const deadline = Date.now() + 60000;
  let save;
  while (Date.now() < deadline && !save) {
    const messages = [...document.querySelectorAll("[role=alert],.oj-message,.oj-message-summary,.oj-messages,[class*=error],[class*=message]")].filter(visible).map(text).filter(Boolean);
    const failure = messages.find((message) => /connection.*(failed|failure|unable)|verification.*(failed|failure)|invalid.*(credential|key|secret)|error/i.test(message));
    if (failure) throw new Error(`Connection verification failed: ${failure}. Oracle keeps Save and Close disabled until verification succeeds.`);
    save = [...document.querySelectorAll("button,oj-button")].find((item) => visible(item) && /save and close/i.test(text(item)) && !(item.disabled || item.getAttribute("aria-disabled") === "true"));
    if (!save) await sleep(250);
  }
  if (!save) throw new Error("Connection verification did not complete. Oracle keeps Save and Close disabled until the connection validates successfully.");
  await click(save.querySelector("button") || save);
})().catch((error) => { console.error("Connection template automation failed", error); alert(`Connection template automation failed: ${error.message || error}`); });
