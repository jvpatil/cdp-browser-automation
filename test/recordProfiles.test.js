const test = require("node:test");
const assert = require("node:assert/strict");
require("../recordProfiles.js");

const profiles = globalThis.cdpRecordProfiles;
const date = new Date("2026-10-16T10:20:30.000Z");
const sample = (field, position, count, ui = false) => profiles.value(field, {
  position, count, sequence: position, runDate: date, ui
});

test("one record is the upper boundary", () => {
  assert.equal(profiles.kind(1, 1), "upper");
  assert.equal(sample("tinyintvalue", 1, 1), 127);
  assert.equal(sample("intvalue", 1, 1), 2147483647);
  assert.equal(sample("bigintvalue", 1, 1), "9223372036854775807");
  assert.equal(sample("decimalvalue", 1, 1), "99999999999999.9999");
  assert.equal(sample("timestampvalue", 1, 1), "2026-10-16 23:59:59");
  assert.equal(sample("timestampvalue", 1, 1, true), "2026-10-16T23:59:59");
  assert.match(sample("email", 1, 1), /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
});

test("two through five records follow the requested priority", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((position) => profiles.kind(position, 5)),
    ["happy", "upper", "minimum", "sparse", "variation"]);
  assert.equal(sample("tinyintvalue", 3, 5), -128);
  assert.equal(sample("decimalvalue", 3, 5), "0.0000");
  assert.equal(sample("textvalue", 3, 5), "");
  assert.equal(sample("intvalue", 4, 5), undefined);
  assert.equal(profiles.sourceKey(3, date, 3, 5), "000161026003");
});

test("exact numeric serializer preserves int64 and decimal JSON literals", () => {
  const json = profiles.serializeExactNumericPayload({ rows: [{
    BigIntValue_c: "9223372036854775807",
    DecimalValue_c: "99999999999999.9999",
    SourceCustomerID_c: "000161026003",
    TextValue_c: "Café ग्राहक"
  }] }, ["BigIntValue_c", "DecimalValue_c"]);
  assert.match(json, /"BigIntValue_c":9223372036854775807/);
  assert.match(json, /"DecimalValue_c":99999999999999\.9999/);
  assert.match(json, /"SourceCustomerID_c":"000161026003"/);
  assert.match(json, /"TextValue_c":"Café ग्राहक"/);
});

test("all profile values respect declared ranges and date shapes", () => {
  for (const count of [1, 2, 3, 4, 10]) {
    const keys = new Set();
    for (let position = 1; position <= count; position += 1) {
      const key = profiles.sourceKey(position, date, position, count);
      assert.equal(keys.has(key), false);
      keys.add(key);
      if (profiles.kind(position, count) === "sparse") continue;
      assert.ok(sample("tinyintvalue", position, count) >= -128 && sample("tinyintvalue", position, count) <= 127);
      assert.ok(sample("smallintvalue", position, count) >= -32768 && sample("smallintvalue", position, count) <= 32767);
      assert.match(sample("datevalue", position, count), /^\d{4}-\d{2}-\d{2}$/);
      assert.match(sample("timestampvalue", position, count), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      assert.match(sample("email", position, count), /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    }
  }
});
