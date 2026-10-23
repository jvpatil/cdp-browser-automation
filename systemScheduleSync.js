(function (root) {
  "use strict";

  const SYSTEM_TRIGGERS = Object.freeze({ dw: /^defaultTrigger_DW(?:_|$)/, resolution: /^defaultTrigger_RESOLUTION(?:_|$)/ });
  const BANGALORE_ZONES = new Set(["Asia/Calcutta", "Asia/Kolkata"]);

  function records(value) {
    if (Array.isArray(value)) return value;
    for (const key of ["items", "data", "records", "results", "jobs", "schedules", "triggeredSchedules", "content", "Job"]) {
      if (Array.isArray(value?.[key])) return value[key];
      if (value?.[key] && typeof value[key] === "object") {
        const nested = records(value[key]);
        if (nested.length) return nested;
      }
    }
    return value && typeof value === "object" && (value.name || value.scheduleId) ? [value] : [];
  }

  function exactJob(value, name) {
    const matches = records(value).filter((job) => [job?.name, job?.jobName, job?.jobId].includes(name));
    if (matches.length !== 1) throw new Error(`Expected one live job named ${name}; found ${matches.length}.`);
    return matches[0];
  }

  function requireActive(job, label) {
    const status = String(job?.status || job?.state || "").toLowerCase();
    if (job?.active !== true && !["active", "enabled"].includes(status)) {
      throw new Error(`${label} is not confirmed active in Oracle. Activate and publish it before syncing.`);
    }
  }

  function scheduleIn(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 5) return null;
    if (value.days?.type && value.times?.type) return value;
    for (const key of ["schedule", "triggeredSchedule", "jobSchedule", "jobData", "trigger"]) {
      const found = scheduleIn(value[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function requireSchedule(job, triggerRecords, label) {
    const embedded = scheduleIn(job);
    if (embedded) return embedded;
    const id = job?.scheduleId || job?.triggeredScheduleId || job?.triggerId;
    const linked = id && records(triggerRecords).find((item) => item.scheduleId === id);
    const resolved = scheduleIn(linked);
    if (!resolved) throw new Error(`${label} did not expose a saved recurring schedule. Sync was not applied.`);
    return resolved;
  }

  function parseSpecific(schedule, label) {
    const dayType = String(schedule?.days?.type || "").toLowerCase();
    if (!["daily", "weekly"].includes(dayType)) throw new Error(`${label} must use a Daily or Weekly schedule.`);
    if (String(schedule?.times?.type || "").toLowerCase() !== "specific" || schedule.times.times?.length !== 1) {
      throw new Error(`${label} must have exactly one Specific run time.`);
    }
    const zone = schedule.timeZone || "Asia/Calcutta";
    if (!BANGALORE_ZONES.has(zone)) throw new Error(`${label} must use the Bangalore time zone.`);
    const time = String(schedule.times.times[0]);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`${label} has an invalid run time.`);
    return { days: schedule.days, dayKey: JSON.stringify(schedule.days), zone, minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) };
  }

  function time(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function sameSchedule(actual, expected) {
    if (!actual || !expected) return false;
    const sameDays = JSON.stringify(actual.days) === JSON.stringify(expected.days);
    const left = actual.times || {};
    const right = expected.times || {};
    return sameDays && BANGALORE_ZONES.has(actual.timeZone) && BANGALORE_ZONES.has(expected.timeZone)
      && left.type === right.type && left.start === right.start && left.end === right.end && Number(left.interval) === Number(right.interval);
  }

  function findTrigger(value, kind, fallbackId = "") {
    const matches = records(value).filter((item) => SYSTEM_TRIGGERS[kind].test(String(item?.scheduleId || "")));
    if (matches.length > 1) throw new Error(`Multiple ${kind} default triggers exist; select one in Oracle before syncing.`);
    if (matches.length) return matches[0];
    if (SYSTEM_TRIGGERS[kind].test(fallbackId)) return { scheduleId: fallbackId };
    throw new Error(`The tenant did not expose a ${kind} default trigger ID. Sync was not applied.`);
  }

  function buildSyncPlan({ importJob, deleteJob, triggeredSchedules, systemJobs = [] }) {
    requireActive(importJob, "Import job");
    requireActive(deleteJob, "Delete job");
    const imported = parseSpecific(requireSchedule(importJob, triggeredSchedules, "Import job"), "Import job");
    const deleted = parseSpecific(requireSchedule(deleteJob, triggeredSchedules, "Delete job"), "Delete job");
    if (imported.dayKey !== deleted.dayKey) throw new Error("Import and Delete must use the same Daily or Weekly days.");
    if (deleted.minutes <= imported.minutes) throw new Error("Delete must be scheduled after Import on the same day.");
    const gap = deleted.minutes - imported.minutes;
    if (gap < 60 || gap % 60) throw new Error("Import-to-Delete gap must be a whole number of hours (at least one hour).");

    const jobs = records(systemJobs);
    const systemId = (kind) => {
      const type = kind === "dw" ? "DW" : "ANALYTICS";
      const job = jobs.find((item) => String(item.jobType || item.type || "").toUpperCase() === type)
        || jobs.find((item) => String(item.jobId || "").toUpperCase() === (kind === "dw" ? "DW" : "ANALYTICS"));
      return job?.scheduleId || job?.triggeredScheduleId || job?.triggerId || "";
    };
    const make = (kind, offset) => {
      const first = imported.minutes + offset;
      const second = deleted.minutes + offset;
      if (second >= 1439) throw new Error("A DW/ID follow-up reaches midnight; choose earlier job times.");
      const trigger = findTrigger(triggeredSchedules, kind, systemId(kind));
      const schedule = {
        timeZone: "Asia/Calcutta", startDate: null, endDate: null,
        days: imported.days,
        times: { type: "interval", start: time(first), end: time(second + 1), interval: gap }
      };
      return {
        kind, scheduleId: trigger.scheduleId, exists: Boolean(scheduleIn(trigger)), method: scheduleIn(trigger) ? "PUT" : "POST",
        previous: scheduleIn(trigger) ? { name: trigger.name || "Default trigger for job.", scheduleId: trigger.scheduleId, description: trigger.description || "Created during creating/updating job process.", schedule: scheduleIn(trigger) } : null,
        body: { name: trigger.name || "Default trigger for job.", scheduleId: trigger.scheduleId, description: trigger.description || "Created during creating/updating job process.", schedule },
        first: time(first), second: time(second)
      };
    };
    return { frequency: imported.days.type, days: imported.days, timezone: "Asia/Calcutta", importTime: time(imported.minutes), deleteTime: time(deleted.minutes), gapMinutes: gap, dw: make("dw", 30), resolution: make("resolution", 90) };
  }

  const api = { records, exactJob, buildSyncPlan, sameSchedule };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CdpSystemScheduleSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
