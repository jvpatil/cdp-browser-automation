(function () {
  async function runCdpIntegrationStatusCheck({ jobNames }) {
    if (!Array.isArray(jobNames) || !jobNames.length) {
      throw new Error("No saved job names were supplied for publish verification.");
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = Date.now() + 300000;
    const visible = (element) => Boolean(element?.getClientRects().length);
    const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
    const cancelled = () => window.__cdpPublishCancelled === true;

    const statusFor = (jobName) => {
      const jobElement = [...document.querySelectorAll(".entity-name, [title], span, div")]
        .find((element) => visible(element) && text(element).includes(jobName));
      if (!jobElement) return "Not found";

      let row = jobElement;
      for (let level = 0; row && level < 7; level += 1, row = row.parentElement) {
        const statusElement = [...row.querySelectorAll(".oj-badge, [title]")]
          .find((element) => {
            const value = text(element) || element.getAttribute("title") || "";
            return /^(Published|Unpublished|Processing)$/i.test(value);
          });
        if (statusElement) return text(statusElement) || statusElement.getAttribute("title");
      }
      return "Processing";
    };

    while (Date.now() < deadline) {
      if (cancelled()) throw new Error("Publish verification was stopped by the user.");

      const statuses = Object.fromEntries(jobNames.map((jobName) => [jobName, statusFor(jobName)]));
      if (Object.values(statuses).every((status) => /^Published$/i.test(status))) {
        return statuses;
      }

      const clearAll = document.getElementById("clear-all-link");
      if (visible(clearAll)) clearAll.click();
      await sleep(5000);
    }

    const statuses = Object.fromEntries(jobNames.map((jobName) => [jobName, statusFor(jobName)]));
    throw new Error(`Jobs did not reach Published within 5 minutes: ${JSON.stringify(statuses)}`);
  }

  window.runCdpIntegrationStatusCheck = runCdpIntegrationStatusCheck;
})();
