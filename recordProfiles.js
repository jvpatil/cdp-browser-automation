// Shared QA data profiles for the stream API and Data Viewer form.
// Keep exact decimal/int64 values as strings until the API wire serializer.
(() => {
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  const ordinarySourceKey = (sequence, runDate) => {
    const date = `${pad(runDate.getDate())}${pad(runDate.getMonth() + 1)}${pad(runDate.getFullYear() % 100)}`;
    return `${date}${pad(sequence, 3)}`;
  };
  const kind = (position, count) => count === 1 ? "elevated"
    : position === 1 ? "happy"
      : position === 2 ? "elevated"
        : position === 3 ? "minimum"
          : position === 4 ? "sparse" : "variation";
  const sourceKey = (sequence, runDate, position, count) => {
    const ordinary = ordinarySourceKey(sequence, runDate);
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
      elevated: {
        tinyintvalue: 42, smallintvalue: 4200, intvalue: 750000,
        bigintvalue: "2345678901234", floatvalue: 42.5, doublevalue: 80.3,
        decimalvalue: "1499.9500", booleanvalue: true,
        datevalue: utcDate, timestampvalue: stamp(isoTime.slice(0, 10), isoTime.slice(11)),
        textvalue: "Customer requested a multi-product Oracle CX demonstration.",
        arraystringvalues: ["Oracle CX", "Product demonstration"]
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
      if (profile === "elevated") return `jagan.customer.high+${sequence}@example.com`;
      if (profile === "minimum") return `jagan.minimum+${sequence}@example.org`;
      if (profile === "variation") return `jagan.customer+${sequence}@xn--bcher-kva.example`;
      return "jagannath.patil@oracle.com";
    }
    return specs[profile]?.[fieldKey];
  };
  // Type-coded columns are business attributes, not generic test-value
  // placeholders. Keep this single catalog shared by API and Data Viewer.
  const businessValue = (fieldKey, { sequence = 1, runDate = new Date() } = {}) => {
    const ordinal = Math.max(1, Number(sequence) || 1);
    const date = runDate.toISOString().slice(0, 10);
    const timestamp = runDate.toISOString().slice(0, 19).replace("T", " ");
    const money = (base) => (base + ordinal / 100).toFixed(4);
    const examples = {
      interesttagsas: ["Oracle CX", "Loyalty"], eventtagsas: ["Product view", "Web"],
      itemcategoriesas: ["Cloud services", "Subscription"], featuretagsas: ["Analytics", "Integration"],
      servicetagsas: ["Support", "Renewal"],
      loyaltypointsbalancei64: String(125000 + ordinal), lifetimeeventcounti64: String(1000000 + ordinal),
      totalunitsprocessedi64: String(250000 + ordinal), lifetimeunitssoldi64: String(500000 + ordinal),
      contractvalueincentsi64: String(12500000 + ordinal),
      isloyaltymemberb: ordinal % 2 === 1, isconversioneventb: ordinal % 3 === 0,
      isrefundedb: ordinal % 5 === 0, isavailableb: true, isrenewaleligibleb: ordinal % 2 === 1,
      membershipstartdatedt: date, activitydatedt: date, settlementdatedt: date,
      launchdatedt: date, contractstartdatedt: date,
      lifetimespendn18p4: money(149.95), cartamountn18p4: money(79.95),
      netamountn18p4: money(249.95), listpricen18p4: money(99.95),
      annualcontractvaluen18p4: money(1499.95),
      engagementindexf64: Number((0.7 + (ordinal % 20) / 100).toFixed(3)),
      sessiondurationsecondsf64: Number((120 + ordinal / 10).toFixed(2)),
      taxratepercentf64: 8.25, averageratingf64: Number((4.2 + (ordinal % 5) / 10).toFixed(2)),
      utilizationpercentf64: Number((72 + (ordinal % 10) / 10).toFixed(2)),
      satisfactionscoref32: Number((4.1 + (ordinal % 5) / 10).toFixed(2)),
      scrolldepthpercentf32: 65 + ordinal % 30, discountpercentf32: 5 + ordinal % 20,
      weightkgf32: Number((1.5 + (ordinal % 20) / 10).toFixed(2)),
      healthscoref32: 70 + ordinal % 20,
      annualincomei32: 65000 + ordinal * 100, pageviewcounti32: 10 + ordinal,
      unitssoldi32: 2 + ordinal % 20, stockquantityi32: 75 + ordinal,
      employeecounti32: 100 + ordinal,
      referralcounti16: 1 + ordinal % 20, clickcounti16: 3 + ordinal % 30,
      installmentcounti16: 3 + ordinal % 10, warrantymonthsi16: 12 + (ordinal % 3) * 12,
      officecounti16: 1 + ordinal % 10,
      profilenotestxt: "Customer requested information about Oracle CX products.",
      eventdescriptiontxt: "Customer viewed the Oracle CX product page.",
      transactionnotestxt: "Online order completed successfully.",
      productdescriptiontxt: "Annual Oracle Cloud subscription.",
      accountnotestxt: "Account renewal is scheduled this quarter.",
      lastengagementatts: timestamp, eventoccurredatts: timestamp,
      paymentcompletedatts: timestamp, lastrestockedatts: timestamp, lastcontactatts: timestamp,
      householdsizei8: 2 + ordinal % 4, interactionscorei8: 55 + ordinal % 35,
      paymentattemptsi8: 1 + ordinal % 3, priorityranki8: 1 + ordinal % 5,
      riskscorei8: 15 + ordinal % 50
    };
    return Object.hasOwn(examples, fieldKey) ? examples[fieldKey] : undefined;
  };
  // Stream API loads are for repeatable insertion, not boundary testing. Keep
  // these values well inside common CDP numeric ranges and give every row a
  // complete, ordinary payload regardless of its position in the batch.
  const normalValue = (fieldKey, { sequence, runDate } = {}) => {
    const semanticValue = businessValue(fieldKey, { sequence, runDate });
    if (semanticValue !== undefined) return semanticValue;
    const ordinal = Math.max(1, Number(sequence) || 1);
    const date = runDate.toISOString().slice(0, 10);
    const timestamp = runDate.toISOString().slice(0, 19).replace("T", " ");
    const nameIndex = (ordinal - 1) % 5;
    const firstName = ["Jagan", "Anika", "Rahul", "Meera", "Arjun"][nameIndex];
    const lastName = ["Patil", "Sharma", "Nair", "Iyer", "Rao"][nameIndex];
    const emailDomain = ["gmail.com", "yahoo.com", "outlook.com"][(ordinal - 1) % 3];
    const values = {
      firstname: firstName,
      lastname: lastName,
      tinyintvalue: 5 + ordinal % 20,
      smallintvalue: 1000 + ordinal,
      intvalue: 100000 + ordinal,
      bigintvalue: String(1000000000 + ordinal),
      floatvalue: Number((4.2 + ordinal / 1000).toFixed(3)),
      doublevalue: Number((0.75 + ordinal / 1000).toFixed(3)),
      decimalvalue: (149.95 + ordinal / 100).toFixed(4),
      booleanvalue: ordinal % 2 === 1,
      datevalue: date,
      timestampvalue: timestamp,
      textvalue: "Customer requested information about Oracle CX products.",
      arraystringvalues: ["Oracle CX", "Product updates"],
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${ordinarySourceKey(ordinal, runDate)}@${emailDomain}`
    };
    return values[fieldKey];
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
  globalThis.cdpRecordProfiles = Object.freeze({ kind, sourceKey, value, businessValue, normalValue, serializeExactNumericPayload });
})();
