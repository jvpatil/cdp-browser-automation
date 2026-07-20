(function () {
  const id = "cdp-automation-status";
  let activeStatus = "";

  function installStyles() {
    if (document.getElementById(`${id}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${id}-styles`;
    style.textContent = `
      #cdp-automation-status.status-pill { position:fixed !important; right:24px !important; top:12px !important; z-index:2147483647 !important; display:inline-flex !important; align-items:center !important; gap:5px !important; width:auto !important; height:auto !important; min-width:0 !important; max-width:280px !important; padding:3px 4px 3px 8px !important; border-radius:9999px !important; font-family:system-ui,-apple-system,sans-serif !important; font-size:11px !important; font-weight:600 !important; line-height:1 !important; white-space:nowrap !important; border:1px solid #ceead6 !important; background:#e6f4ea !important; color:#137333 !important; box-shadow:0 3px 10px rgba(19,115,51,.14) !important; }
      #cdp-automation-status.status-pill--failed { border-color:#efb4ae !important; background:#fce8e6 !important; color:#b3261e !important; }
      #cdp-automation-status .status-pill__spinner { display:block !important; flex:0 0 11px !important; width:11px !important; height:11px !important; max-width:11px !important; max-height:11px !important; animation:cdp-status-spin 1s linear infinite !important; opacity:.85 !important; }
      @keyframes cdp-status-spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
      #cdp-automation-status .status-pill__label { line-height:1 !important; overflow:hidden !important; text-overflow:ellipsis !important; }
      #cdp-automation-status .status-pill__stop-btn { align-self:stretch !important; display:flex !important; align-items:center !important; justify-content:center !important; flex:0 0 26px !important; width:26px !important; min-width:26px !important; margin:-3px -4px -3px 0 !important; padding:0 !important; border:none !important; border-radius:0 999px 999px 0 !important; background:#d93025 !important; color:#fff !important; cursor:pointer !important; transition:background-color .2s,color .2s !important; }
      #cdp-automation-status .status-pill__stop-btn:hover { background:#b31412 !important; color:#fff !important; }
      #cdp-automation-status .status-pill__stop-btn:focus-visible { outline:2px solid #b31412 !important; outline-offset:1px !important; }
      #cdp-automation-status .status-pill__stop-icon { display:block !important; width:11px !important; height:11px !important; max-width:11px !important; max-height:11px !important; }
    `;
    document.documentElement.append(style);
  }

  function render(status) {
    activeStatus = status || "";
    const running = /^Running:/.test(status || "");
    const failed = /^Failed:/.test(status || "");
    let panel = document.getElementById(id);
    if (!status || (!running && !failed)) {
      panel?.remove();
      return;
    }
    // Remove the old background-rendered pill (text only) before building the
    // interactive one. This also repairs a stale pill from an earlier reload.
    if (panel && (!panel.classList.contains("status-pill") || !panel.querySelector(`#${id}-message`) || !panel.querySelector(".status-pill__stop-btn"))) {
      panel.remove();
      panel = null;
    }
    if (!panel) {
      installStyles();
      panel = document.createElement("div");
      panel.id = id;
      panel.className = "status-pill";
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "polite");
      const spinner = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      spinner.className = "status-pill__spinner";
      spinner.style.setProperty("width", "10px", "important");
      spinner.style.setProperty("height", "10px", "important");
      spinner.style.setProperty("min-width", "10px", "important");
      spinner.style.setProperty("min-height", "10px", "important");
      spinner.style.setProperty("max-width", "10px", "important");
      spinner.style.setProperty("max-height", "10px", "important");
      spinner.style.setProperty("display", "block", "important");
      spinner.style.setProperty("flex", "0 0 10px", "important");
      spinner.setAttribute("viewBox", "0 0 24 24");
      spinner.setAttribute("aria-hidden", "true");
      const spinnerCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      spinnerCircle.setAttribute("cx", "12");
      spinnerCircle.setAttribute("cy", "12");
      spinnerCircle.setAttribute("r", "10");
      spinnerCircle.setAttribute("stroke", "currentColor");
      spinnerCircle.setAttribute("stroke-width", "3");
      spinnerCircle.setAttribute("fill", "none");
      spinnerCircle.setAttribute("stroke-dasharray", "42");
      spinner.append(spinnerCircle);
      panel.append(spinner);
      const message = document.createElement("span");
      message.id = `${id}-message`;
      message.className = "status-pill__label";
      panel.append(message);
      const stop = document.createElement("button");
      stop.type = "button";
      stop.title = "Stop";
      stop.setAttribute("aria-label", "Stop running process");
      stop.className = "status-pill__stop-btn";
      stop.style.setProperty("width", "26px", "important");
      stop.style.setProperty("min-width", "26px", "important");
      const stopIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      stopIcon.className = "status-pill__stop-icon";
      stopIcon.style.setProperty("width", "11px", "important");
      stopIcon.style.setProperty("height", "11px", "important");
      stopIcon.style.setProperty("min-width", "11px", "important");
      stopIcon.style.setProperty("min-height", "11px", "important");
      stopIcon.style.setProperty("max-width", "11px", "important");
      stopIcon.style.setProperty("max-height", "11px", "important");
      stopIcon.style.setProperty("display", "block", "important");
      stopIcon.setAttribute("viewBox", "0 0 24 24");
      stopIcon.setAttribute("fill", "currentColor");
      const stopRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      stopRect.setAttribute("x", "6");
      stopRect.setAttribute("y", "6");
      stopRect.setAttribute("width", "12");
      stopRect.setAttribute("height", "12");
      stopRect.setAttribute("rx", "1.5");
      stopIcon.append(stopRect);
      stop.append(stopIcon);
      stop.addEventListener("click", () => {
        stop.disabled = true;
        chrome.runtime.sendMessage({ type: "stop-current-flow" });
      });
      panel.append(stop);
      document.documentElement.append(panel);
    }
    panel.classList.toggle("status-pill--failed", failed);
    panel.querySelector(`#${id}-message`).textContent = status;
    panel.querySelector(".status-pill__spinner").hidden = !running;
    panel.querySelector(".status-pill__stop-btn").hidden = !running;
  }

  function refresh() {
    chrome.runtime.sendMessage({ type: "get-current-run-status" }, (response) => {
      render(response?.status || "");
    });
  }

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === "local") refresh();
  });
  // Oracle replaces portions of the document during route changes. If that
  // replaces our element with an older text-only version, rebuild the complete
  // interactive pill without waiting for another storage update.
  setInterval(() => {
    if (activeStatus) render(activeStatus);
  }, 500);
  refresh();
})();
