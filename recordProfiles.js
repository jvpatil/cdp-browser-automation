// Shared QA data profiles for the stream API and Data Viewer form.
// Keep exact decimal/int64 values as strings until the API wire serializer.
(() => {
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  const kind = (position, count) => count === 1 ? "upper"
    : position === 1 ? "happy"
      : position === 2 ? "upper"
        : position === 3 ? "minimum"
          : position === 4 ? "sparse" : "variation";
  const sourceKey = (sequence, runDate, position, count) => {
    const date = `${pad(runDate.getDate())}${pad(runDate.getMonth() + 1)}${pad(runDate.getFullYear() % 100)}`;
    const ordinary = `${date}${pad(sequence, 3)}`;
    return kind(position, count) === "minimum" ? `000${ordinary}` : ordinary;
  };
  const value = (fieldKey, { position, count, sequence, runDate, ui = false } = {}) => {
    const profile = kind(position, count);
    if (profile === "sparse") return undefined; // Caller preserves NOT NULL and source keys.
    const utcDate = runDate.toISOString().slice(0, 10);
    const isoTime = runDate.toISOString().slice(0, 19);
    const stamp = (date, time) => `${date}${ui ? "T" : " "}${time}`;
    const variation = Math.max(0, position - 5);
    const specs = {
      happy: {
        tinyintvalue: 7, smallintvalue: 1200, intvalue: 250000, bigintvalue: "1234567890123",
        floatvalue: 4.3, doublevalue: 0.803, decimalvalue: "149.9500", booleanvalue: true,
        datevalue: utcDate, timestampvalue: stamp(isoTime.slice(0, 10), isoTime.slice(11)),
        textvalue: "Customer requested an Oracle CX product demonstration.",
        arraystringvalues: ["Oracle CX", "Email subscriber"]
      },
      upper: {
        tinyintvalue: 127, smallintvalue: 32767, intvalue: 2147483647,
        bigintvalue: "9223372036854775807", floatvalue: 3.402823e38, doublevalue: 1.79e308,
        decimalvalue: "99999999999999.9999", booleanvalue: true,
        datevalue: utcDate, timestampvalue: stamp(utcDate, "23:59:59"),
        textvalue: "Café ग्राहक — multilingual boundary record with Unicode text.",
        arraystringvalues: ["International", "High precision"]
      },
      minimum: {
        tinyintvalue: -128, smallintvalue: -32768, intvalue: -2147483648,
        bigintvalue: "-9223372036854775808", floatvalue: -3.402823e38, doublevalue: -1.79e308,
        decimalvalue: "0.0000", booleanvalue: false,
        datevalue: "1970-01-01", timestampvalue: stamp("1970-01-01", "00:00:00"),
        textvalue: "", arraystringvalues: []
      },
      variation: {
        tinyintvalue: (variation % 21) - 10, smallintvalue: 120 + variation * 13,
        intvalue: 10000 + sequence, bigintvalue: String(9000000000000000n + BigInt(sequence)),
        floatvalue: Number((3.1 + variation / 10).toFixed(2)),
        doublevalue: Number((0.625 + variation / 100).toFixed(3)),
        decimalvalue: (49.95 + variation * 17).toFixed(4), booleanvalue: variation % 2 === 0,
        datevalue: ["2024-02-29", "2025-12-31", "2026-01-15", utcDate][variation % 4],
        timestampvalue: stamp(["2024-02-29", "2025-12-31", "2026-01-15", utcDate][variation % 4], "14:35:20"),
        textvalue: ["Returning customer chose email updates.", "New customer viewed a product webinar.", "Renewal inquiry from an enterprise account."][variation % 3],
        arraystringvalues: ["Customer engagement", ["Email", "Web", "Mobile"][variation % 3]]
      }
    };
    if (fieldKey === "email") {
      if (profile === "upper") return `jagan.boundary+${sequence}@example.com`;
      if (profile === "minimum") return `jagan.minimum+${sequence}@example.org`;
      if (profile === "variation") return `jagan.customer+${sequence}@xn--bcher-kva.example`;
      return "jagannath.patil@oracle.com";
    }
    return specs[profile]?.[fieldKey];
  };
  const serializeExactNumericPayload = (body, exactNumericFields = []) => {
    const exact = new Set(exactNumericFields);
    const tokens = [];
    const nonce = Math.random().toString(36).slice(2);
    const serialized = JSON.stringify(body, (key, entry) => {
      if (!exact.has(key) || entry == null) return entry;
      const raw = String(entry);
      if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error(`Invalid exact numeric value for ${key}.`);
      const token = `__CDP_EXACT_NUMBER_${nonce}_${tokens.length}__`;
      tokens.push(raw);
      return token;
    });
    return serialized.replace(new RegExp(`"__CDP_EXACT_NUMBER_${nonce}_(\\d+)__"`, "g"), (_match, index) => tokens[Number(index)]);
  };
  globalThis.cdpRecordProfiles = Object.freeze({ kind, sourceKey, value, serializeExactNumericPayload });
})();
