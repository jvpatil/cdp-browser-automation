(function () {
  async function runCdpPublish({ mode, jobNames = [], startedAt = 0 }) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = Date.now() + 90000;
    const visible = (element) => Boolean(element?.getClientRects().length);
    const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
    const enabled = (element) =>
      Boolean(element) &&
      !element.disabled &&
      element.getAttribute("aria-disabled") !== "true" &&
      !element.closest("oj-button")?.classList.contains("oj-disabled");
    const throwIfCancelled = () => {
      if (window.__cdpPublishCancelled) {
        throw new Error("Publishing was stopped by the user.");
      }
    };

    async function waitFor(find, description) {
      while (Date.now() < deadline) {
        throwIfCancelled();
        const value = find();
        if (value) return value;
        await sleep(250);
      }
      throw new Error(`Timed out waiting for ${description}.`);
    }

    async function click(element) {
      throwIfCancelled();
      element.scrollIntoView({ block: "center" });
      element.focus?.();
      const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
      if (typeof PointerEvent !== "undefined") {
        element.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerType: "mouse" }));
      }
      element.dispatchEvent(new MouseEvent("mousedown", options));
      element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
      element.click();
      await sleep(300);
      throwIfCancelled();
    }

    await waitFor(() => [...document.querySelectorAll("h1,h2,h3,h4,span,div")]
      .find((element) => visible(element) && text(element) === "Data feeds"), "Data feeds header");

    const rowFor = (nameElement) =>
      nameElement.closest("span.oj-flex-item.ellipsis") ||
      nameElement.closest("span.ellipsis") ||
      (() => {
        let current = nameElement.parentElement;
        for (let level = 0; current && level < 6; level += 1, current = current.parentElement) {
          if (current.querySelector("oj-checkboxset input[type='checkbox']")) return current;
        }
        return null;
      })();

    const modifiedAt = (row) => {
      let current = row;
      for (let level = 0; current && level < 6; level += 1, current = current.parentElement) {
        const match = text(current).match(/last\s+modified\s+(.+?)(?:\s+by\s+|$)/i);
        if (match) {
          const timestamp = Date.parse(match[1].replace(/\bat\b/i, " "));
          if (!Number.isNaN(timestamp)) return timestamp;
        }
      }
      return Number.NaN;
    };

    const entityNames = () => [...document.querySelectorAll("span.entity-name")]
      .filter((element) => visible(element));

    const candidates = entityNames().filter((element) => {
      const name = text(element);
      const row = rowFor(element);
      if (mode === "all") {
        const checkbox = row?.querySelector("oj-checkboxset input[type='checkbox']");
        return Boolean(checkbox) && !checkbox.disabled && checkbox.getAttribute("aria-disabled") !== "true";
      }
      return jobNames.some((jobName) => name.includes(jobName)) &&
        row &&
        modifiedAt(row) >= startedAt - 5000;
    });

    if (!candidates.length) {
      throw new Error(mode === "all"
        ? "No selectable Data feeds jobs were found."
        : "No Data feeds jobs from this E2E run were found.");
    }

    let selected = 0;
    for (const nameElement of candidates) {
      throwIfCancelled();
      const row = rowFor(nameElement);
      const checkbox = row?.querySelector("oj-checkboxset input[type='checkbox']");
      if (!checkbox || checkbox.disabled || checkbox.getAttribute("aria-disabled") === "true") {
        throw new Error(`The Data feed is not selectable: ${text(nameElement)}`);
      }
      if (!checkbox.checked) {
        const label = document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`);
        await click(label || checkbox);
      }
      await waitFor(() => checkbox.checked, `selected checkbox for ${text(nameElement)}`);
      selected += 1;
    }

    const publishButton = await waitFor(() => {
      const host = document.getElementById("publish-tenant-btn");
      const button = host?.querySelector("button") || host;
      return visible(button) && enabled(button) ? button : null;
    }, "Publish button");
    await click(publishButton);

    const agreement = await waitFor(() => {
      const label = [...document.querySelectorAll("label")]
        .find((element) => visible(element) && /yes,?\s+i am ready to start publish/i.test(text(element)));
      if (!label) return null;
      const input = document.getElementById(label.getAttribute("for"));
      return input ? { input, label } : null;
    }, "publish confirmation checkbox");
    if (!agreement.input.checked) await click(agreement.label);
    await waitFor(() => agreement.input.checked, "publish confirmation selection");

    const startButton = await waitFor(() => [...document.querySelectorAll("button,oj-button,[role='button']")]
      .map((element) => element.querySelector?.("button") || element)
      .find((element) => visible(element) && enabled(element) && /^start publish job$/i.test(text(element))),
    "Start publish job button");
    await click(startButton);
    return { selected };
  }

  window.runCdpPublish = runCdpPublish;
})();
