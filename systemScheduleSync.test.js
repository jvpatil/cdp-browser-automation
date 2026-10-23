const assert = require("node:assert/strict");
const { buildSyncPlan, exactJob, sameSchedule } = require("./systemScheduleSync.js");

const schedule = (time, days = { type: "daily" }) => ({ timeZone: "Asia/Calcutta", days, times: { type: "specific", times: [time] } });
const triggers = [
  { scheduleId: "defaultTrigger_DW_abc", name: "Default trigger for job.", schedule: schedule("00:40") },
  { scheduleId: "defaultTrigger_RESOLUTION_xyz", name: "Default trigger for job.", schedule: schedule("00:30") }
];
const importJob = { name: "IMP_CUSTOMER", active: true, schedule: schedule("13:00") };
const deleteJob = { name: "DEL_CUSTOMER", active: true, schedule: schedule("17:00") };
const plan = buildSyncPlan({ importJob, deleteJob, triggeredSchedules: triggers });
assert.deepEqual([plan.dw.first, plan.dw.second, plan.resolution.first, plan.resolution.second], ["13:30", "17:30", "14:30", "18:30"]);
assert.deepEqual(plan.dw.body.schedule.times, { type: "interval", start: "13:30", end: "17:31", interval: 240 });
assert.deepEqual(plan.resolution.body.schedule.times, { type: "interval", start: "14:30", end: "18:31", interval: 240 });
assert.equal(plan.dw.exists, true);
assert.equal(plan.dw.method, "PUT");
assert.equal(sameSchedule({ ...plan.dw.body.schedule, times: { ...plan.dw.body.schedule.times, interval: "240" } }, plan.dw.body.schedule), true);
assert.equal(exactJob({ items: [importJob] }, "IMP_CUSTOMER"), importJob);
const newTrigger = buildSyncPlan({ importJob, deleteJob, triggeredSchedules: [], systemJobs: [
  { type: "DW", scheduleId: "defaultTrigger_DW_new" },
  { type: "ANALYTICS", scheduleId: "defaultTrigger_RESOLUTION_new" }
] });
assert.equal(newTrigger.dw.exists, false);
assert.equal(newTrigger.resolution.exists, false);
assert.equal(newTrigger.dw.method, "POST");

const weekly = { type: "weekly", days: [1] };
assert.equal(buildSyncPlan({ importJob: { ...importJob, schedule: schedule("16:00", weekly) }, deleteJob: { ...deleteJob, schedule: schedule("20:00", weekly) }, triggeredSchedules: triggers }).dw.body.schedule.days.type, "weekly");
assert.throws(() => buildSyncPlan({ importJob, deleteJob: { ...deleteJob, active: false }, triggeredSchedules: triggers }), /not confirmed active/);
assert.throws(() => buildSyncPlan({ importJob, deleteJob: { ...deleteJob, schedule: schedule("17:15") }, triggeredSchedules: triggers }), /whole number of hours/);
assert.throws(() => buildSyncPlan({ importJob, deleteJob: { ...deleteJob, schedule: schedule("22:30") }, triggeredSchedules: triggers }), /whole number of hours/);
assert.throws(() => buildSyncPlan({ importJob: { ...importJob, schedule: schedule("21:00") }, deleteJob: { ...deleteJob, schedule: schedule("23:00") }, triggeredSchedules: triggers }), /midnight/);
assert.throws(() => buildSyncPlan({ importJob: { ...importJob, schedule: schedule("13:00", weekly) }, deleteJob, triggeredSchedules: triggers }), /same Daily or Weekly days/);
assert.throws(() => buildSyncPlan({ importJob: { ...importJob, schedule: { ...schedule("13:00"), times: { type: "interval", start: "13:00", end: "17:00", interval: 240 } } }, deleteJob, triggeredSchedules: triggers }), /one Specific/);
assert.throws(() => buildSyncPlan({ importJob, deleteJob, triggeredSchedules: [triggers[0], triggers[0], triggers[1]] }), /Multiple dw/);
