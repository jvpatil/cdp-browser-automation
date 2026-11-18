(() => {
  if (window.__cdpDataViewerTrustedClickBridgeInstalled) return;
  window.__cdpDataViewerTrustedClickBridgeInstalled = true;

  window.addEventListener("cdp-data-viewer-trusted-click", (event) => {
    let detail;
    try {
      detail = JSON.parse(document.documentElement.dataset.cdpDataViewerTrustedClick || "{}");
    } catch (_error) {
      return;
    }
    const rect = detail.rect;
    if (detail.action !== "next" || !rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return;
    chrome.runtime.sendMessage({
      type: "trusted-data-viewer-next",
      requestId: detail.requestId,
      rect: { x: rect.x, y: rect.y }
    }, (response) => {
      document.documentElement.dataset.cdpDataViewerTrustedClickResult = JSON.stringify({
        requestId: detail.requestId,
        ok: Boolean(response?.ok),
        error: response?.error || ""
      });
      window.dispatchEvent(new Event("cdp-data-viewer-trusted-click-result"));
    });
  });

  // A completed record is emitted once by the page runner. Forward that
  // bounded audit to the service worker so Activity updates during the batch.
  window.addEventListener("cdp-data-viewer-record-complete", () => {
    let payload;
    try { payload = JSON.parse(document.documentElement.dataset.cdpDataViewerRecord || "{}"); }
    catch (_error) { return; }
    if (!payload.requestId || !payload.record) return;
    chrome.runtime.sendMessage({ type: "data-viewer-record-complete", record: payload.record }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      document.documentElement.dataset.cdpDataViewerRecordResult = JSON.stringify({
        requestId: payload.requestId,
        ok: Boolean(response?.ok) && !runtimeError
      });
      window.dispatchEvent(new Event("cdp-data-viewer-record-result"));
    });
  });
})();
