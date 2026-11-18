const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const viewerSource = fs.readFileSync(path.join(__dirname, "../dataViewer.js"), "utf8");
const timestampStart = viewerSource.indexOf("  const viewerTimestamp =");
const timestampEnd = viewerSource.indexOf("  const tableShortCode =", timestampStart);
assert.ok(timestampStart >= 0 && timestampEnd > timestampStart);
const context = vm.createContext({});
vm.runInContext(`${viewerSource.slice(timestampStart, timestampEnd)}\nthis.formatViewerTimestamp = viewerTimestamp;`, context);

test("Data Viewer converts ISO-like timestamps to its month-first 12-hour input format", () => {
  assert.equal(context.formatViewerTimestamp("2026-11-06T00:00:00"), "11/06/2026, 12:00:00 AM");
  assert.equal(context.formatViewerTimestamp("2026-11-06 12:00:00"), "11/06/2026, 12:00:00 PM");
  assert.equal(context.formatViewerTimestamp("2026-11-06 16:57:41"), "11/06/2026, 04:57:41 PM");
});

test("Data Viewer leaves date-only and already formatted values unchanged", () => {
  assert.equal(context.formatViewerTimestamp("2026-11-06"), "2026-11-06");
  assert.equal(context.formatViewerTimestamp("11/06/2026, 12:00:00 AM"), "11/06/2026, 12:00:00 AM");
});
