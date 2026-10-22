importScripts("templateStore.js");
importScripts("recordProfiles.js");

const CDP_CONNECTION_SEQUENCE_KEY = "cdpConfirmedConnectionSequencesV2";

const TASKS = {
  "source.js": {
    script: "connectionForm.js",
    dependencies: ["connectionAdapters.js"],
    path: "/integration/",
    root: "sources",
    saveSelector: "#create-source-saveClose",
    createLabel: "Create Source",
    typeDropdownId: "oj-select-choice-source-type",
    formInputIds: ["source-name-input|input"]
  },
  "destination.js": {
    script: "connectionForm.js",
    dependencies: ["connectionAdapters.js"],
    path: "/integration/",
    root: "destinations",
    saveSelector: "#dst-saveClose-btn",
    createLabel: "Create Destination",
    typeDropdownId: "oj-select-choice-destination-type",
    formInputIds: ["source-name-input|input"]
  },
  "importJob.js": { path: "/data/", root: "createConnectJob", readySelector: "div[class*='create-connect-job-body']", saveSelector: "#saveNclose-create-job" },
  // One configurable Import Job is used for every table-based import.
  "importContacts.js": {
    path: "/data/",
    root: "createConnectJob",
    readySelector: "div[class*='create-connect-job-body']",
    saveSelector: "#saveNclose-create-job",
    dependencies: ["cdpCustomerFieldMapping.js"]
  },
  "exportJob.js": { path: "/data/", root: "createExportJob", readySelector: "div[class*='create-export-job-body']", saveSelector: "#saveNclose-create-job" },
  // The Oracle JET input ID contains `|`, which must be escaped when queried
  // as CSS by waitForPageElement.
  "dataViewer.js": { path: "/data/", root: "dataViewer", readySelector: "#data-object-dropdown\\|input" },
  // Handles both object creation and attribute creation on the Data Model page.
  "dataModel.js": { path: "/data/", root: "dataModel", readySelector: ".oj-cxu-side-nav .data-obj-list" },
  "publish.js": { path: "/data/", root: "publishChanges" },
  "integrationStatus.js": { path: "/data/", root: "integrations" }
};

let tableCatalogPromise;
let dataViewerRecordConfigPromise;
let dataModelColumnConfigPromise;

async function loadDataModelColumnConfig() {
  if (!dataModelColumnConfigPromise) {
    dataModelColumnConfigPromise = fetch(chrome.runtime.getURL("config/data-model-columns.json"))
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not read config/data-model-columns.json.");
        return response.json();
      })
      .then((config) => {
        const groups = config?.groups && typeof config.groups === "object" && !Array.isArray(config.groups) ? config.groups : null;
        if (!groups) throw new Error("config/data-model-columns.json must contain a groups object.");
        return { groups, sharedTypeColumns: Array.isArray(config.sharedTypeColumns) ? config.sharedTypeColumns : [] };
      });
  }
  return dataModelColumnConfigPromise;
}

async function loadDataViewerRecordConfig() {
  if (!dataViewerRecordConfigPromise) {
    dataViewerRecordConfigPromise = fetch(chrome.runtime.getURL("config/data-viewer-records.json"))
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not read config/data-viewer-records.json.");
        return response.json();
      })
      .then((config) => {
        const tables = config?.tables && typeof config.tables === "object" && !Array.isArray(config.tables) ? config.tables : {};
        return { tables };
      });
  }
  return dataViewerRecordConfigPromise;
}

async function loadTableCatalog() {
  if (!tableCatalogPromise) {
    tableCatalogPromise = fetch(chrome.runtime.getURL("config/tables.json"))
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not read config/tables.json.");
        return response.json();
      })
      .then((catalog) => {
        const imports = Array.isArray(catalog?.importTables) ? catalog.importTables : [];
        const exports = Array.isArray(catalog?.exportPayloads) ? catalog.exportPayloads : [];
        const dataViewerTables = Array.isArray(catalog?.dataViewerTables) ? catalog.dataViewerTables : [];
        const validImports = imports.length && imports.every((table) =>
          typeof table?.id === "string" && table.id &&
          typeof table.label === "string" && table.label &&
          typeof table.cdpTable === "string" && table.cdpTable &&
          (table.csvFile === undefined || typeof table.csvFile === "string")
        );
        const uniqueIds = new Set(imports.map((table) => table.id)).size === imports.length;
        const validExports = exports.length && exports.every((payload) => typeof payload === "string" && payload);
        const validDataViewerTables = dataViewerTables.length && dataViewerTables.every((table) => typeof table === "string" && table);
        if (!validImports || !uniqueIds || !validExports || !validDataViewerTables) throw new Error("config/tables.json has an invalid table or payload entry.");
        return {
          importsById: Object.fromEntries(imports.map((table) => [table.id, table])),
          exportPayloads: exports,
          dataViewerTables: [...new Set(dataViewerTables)]
        };
      });
  }
  return tableCatalogPromise;
}


// Data Viewer is driven by tenant metadata rather than a copied static list.
// The request runs in the page MAIN world, using the signed-in CDP session and
// never persisting cookies or credentials in extension storage.
function metadataListFromResponse(response) {
  if (Array.isArray(response)) return response;
  for (const key of ["items", "data", "results", "content", "tables"]) {
    if (Array.isArray(response?.[key])) return response[key];
  }
  return [];
}

function metadataFieldList(response) {
  // CDP returns table attributes under different nesting keys across Data Model
  // and Data Viewer routes. Collect actual field nodes by their stable fieldId
  // instead of assuming one response wrapper.
  const found = [];
  const visited = new Set();
  const walk = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (!Array.isArray(value) && typeof value.fieldId === "string" && value.fieldId.trim()) {
      found.push(value);
      return;
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child);
  };
  walk(response);
  return found;
}

async function fetchCdpMetadata(tabId, endpoint) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [endpoint],
    func: async (metadataEndpoint) => {
      const tenant = String(location.hostname || "").split(".")[0];
      if (!tenant) throw new Error("Could not determine the CDP tenant from the active tab.");
      const response = await fetch(`${location.origin}/api-metadata/v1/${tenant}/metadata/${metadataEndpoint}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" }
      });
      if (!response.ok) throw new Error(`CDP metadata request failed (${response.status}).`);
      return response.json();
    }
  });
  return result;
}

function normalizeLiveDataViewerTable(table) {
  const name = String(table?.name || table?.resourceName || table?.tableId || "").trim();
  const tableId = String(table?.tableId || table?.resourceName || name).trim();
  if (!name || !tableId) return null;
  return {
    id: tableId,
    label: name,
    cdpTable: name,
    tableId,
    resourceName: String(table?.resourceName || "").trim(),
    sourceAttribute: String(table?.sourceAttribute || "").trim(),
    versionTS: Number(table?.versionTS || 0) || 0,
    isCustom: /_c$/i.test(tableId) || (table?.createdBy && !/^system$/i.test(String(table.createdBy)))
  };
}

async function loadLiveDataViewerTables(tabId) {
  const filter = encodeURIComponent(JSON.stringify([{ operator: "IN", attribute: "scope", value: ["DW"] }]));
  const response = await fetchCdpMetadata(tabId, `tables?q=${filter}&limit=1000`);
  const unique = new Map();
  for (const item of metadataListFromResponse(response)) {
    const table = normalizeLiveDataViewerTable(item);
    if (table) unique.set(table.id, table);
  }
  return [...unique.values()].sort((left, right) => {
    if (left.isCustom !== right.isCustom) return left.isCustom ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
}

function liveDataViewerFieldsFromMetadata(response) {
  const unique = new Map();
  for (const field of metadataFieldList(response)) {
    const fieldId = String(field?.fieldId || field?.id || field?.name || "").trim();
    if (!fieldId) continue;
    const rawSystemAttribute = field?.systemAttribute;
    const displayName = String(
      field?.displayName || field?.label || field?.resourceName || field?.name ||
      fieldId.replace(/_c$/i, "")
    ).trim();
    unique.set(fieldId, {
      fieldId,
      displayName: displayName || fieldId,
      // CDP table metadata nests the physical type under `type.dataType`.
      // Reading that first lets API record generation preserve numbers,
      // booleans, dates, and collection values instead of treating every
      // attribute as an arbitrary string.
      dataType: String(field?.dataType || field?.type?.dataType || field?.type?.name || "string").toLowerCase(),
      elementDataType: String(field?.type?.typeDescription?.dataType?.dataType || "").toLowerCase(),
      required: field?.required === true || /^true$/i.test(String(field?.required || "")),
      systemAttribute: rawSystemAttribute === true || /^true$/i.test(String(rawSystemAttribute || ""))
    });
  }
  return [...unique.values()];
}

async function loadLiveDataViewerFields(tabId, table) {
  const tableId = encodeURIComponent(String(table?.tableId || table?.id || table || ""));
  if (!tableId) throw new Error("A Data Viewer table ID is required.");
  const before = Number(table?.versionTS || 0);
  const response = await fetchCdpMetadata(tabId, `tables/${tableId}${before ? `?before=${before}` : ""}`);
  return liveDataViewerFieldsFromMetadata(response);
}

function parentTableFromMetadataFields(fields = []) {
  const ids = new Set(fields.map((field) => String(field.fieldId || "").replace(/[^a-z0-9]/gi, "").toLowerCase()));
  if (ids.has("sourcecustomerid")) return "Customer";
  if (ids.has("sourceaccountid")) return "Account";
  return "";
}

const E2E_IMPORT_FALLBACK = {
  targetTables: ["Customer", "ContactPoint"],
  fieldToTable: {
    sourcecustomerid: ["Customer", "ContactPoint"], email: ["Customer", "ContactPoint"],
    firstname: ["Customer"], lastname: ["Customer"], gender: ["Customer"],
    birthdate: ["Customer"], jobtitle: ["Customer"],
    sourcecontactpointid: ["ContactPoint"],
    mobilephone: ["ContactPoint"], optinstatus: ["ContactPoint"], isdeliverable: ["ContactPoint"]
  },
  csvContent: "sourcecustomerid,firstname,lastname,gender,birthdate,jobtitle,sourcecontactpointid,email,mobilephone,optinstatus,isdeliverable\n1,Sachin,Tendulkar,M,07/10/26,Sales Executive,cp-1,jagan.test01@yahoo.com,16504522260,In,TRUE\n"
};

function importFallbackConfig(delimiter = ",") {
  const separator = csvDelimiter(delimiter);
  const rows = E2E_IMPORT_FALLBACK.csvContent.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
  return {
    ...E2E_IMPORT_FALLBACK,
    csvContent: `${rows.map((row) => row.map((value) => csvCell(value, separator)).join(separator)).join("\n")}\n`
  };
}

function parseCsvRow(row) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === '"' && row[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

function csvDelimiter(value) {
  return { tab: "\t", ";": ";", "|": "|", ",": "," }[value] || ",";
}

function csvCell(value, delimiter) {
  const text = String(value ?? "");
  return /["\r\n]/.test(text) || text.includes(delimiter)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function isAuditImportField(field) {
  const fieldNames = [field?.fieldId, field?.displayName, field?.name, field?.header, typeof field === "string" ? field : ""]
    .map((value) => String(value || "").replace(/^column\s*[-_:]?\s*/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter(Boolean);
  return fieldNames.some((name) => /^(?:column)?(createdby|createddate|createdts|creationdate|creationts|modifiedby|modifieddate|modifiedts|lastmodifiedby|lastmodifieddate|lastmodifiedts|rowcreatedts|rowmodifiedts|rowcreatedtimestamp|rowmodifiedtimestamp)$/.test(name));
}

function isApiManagedField(field) {
  if (isAuditImportField(field)) return true;
  return [field?.fieldId, field?.displayName, field?.name, field?.header]
    .map((value) => String(value || "").replace(/^column\s*[-_:]?\s*/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase())
    .some((name) => name === "id" || name === "tenantid");
}

function importFieldKey(field) {
  // Custom-object attributes are rendered by CDP as "Column - <name>".
  // The prefix is presentational only: source CSV headers and OOTB attributes
  // use the unprefixed key. Normalizing it here keeps all mapping, required
  // source-key, and sample-value rules consistent across both object types.
  return String(field?.displayName || field?.fieldId || field?.header || field || "")
    .replace(/^column\s*[-_:]?\s*/i, "")
    .replace(/_c$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isDerivedImportField(field, availableFields = []) {
  const key = importFieldKey(field);
  if (key === "id" || key === "tenantid") return true;
  if (!key.endsWith("id") || key.startsWith("source")) return false;
  const keys = new Set(availableFields.map(importFieldKey));
  return keys.has(`source${key}`);
}

async function loadCsvFields(table) {
  if (!table.csvFile) throw new Error(`${table.label} has no sample CSV configured. Add its csvFile in config/tables.json before creating an Import job.`);
  const response = await fetch(chrome.runtime.getURL(table.csvFile));
  if (!response.ok) throw new Error(`Could not read ${table.csvFile}.`);
  const lines = (await response.text()).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error(`${table.csvFile} must contain a header row and one sample row.`);
  const headers = parseCsvRow(lines[0]);
  const values = parseCsvRow(lines[1]);
  if (!headers.length || headers.length !== values.length || headers.some((header) => !header)) {
    throw new Error(`${table.csvFile} has invalid headers or sample values.`);
  }
  const csvFields = headers.map((header, index) => ({ header, value: values[index], table: table.cdpTable }));
  return csvFields.filter((field) => !isAuditImportField(field.header) && !isDerivedImportField(field, csvFields));
}

async function buildImportConfig(tableIds, delimiter = ",") {
  const catalog = await loadTableCatalog();
  const selected = [...new Set(tableIds || [])].map((id) => catalog.importsById[id]);
  if (!selected.length || selected.some((table) => !table)) throw new Error("Select at least one supported import table.");
  const fields = (await Promise.all(selected.map(loadCsvFields))).flat();
  const uniqueFields = [];
  const fieldsByHeader = new Map();
  for (const field of fields) {
    const existing = fieldsByHeader.get(field.header);
    if (!existing) {
      fieldsByHeader.set(field.header, { ...field, tables: [field.table] });
      uniqueFields.push(fieldsByHeader.get(field.header));
      continue;
    }
    // A combined mapping CSV has one column for a repeated header. Retain the
    // first selected example value and map that column to every selected table.
    existing.tables.push(field.table);
  }
  const separator = csvDelimiter(delimiter);
  return {
    targetTables: selected.map((table) => table.cdpTable),
    // Preserve the author-provided CSV header verbatim. The field-mapping
    // script receives the same literal value from Oracle's source-field row.
    fieldToTable: Object.fromEntries(uniqueFields.map((field) => [field.header, field.tables])),
    csvContent: `${uniqueFields.map((field) => csvCell(field.header, separator)).join(separator)}\n${uniqueFields.map((field) => csvCell(field.value, separator)).join(separator)}\n`
  };
}

function customObjectCode(table) {
  const value = String(table?.label || table?.cdpTable || table?.tableId || "").toLowerCase();
  if (value.includes("profile")) return "PROFILE";
  if (value.includes("behavior")) return "BEH";
  if (value.includes("transaction")) return "TXN";
  if (value.includes("product")) return "PRODUCT";
  return "OTH";
}
const CUSTOM_IMPORT_SOURCE_ORDER = ["PROFILE", "BEH", "TXN", "PRODUCT", "OTH"];

function importHeaderForField(field) {
  // CDP's Export job writes the physical fieldId as the CSV header. Display
  // names (for example "Column - SourceProfile…") are UI-only and must not
  // define the source-file contract. Preserve fieldId, including `_c`.
  return String(field?.fieldId || "").trim().toLowerCase();
}

function sourceKeySampleValue(field, table, sequence = 1) {
  const id = String(field?.displayName || field?.fieldId || "").replace(/^column\s*[-_:]?\s*/i, "");
  const related = id.replace(/^source/i, "").replace(/id$/i, "").replace(/_c$/i, "").replace(/[^a-z0-9]+/gi, "");
  const normalized = related.toLowerCase();
  const codeFor = (name) => ({ customer: "CU", account: "AC", contactpoint: "CP", address: "AD", product: "PR", profile: "PR", behavioral: "BH", transactional: "TR", other: "OT" })[String(name || "").toLowerCase()];
  const code = Object.entries({ customer: "CU", account: "AC", contactpoint: "CP", address: "AD", product: "PR", profile: "PR", behavioral: "BH", transactional: "TR", other: "OT" })
    .find(([name]) => normalized.startsWith(name))?.[1]
    || codeFor(String(table?.cdpTable || table?.label || "").split(/[_\s-]/)[0])
    || String(table?.label || related || "OB").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "OB";
  const now = new Date();
  const ddmm = String(now.getDate()).padStart(2, "0") + String(now.getMonth() + 1).padStart(2, "0");
  return `${code}-${ddmm}-${Math.max(1, Number(sequence) || 1)}`;
}

function importSampleValueForField(field, table) {
  const id = String(field?.displayName || field?.fieldId || "").replace(/^column\s*[-_:]?\s*/i, "");
  const type = String(field?.dataType || "string").toLowerCase();
  if (/^sourceid$/i.test(id)) return "CDP";
  if (/^source.+id$/i.test(id)) return sourceKeySampleValue(field, table);
  if (/email/i.test(id)) return recordEmailForSequence(1);
  if (/date/i.test(id) && type !== "timestamp") return new Date().toISOString().slice(0, 10);
  if (/timestamp|\bts\b/i.test(id) || type === "timestamp") return new Date().toISOString().slice(0, 19);
  if (/amount|score|count|number/i.test(id) || ["int", "bigint", "decimal"].includes(type)) return "1";
  if (type === "boolean") return "true";
  return "Sample Value";
}

function downstreamImportFields() {
  // Every generated custom-object source also creates the minimal Customer and
  // ContactPoint records needed by downstream profile/activation scenarios.
  return [
    { header: "sourceid", value: "UI", targets: ["Customer", "ContactPoint"] },
    // Each custom object now carries SourceCustomerID through its Customer
    // relationship. Reuse that real exported header for ContactPoint too;
    // do not invent a SourceContactPointID field that exports never contain.
    { header: "sourcecustomerid", value: "CU-1001", targets: ["Customer", "ContactPoint"] },
    // Opt-in and deliverability are derived from the real exported `email`
    // column by static transformations during field mapping. Do not add
    // fictional columns to the sample/import CSV contract.
    { header: "email", value: recordEmailForSequence(1), targets: ["Customer", "ContactPoint"] }
  ];
}

const importHeaderKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// `_c` is significant in the exported physical header, but a mapping-picker
// label can omit it. Use this semantic key only to find the same bridge field;
// never use it when writing the CSV header.
const importHeaderSemanticKey = (value) => String(value || "").replace(/_c$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function customImportMappingRules(entries) {
  // Every target object must receive its required Source<Table>ID. Reuse the
  // real, physical source header from the selected custom object (with or
  // without `_c`) instead of creating a second logical source column.
  const fieldTargetAttributes = {};
  const fieldStaticTransforms = {};
  const findEntry = (name) => entries.find((entry) => importHeaderSemanticKey(entry.header) === importHeaderSemanticKey(name));
  const sourceCustomerEntry = findEntry("sourcecustomerid");
  if (sourceCustomerEntry) {
    sourceCustomerEntry.targets = [...new Set([...sourceCustomerEntry.targets, "Customer", "ContactPoint"])];
    fieldTargetAttributes[sourceCustomerEntry.header] = {
      ContactPoint: ["SourceCustomerID", "SourceContactPointID"]
    };
  }
  const sourceContactPointEntry = findEntry("sourcecontactpointid");
  if (sourceContactPointEntry) sourceContactPointEntry.targets = [...new Set([...sourceContactPointEntry.targets, "ContactPoint"])];
  const sourceAccountEntry = findEntry("sourceaccountid");
  if (sourceAccountEntry) {
    sourceAccountEntry.targets = [...new Set([...sourceAccountEntry.targets, "Account"])];
    const sourceIdEntry = findEntry("sourceid");
    if (sourceIdEntry) sourceIdEntry.targets = [...new Set([...sourceIdEntry.targets, "Account"])];
  }
  const emailEntry = findEntry("email");

  for (const targetName of ["OptInStatus", "IsDeliverable"]) {
    const directEntry = findEntry(targetName);
    if (directEntry) {
      // The field is genuinely present in the selected table's metadata and
      // therefore in its export file: map it directly, never overwrite it.
      directEntry.targets = [...new Set([...directEntry.targets, "ContactPoint"])];
      continue;
    }
    // No real source field exists. Reuse email and supply CDP's required
    // static ContactPoint value without introducing a made-up CSV header.
    if (!emailEntry) continue;
    const targetRules = fieldTargetAttributes[emailEntry.header] || { ContactPoint: ["Email"] };
    targetRules.ContactPoint = [...new Set([...targetRules.ContactPoint, targetName])];
    fieldTargetAttributes[emailEntry.header] = targetRules;
    fieldStaticTransforms[emailEntry.header] ||= { ContactPoint: {} };
    fieldStaticTransforms[emailEntry.header].ContactPoint[targetName] = targetName === "OptInStatus" ? "In" : "true";
  }
  return { fieldTargetAttributes, fieldStaticTransforms };
}

async function buildCustomImportConfig(tabId, tables, delimiter = ",", mappingMode = "combined") {
  const separator = csvDelimiter(delimiter);
  const selected = (tables || [])
    .filter((table) => table?.isCustom && table?.tableId && table?.cdpTable)
    .sort((left, right) => CUSTOM_IMPORT_SOURCE_ORDER.indexOf(customObjectCode(left)) - CUSTOM_IMPORT_SOURCE_ORDER.indexOf(customObjectCode(right)));
  if (!selected.length) throw new Error("Select at least one published custom object.");
  const sources = [];
  for (const table of selected) {
    const allFields = await loadLiveDataViewerFields(tabId, table);
    const required = new Set(["sourceid", importFieldKey(table.sourceAttribute)]);
    for (const field of allFields) {
      if (/^source.+id$/i.test(importFieldKey(field))) required.add(importFieldKey(field));
    }
    const mappingFields = allFields.filter((field) =>
      (!field.systemAttribute || required.has(importFieldKey(field))) &&
      !isAuditImportField(field) &&
      !isDerivedImportField(field, allFields)
    );
    if (!mappingFields.length) throw new Error(`CDP did not return mappable fields for ${table.label}.`);
    const entriesByHeader = new Map();
    for (const field of mappingFields) {
      const header = importHeaderForField(field);
      if (entriesByHeader.has(header)) throw new Error(`Custom object ${table.label} has duplicate Import display headers.`);
      entriesByHeader.set(header, {
        header,
        value: importSampleValueForField(field, table),
        targets: [table.cdpTable]
      });
    }
    // CDP can omit its default "Column - SourceID" and table-level
    // "Column - Source<Table>ID" attributes from the metadata field list.
    // They are nevertheless required by the import contract. Add them
    // explicitly so their source-file headers are mapped to this custom
    // object as well as to any downstream bridge records.
    const tableSourceFieldId = String(
      table.sourceAttribute || `Source${String(table.cdpTable || table.label || "").replace(/[^A-Za-z0-9]/g, "")}ID`
    ).trim();
    const requiredSourceEntries = [
      { header: "sourceid", value: "CDP" },
      {
        header: importHeaderForField({ fieldId: tableSourceFieldId }),
        value: sourceKeySampleValue({ fieldId: tableSourceFieldId }, table)
      }
    ];
    for (const requiredSource of requiredSourceEntries) {
      const existing = [...entriesByHeader.values()].find((entry) => importHeaderSemanticKey(entry.header) === importHeaderSemanticKey(requiredSource.header));
      if (existing) existing.targets = [...new Set([...existing.targets, table.cdpTable])];
      else entriesByHeader.set(requiredSource.header, { ...requiredSource, targets: [table.cdpTable] });
    }
    for (const downstream of downstreamImportFields()) {
      const existing = [...entriesByHeader.values()].find((entry) => importHeaderSemanticKey(entry.header) === importHeaderSemanticKey(downstream.header));
      if (existing) existing.targets = [...new Set([...existing.targets, ...downstream.targets])];
      else entriesByHeader.set(downstream.header, { ...downstream });
    }
    const entries = [...entriesByHeader.values()];
    const mappingRules = customImportMappingRules(entries);
    sources.push({
      table,
      sourceCode: customObjectCode(table),
      targetTables: [...new Set(entries.flatMap((entry) => entry.targets))],
      fieldToTable: Object.fromEntries(entries.map((entry) => [entry.header, entry.targets])),
      ...mappingRules,
      parentBridge: "Customer + ContactPoint",
      mappingEntries: entries,
      csvContent: `${entries.map((entry) => csvCell(entry.header, separator)).join(separator)}\n${entries.map((entry) => csvCell(entry.value, separator)).join(separator)}\n`
    });
  }
  if (mappingMode !== "separate" && sources.length > 1) {
    const entriesByHeader = new Map();
    for (const source of sources) for (const entry of source.mappingEntries || []) {
      const existing = entriesByHeader.get(entry.header);
      if (existing) existing.targets = [...new Set([...existing.targets, ...entry.targets])];
      else entriesByHeader.set(entry.header, { ...entry, targets: [...entry.targets] });
    }
    const entries = [...entriesByHeader.values()];
    return { sources: [{ sourceCode: "COMBINED", targetTables: [...new Set(entries.flatMap((entry) => entry.targets))], fieldToTable: Object.fromEntries(entries.map((entry) => [entry.header, entry.targets])), ...customImportMappingRules(entries), parentBridge: "Customer + ContactPoint", csvContent: entries.map((entry) => csvCell(entry.header, separator)).join(separator) + "\n" + entries.map((entry) => csvCell(entry.value, separator)).join(separator) + "\n" }] };
  }
  return { sources };
}

function runStamp() {
  const now = new Date();
  const part = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
}

async function selectedTransferTemplate(templateId) {
  const vault = await cdpReadTemplates();
  const template = vault.templates.find((item) => item.id === templateId);
  if (!template) throw new Error("Select a valid transfer template before running automation.");
  if (template.kind === "direct") throw new Error("Select a file-transfer template for Export or Import jobs.");
  if (!template.source?.type || !template.destination?.type) throw new Error("The selected transfer template is incomplete.");
  const profiles = await cdpReadConnectionProfiles();
  const resolve = (side) => {
    const profileId = template[side]?.profileId;
    if (!profileId) return template[side]; // Existing templates remain usable.
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error(`The ${side} connection profile selected by this template no longer exists.`);
    return { type: profile.type, fields: profile.fields || {}, profileId: profile.id, profileName: profile.name };
  };
  return { ...template, source: resolve("source"), destination: resolve("destination") };
}

async function nextConnectionSequence(templateId) {
  const dateTag = dateTagForName();
  // CDP is the authority for collisions. A local counter can be advanced by
  // an interrupted attempt, so always begin with the unsuffixed base name.
  return { dateTag, entityTag: entityNameTag(), ordinal: 1 };
}

async function rememberConnectionSequence(templateId, sequence) {
  if (!templateId || !sequence?.dateTag || !sequence?.ordinal) return;
  const { [CDP_CONNECTION_SEQUENCE_KEY]: saved = {} } = await chrome.storage.local.get(CDP_CONNECTION_SEQUENCE_KEY);
  const previous = saved[templateId];
  const currentOrdinal = previous && previous.dateTag === sequence.dateTag ? Number(previous.ordinal || 0) : 0;
  if (currentOrdinal >= sequence.ordinal) return;
  await chrome.storage.local.set({ [CDP_CONNECTION_SEQUENCE_KEY]: { ...saved, [templateId]: { dateTag: sequence.dateTag, ordinal: sequence.ordinal } } });
}

function connectionProviderCode(type) {
  return {
    "Oracle Object Storage": "OOS",
    "Secure FTP": "SFTP",
    "Google Cloud Storage": "GCS",
    "Salesforce CRM": "SFDC",
    "CX Sales": "CX",
    AWS: "AWS"
  }[type] || "CDP";
}

function dateTagForName(date = new Date()) {
  const part = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

function entityNameTag(date = new Date()) {
  const part = (value) => String(value).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short" });
  return `${part(date.getDate())}${month}_${part(date.getHours())}${part(date.getMinutes())}`;
}

function templateShortName(template, providerCode) {
  const parts = String(template.name || "Transfer").split(/[-_\s]+/).filter(Boolean);
  if (parts.length && parts[0].toUpperCase() === providerCode) parts.shift();
  const shortName = parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`).join("");
  return shortName || "Transfer";
}

function normalizedNamePart(value, fallback = "") {
  return String(value || "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || fallback;
}

function sharedJobTag(sequence = null) {
  return String(sequence?.jobTag || sequence?.entityTag || entityNameTag()).toUpperCase();
}

function sharedConnectionTime(sequence = null) {
  const tag = String(sequence?.entityTag || entityNameTag());
  const match = tag.match(/_(\d{4})$/);
  return match ? match[1] : tag.replace(/[^0-9]/g, "").slice(-4);
}

function transferJobName(template, connection, operation, sequence) {
  const provider = normalizedNamePart(connectionProviderCode(connection?.type), "CDP");
  const purpose = normalizedNamePart(template?.connectionPurpose);
  const operationCode = normalizedNamePart(operation, "JOB");
  return [operationCode, provider, purpose, sharedJobTag(sequence)].filter(Boolean).join("_");
}

function connectionRuntime(template, side, sequence = null) {
  const connection = template[side];
  const provider = normalizedNamePart(connectionProviderCode(connection.type), "CDP");
  const purpose = normalizedNamePart(template.connectionPurpose);
  const time = sharedConnectionTime(sequence);
  const ordinal = Number(sequence?.ordinal || 1);
  const suffix = ordinal > 1 ? "_" + String(ordinal).padStart(2, "0") : "";
  const name = [provider, purpose, time + suffix].filter(Boolean).join("_");
  return {
    side,
    type: connection.type,
    fields: connection.fields || {},
    fileContract: template.fileContract || {},
    name
  };
}

function transferPurposeCode(template) {
  return normalizedNamePart(template?.connectionPurpose);
}

function responsysSourceRuntime(template, sequence = null) {
  const runtime = connectionRuntime(template, "source", sequence);
  const provider = normalizedNamePart(connectionProviderCode(runtime.type), "CDP");
  const purpose = transferPurposeCode(template);
  const time = sharedConnectionTime(sequence);
  const ordinal = Number(sequence?.ordinal || 1);
  const suffix = ordinal > 1 ? "_" + String(ordinal).padStart(2, "0") : "";
  runtime.name = [provider, purpose, "RESPONSYS", time + suffix].filter(Boolean).join("_");
  return runtime;
}

function responsysImportJobName(template, connection, sequence) {
  return ["IMP", "RESPONSYS", transferPurposeCode(template), sharedJobTag(sequence)].filter(Boolean).join("_");
}

function jobObjectCode(request) {
  if (request.variant === "responsys") return "RESPONSYS";
  if (request.kind === "export") {
    return request.customTable ? customObjectCode(request.customTable) : normalizedNamePart(request.payloadName, "OBJECT");
  }
  const customTables = request.customTables || [];
  const tableIds = request.tableIds || [];
  if (customTables.length === 1 && tableIds.length === 0) return customObjectCode(customTables[0]);
  if (customTables.length + tableIds.length === 1) return normalizedNamePart(customTables[0]?.label || tableIds[0], "OBJECT");
  return "COMBINED";
}

function jobNameForRequest(request) {
  const prefix = request.kind === "export" ? "EXP" : "IMP";
  return [prefix, jobObjectCode(request), transferPurposeCode(request.template), sharedJobTag(request.connectionSequence)]
    .filter(Boolean)
    .join("_");
}
function jobRuntime(template, side) {
  const stamp = runStamp();
  const prefix = `${template.name || "CDP"}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "CDP";
  const contract = template.fileContract || {};
  return {
    name: `${prefix}-${side === "source" ? "Import" : "Export"}-${stamp}`,
    description: template.description || `${template.name} automated transfer`,
    notification: template.notification || "",
    sourceName: side === "source" ? connectionRuntime(template, "source").name : "",
    destinationName: side === "destination" ? connectionRuntime(template, "destination").name : "",
    sourceObjectName: "",
    fileName: "",
    compression: contract.compression || "none",
    filePattern: contract.filePattern || "",
    fileContract: contract
  };
}

const sequenceStepState = new Map();
const activeSequences = new Map();

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.warn("Could not enable CDP Automation Side Panel", error));
}

async function setE2EStatus(status = "", tabId) {
  const activeRun = activeSequences.get(tabId);
  if (activeRun) activeRun.status = status;
  await chrome.storage.local.set({ e2eStatus: status });
  if (status) await appendRunLog(status, status.startsWith("Failed:") ? "error" : "info");
}

async function clearFlowDraft() {
  await chrome.storage.local.remove("flowDraft");
}

async function appendRunLog(message, level = "info", group = "", action = "") {
  const { pendingRun = null } = await chrome.storage.local.get({ pendingRun: null });
  if (!pendingRun || !message) return;
  const logs = Array.isArray(pendingRun.logs) ? pendingRun.logs : [];
  const previous = logs.at(-1);
  if (previous?.message === message && previous?.group === group && previous?.action === action) return;
  await chrome.storage.local.set({
    pendingRun: { ...pendingRun, logs: [...logs, { at: Date.now(), level, group, action, message: String(message) }].slice(-500) }
  });
}

async function appendDataViewerRunLog(result, tables, { recordsPerTable, sourceId, saveRecords }) {
  const names = tables.map((table) => table.cdpTable).join(", ");
  await appendRunLog(`Data Viewer selection: ${names} · ${recordsPerTable} record${recordsPerTable === 1 ? "" : "s"} per table · Source ID: ${sourceId}.`);
  for (const record of result?.records || []) {
    const group = `${record.table} · Record ${record.sequence}`;
    await appendRunLog(`${record.outcome || "Completed"} · Object ID: ${record.objectId || "—"}.`, "info", group);
    for (const item of record.actions || []) {
      const detail = [item.target, item.value ? `= ${item.value}` : ""].filter(Boolean).join(" ");
      await appendRunLog(detail, item.action === "Skip" ? "warning" : "info", group, item.action || "Action");
    }
  }
}

async function finalizeRunHistory(outcome, detail = "") {
  const { pendingRun = null, runHistory = [], runSnapshots = [], activeRunSnapshotId = "" } = await chrome.storage.local.get({ pendingRun: null, runHistory: [], runSnapshots: [], activeRunSnapshotId: "" });
  if (!pendingRun) return;
  const terminalMessage = outcome === "completed" ? "Run completed." : outcome === "stopped" ? "Run stopped." : `Run failed: ${detail || pendingRun.details || "Unknown error"}`;
  const logs = Array.isArray(pendingRun.logs) ? pendingRun.logs : [];
  const entry = {
    ...pendingRun,
    outcome,
    detail: detail || pendingRun.details || "",
    finishedAt: Date.now(),
    logs: [...logs, { at: Date.now(), level: outcome === "failed" ? "error" : outcome, message: terminalMessage }].slice(-500)
  };
  const snapshot = Array.isArray(runSnapshots) ? runSnapshots.find((item) => item?.runId === activeRunSnapshotId) : null;
  if (snapshot) entry.snapshot = { ...snapshot, outcome, finishedAt: entry.finishedAt };
  await chrome.storage.local.set({ runHistory: [entry, ...(Array.isArray(runHistory) ? runHistory : [])].slice(0, 5), lastRun: entry });
  await chrome.storage.local.remove(["pendingRun", "activeRunSnapshotId"]);
}

async function installStopGuard(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      window.__cdpAutomationStopped = false;
      if (window.__cdpStopGuardInstalled) return;
      window.__cdpStopGuardInstalled = true;
      document.addEventListener("click", (event) => {
        if (!window.__cdpAutomationStopped) return;
        if (event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
  });
}

// CDP routes in place, so a cancelled run's click guard may survive the next
// navigation. Reset it before any new scripted Create/Save interaction and
// expose the active run ID to make older monitor listeners harmless.
async function activatePageAutomationRun(tabId, runId = "") {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [runId],
    func: (nextRunId) => {
      window.__cdpAutomationStopped = false;
      window.__cdpPublishCancelled = false;
      document.documentElement.dataset.cdpAutomationRunId = nextRunId || "";
    }
  });
}

function navigationUrl(tabUrl, path, root) {
  const hostKey = new URL(tabUrl).hostname.split(".")[0];
  if (!hostKey) throw new Error("Could not determine the CDP host key from the active tab.");

  const url = new URL(`https://${hostKey}.cdp.ocs.oc-test.com${path}`);
  url.searchParams.set("root", root);
  return url.href;
}

async function captureCreatedEntity(tabId, runMetadata, filename, fallbackName = "") {
  const creation = {
    "source.js": { section: "sources", label: "Source", inputId: "source-name-input|input" },
    "destination.js": { section: "destinations", label: "Destination", inputId: "source-name-input|input" },
    "exportJob.js": { section: "jobs", role: "export", label: "Export Job", inputId: "job-name-input|input" },
    "importContacts.js": { section: "jobs", role: "import", label: "Import Job", inputId: "job-name-input|input" },
    "importJob.js": { section: "jobs", role: "responsys", label: "Responsys Import", inputId: "job-name-input|input" }
  }[filename];
  if (!creation) return;

  let capturedEntity;
  // A plain Save keeps most CDP forms open, but connection forms can rerender
  // immediately after their success toast. Give the input a short chance to
  // return before relying on the exact name we generated for this run.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [creation.inputId],
      func: (inputId) => ({
        name: document.getElementById(inputId)?.value?.trim() || "",
        scheduledAt: Number(window.__cdpScheduledRunAt) || null
      })
    });
    capturedEntity = result;
    if (capturedEntity?.name) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const { name: jobName, scheduledAt: capturedScheduledAt } = capturedEntity || {};
  const scheduledAt = capturedScheduledAt || (filename === "exportJob.js" ? runMetadata.exportScheduledAt : null);
  const resolvedName = jobName || String(fallbackName || "").trim();
  if (!resolvedName) throw new Error(`The saved ${creation.label} name could not be captured.`);
  const savedEntity = {
    label: creation.label,
    name: resolvedName,
    savedAt: Date.now()
  };
  if (creation.section === "jobs" && scheduledAt) savedEntity.scheduledAt = scheduledAt;
  if (creation.section === "jobs") {
    runMetadata.creations.jobs[creation.role] = savedEntity;
  } else {
    const collection = runMetadata.creations[creation.section];
    const existingIndex = collection.findIndex((entity) => entity.name === savedEntity.name);
    if (existingIndex >= 0) collection[existingIndex] = savedEntity;
    else collection.push(savedEntity);
  }
  runMetadata.jobNames = [
    runMetadata.creations.jobs.export?.name,
    runMetadata.creations.jobs.import?.name,
    runMetadata.creations.jobs.responsys?.name
  ].filter(Boolean);
  await chrome.storage.local.set({ e2eRun: runMetadata });
  return savedEntity;
}

function navigateAndWait(tabId, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("The target page did not finish loading within 30 seconds."));
    }, 30000);

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      // CDP's SPA reports the route load before its JET controls are reliably
      // interactive. Apply one consistent post-navigation stability window to
      // every automation route before its next action begins.
      setTimeout(resolve, 3000);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url }).catch((error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(error);
    });
  });
}

async function waitForPageElement(tabId, selector, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const [{ result: ready }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [selector],
      func: (pageSelector) => {
        const element = document.querySelector(pageSelector);
        return Boolean(element?.getClientRects().length);
      }
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${selector}.`);
}

async function prepareConnectionForm(tabId, { createLabel, typeDropdownId, formInputIds }, connectionType = "Oracle Object Storage") {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [createLabel, typeDropdownId, formInputIds, connectionType],
    func: async (label, dropdownId, inputIds, selectedType) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // The Sources/Destinations list can report page-ready while Oracle is
      // still rendering its JET action bar. Allow the full form transition.
      const deadline = Date.now() + 60000;
      const visible = (element) => Boolean(element?.getClientRects().length);
      const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
      const enabled = (element) =>
        !element.disabled &&
        element.getAttribute("aria-disabled") !== "true" &&
        !element.closest("oj-button")?.classList.contains("oj-disabled");
      const waitFor = async (find, description) => {
        while (Date.now() < deadline) {
          const element = find();
          if (element) return element;
          await sleep(200);
        }
        throw new Error(`Timed out waiting for ${description}.`);
      };
      const click = async (element) => {
        element.scrollIntoView({ block: "center" });
        element.focus?.();
        const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
        if (typeof PointerEvent !== "undefined") {
          element.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerType: "mouse" }));
        }
        element.dispatchEvent(new MouseEvent("mousedown", options));
        element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
        element.click();
        await sleep(250);
      };

      const create = await waitFor(() =>
        [...document.querySelectorAll("button, oj-button, [role='button']")].find((element) => {
          const nativeButton = element.matches("button") ? element : element.querySelector("button");
          return visible(element) && enabled(nativeButton || element) && text(element).toLowerCase() === label.toLowerCase();
        }), label);
      // Click the real button where JET exposes one. Calling click() on the
      // custom-element wrapper alone is unreliable after a slow navigation.
      await click(create.matches("button") ? create : (create.querySelector("button") || create));

      const chooser = await waitFor(() => {
        const element = document.getElementById(dropdownId);
        return visible(element) ? element : null;
      }, "connection type dropdown");
      await click(chooser);

      const option = await waitFor(() =>
        [...document.querySelectorAll("[role='option'], oj-option, li")]
          .find((element) => visible(element) && text(element) === selectedType),
      `${selectedType} option`);
      await click(option.closest("[role='option'], oj-option, li") || option);

      await waitFor(() => text(document.getElementById(dropdownId)).toLowerCase().includes(selectedType.toLowerCase()),
        `${selectedType} selection`);

      await waitFor(() => inputIds.every((id) => {
        const input = document.getElementById(id);
        return input && visible(input) && !input.disabled;
      }), `${selectedType} form fields`);
    }
  });
}

async function connectionNameState(tabId, side) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [side],
    func: (connectionSide) => {
      const input = document.getElementById("source-name-input|input");
      const host = document.getElementById("source-name-input");
      const id = document.getElementById(connectionSide === "destination" ? "destination-id-input|input" : "source-id-input|input");
      const messages = [...document.querySelectorAll("[role=alert], [role=tooltip], .oj-message, .oj-message-detail, .oj-messages, .oj-popup-content")]
        .filter((element) => element.getClientRects().length)
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
      return { name: input?.value || "", jetValue: host?.value || "", invalid: input?.getAttribute("aria-invalid") === "true", id: id?.value || "", messages };
    }
  });
  return result || {};
}

async function typeJetConnectionName(tabId, value) {
  return typeJetInput(tabId, "source-name-input|input", value, "Connection Name");
}

async function typeJetInput(tabId, inputId, value, label = "input", commitKey = "Tab", keyDelayMs = 0) {
  await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [inputId, label],
    func: (targetId, inputLabel) => {
      const input = document.getElementById(targetId);
      if (!input || input.disabled || input.readOnly) throw new Error(`${inputLabel} input is unavailable.`);
      input.scrollIntoView({ block: "center" });
      input.focus();
      input.select();
    }
  });
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    // Oracle JET's generated-ID listener requires keyboard transition events,
    // not only the trusted `input` event emitted by Input.insertText.
    for (const character of String(value)) {
      const upper = character.toUpperCase();
      const isLetter = /^[A-Z]$/.test(upper);
      const isDigit = /^\d$/.test(character);
      const isUnderscore = character === "_";
      const code = isLetter ? `Key${upper}` : isDigit ? `Digit${character}` : isUnderscore ? "Minus" : "Unidentified";
      const keyCode = isLetter ? upper.charCodeAt(0) : isDigit ? character.charCodeAt(0) : isUnderscore ? 189 : 0;
      const modifiers = isUnderscore ? 8 : 0; // Shift for `_` on the Minus key.
      const event = { key: character, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "char", ...event, text: character, unmodifiedText: character });
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...event });
      if (keyDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, keyDelayMs));
    }
    // JET requires a trusted completion key. Most form inputs commit on Tab;
    // the Data Model object search intentionally filters only on Enter.
    const completion = commitKey === "Enter"
      ? { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0 }
      : { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 0 };
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...completion });
    // JET's valueChanged handler is attached to the DOM keydown/focus
    // transition. rawKeyDown alone types correctly but can leave Object ID
    // blank on the Data Model drawer; include the normal trusted keydown so
    // the browser performs the same Tab transition as a user.
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", ...completion });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...completion });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

const schedulerSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newSchedulerRunAt(schedule, presetKey, customTimeKey) {
  const preset = presetKey === "custom" ? "custom" : schedule[presetKey];
  const customTime = schedule[customTimeKey];
  const result = new Date();
  if (preset === "custom") {
    if (!/^\d{2}:\d{2}$/.test(String(customTime || ""))) throw new Error("Enter a custom schedule time.");
    const [hours, minutes] = customTime.split(":").map(Number);
    result.setHours(hours, minutes, 0, 0);
    if (result <= new Date()) result.setDate(result.getDate() + 1);
    return result;
  }
  if (preset === "nextHour") {
    // Backward compatibility for saved pre-change drafts only.
    result.setHours(result.getHours() + 1, 0, 0, 0);
  } else if (preset === "plusOneHour") {
    // The popup's +1 hour means exactly 60 minutes from now.
    result.setHours(result.getHours() + 1);
  } else {
    result.setMinutes(result.getMinutes() + (preset === "in30" ? 30 : 15), 0, 0);
  }
  return result;
}

function newSchedulerTimeText(date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function normalizeNewSchedulerConfig(schedule = {}, kind = "import") {
  // A Custom Flow saved before the New Scheduler UI existed can omit its
  // per-step schedule. Treat a missing schedule as the new safe default;
  // retain an explicitly selected Legacy scheduler unchanged.
  if (schedule?.schedulerUi === "legacy") return schedule;
  const isExport = kind === "export";
  const mode = !isExport && schedule?.mode === "onDemand" ? "onDemand" : "scheduled";
  return {
    schedulerUi: "new",
    mode: "scheduled",
    frequency: "Daily",
    timeMode: "specific",
    specificPreset: isExport ? "in15" : "in30",
    intervalHours: "1",
    intervalStartPreset: isExport ? "in15" : "in30",
    intervalEndTime: "23:59",
    ...schedule,
    // Import's new schedule page retains the existing On-demand choice.
    // Export's recurrence is determined by its payload/filter behavior.
    mode
  };
}

function normalizeExportFilter(value) {
  const normalized = String(value || "UPDATED").trim().toUpperCase();
  return ["UPDATED", "CREATED", "ALL"].includes(normalized) ? normalized : "UPDATED";
}

function normalizeExportPayloadType(value) {
  return String(value || "data-object").trim().toLowerCase() === "segment"
    ? "segment"
    : "data-object";
}

async function readNewSchedulerState(tabId, probe) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [probe],
    func: (requestedProbe) => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const rectangle = (element) => {
        if (!element || !visible(element)) return null;
        const box = element.getBoundingClientRect();
        return { x: box.left + (box.width / 2), y: box.top + (box.height / 2) };
      };
      if (requestedProbe.type === "ready") {
        // Import starts with On demand, which renders the outer settings
        // component but deliberately withholds #times and the recurring
        // controls until the user selects Recurring.
        return Boolean(document.querySelector("oj-cx-unity-job-schedule-settings") || document.querySelector("oj-cx-unity-job-schedule-recurring"));
      }
      if (requestedProbe.type === "frequency-input") {
        const input = [...document.querySelectorAll("input[aria-controls='lovDropdown_requency']")]
          .find((element) => visible(element) || visible(element.closest("oj-select-single")));
        return rectangle(input?.closest("oj-select-single, .oj-text-field-container") || input);
      }
      if (requestedProbe.type === "import-frequency-input") {
        const input = document.getElementById("requency|input")
          || [...document.querySelectorAll("input[aria-controls='lovDropdown_requency']")].find(visible);
        return rectangle(input);
      }
      if (requestedProbe.type === "frequency-option") {
        const wanted = String(requestedProbe.value || "").replace(/\s+/g, " ").trim().toLowerCase();
        const list = [...document.querySelectorAll("#lovDropdown_requency, #oj-listbox-results-requency")]
          .find(visible);
        const options = [...(list?.querySelectorAll("[role='option'], [role='gridcell'], li, oj-option") || [])]
          .filter(visible);
        const option = options.find((element) => (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === wanted)
          || options.find((element) => (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase().startsWith(wanted));
        return rectangle(option?.closest("[role='option'], [role='gridcell'], li, oj-option") || option);
      }
      if (requestedProbe.type === "frequency-value") {
        const input = [...document.querySelectorAll("input[aria-controls='lovDropdown_requency']")]
          .find((element) => visible(element) || visible(element.closest("oj-select-single")));
        return input?.value || "";
      }
      if (requestedProbe.type === "recurring-run") {
        // CDP/JET generates the radio id dynamically and can reflect its
        // selected state on the visible choice wrapper before it mirrors the
        // native input's checked property. Read both representations.
        const runType = [...document.querySelectorAll("oj-cx-unity-job-schedule-settings oj-radioset#recurring-or-manual, oj-radioset#recurring-or-manual")]
          .find(visible)
          || [...document.querySelectorAll("oj-radioset")].find((element) => visible(element) && [...element.querySelectorAll("input")].some((input) => /recurr/i.test(input.value || input.name || "")))
          || [...document.querySelectorAll("oj-cx-unity-job-schedule-settings")].find(visible);
        const inputs = [...(runType?.querySelectorAll("input") || [])];
        const input = inputs.find((candidate) => /recurr/i.test(candidate.value || candidate.name || "")) || null;
        const manual = inputs.find((candidate) => /ondemand|manual/i.test(candidate.value || "")) || null;
        const labelFor = (control) => [...document.querySelectorAll("label")].find((label) => label.htmlFor === control?.id) || control?.closest(".oj-choice-item, label") || control;
        const manualExists = Boolean(manual);
        if (!input) {
          const recurringLabel = [...(runType?.querySelectorAll("label,span,.option-recurring") || [])]
            .find((element) => visible(element) && /^recurring$/i.test((element.textContent || "").replace(/\s+/g, " ").trim()));
          return {
            exists: Boolean(recurringLabel),
            manualExists,
            checked: Boolean(recurringLabel),
            rect: rectangle(recurringLabel?.closest(".oj-choice-item") || recurringLabel)
          };
        }
        const choice = input.closest(".oj-choice-item") || labelFor(input);
        // The icon is the interactive hit target in JET. The native input is
        // visually hidden and the wider wrapper can be covered by layout
        // elements on the Import schedule page.
        const target = choice?.querySelector(".oj-radiocheckbox-icon") || choice;
        const checked = Boolean(input.checked) || [input, choice, labelFor(input), choice?.parentElement]
          .some((element) => element?.getAttribute?.("aria-checked") === "true" || element?.classList?.contains("oj-selected"));
        return { exists: true, manualExists, checked, rect: rectangle(target) };
      }
      if (requestedProbe.type === "time-mode") {
        const input = [...document.querySelectorAll(`#specific_or_interval input[value="${requestedProbe.value}"], input[name="specific_or_interval"][value="${requestedProbe.value}"]`)]
          .find((element) => visible(element) || visible(element.closest("oj-radioset, .oj-choice-item")));
        const choice = input?.closest(".oj-choice-item");
        const checked = Boolean(input?.checked)
          || choice?.classList.contains("oj-selected")
          || choice?.getAttribute("aria-checked") === "true";
        return {
          checked,
          rect: rectangle(choice?.querySelector(".oj-radiocheckbox-icon") || document.querySelector(`label[for="${input?.id || ""}"]`) || choice || input)
        };
      }
      if (requestedProbe.type === "time-input") {
        const input = [...document.querySelectorAll("#times oj-input-time.specific-time-length input, #times .specific-time-length input")]
          .find((element) => visible(element) && !element.id.startsWith("interval_"));
        return input?.id || "";
      }
      if (requestedProbe.type === "interval-input") return document.getElementById(`${requestedProbe.id}|input`)?.id || "";
      if (requestedProbe.type === "calendar-choice") {
        const root = document.querySelector("oj-cx-unity-job-schedule-recurring, oj-cx-unity-job-schedule-settings");
        const input = [...(root?.querySelectorAll(`input[value="${requestedProbe.value}"]`) || [])]
          .find((element) => visible(element) || visible(element.closest("oj-buttonset-many, .oj-choice-item")));
        return { checked: Boolean(input?.checked), rect: rectangle(root?.querySelector(`label[for="${input?.id || ""}"]`) || input?.closest(".oj-button-toggle,.oj-choice-item") || input) };
      }
      return null;
    }
  });
  return result;
}

async function waitForNewSchedulerState(tabId, probe, label, predicate = Boolean, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await readNewSchedulerState(tabId, probe);
    if (predicate(state)) return state;
    await schedulerSleep(150);
  }
  throw new Error(`New scheduler: timed out waiting for ${label}.`);
}

async function trustedSchedulerClick(tabId, point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`New scheduler: ${label} is not available.`);
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const x = Math.round(point.x); const y = Math.round(point.y);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function trustedSelectRecurring(tabId, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("New scheduler: Recurring run option is not available.");
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const x = Math.round(point.x); const y = Math.round(point.y);
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

// Import's New Scheduler is a JET radioset.  Its stable native radio is the
// only control we need to activate; do not set the component value or infer
// selection from dynamic ui-id values.
async function clickImportRecurringRadio(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const group = [...document.querySelectorAll("oj-radioset#recurring-or-manual")]
        .find(visible)
        || document.querySelector("oj-radioset#recurring-or-manual");
      const recurring = group?.querySelector("input[name='recurring-or-manual'][value='recurring']");
      if (!recurring) return { found: false, checked: false };
      if (!recurring.checked) recurring.click();
      return { found: true, checked: Boolean(recurring.checked) };
    }
  });
  if (!result?.found) throw new Error("New scheduler: Recurring run option is not available.");
  return Boolean(result.checked);
}

async function clickImportOnDemandRadio(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const group = [...document.querySelectorAll("oj-radioset#recurring-or-manual")]
        .find(visible)
        || document.querySelector("oj-radioset#recurring-or-manual");
      const onDemand = group?.querySelector("input[name='recurring-or-manual'][value='onDemand'], input[name='recurring-or-manual'][value='manual']");
      if (!onDemand) return { found: false, checked: false };
      if (!onDemand.checked) onDemand.click();
      return { found: true, checked: Boolean(onDemand.checked) };
    }
  });
  if (!result?.found) throw new Error("New scheduler: On-demand run option is not available.");
  return Boolean(result.checked);
}

// Import's Frequency and Times controls are Oracle JET components that sit
// behind a transient mapping overlay. The component accepts this native JET
// event sequence reliably, whereas a debugger-coordinate click can land on
// the overlay. Keep the behavior in the shared scheduler—not the Import job.
async function selectImportSchedulerFrequency(tabId, frequency) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [frequency],
    func: async (requestedFrequency) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const normalized = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const click = (element) => {
        element.scrollIntoView({ block: "center" });
        element.focus?.();
        const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
        if (typeof PointerEvent !== "undefined") element.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerType: "mouse" }));
        element.dispatchEvent(new MouseEvent("mousedown", options));
        element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
        element.click();
      };
      const input = document.getElementById("requency|input");
      if (!input || !visible(input) || input.disabled) return { ok: false, error: "Import Frequency input is unavailable." };
      click(input);
      const wanted = normalized(requestedFrequency);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const menu = document.getElementById("lovDropdown_requency");
        const choices = [...(menu?.querySelectorAll("[role='option'],[role='gridcell'],li,oj-option") || [])].filter(visible);
        const option = choices.find((item) => normalized(item.textContent) === wanted)
          || choices.find((item) => normalized(item.textContent).startsWith(wanted));
        if (option) {
          click(option.closest("[role='option'],[role='gridcell'],li,oj-option") || option);
          return { ok: true };
        }
        await sleep(100);
      }
      return { ok: false, error: `Import Frequency option ${requestedFrequency} was not available.` };
    }
  });
  if (!result?.ok) throw new Error(result?.error || "New scheduler: Import Frequency could not be selected.");
}

async function selectImportSchedulerTimeMode(tabId, timeMode) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [timeMode],
    func: (requestedMode) => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const input = [...document.querySelectorAll("oj-radioset#specific_or_interval input")]
        .find((element) => visible(element.closest("oj-radioset")) && String(element.value || "").toLowerCase() === String(requestedMode).toLowerCase());
      if (!input) return { ok: false, error: `Import ${requestedMode} option is unavailable.` };
      const target = document.querySelector(`label[for="${CSS.escape(input.id)}"]`) || input.closest(".oj-choice-item") || input;
      const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
      target.dispatchEvent(new MouseEvent("mousedown", options));
      target.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
      target.click();
      return { ok: Boolean(input.checked) };
    }
  });
  if (!result?.ok) throw new Error(result?.error || `New scheduler: Import ${timeMode} could not be selected.`);
}

async function trustedSchedulerSpace(tabId) {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
    const space = { key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 };
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...space });
    await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...space });
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function activateRecurringMode(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const visible = (element) => Boolean(element?.getClientRects?.().length);
      const root = [...document.querySelectorAll("oj-cx-unity-job-schedule-settings oj-radioset#recurring-or-manual, oj-radioset#recurring-or-manual")]
        .find(visible)
        || [...document.querySelectorAll("oj-radioset")].find((element) => visible(element) && [...element.querySelectorAll("input")].some((input) => /recurr/i.test(input.value || input.name || "")));
      if (!root) return { found: false, activated: false };
      const input = [...root.querySelectorAll("input")].find((candidate) => /recurr/i.test(candidate.value || candidate.name || ""));
      const current = () => Boolean(input?.checked) || /recurr/i.test(String(root.value || ""));
      if (current()) return { found: true, activated: true };
      // JET exposes the radioset value as a component property. Setting it
      // first lets its own valueChanged handler render the recurring panel;
      // the native event path below covers older CDP builds.
      for (const value of [["recurring"], "recurring"]) {
        try { root.setProperty?.("value", value); } catch (_) {}
        try { root.value = value; } catch (_) {}
        if (current()) break;
      }
      if (!current() && input) {
        input.checked = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return { found: true, activated: current() };
    }
  });
  return Boolean(result?.activated);
}

async function applyTrustedNewScheduler(tabId, schedule = {}) {
  const normalized = { frequency: "Daily", timeMode: "specific", specificPreset: "in15", intervalHours: "1", intervalStartPreset: "in15", intervalEndTime: "23:59", ...schedule };
  const isImportJob = normalized.jobKind === "import";
  const schedulerGroup = `Scheduler · ${isImportJob ? "Import" : "Export"}`;
  await waitForNewSchedulerState(tabId, { type: "ready" }, "schedule controls", Boolean, 120000);
  await appendRunLog("Schedule and Notify controls are ready.", "info", schedulerGroup, "Ready");

  // Only Import exposes an explicit On-demand radio in the New Scheduler.
  // Export's schedule mode is determined by its payload/filter selection.
  if (isImportJob && String(normalized.mode || "scheduled").toLowerCase() === "ondemand") {
    await clickImportOnDemandRadio(tabId);
    await appendRunLog("Run mode = On-demand.", "info", schedulerGroup, "Select");
    return { ok: true, mode: "onDemand" };
  }

  // Import jobs can open with Manual selected; Export has Recurring fixed. In
  // both cases, a New Scheduler configuration must explicitly be recurring.
  const recurring = await waitForNewSchedulerState(
    tabId,
    { type: "recurring-run" },
    "Run selection",
    (state) => Boolean(state?.exists || state?.manualExists || state?.rect),
    120000
  );
  if (recurring?.manualExists && !recurring.exists) {
    let activated = false;
    if (isImportJob) activated = await clickImportRecurringRadio(tabId);
    if (!isImportJob) activated = await activateRecurringMode(tabId);
    if (!activated && !isImportJob && recurring.rect) {
      await trustedSelectRecurring(tabId, recurring.rect);
      activated = true;
    }
    if (!activated) throw new Error("New scheduler: CDP exposed On-demand but not an activatable Recurring option.");
    await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "Recurring schedule controls", Boolean);
  }
  if (recurring?.exists && !recurring.checked) {
    if (isImportJob) {
      await clickImportRecurringRadio(tabId);
    } else {
      const activated = await activateRecurringMode(tabId);
      if (!activated) await trustedSelectRecurring(tabId, recurring.rect);
    }
    // The recurrence controls are the authoritative signal. JET can delay
    // rendering them just after the radio's click handler runs.
    try {
      await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "Recurring schedule controls", Boolean, 2500);
    } catch (_) {
      if (isImportJob) {
        await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "Recurring schedule controls", Boolean);
      } else {
        // The visible radio icon receives focus after the mouse action. Some
        // JET builds need its standard keyboard activation to commit the value.
        await trustedSchedulerSpace(tabId);
        await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "Recurring schedule controls", Boolean);
      }
    }
  }
  await appendRunLog("Run mode = Recurring.", "info", schedulerGroup, "Select");

  if (isImportJob) {
    await selectImportSchedulerFrequency(tabId, normalized.frequency);
  } else {
    await trustedSchedulerClick(tabId, await waitForNewSchedulerState(tabId, { type: "frequency-input" }, "frequency selector"), "frequency selector");
    await trustedSchedulerClick(tabId, await waitForNewSchedulerState(tabId, { type: "frequency-option", value: normalized.frequency }, `${normalized.frequency} option`), "frequency option");
  }
  await waitForNewSchedulerState(tabId, { type: "frequency-value" }, `${normalized.frequency} selection`, (value) => String(value).trim().toLowerCase() === String(normalized.frequency).trim().toLowerCase());
  await appendRunLog(`Frequency = ${normalized.frequency}.`, "info", schedulerGroup, "Select");

  if (normalized.frequency !== "Daily") {
    const now = new Date();
    const value = normalized.frequency === "Weekly, on selected Days" ? String(now.getDay() + 1) : String(now.getDate());
    const calendar = await waitForNewSchedulerState(tabId, { type: "calendar-choice", value }, "calendar choice", (state) => state?.rect);
    if (!calendar.checked) await trustedSchedulerClick(tabId, calendar.rect, "calendar choice");
    await waitForNewSchedulerState(tabId, { type: "calendar-choice", value }, "calendar selection", (state) => state?.checked);
    await appendRunLog(`Calendar selection = ${value}.`, "info", schedulerGroup, "Select");
  }

  const timeMode = await waitForNewSchedulerState(tabId, { type: "time-mode", value: normalized.timeMode }, `${normalized.timeMode} option`, (state) => state?.rect);
  if (!timeMode.checked) {
    if (isImportJob) await selectImportSchedulerTimeMode(tabId, normalized.timeMode);
    else await trustedSchedulerClick(tabId, timeMode.rect, `${normalized.timeMode} option`);
  }
  await waitForNewSchedulerState(tabId, { type: "time-mode", value: normalized.timeMode }, `${normalized.timeMode} selection`, (state) => state?.checked);
  await appendRunLog(`Times = ${normalized.timeMode === "interval" ? "Interval" : "Specific"}.`, "info", schedulerGroup, "Select");

  if (normalized.timeMode === "interval") {
    const hours = Number.parseInt(normalized.intervalHours, 10);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new Error("Interval must be a whole number from 1 to 24 hours.");
    const intervalId = await waitForNewSchedulerState(tabId, { type: "interval-input", id: "interval" }, "interval input", Boolean);
    await typeJetInput(tabId, intervalId, String(hours), "Interval");
    const startId = await waitForNewSchedulerState(tabId, { type: "interval-input", id: "interval_start_time" }, "interval start time", Boolean);
    await typeJetInput(tabId, startId, newSchedulerTimeText(newSchedulerRunAt(normalized, "intervalStartPreset", "intervalStartTime")), "Interval start time");
    const endId = await waitForNewSchedulerState(tabId, { type: "interval-input", id: "interval_end_time" }, "interval end time", Boolean);
    await typeJetInput(tabId, endId, newSchedulerTimeText(newSchedulerRunAt({ ...normalized, customTime: normalized.intervalEndTime || "23:59" }, "custom", "customTime")), "Interval end time");
    await appendRunLog(`Interval = ${hours} hour(s); start = ${newSchedulerTimeText(newSchedulerRunAt(normalized, "intervalStartPreset", "intervalStartTime"))}; end = ${newSchedulerTimeText(newSchedulerRunAt({ ...normalized, customTime: normalized.intervalEndTime || "23:59" }, "custom", "customTime"))}.`, "info", schedulerGroup, "Type");
  } else {
    const timeInputId = await waitForNewSchedulerState(tabId, { type: "time-input" }, "specific time", Boolean);
    const runAt = newSchedulerRunAt(normalized, "specificPreset", "customTime");
    await typeJetInput(tabId, timeInputId, newSchedulerTimeText(runAt), "Specific time");
    await appendRunLog(`Specific time = ${newSchedulerTimeText(runAt)}.`, "info", schedulerGroup, "Type");
    return { ok: true, scheduledAt: runAt.getTime() };
  }
  return { ok: true };
}

async function installNewSchedulerRelay(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId }, world: "ISOLATED",
    func: () => {
      if (window.__cdpNewSchedulerRelayInstalled) return;
      window.__cdpNewSchedulerRelayInstalled = true;
      window.addEventListener("cdp-new-scheduler-request", async (event) => {
        try {
          const schedule = JSON.parse(String(event.detail || "{}"));
          const result = await chrome.runtime.sendMessage({ type: "apply-new-scheduler", schedule });
          window.dispatchEvent(new CustomEvent("cdp-new-scheduler-result", { detail: JSON.stringify(result || {}) }));
        } catch (error) {
          window.dispatchEvent(new CustomEvent("cdp-new-scheduler-result", { detail: JSON.stringify({ ok: false, error: error.message || String(error) }) }));
        }
      });
      window.addEventListener("message", async (event) => {
        const message = event.data;
        if (event.source !== window || message?.source !== "cdp-import-scheduler" || message?.type !== "apply") return;
        let result;
        try {
          result = await chrome.runtime.sendMessage({ type: "apply-new-scheduler", schedule: message.schedule || {} });
        } catch (error) {
          result = { ok: false, error: error.message || String(error) };
        }
        window.postMessage({
          source: "cdp-import-scheduler",
          type: "result",
          requestId: message.requestId,
          result: result || { ok: false, error: "New scheduler did not return a result." }
        }, "*");
      });
    }
  });
}

async function dataModelObjectState(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    func: () => {
      const name = document.getElementById("objNameInput|input");
      const objectId = document.getElementById("objIdInput|input");
      const resourceName = document.getElementById("objResNameInput|input");
      const messages = [...document.querySelectorAll("[role=alert], [role=tooltip], .oj-message, .oj-message-detail, .oj-messages, .oj-popup-content")]
        .filter((element) => element.getClientRects().length)
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
      return {
        name: name?.value || "",
        objectId: objectId?.value || "",
        resourceName: resourceName?.value || "",
        invalid: name?.getAttribute("aria-invalid") === "true" || resourceName?.getAttribute("aria-invalid") === "true",
        messages
      };
    }
  });
  return result || {};
}

async function commitJetDataModelObjectName(tabId, objectName) {
  const candidate = String(objectName || "").replace(/_\d{2}$/, "");
  await typeJetInput(tabId, "objNameInput|input", candidate, "Object name");
  for (let attempt = 0; attempt < 28; attempt += 1) {
    const state = await dataModelObjectState(tabId);
    if (String(state.objectId || "").trim() && !state.invalid) return { ...state, name: candidate };
    if (state.invalid) return { ...state, name: candidate, skipped: true, reason: state.messages || "CDP rejected this Data Model object name." };
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  const state = await dataModelObjectState(tabId);
  if (state.invalid) return { ...state, name: candidate, skipped: true, reason: state.messages || "CDP rejected this Data Model object name." };
  throw new Error(`CDP did not generate an Object ID for ${candidate}${state.messages ? `: ${state.messages}` : ""}`);
}

async function commitJetDataModelResourceName(tabId, resourceName) {
  const candidate = String(resourceName || "").trim();
  if (!candidate) throw new Error("Data Model Resource Name is required.");
  await typeJetInput(tabId, "objResNameInput|input", candidate, "Resource Name");
  for (let attempt = 0; attempt < 28; attempt += 1) {
    const state = await dataModelObjectState(tabId);
    if (String(state.resourceName || "").trim() === candidate && !state.invalid) return state;
    if (state.invalid) throw new Error("CDP rejected Resource Name " + candidate + (state.messages ? ": " + state.messages : ""));
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  const state = await dataModelObjectState(tabId);
  throw new Error("CDP did not commit Resource Name " + candidate + (state.messages ? ": " + state.messages : ""));
}

async function dataModelAttributeState(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    func: () => {
      const name = document.getElementById("attrNameInput|input");
      const attributeId = document.getElementById("attrIdInput|input");
      const messages = [...document.querySelectorAll("[role=alert], [role=tooltip], .oj-message, .oj-message-detail, .oj-messages, .oj-popup-content")]
        .filter((element) => element.getClientRects().length)
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ");
      return { name: name?.value || "", attributeId: attributeId?.value || "", invalid: name?.getAttribute("aria-invalid") === "true", messages };
    }
  });
  return result || {};
}

async function commitJetDataModelAttributeName(tabId, attributeName) {
  const expectedName = String(attributeName || "").trim().toLowerCase();
  // Use the original full-value entry method once the drawer is stable. The
  // drawer stability check—not per-character slowing—keeps JET from binding
  // the generated ID to the first character only.
  const typeAttributeName = () => typeJetInput(tabId, "attrNameInput|input", attributeName, "Attribute name");
  await typeAttributeName();
  let retriedAttributeCommit = false;
  let latest = {};
  const idMatchesName = (attributeId) => {
    const nameKey = expectedName.replace(/[^a-z0-9]/g, "");
    const idKey = String(attributeId || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // CDP may append _c, but the generated ID must begin with the whole Name.
    return Boolean(nameKey) && idKey.startsWith(nameKey);
  };
  for (let attempt = 0; attempt < 84; attempt += 1) {
    const state = await dataModelAttributeState(tabId);
    latest = state;
    const actualName = String(state.name || "").trim().toLowerCase();
    const hasCompleteAttributeId = idMatchesName(state.attributeId);
    if (actualName === expectedName && hasCompleteAttributeId && !state.invalid) {
      return { ...state, name: attributeName };
    }
    // Oracle JET can drop trailing keystrokes or generate the ID from only the
    // first character while the just-closed drawer is being reconciled. Once
    // the drawer has settled, re-enter the complete value so JET regenerates
    // the ID from the final Name rather than the initial keystroke.
    if ((actualName !== expectedName || !hasCompleteAttributeId) && attempt >= 12 && !retriedAttributeCommit) {
      retriedAttributeCommit = true;
      await typeAttributeName();
      continue;
    }
    // Only a specific duplicate response means this name must be skipped. The
    // generic character-rule tooltip is transient while JET validates a name.
    if (actualName === expectedName && state.invalid && /already exists|duplicate|unavailable/i.test(state.messages || "")) {
      return { ...state, name: attributeName, skipped: true, reason: state.messages || "Attribute name is already unavailable in CDP." };
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  const actualName = String(latest.name || "").trim();
  if (actualName.toLowerCase() === expectedName && idMatchesName(latest.attributeId)) {
    // The generated ID is authoritative; the subsequent Save readiness check
    // still ensures CDP has cleared any stale validation state.
    return { ...latest, name: attributeName };
  }
  throw new Error(`CDP did not generate an Attribute ID for ${attributeName}${latest.messages ? `: ${latest.messages}` : ""}`);
}

async function commitJetConnectionName(tabId, connectionConfig) {
  const baseName = String(connectionConfig.name || "").replace(/_\d{2}$/, "");
  for (let index = 1; index <= 99; index += 1) {
    const candidate = index === 1 ? baseName : `${baseName}_${String(index).padStart(2, "0")}`;
    await typeJetConnectionName(tabId, candidate);
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const state = await connectionNameState(tabId, connectionConfig.side);
      if (String(state.id || "").trim()) return { ...connectionConfig, name: candidate, nameCommitted: true };
      const duplicate = state.invalid && /(?:source|destination|connection)?\s*(?:with\s+this\s+)?name\s+already\s+exists|name\s+must\s+be\s+unique|try\s+another/i.test(state.messages || "");
      if (duplicate) break;
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    const finalState = await connectionNameState(tabId, connectionConfig.side);
    const duplicate = finalState.invalid && /(?:source|destination|connection)?\s*(?:with\s+this\s+)?name\s+already\s+exists|name\s+must\s+be\s+unique|try\s+another/i.test(finalState.messages || "");
    if (!duplicate) throw new Error(`CDP did not generate the required ${connectionConfig.side === "destination" ? "Destination" : "Source"} ID after typing the connection name.`);
  }
  throw new Error(`No available connection name suffix was found for ${baseName}.`);
}

async function installStepMonitor(tabId, { runId, stepId, saveSelector }) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [runId, stepId, saveSelector],
    func: (activeRunId, activeStepId, selector) => {
      const visible = (element) => Boolean(element?.getClientRects().length);
      const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
      const plainSaveButton = () => [...document.querySelectorAll("button, oj-button, [role='button']")]
        .find((element) => visible(element) && text(element) === "Save" && !element.disabled);

      document.addEventListener("click", (event) => {
        if (document.documentElement.dataset.cdpAutomationRunId !== activeRunId) return;
        if (!(event.target instanceof Element) || !event.target.closest(selector)) return;

        // New Scheduler jobs configure the actual CDP controls from their
        // Save gate. Do not redirect their Save and close click around it.
        if (document.documentElement.dataset.cdpNewScheduler === "true") return;

        const saveButton = plainSaveButton();
        if (saveButton) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setTimeout(() => {
            (saveButton.querySelector("button") || saveButton).click();
            chrome.runtime.sendMessage({
              type: "sequence-step-saved",
              runId: activeRunId,
              stepId: activeStepId
            });
          }, 0);
        } else {
          chrome.runtime.sendMessage({
            type: "sequence-step-save-missing",
            runId: activeRunId,
            stepId: activeStepId
          });
        }
      }, true);
    }
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [saveSelector],
    func: (selector) => {
      const state = { status: "running", error: "", saveClickedAt: 0 };
      window.__cdpSequenceStep = state;
      const originalAlert = window.alert.bind(window);
      window.alert = (message) => {
        state.status = "failed";
        state.error = String(message);
        return originalAlert(message);
      };
      document.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest(selector)) {
          state.status = "saved";
          state.saveClickedAt = Date.now();
        }
      }, true);
    }
  });
}

async function installTaskCompletionMonitor(tabId, runId, saveSelector) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [runId, saveSelector],
    func: (activeRunId, selector) => {
      document.addEventListener("click", (event) => {
        if (document.documentElement.dataset.cdpAutomationRunId !== activeRunId) return;
        if (event.target instanceof Element && event.target.closest(selector)) {
          chrome.runtime.sendMessage({ type: "individual-task-finished", runId: activeRunId });
        }
      }, true);
    }
  });
}

async function waitForStep(tabId, label, saveSelector, runId, stepId, timeout = 180000) {
  const deadline = Date.now() + timeout;
  const isJobSave = /Create (Import|Export) Job/i.test(label);
  let saveRetryAttempted = false;
  let saveRetryDeadline = 0;
  while (Date.now() < deadline) {
    try {
      const activeSequence = activeSequences.get(tabId);
      if (!activeSequence || activeSequence.runId !== runId || activeSequence.cancelled) {
        throw new Error(`${label} was stopped by the user.`);
      }
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [saveSelector],
        func: (stepSaveSelector) => {
          const visible = (element) => Boolean(element?.getClientRects().length);
          const messages = [...document.querySelectorAll(
            "[data-bind='text: message.data.detail'], [role='alert'], .oj-message, .oj-message-summary, .oj-messages, [class*='toast'], [class*='notification']"
          )]
            .filter(visible)
            .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
            .filter(Boolean);
          const saveHost = stepSaveSelector ? document.querySelector(stepSaveSelector) : null;
          const saveButton = saveHost?.matches("button") ? saveHost : saveHost?.querySelector("button");
          const saveEnabled = Boolean(
            saveHost && saveButton && visible(saveHost) && !saveButton.disabled &&
            !saveHost.classList.contains("oj-disabled") && saveHost.getAttribute("aria-disabled") !== "true"
          );
          return {
            monitor: window.__cdpSequenceStep || null,
            saveEnabled,
            success: messages.some((message) =>
              /\byour\s+changes\s+have\s+been\s+saved\b/i.test(message) ||
              /\bjob\s+was\s+saved\s+successfully\b/i.test(message)
            )
          };
        }
      });
      if (result?.success) {
        // Do not treat a Save click as completion. CDP can still be validating
        // or persisting the source/destination while the next navigation would
        // cancel the request. Advance only after its visible success message.
        await appendRunLog(`${label} saved.`);
        return;
      }
      if (!result?.monitor) {
        throw new Error(`${label} was interrupted before Oracle confirmed it was saved successfully.`);
      }
      const saveClickedAt = Number(result.monitor.saveClickedAt || 0);
      const elapsedSinceSave = saveClickedAt ? Date.now() - saveClickedAt : 0;
      if (isJobSave && saveClickedAt && !saveRetryAttempted && elapsedSinceSave >= 4000) {
        saveRetryAttempted = true;
        saveRetryDeadline = Date.now() + 5000;
        if (result.saveEnabled) {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            args: [saveSelector],
            func: (selector) => {
              const host = document.querySelector(selector);
              const button = host?.matches("button") ? host : host?.querySelector("button");
              if (!host || !button || button.disabled || host.classList.contains("oj-disabled") || host.getAttribute("aria-disabled") === "true") return false;
              button.click();
              return true;
            }
          });
          await appendRunLog(`${label}: Save remained enabled after 4 seconds; retried Save.`, "warn", label, "Retry");
        } else {
          await appendRunLog(`${label}: Save became unavailable; waiting briefly for CDP confirmation.`, "info", label, "Wait");
        }
      }
      if (isJobSave && saveRetryAttempted && Date.now() >= saveRetryDeadline) {
        throw new Error(`${label} did not show a save confirmation after the Save retry.`);
      }
    } catch (error) {
      throw new Error(`${label} failed: ${error.message || error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out waiting for CDP's save confirmation.`);
}

async function runTask(tabId, filename, monitor, schedule, importConfig, exportPayloadName, importTableIds, connectionConfig, jobConfig) {
  const task = TASKS[filename];
  if (!task) throw new Error(`Unsupported automation script: ${filename}`);
  if (filename === "exportJob.js") {
    const catalog = await loadTableCatalog();
    const payload = exportPayloadName || "Customer";
    if (!jobConfig?.customTable && !catalog.exportPayloads.includes(payload)) throw new Error(`Unsupported export payload: ${payload}.`);
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith("http")) {
    throw new Error("Open your Oracle CDP tenant in the active tab first.");
  }

  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  await activatePageAutomationRun(tabId, monitor?.runId || schedule?.runId || "");
  let runtimeConnectionConfig = connectionConfig;
  if (task.createLabel) {
    await prepareConnectionForm(tabId, task, connectionConfig?.type);
    if (connectionConfig?.name) runtimeConnectionConfig = await commitJetConnectionName(tabId, connectionConfig);
  }
  if (task.readySelector) await waitForPageElement(tabId, task.readySelector);

  // In E2E, navigate first. This ensures the Export→Import handoff is visible
  // even if a user-edited CSV fragment has a configuration error.
  if (filename === "importContacts.js" && !importConfig && importTableIds) {
    try {
      importConfig = await buildImportConfig(importTableIds, jobConfig?.fileContract?.delimiter);
    } catch (error) {
      console.warn("Could not load editable E2E import CSV files; using the bundled Customer + ContactPoint fallback.", error);
      importConfig = importFallbackConfig(jobConfig?.fileContract?.delimiter);
    }
  }

  // Oracle sometimes reports the page complete just before its JET form accepts
  // MAIN-world injections. Retry that short transition rather than leaving an
  // empty form open and silently abandoning the E2E flow.
  const installAutomation = async () => {
    await installStopGuard(tabId);
    if (monitor) await installStepMonitor(tabId, monitor);
    if (!monitor && task.saveSelector && schedule?.runId) {
      await installTaskCompletionMonitor(tabId, schedule.runId, task.saveSelector);
    }

    if (["exportJob.js", "importJob.js", "importContacts.js"].includes(filename)) {
      // The worker scheduler needs to distinguish Import's JET radio group
      // (which must receive a real click) from Export's schedule controls.
      // Keep this explicit rather than inferring it from DOM labels.
      const jobSchedule = {
        ...(schedule || { mode: "scheduled", frequency: "Daily", startTime: "immediate" }),
        jobKind: filename === "exportJob.js" ? "export" : "import"
      };
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [jobSchedule],
        func: (scheduleConfig) => {
          window.__cdpSchedule = scheduleConfig;
          window.__cdpScheduledRunAt = null;
          window.__cdpScheduleApplied = false;
          window.__cdpManualScheduleApplied = false;
          window.__cdpFrequencySaveDeferred = false;
          window.__cdpFrequencyOverrideSaved = false;
          window.__cdpFrequencyOverrideApplying = false;
          window.__cdpNewScheduleApplied = false;
          window.__cdpUseWorkerScheduler = scheduleConfig?.schedulerUi === "new";
          document.documentElement.dataset.cdpNewScheduler = scheduleConfig?.schedulerUi === "new" ? "true" : "false";
        }
      });
      if (schedule?.schedulerUi === "legacy") {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          files: ["scheduleOverride.js"]
        });
      }
      // New Scheduler is one shared scheduler for Import, Export, and
      // Responsys. Legacy scheduler scripts remain page-specific.
      if (schedule?.schedulerUi === "new") {
        await installNewSchedulerRelay(tabId);
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          files: ["jobSchedulerBridge.js"]
        });
      }
    }

    if (runtimeConnectionConfig) {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [runtimeConnectionConfig],
        func: (config) => { window.__cdpConnectionConfig = config; }
      });
    }
    if (jobConfig) {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [jobConfig],
        func: (config) => {
          window.__cdpJobConfig = config;
          const set = (id, value) => {
            if (!value) return;
            const input = document.getElementById(id);
            if (!input || input.value === value) return;
            const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
            setter?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
          };
          const apply = () => { set("job-name-input|input", config.name); set("job-desc-text-area|input", config.description); set("job-details-fileName|input", config.fileName); set("notify-input|input", config.notification); };
          const applyCompression = () => {
            if (!config.compression || config.compression === "none") return;
            const input = [...document.querySelectorAll("input[role=combobox]")].find((item) => /compressformat/i.test(item.getAttribute("aria-label") || item.id));
            if (!input || input.value === config.compression || input.dataset.cdpTemplateCompression === config.compression) return;
            input.dataset.cdpTemplateCompression = config.compression;
            (input.closest("oj-select-single")?.querySelector(".oj-searchselect-arrow,.oj-searchselect-main-field") || input).click();
            setTimeout(() => {
              const option = [...document.querySelectorAll("[role=option],oj-option,li")].find((item) => item.getClientRects().length && (item.textContent || "").trim().toLowerCase() === String(config.compression).toLowerCase());
              option?.click();
            }, 180);
          };
          apply(); const timer = setInterval(() => { apply(); applyCompression(); }, 80); setTimeout(() => clearInterval(timer), 120000);
        }
      });
    }

    if (filename === "importContacts.js") {
      const hasSingleMapping = Boolean(importConfig?.csvContent && Array.isArray(importConfig.targetTables) && importConfig.fieldToTable);
      const hasMultipleMappings = Array.isArray(importConfig?.sources) && importConfig.sources.length > 0;
      if (!hasSingleMapping && !hasMultipleMappings) importConfig = E2E_IMPORT_FALLBACK;
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [importConfig],
        func: (config) => { window.__cdpImportConfig = config; }
      });
    }
  };

  let installError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await installAutomation();
      installError = undefined;
      break;
    } catch (error) {
      installError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (installError) throw new Error(`Could not attach ${filename} after the page loaded: ${installError.message || installError}`);

  if (filename === "exportJob.js") {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [exportPayloadName || "Customer"],
      func: (payloadName) => { window.__cdpExportPayloadName = payloadName; }
    });
  }

  if (false && filename === "exportJob.js") {
    if (!exportPayloadName && exportPayloadName !== undefined) throw new Error("Export payload selection is missing.");
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [exportPayloadName || "Customer"],
      func: (payloadName) => {
        window.__cdpExportPayloadName = payloadName;
        if (window.__cdpExportPayloadOverrideInstalled) return;
        window.__cdpExportPayloadOverrideInstalled = true;
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const visible = (element) => Boolean(element?.getClientRects().length);
        const text = (element) => (element?.textContent || "").replace(/\s+/g, " ").trim();
        const setValue = (element, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter ? setter.call(element, value) : element.value = value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const click = (element) => {
          const options = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
          element.dispatchEvent(new MouseEvent("mousedown", options));
          element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
          element.click();
        };
        const chooseConfiguredPayload = async () => {
          const payloadName = window.__cdpExportPayloadName;
          if (!payloadName || payloadName === "Customer" || window.__cdpApplyingExportPayload) return;
          window.__cdpApplyingExportPayload = true;
          const input = document.getElementById("data-object-selection-dropdown|input");
          try {
            if (!input || !visible(input)) return;
            const host = input.closest("oj-select-single,oj-combobox-one,oj-combobox-many");
            const trigger = host?.querySelector(".oj-searchselect-arrow,.oj-searchselect-main-field,.oj-text-field-container,[role=combobox]") || input;
            click(trigger);
            await sleep(80);
            const filter = document.getElementById("oj-searchselect-filter-data-object-selection-dropdown|input") || input;
            setValue(filter, payloadName);
            const deadline = Date.now() + 1200;
            let option = null;
            while (Date.now() < deadline && !option) {
              option = [...document.querySelectorAll("[role='option'],oj-option,li.oj-listbox-result-selectable")].find((element) => {
                const label = text(element);
                return visible(element) && (label === payloadName || label.includes(payloadName) || element.getAttribute("value") === payloadName);
              });
              if (!option) await sleep(60);
            }
            if (!option) throw new Error(`Export payload option ${payloadName} was not found.`);
            click(option.closest("[role='option'],oj-option,li") || option);
          } finally {
            await sleep(100);
            window.__cdpApplyingExportPayload = false;
          }
        };
        document.addEventListener("click", (event) => {
          const option = event.target instanceof Element && event.target.closest("[role='option'],oj-option,li");
          if (!option || window.__cdpExportPayloadName === "Customer" || window.__cdpApplyingExportPayload) return;
          if (!document.getElementById("data-object-selection-dropdown|input")) return;
          setTimeout(() => chooseConfiguredPayload().catch(() => undefined), 0);
        }, true);
      }
    });
  }

  if (task.dependencies?.length) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: task.dependencies
    });
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [task.script || filename]
  });
}

// Every job entry point builds one of these requests. The page scripts remain
// provider-specific, while scheduling, save confirmation and flow handoff live
// in these two runners only.
function normalizeJobRunRequest(request = {}) {
  const kind = request.kind === "export" ? "export" : "import";
  const variant = kind === "import" && request.variant === "responsys" ? "responsys" : "generic";
  if (!request.runId) throw new Error("A job run requires a run ID.");
  if (!request.template) throw new Error("A job run requires a transfer template.");
  if (kind === "export" && !String(request.payloadName || "").trim()) throw new Error("Select an Export payload.");
  if (kind === "import" && variant === "generic" && (!Array.isArray(request.tableIds) || !request.tableIds.length) && (!Array.isArray(request.customTables) || !request.customTables.length)) throw new Error("Select at least one Import table.");
  return {
    origin: request.origin || "independent",
    kind,
    variant,
    runId: request.runId,
    template: request.template,
    connectionSequence: request.connectionSequence,
    connection: request.connection,
    schedule: kind === "export"
      ? normalizeNewSchedulerConfig(request.schedule, "export")
      : normalizeNewSchedulerConfig(request.schedule, "import"),
    filterRecords: kind === "export" ? normalizeExportFilter(request.filterRecords || request.filter) : "UPDATED",
    payloadType: kind === "export" ? normalizeExportPayloadType(request.payloadType) : "data-object",
    payloadName: request.payloadName || "Customer",
    tableIds: Array.isArray(request.tableIds) ? [...request.tableIds] : [],
    customTables: Array.isArray(request.customTables) ? request.customTables.filter((table) => table?.isCustom && table?.tableId && table?.cdpTable) : [],
    customTable: request.customTable?.isCustom && request.customTable?.tableId && request.customTable?.cdpTable ? request.customTable : null,
    mappingMode: request.mappingMode === "separate" ? "separate" : "combined",
    jobName: request.jobName || "",
    description: request.description || "",
    notification: request.notification || "",
    monitor: request.monitor || null,
    runMetadata: request.runMetadata || null,
    allowImportFallback: Boolean(request.allowImportFallback)
  };
}

function buildJobRuntimeConfig(request) {
  const isExport = request.kind === "export";
  const connection = request.connection;
  const operation = isExport ? "Export" : "Import";
  return isExport ? {
    name: request.jobName || jobNameForRequest(request),
    description: request.description || request.template.description || `${request.template.name} export`,
    destinationName: connection.name,
    // The page script adds the live host key between the table and Purpose.
    fileName: "",
    fileNameCode: jobObjectCode(request),
    compression: request.template.fileContract?.compression || "none",
    fileContract: request.template.fileContract || {},
    filterRecords: request.filterRecords,
    payloadType: request.payloadType,
    notification: request.notification || "", customTable: request.customTable || null, purpose: String(request.template.connectionPurpose || "")
  } : {
    name: request.jobName || jobNameForRequest(request),
    description: request.description || request.template.description || request.template.name + " import",
    sourceName: connection.name,
    sourceObjectName: "", purpose: String(request.template.connectionPurpose || ""),
    notification: request.notification || "",
    filePattern: request.template.fileContract?.filePattern || "",
    fileContract: request.template.fileContract || {}
  };
}

async function runImportJobRequest(tabId, rawRequest) {
  const request = normalizeJobRunRequest({ ...rawRequest, kind: "import" });
  const filename = request.variant === "responsys" ? "importJob.js" : "importContacts.js";
  const task = TASKS[filename];
  let importConfig;
  if (request.variant === "generic") {
    try {
      const sources = [];
      if (request.tableIds.length) {
        sources.push({
          ...(await buildImportConfig(request.tableIds, request.template.fileContract?.delimiter)),
          sourceCode: request.tableIds.length === 1
            ? normalizedNamePart(request.tableIds[0], "CUSTOMER")
            : "COMBINED"
        });
      }
      if (request.customTables.length) {
        const customImport = await buildCustomImportConfig(tabId, request.customTables, request.template.fileContract?.delimiter, request.mappingMode);
        sources.push(...customImport.sources);
      }
      importConfig = {
        sources
      };
    } catch (error) {
      if (!request.allowImportFallback) throw error;
      console.warn("Could not load editable Import CSV files; using bundled fallback.", error);
      const fallback = importFallbackConfig(request.template.fileContract?.delimiter);
      importConfig = {
        ...fallback,
        sources: (fallback.sources || [fallback]).map((source) => ({
          ...source,
          sourceCode: source.sourceCode || "CUSTOMER"
        }))
      };
    }
  }
  const jobConfig = buildJobRuntimeConfig(request);
  const importObjects = [...request.tableIds, ...request.customTables.map((table) => table.label || table.cdpTable)];
  await appendRunLog(`Import runner: ${request.variant} · ${importObjects.join(", ") || "Responsys Profile"}.`, "info", "Import", "Configure");
  await appendRunLog(`Job name = ${jobConfig.name}; Source = ${jobConfig.sourceName || "—"}.`, "info", "Import", "Plan");
  if (request.variant === "generic") {
    const mappingSources = importConfig.sources || [importConfig];
    const sourceCount = mappingSources.length;
    const headerCount = mappingSources.reduce((total, source) => total + String(source.csvContent || "").split(/\r?\n/, 1)[0].split(",").filter(Boolean).length, 0);
    await appendRunLog(`Tables = ${importObjects.join(", ")}; ${sourceCount} generated mapping source${sourceCount === 1 ? "" : "s"} = ${headerCount} fields.`, "info", "Import", "Map");
    for (const source of mappingSources.filter((item) => item.parentBridge)) {
      await appendRunLog(`Parent bridge: ${source.table?.label || source.table?.cdpTable} → ${source.parentBridge} using shared source keys.`, "info", "Import", "Map");
    }
  }
  await appendRunLog(`File contract = ${jobConfig.fileContract?.fileFormat || "CSV"} · ${jobConfig.fileContract?.charset || "UTF-8"} · ${jobConfig.fileContract?.csvParser || "RFC 4180"} · ${jobConfig.fileContract?.delimiter || "Comma"}.`, "info", "Import", "Configure");
  await appendRunLog(`Import scheduler: ${request.schedule.schedulerUi === "new" ? `New · ${request.schedule.frequency} · ${request.schedule.timeMode}` : `Legacy · ${request.schedule.mode} · ${request.schedule.frequency}`}.`, "info", "Scheduler · Import", "Configure");
  await appendRunLog("Opening Create Ingest Job.", "info", "Import", "Navigate");
  await runTask(tabId, filename, request.monitor, request.schedule, importConfig, undefined, request.tableIds, undefined, jobConfig);
  await waitForStep(tabId, request.variant === "responsys" ? "Responsys Import" : "Import Job", task.saveSelector, request.runId, request.monitor?.stepId || filename);
  const saved = request.runMetadata ? await captureCreatedEntity(tabId, request.runMetadata, filename) : null;
  return { request: { ...request, jobName: jobConfig.name }, saved };
}

async function runImportJobBatch(tabId, rawRequest) {
  const entries = [
    ...(rawRequest.tableIds || []).map((tableId) => ({ tableIds: [tableId], customTables: [], label: tableId })),
    ...(rawRequest.customTables || []).map((table) => ({ tableIds: [], customTables: [table], label: table.label || table.cdpTable }))
  ];
  const results = [];
  for (const entry of entries) {
    const jobName = rawRequest.jobName || jobNameForRequest({
      ...rawRequest,
      kind: "import",
      ...entry,
      mappingMode: "combined"
    });
    results.push(await runImportJobRequest(tabId, { ...rawRequest, ...entry, mappingMode: "combined", jobName }));
  }
  return { ...results[results.length - 1], results };
}

async function runExportJobRequest(tabId, rawRequest) {
  const request = normalizeJobRunRequest({ ...rawRequest, kind: "export" });
  const task = TASKS["exportJob.js"];
  const catalog = await loadTableCatalog();
  if (!request.customTable && !catalog.exportPayloads.includes(request.payloadName)) throw new Error(`Unsupported export payload: ${request.payloadName}.`);
  const jobConfig = buildJobRuntimeConfig(request);
  await appendRunLog(`Export runner: ${request.payloadName}.`, "info", "Export", "Configure");
  await appendRunLog(`Job name = ${jobConfig.name}; Destination = ${jobConfig.destinationName || "—"}.`, "info", "Export", "Plan");
  await appendRunLog(`Payload = ${request.payloadName}; type = ${request.payloadType}; records = ${request.filterRecords}.`, "info", "Export", "Select");
  await appendRunLog(`File contract = ${jobConfig.fileContract?.fileFormat || "CSV"} · compression = ${jobConfig.compression || "none"}.`, "info", "Export", "Configure");
  await appendRunLog(`Export scheduler: ${request.schedule.schedulerUi === "new" ? `New · ${request.schedule.frequency} · ${request.schedule.timeMode}` : `Legacy · ${request.schedule.mode} · ${request.schedule.frequency}`}.`, "info", "Scheduler · Export", "Configure");
  await appendRunLog("Opening Create Export Job.", "info", "Export", "Navigate");
  await runTask(tabId, "exportJob.js", request.monitor, request.schedule, undefined, request.payloadName, undefined, undefined, jobConfig);
  await waitForStep(tabId, "Export Job", task.saveSelector, request.runId, request.monitor?.stepId || "exportJob.js");
  const saved = request.runMetadata ? await captureCreatedEntity(tabId, request.runMetadata, "exportJob.js") : null;
  return { request: { ...request, jobName: jobConfig.name }, saved };
}

async function runExportJobBatch(tabId, rawRequest) {
  const payloads = [...new Set(rawRequest.exportPayloads || [rawRequest.payloadName || "Customer"])];
  const results = [];
  for (const payloadName of payloads) {
    const customTable = (rawRequest.customTables || []).find((table) => table.label === payloadName) || (rawRequest.customTable?.label === payloadName ? rawRequest.customTable : null);
    const generatedName = rawRequest.jobName || jobNameForRequest({
      ...rawRequest,
      kind: "export",
      payloadName,
      customTable
    });
    results.push(await runExportJobRequest(tabId, { ...rawRequest, payloadName, customTable, jobName: generatedName }));
  }
  return { ...results[results.length - 1], results };
}

async function saveRunSnapshot(snapshot) {
  const { runSnapshots = [] } = await chrome.storage.local.get({ runSnapshots: [] });
  const next = [snapshot, ...runSnapshots.filter((item) => item?.runId !== snapshot.runId)].slice(0, 5);
  await chrome.storage.local.set({ runSnapshots: next });
}

function assertSequenceActive(tabId, runId, label) {
  const activeSequence = activeSequences.get(tabId);
  if (!activeSequence || activeSequence.runId !== runId || activeSequence.cancelled) {
    throw new Error(`${label} was stopped by the user.`);
  }
}

async function runPublish(tabId, options) {
  const task = TASKS["publish.js"];
  assertSequenceActive(tabId, options.runId, options.label || "Publishing");
  const tab = await chrome.tabs.get(tabId);
  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  assertSequenceActive(tabId, options.runId, options.label || "Publishing");
  const cancelled = activeSequences.get(tabId)?.cancelled === true;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [cancelled],
    func: (isCancelled) => {
      window.__cdpPublishCancelled = isCancelled;
    }
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["publish.js"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [options],
    func: async (publishOptions) => {
      if (typeof window.runCdpPublish !== "function") {
        throw new Error("Publish automation did not load.");
      }
      return window.runCdpPublish(publishOptions);
    }
  });
}

async function verifyPublishedJobs(tabId, options) {
  const task = TASKS["integrationStatus.js"];
  assertSequenceActive(tabId, options.runId, "Verify Published Jobs");
  const tab = await chrome.tabs.get(tabId);
  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  assertSequenceActive(tabId, options.runId, "Verify Published Jobs");
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["integrationStatus.js"]
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [options.jobNames],
    func: async (jobNames) => {
      if (typeof window.runCdpIntegrationStatusCheck !== "function") {
        throw new Error("Integration status automation did not load.");
      }
      return window.runCdpIntegrationStatusCheck({ jobNames });
    }
  });
}

async function runDataViewerStep(tabId, flow, runId) {
  const recordsPerTable = flow.recordsPerTable ?? 1;
  if (!Number.isSafeInteger(recordsPerTable) || recordsPerTable < 1) throw new Error("Records per table must be a positive whole number.");
  const sourceId = String(flow.sourceId || "").trim() || "CDP";
  const tableIds = [...new Set(flow.dataViewerTableIds || ["Customer"])];
  const tables = await resolveDataViewerTables(tabId, tableIds, flow.dataViewerOverrides || {}, flow.dataViewerParents || {});
  const tab = await chrome.tabs.get(tabId);
  await navigateAndWait(tabId, navigationUrl(tab.url, TASKS["dataViewer.js"].path, TASKS["dataViewer.js"].root));
  await activatePageAutomationRun(tabId, runId);
  await waitForPageElement(tabId, TASKS["dataViewer.js"].readySelector, 60000);
  await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: ["dataViewerClickBridge.js"] });
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["recordProfiles.js", "dataViewer.js"] });
  const [{ result: dataViewerResult }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    args: [tables.map((table) => ({ id: table.id, label: table.label, cdpTable: table.cdpTable, sourceAttribute: table.sourceAttribute, enterableFieldIds: table.enterableFieldIds, liveFields: table.liveFields, recordConfig: table.recordConfig })), { recordsPerTable, sourceId, saveRecords: Boolean(flow.saveRecords) }],
    func: async (dataViewerTables, options) => {
      if (typeof window.runCdpDataViewer !== "function") throw new Error("Data Viewer automation did not load.");
      return window.runCdpDataViewer({ tables: dataViewerTables, ...options });
    }
  });
  await appendDataViewerRunLog(dataViewerResult, tables, { recordsPerTable, sourceId, saveRecords: Boolean(flow.saveRecords) });
}

const DATA_MODEL_GROUPS = ["Profile", "Behavioral", "Transactional", "Product", "Other"];
const DATA_MODEL_ATTRIBUTE_TYPES = new Set(["array - string", "bigint", "boolean", "date", "decimal", "double", "float", "int", "smallint", "string", "text", "timestamp", "tinyint"]);

function dataModelDryRunName(group, purpose = "", entityTimestamp = entityNameTag()) {
  // This is never saved. Keep the visible name aligned with jobs/connections
  // so the drawer is easy to identify while a test is running.
  const cleanPurpose = String(purpose || "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 28);
  return [group, cleanPurpose, entityTimestamp].filter(Boolean).join("_").slice(0, 50);
}

function normalizedDataModelColumnName(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function validateDataModelColumns(columns, group) {
  if (!Array.isArray(columns) || !columns.length) throw new Error(`${group} requires at least one configured column.`);
  const usedNames = new Set();
  return columns.map((column, index) => {
    const name = String(column?.name || "").trim();
    const dataType = String(column?.dataType || "string").trim().toLowerCase();
    if (!name || name.length > 50) throw new Error(`${group} column ${index + 1} must have a name of 1–50 characters.`);
    if (!/^[a-z][a-z0-9 ]*$/i.test(name)) throw new Error(`${group} column ${name} has unsupported characters.`);
    if (!DATA_MODEL_ATTRIBUTE_TYPES.has(dataType)) throw new Error(`${group} column ${name} uses unsupported data type ${dataType}.`);
    const key = normalizedDataModelColumnName(name);
    if (!key || usedNames.has(key)) throw new Error(`${group} has duplicate column ${name}.`);
    usedNames.add(key);
    return { name, dataType };
  });
}

async function dataModelColumnsForGroup(group, columnOverrides = {}) {
  const config = await loadDataModelColumnConfig();
  const defaults = config.groups[group];
  if (!Array.isArray(defaults)) throw new Error(`No default columns are configured for ${group}.`);
  // The popup sends the complete, reviewed list for a group. This lets users
  // edit or remove JSON defaults without the runner silently adding them back.
  const configured = Array.isArray(columnOverrides?.[group])
    ? columnOverrides[group]
    : [...(config.sharedTypeColumns || []), defaults.find((column) => String(column?.name || "").toLowerCase() === "email") || { name: "Email", dataType: "string" }];
  const columns = validateDataModelColumns(configured, group);
  // Older presets may still put Email first. Keep the requested creation
  // order consistent without changing the order of other attributes.
  return [
    ...columns.filter((column) => column.name.toLowerCase() !== "email"),
    ...columns.filter((column) => column.name.toLowerCase() === "email")
  ];
}

async function runDataModelStep(tabId, runId, { purpose = "", groups = DATA_MODEL_GROUPS, saveObjects = false, attributeGroups = [], addAttributes = false, columnOverrides = {}, parentByGroup = {}, entityTimestamp = entityNameTag() } = {}) {
  const tab = await chrome.tabs.get(tabId);
  const task = TASKS["dataModel.js"];
  await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  await activatePageAutomationRun(tabId, runId);
  await waitForPageElement(tabId, task.readySelector, 60000);
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["dataModel.js"] });

  const selectedGroups = [...new Set(groups)].filter((group) => DATA_MODEL_GROUPS.includes(group));
  if (!selectedGroups.length) throw new Error("Select at least one Data Model object group.");
  const createdObjects = {};
  const configuredAttributeGroups = new Set((attributeGroups.length ? attributeGroups : (addAttributes ? selectedGroups : [])).filter((group) => DATA_MODEL_GROUPS.includes(group)));
  for (const group of selectedGroups) {
    assertSequenceActive(tabId, runId, "Data Model dry run");
    await appendRunLog(`${group}: opening Create data object.`, "info", `Data Model · ${group}`, "Click");
    let saved = false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [group],
        func: async (selectedGroup) => window.cdpDataModelOpenGroup(selectedGroup)
      });
      const name = dataModelDryRunName(group, purpose, entityTimestamp);
      const generated = await commitJetDataModelObjectName(tabId, name);
      if (generated.skipped) {
        await appendRunLog(`Skipped: ${generated.name}. ${generated.reason}`, "warn", `Data Model · ${group}`, "Skip");
        continue;
      }
      const resource = await commitJetDataModelResourceName(tabId, generated.name);
      await appendRunLog("Object name = " + generated.name + "; Object ID = " + generated.objectId + "; Resource Name = " + resource.resourceName + ".", "info", "Data Model · " + group, "Type");
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [group, generated.name],
        func: async (selectedGroup, expectedResourceName) => window.cdpDataModelValidateAndAdvance(selectedGroup, expectedResourceName)
      });
      await appendRunLog(`Object group = ${result.group}; settings page opened.`, "info", `Data Model · ${group}`, "Validate");
      if (saveObjects) {
        const [{ result: prepared }] = await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelPrepareForSave()
        });
        await appendRunLog(`Expected number of records = ${prepared.expectedRecords} million; Save enabled.`, "info", `Data Model · ${group}`, "Click");
        await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelSave()
        });
        saved = true;
        createdObjects[group] = generated.name;
        await appendRunLog("Object saved successfully.", "info", `Data Model · ${group}`, "Save");
        // Complete this object while its group/detail context is active.
        if (configuredAttributeGroups.has(group)) {
          assertSequenceActive(tabId, runId, "Data Model attribute creation");
          await appendRunLog("Adding configured " + group + " attributes to " + generated.name + ".", "info", "Data Model · " + group, "Attributes");
          await runDataModelAttributesStep(tabId, runId, {
            group,
            objectName: generated.name,
            columnOverrides,
            reuseCurrentPage: true
          });
        }

        const parentName = String(parentByGroup?.[group] || "").trim();
        if (parentName) {
          if (parentName.toLowerCase() === generated.name.toLowerCase()) {
            throw new Error(group + " cannot be its own parent object.");
          }
          assertSequenceActive(tabId, runId, "Data Model relationship creation");
          await appendRunLog("Creating relationship: " + generated.name + " → " + parentName + ".", "info", "Relationship · " + group, "Plan");
          const [{ result: relationshipResult }] = await chrome.scripting.executeScript({
            target: { tabId }, world: "MAIN", args: [group, generated.name, parentName],
            func: async (selectedGroup, childObjectName, relationshipParentName) => window.cdpDataModelCreateRelationship(selectedGroup, childObjectName, relationshipParentName)
          });
          if (!relationshipResult?.saved || !relationshipResult?.verified) {
            throw new Error("CDP did not verify the relationship " + generated.name + " → " + parentName + ".");
          }
          await appendRunLog("Relationship verified: " + generated.name + " → " + parentName + ".", "info", "Relationship · " + group, "Save");
        }
      }
    } finally {
      if (!saved) {
        await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelCancel?.()
        }).catch(() => undefined);
      }
    }
  }
  await appendRunLog(saveObjects ? "Selected Data Model objects were saved." : "Selected Data Model groups validated without saving objects.");
  return { createdObjects };
}

async function runDataModel(tabId, { purpose = "", groups = DATA_MODEL_GROUPS, saveObjects = false, attributeGroups = [], addAttributes = false, columnOverrides = {}, parentByGroup = {} } = {}) {
  if (activeSequences.has(tabId)) throw new Error("An automation flow is already running in this tab.");
  const runId = crypto.randomUUID();
  let failed = false;
  let failureDetail = "";
  const runLabel = saveObjects ? "Create Data Model Objects" : "Data Model Dry Run";
  activeSequences.set(tabId, { runId, cancelled: false, status: `Running: ${runLabel}` });
  await setE2EStatus(`Running: ${runLabel}`, tabId);
  try {
    const result = await runDataModelStep(tabId, runId, { purpose, groups, saveObjects, attributeGroups, addAttributes, columnOverrides, parentByGroup });
  } catch (error) {
    failed = true;
    failureDetail = error.message || String(error);
    if (!/stopped by the user/i.test(error.message || "")) await setE2EStatus(`Failed: ${runLabel} — ${error.message || error}`, tabId);
    throw error;
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (!failed) await setE2EStatus("", tabId);
    if (failed) await finalizeRunHistory("failed", failureDetail);
    else if (cancelled) await finalizeRunHistory("stopped");
    else await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

async function runDataModelAttributesStep(tabId, runId, { group, objectName, columnOverrides = {}, reuseCurrentPage = false } = {}) {
  if (!DATA_MODEL_GROUPS.includes(group)) throw new Error("Select a valid Data Model object group.");
  const targetObjectName = String(objectName || "").trim();
  if (!targetObjectName) throw new Error("Enter the existing Data Model object name.");
  const columns = await dataModelColumnsForGroup(group, columnOverrides);
  const task = TASKS["dataModel.js"];
  if (!reuseCurrentPage) {
    const tab = await chrome.tabs.get(tabId);
    await navigateAndWait(tabId, navigationUrl(tab.url, task.path, task.root));
  }
  await activatePageAutomationRun(tabId, runId);
  await waitForPageElement(tabId, task.readySelector, 60000);
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["dataModel.js"] });
  const [{ result: objectSearch }] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", args: [group],
    func: async (selectedGroup) => window.cdpDataModelPrepareObjectSearch(selectedGroup)
  });
  await typeJetInput(tabId, objectSearch?.inputId || "search-input-text|input", targetObjectName,
    "Data Model object search", "Enter");
  await appendRunLog(`Target object = ${targetObjectName}; ${columns.length} attributes configured.`, "info", `Attributes · ${group}`, "Plan");
  for (const column of columns) {
    assertSequenceActive(tabId, runId, "Data Model attribute creation");
    let attributeSaved = false;
    let attributeDrawerOpened = false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [group, targetObjectName],
        func: async (selectedGroup, selectedObjectName) => window.cdpDataModelOpenAttribute(selectedGroup, selectedObjectName, true)
      });
      attributeDrawerOpened = true;
      const attribute = await commitJetDataModelAttributeName(tabId, column.name);
      if (attribute.skipped) {
        await appendRunLog(
          `Skipped: an attribute named ${column.name} already exists or CDP rejected the duplicate name.`,
          "warn",
          `Attributes · ${targetObjectName} · ${column.name}`,
          "Skip"
        );
        await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelCancelAttribute?.()
        });
        attributeSaved = true; // drawer is intentionally closed; continue to the next configured attribute.
        continue;
      }
      await appendRunLog(`${column.name}: Attribute ID = ${attribute.attributeId}.`, "info", `Attributes · ${targetObjectName} · ${column.name}`, "Type");
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [column.dataType],
        func: async (dataType) => window.cdpDataModelSelectAttributeDataType(dataType)
      });
      await appendRunLog(`Data type = ${column.dataType}.`, "info", `Attributes · ${targetObjectName} · ${column.name}`, "Select");
      await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: async () => window.cdpDataModelSaveAttribute()
      });
      attributeSaved = true;
      await appendRunLog("Attribute saved successfully.", "info", `Attributes · ${targetObjectName} · ${column.name}`, "Save");
    } finally {
      // Leave a failed attribute drawer open so its CDP validation message is
      // visible to the user. Closing it used to make a validation timeout look
      // like an ordinary successful completion and obscured the root cause.
      if (!attributeSaved && !attributeDrawerOpened) {
        await chrome.scripting.executeScript({
          target: { tabId }, world: "MAIN",
          func: async () => window.cdpDataModelCancelAttribute?.()
        }).catch(() => undefined);
      }
    }
  }
  await appendRunLog(`Attributes saved for ${targetObjectName}.`, "info", `Attributes · ${group}`, "Complete");
}

async function runDataModelAttributes(tabId, options = {}) {
  if (activeSequences.has(tabId)) throw new Error("An automation flow is already running in this tab.");
  const runId = crypto.randomUUID();
  let failed = false;
  let failureDetail = "";
  activeSequences.set(tabId, { runId, cancelled: false, status: "Running: Add New Attributes" });
  await setE2EStatus("Running: Add New Attributes", tabId);
  try {
    await runDataModelAttributesStep(tabId, runId, options);
  } catch (error) {
    failed = true;
    failureDetail = error.message || String(error);
    if (!/stopped by the user/i.test(error.message || "")) await setE2EStatus(`Failed: Add New Attributes — ${error.message || error}`, tabId);
    throw error;
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (!failed) await setE2EStatus("", tabId);
    if (failed) await finalizeRunHistory("failed", failureDetail);
    else if (cancelled) await finalizeRunHistory("stopped");
    else await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

async function runConfiguredFlow(tabId, flow = {}) {
  if (activeSequences.has(tabId)) throw new Error("An E2E flow is already running in this tab.");
  const entityTimestamp = entityNameTag();
  const selectedSteps = new Set(flow.steps || ["dataViewer", "source", "destination", "export", "import", "publish", "verify"]);
  const usesTransfer = [...selectedSteps].some((step) => ["source", "destination", "export", "import", "responsys"].includes(step));
  const selectedTemplate = usesTransfer ? await selectedTransferTemplate(flow.templateId) : null;
  const template = selectedTemplate ? { ...selectedTemplate, connectionPurpose: flow.connectionPurpose || "" } : null;
  const connectionSequence = template ? await nextConnectionSequence(template.id) : 0;
  if (template) {
    connectionSequence.entityTag = entityTimestamp;
    connectionSequence.jobTag = entityTimestamp.toUpperCase();
  }
  const sourceConfig = template ? connectionRuntime(template, "source", connectionSequence) : null;
  // Responsys uses its own file and mapping contract, so it always creates a
  // dedicated Source instead of reusing the generic Import Source.
  const responsysSourceConfig = template ? responsysSourceRuntime(template, connectionSequence) : null;
  const destinationConfig = template ? connectionRuntime(template, "destination", connectionSequence) : null;
  const routeStates = new Map();
  let routeOrdinal = 1;
  routeStates.set(template?.id, { template, sequence: connectionSequence, source: sourceConfig, destination: destinationConfig, defaultRoute: true });
  const routeTemplateFor = async (label, explicitTemplateId = "") => {
    const templateId = explicitTemplateId || flow.transferRoutes?.[label] || template?.id;
    if (!templateId) throw new Error(`Select a transfer template for ${label}.`);
    if (routeStates.has(templateId)) return routeStates.get(templateId);
    const routeTemplate = await selectedTransferTemplate(templateId);
    if (routeTemplate.kind === "direct") throw new Error(`${routeTemplate.name} is a direct application template and cannot be used for file transfer jobs.`);
    const sequence = { ...connectionSequence, ordinal: ++routeOrdinal };
    const state = { template: { ...routeTemplate, connectionPurpose: flow.connectionPurpose || "" }, sequence, source: null, destination: null, defaultRoute: false };
    state.source = connectionRuntime(state.template, "source", sequence);
    state.destination = connectionRuntime(state.template, "destination", sequence);
    routeStates.set(templateId, state);
    return state;
  };
  const ensureRouteConnection = async (route, side) => {
    const config = route[side];
    const readyKey = `${side}Ready`;
    if (route[readyKey]) return config;
    if (route.defaultRoute) { route[readyKey] = true; return config; }
    const definition = side === "source"
      ? { filename: "source.js", label: `Create Source · ${route.template.name}`, saveSelector: "#create-source-saveClose" }
      : { filename: "destination.js", label: `Create Destination · ${route.template.name}`, saveSelector: "#dst-saveClose-btn" };
    await setE2EStatus(`Running: ${definition.label}`, tabId);
    await runTask(tabId, definition.filename, { runId, stepId: `${definition.filename}:${route.template.id}`, saveSelector: definition.saveSelector }, undefined, undefined, undefined, undefined, config);
    await waitForStep(tabId, definition.label, definition.saveSelector, runId, `${definition.filename}:${route.template.id}`);
    await rememberConnectionSequence(route.template.id, route.sequence);
    const saved = await captureCreatedEntity(tabId, runMetadata, definition.filename, config.name);
    if (saved?.name) config.name = saved.name;
    route[readyKey] = true;
    runSnapshot.connections[`${side}:${route.template.name}`] = config.name;
    await saveRunSnapshot({ ...runSnapshot, connections: { ...runSnapshot.connections } });
    return config;
  };
  // A job always owns its prerequisite connection, even when the user did not
  // select the connection card explicitly in a custom flow.
  if (selectedSteps.has("import")) selectedSteps.add("source");
  if (selectedSteps.has("responsys")) selectedSteps.add("responsysSource");
  if (selectedSteps.has("export")) selectedSteps.add("destination");
  const stepDefinitions = [
    { id: "dataModel", label: "Data Models" },
    { id: "dataModelAttributes", label: "Add New Attributes" },
    { id: "dataViewer", label: "Data Viewer" },
    { id: "source", filename: "source.js", label: "Create Source", saveSelector: "#create-source-saveClose" },
    { id: "responsysSource", filename: "source.js", label: "Create Responsys Source", saveSelector: "#create-source-saveClose" },
    { id: "destination", filename: "destination.js", label: "Create Destination", saveSelector: "#dst-saveClose-btn" },
    { id: "export", filename: "exportJob.js", label: "Create Export Job", saveSelector: "#saveNclose-create-job" },
    { id: "import", filename: "importContacts.js", label: "Create Import Job", saveSelector: "#saveNclose-create-job" },
    { id: "responsys", filename: "importJob.js", label: "Create Responsys Import", saveSelector: "#saveNclose-create-job" }
  ].filter((step) => selectedSteps.has(step.id));
  const selectedJobSteps = stepDefinitions.filter((step) => step.id === "export" || step.id === "import" || step.id === "responsys");
  if (!stepDefinitions.length && !selectedSteps.has("publish") && !selectedSteps.has("verify")) {
    throw new Error("Select at least one flow step.");
  }
  if (selectedSteps.has("import") && !(flow.importTableIds || []).length && !(flow.importCustomTables || []).length) {
    throw new Error("Select at least one import table.");
  }

  const runId = crypto.randomUUID();
  const runMetadata = {
    startedAt: Date.now(),
    exportScheduledAt: null,
    jobNames: [],
    creations: {
      sources: [],
      destinations: [],
      jobs: {
        export: null,
        import: null,
        responsys: null
      }
    }
  };
  const useLegacyStagger = Boolean(flow.staggerJobs && flow.exportSchedule?.schedulerUi === "legacy" && flow.importSchedule?.schedulerUi === "legacy");
  sequenceStepState.set(runId, new Set());
  activeSequences.set(tabId, { runId, cancelled: false });
  await chrome.storage.local.set({ e2eRun: runMetadata });
  const runSnapshot = {
    runId,
    startedAt: runMetadata.startedAt,
    origin: flow.origin || "custom-flow",
    template: template ? { id: template.id, name: template.name, sourceType: template.sourceType, destinationType: template.destinationType, fileContract: template.fileContract || {} } : null,
    purpose: flow.connectionPurpose || "",
    steps: [...selectedSteps],
    connections: {},
    jobs: []
  };
  await saveRunSnapshot(runSnapshot);
  await chrome.storage.local.set({ activeRunSnapshotId: runId });
  let completed = false;
  let failure;
  const createdDataModelObjects = {};
  try {
    for (const step of stepDefinitions) {
      await setE2EStatus(`Running: ${step.label}`, tabId);
      if (step.id === "dataModel") {
        const result = await runDataModelStep(tabId, runId, { purpose: flow.connectionPurpose || "", groups: flow.dataModelGroups, saveObjects: Boolean(flow.saveDataModelObjects), attributeGroups: flow.dataModelAttributeGroups || [], addAttributes: Boolean(flow.addDataModelAttributes), columnOverrides: flow.dataModelColumnOverrides || {}, parentByGroup: flow.dataModelParents || {}, entityTimestamp });
        Object.assign(createdDataModelObjects, result.createdObjects || {});
        continue;
      }
      if (step.id === "dataModelAttributes") {
        await runDataModelAttributesStep(tabId, runId, { group: flow.dataModelAttributeGroup, objectName: flow.dataModelAttributeObjectName || createdDataModelObjects[flow.dataModelAttributeGroup], columnOverrides: flow.dataModelColumnOverrides || {} });
        continue;
      }
      if (step.id === "dataViewer") {
        await runDataViewerStep(tabId, flow, runId);
        continue;
      }
      if (step.id === "export" && useLegacyStagger && !runMetadata.exportScheduledAt) {
        const exportHour = new Date();
        exportHour.setHours(exportHour.getHours() + 1, 0, 0, 0);
        runMetadata.exportScheduledAt = exportHour.getTime();
      }
      const schedule = step.id === "export"
        ? (useLegacyStagger ? { ...flow.exportSchedule, scheduledAt: runMetadata.exportScheduledAt } : normalizeNewSchedulerConfig(flow.exportSchedule, "export"))
        : step.id === "import"
          ? (useLegacyStagger ? { ...flow.importSchedule, scheduledAt: runMetadata.exportScheduledAt + 3600000 } : normalizeNewSchedulerConfig(flow.importSchedule, "import"))
          : step.id === "responsys"
            ? normalizeNewSchedulerConfig(flow.responsysSchedule, "import")
            : undefined;
      if (step.id === "export" || step.id === "import" || step.id === "responsys") {
        await appendRunLog(`${step.label} scheduler: ${schedule.schedulerUi === "new" ? `New · ${schedule.frequency} · ${schedule.timeMode} · ${schedule.specificPreset || schedule.intervalStartPreset}` : `Legacy · ${schedule.mode} · ${schedule.frequency}`}.`, "info", `Scheduler · ${step.label}`, "Configure");
      }
      if (step.id === "export" || step.id === "import" || step.id === "responsys") {
        const monitor = { runId, stepId: step.filename, saveSelector: step.saveSelector };
        const recordJob = async (result) => { runSnapshot.jobs.push({ kind: step.id, variant: result.request.variant || "generic", name: result.saved?.name || result.request.jobName, connectionName: result.request.connection?.name || "", payloadName: result.request.payloadName || "", tableIds: result.request.tableIds || [], templateId: result.request.template?.id || "", templateName: result.request.template?.name || "", scheduler: result.request.schedule }); await saveRunSnapshot({ ...runSnapshot, jobs: [...runSnapshot.jobs] }); };
        if (step.id === "export") {
          for (const payloadName of [...new Set(flow.exportPayloads || [flow.exportPayloadName || "Customer"])]) {
            const route = await routeTemplateFor(payloadName);
            const connection = await ensureRouteConnection(route, "destination");
            const customTable = (flow.exportCustomTables || []).find((item) => item.label === payloadName) || (flow.exportCustomTable?.label === payloadName ? flow.exportCustomTable : null);
            await recordJob(await runExportJobRequest(tabId, { origin: flow.origin || "custom-flow", runId, template: route.template, connectionSequence: route.sequence, connection, schedule, filterRecords: flow.exportFilterRecords, payloadType: flow.exportPayloadType, payloadName, customTable, jobName: flow.exportJobName, description: flow.exportDescription, notification: flow.notification, monitor, runMetadata }));
          }
        } else if (step.id === "responsys") {
          await recordJob(await runImportJobRequest(tabId, { origin: flow.origin || "custom-flow", runId, template, connectionSequence, connection: responsysSourceConfig, schedule, variant: "responsys", tableIds: [], customTables: [], mappingMode: "combined", jobName: flow.importJobName, description: flow.importDescription, notification: flow.notification, monitor, runMetadata, allowImportFallback: flow.allowImportFallback }));
        } else if (flow.importMappingMode === "separateJobs") {
          const catalog = await loadTableCatalog();
          const entries = [...(flow.importTableIds || []).map((tableId) => ({ label: catalog.importsById[tableId]?.label || tableId, tableIds: [tableId], customTables: [] })), ...(flow.importCustomTables || []).map((customTable) => ({ label: customTable.label || customTable.cdpTable, tableIds: [], customTables: [customTable] }))];
          for (const entry of entries) { const route = await routeTemplateFor(entry.label); const connection = await ensureRouteConnection(route, "source"); await recordJob(await runImportJobRequest(tabId, { origin: flow.origin || "custom-flow", runId, template: route.template, connectionSequence: route.sequence, connection, schedule, variant: flow.importVariant || "generic", ...entry, mappingMode: "combined", jobName: flow.importJobName, description: flow.importDescription, notification: flow.notification, monitor, runMetadata, allowImportFallback: flow.allowImportFallback })); }
        } else {
          const route = await routeTemplateFor("__singleImport__", flow.singleImportTemplateId || template.id);
          const connection = await ensureRouteConnection(route, "source");
          await recordJob(await runImportJobRequest(tabId, { origin: flow.origin || "custom-flow", runId, template: route.template, connectionSequence: route.sequence, connection, schedule, variant: flow.importVariant || "generic", tableIds: flow.importTableIds || (flow.importCustomTables?.length ? [] : ["customer", "contactPoint"]), customTables: flow.importCustomTables || [], mappingMode: flow.importMappingMode || "combined", jobName: flow.importJobName, description: flow.importDescription, notification: flow.notification, monitor, runMetadata, allowImportFallback: flow.allowImportFallback }));
        }
        continue;
      }
      const connectionConfig = step.id === "source"
        ? sourceConfig
        : step.id === "responsysSource"
          ? responsysSourceConfig
          : step.id === "destination"
            ? destinationConfig
            : undefined;
      await runTask(tabId, step.filename, {
        runId,
        stepId: step.filename,
        saveSelector: step.saveSelector
      }, undefined, undefined, undefined, undefined, connectionConfig);
      await waitForStep(tabId, step.label, step.saveSelector, runId, step.filename);
      if (step.id === "source" || step.id === "destination") {
        await rememberConnectionSequence(template.id, connectionSequence);
      }
      const savedEntity = await captureCreatedEntity(
        tabId,
        runMetadata,
        step.filename,
        connectionConfig?.name || ""
      );
      // The connection form may have added a suffix only after CDP rejected a
      // duplicate name. Carry that actual saved name into the later job's
      // source/destination selector.
      if (step.id === "source" && savedEntity?.name) sourceConfig.name = savedEntity.name;
      if (step.id === "responsysSource" && savedEntity?.name) responsysSourceConfig.name = savedEntity.name;
      if (step.id === "destination" && savedEntity?.name) destinationConfig.name = savedEntity.name;
      if (step.id === "source") routeStates.get(template?.id).sourceReady = true;
      if (step.id === "destination") routeStates.get(template?.id).destinationReady = true;
      if (step.id === "source" || step.id === "responsysSource" || step.id === "destination") {
        runSnapshot.connections[step.id] = savedEntity?.name || connectionConfig?.name || "";
        await saveRunSnapshot({ ...runSnapshot, connections: { ...runSnapshot.connections } });
      }
    }
    if (selectedSteps.has("publish")) {
      if (!selectedJobSteps.length || !runMetadata.jobNames.length) throw new Error("Publish requires an Export or Import job in the flow.");
      if (activeSequences.get(tabId)?.cancelled) throw new Error("Publishing was stopped by the user.");
      await setE2EStatus("Running: Publish Created Jobs", tabId);
      await runPublish(tabId, { mode: "e2e", ...runMetadata, runId, label: "Publish Created Jobs" });
    }
    if (selectedSteps.has("verify")) {
      if (!selectedSteps.has("publish")) throw new Error("Verify Published requires Publish to be selected.");
      await setE2EStatus("Running: Verify Published Jobs", tabId);
      await verifyPublishedJobs(tabId, { jobNames: runMetadata.jobNames, runId });
    }
    completed = true;
  } catch (error) {
    failure = error;
    console.error("CDP flow failed", error);
    await setE2EStatus(`Failed: ${error.message || error}`, tabId);
    throw error;
  } finally {
    sequenceStepState.delete(runId);
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (completed || cancelled) {
      await setE2EStatus("", tabId);
      await chrome.storage.local.remove("e2eRun");
    }
    if (failure) await finalizeRunHistory("failed", failure.message || String(failure));
    else if (cancelled) await finalizeRunHistory("stopped");
    else if (completed) await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

async function runFullSequence(tabId, templateId, connectionPurpose) {
  return runConfiguredFlow(tabId, {
    origin: "sanity",
    templateId,
    connectionPurpose,
    steps: ["dataModel", "dataViewer", "source", "destination", "export", "import", "responsys", "publish", "verify"],
    dataModelGroups: ["Profile"],
    dataModelAttributeGroups: ["Profile"],
    saveDataModelObjects: true,
    dataViewerTableIds: ["Customer", "ContactPoint"],
    recordsPerTable: 1,
    sourceId: "UI",
    saveRecords: true,
    importTableIds: ["customer", "contactPoint"],
    exportPayloadName: "Customer",
    exportSchedule: { schedulerUi: "new", frequency: "Daily", timeMode: "specific", specificPreset: "in15" },
    importSchedule: { schedulerUi: "new", frequency: "Daily", timeMode: "specific", specificPreset: "in30" },
    responsysSchedule: { schedulerUi: "new", frequency: "Daily", timeMode: "specific", specificPreset: "in30" },
    staggerJobs: true,
    allowImportFallback: true
  });
}

async function runPublishAll(tabId) {
  if (activeSequences.has(tabId)) throw new Error("An E2E flow is already running in this tab.");
  const runId = crypto.randomUUID();
  activeSequences.set(tabId, { runId, cancelled: false });
  await setE2EStatus("Running: Publish All Data Feeds", tabId);
  let completed = false;
  let failure;
  try {
    await runPublish(tabId, { mode: "all", runId, label: "Publish All Data Feeds" });
    completed = true;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    await setE2EStatus("", tabId);
    if (failure) await finalizeRunHistory("failed", failure.message || String(failure));
    else if (cancelled) await finalizeRunHistory("stopped");
    else if (completed) await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

function dataViewerRecordConfigFor(tableName, defaults, overrides, inheritCustomerValues = false) {
  const base = defaults.tables?.[tableName] || {};
  const override = overrides && typeof overrides === "object" ? overrides[tableName] : null;
  const customerOverrideValues = { ...(overrides?.Customer?.values || {}) };
  const customerValues = inheritCustomerValues && tableName === "ContactPoint"
    ? { ...(defaults.tables?.Customer?.values || {}), ...customerOverrideValues }
    : {};
  const contactPointValues = { ...(override?.values || {}) };
  const inheritedCustomerEmail = customerValues.Email;
  if (inheritCustomerValues && tableName === "ContactPoint" && inheritedCustomerEmail) {
    // A Customer + ContactPoint run represents one related person. Reuse the
    // corresponding primary Customer Email for ContactPoint, including lists.
    contactPointValues.Email = inheritedCustomerEmail;
  }
  return {
    ...base,
    values: { ...(base.values || {}), ...customerValues, ...contactPointValues, ...(tableName === "Customer" ? customerOverrideValues : {}) },
    relationships: { ...(base.relationships || {}), ...(override?.relationships || {}) }
  };
}


async function resolveDataViewerTables(tabId, selections, overrides = {}, parentByTable = {}) {
  const catalog = await loadTableCatalog();
  const staticTables = catalog.dataViewerTables.map((name) => ({
    id: name,
    label: name,
    cdpTable: name,
    tableId: name,
    sourceAttribute: `Source${String(name).replace(/[^A-Za-z0-9]/g, "")}ID`,
    isCustom: false
  }));
  const requested = [...new Map((selections || []).map((entry) => {
    const key = typeof entry === "string" ? entry : entry?.id || entry?.tableId || entry?.cdpTable;
    return [String(key || ""), entry];
  })).values()];
  if (!requested.length) throw new Error("Select at least one Data Viewer table.");
  let liveTables = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      liveTables = await loadLiveDataViewerTables(tabId);
    } catch (error) {
      if (attempt === 6) console.warn("Could not load live Data Viewer metadata", error);
      break;
    }
    const available = new Set([...staticTables, ...liveTables].flatMap((table) => [String(table.id).toLowerCase(), String(table.label).toLowerCase()]));
    const allPresent = requested.every((entry) => {
      const id = typeof entry === "string" ? entry : entry?.id || entry?.tableId || entry?.cdpTable;
      const label = typeof entry === "string" ? entry : entry?.label || entry?.cdpTable || id;
      return available.has(String(id || "").toLowerCase()) || available.has(String(label || "").toLowerCase());
    });
    if (allPresent || attempt === 6) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const byId = new Map([...staticTables, ...liveTables].map((table) => [table.id, table]));
  const byName = new Map([...staticTables, ...liveTables].map((table) => [String(table.label).toLowerCase(), table]));

  const resolved = [];
  for (const request of requested) {
    const rawId = typeof request === "string" ? request : request?.id || request?.tableId || request?.cdpTable;
    const rawName = typeof request === "string" ? request : request?.label || request?.cdpTable || rawId;
    const base = byId.get(String(rawId)) || byName.get(String(rawName).toLowerCase());
    if (!base) throw new Error(`Data Viewer object "${rawName}" is not available in the current DW metadata.`);
    const table = { ...base };
    const effectiveOverrides = { ...overrides };
    if (overrides?.[table.id] && !effectiveOverrides[table.cdpTable]) effectiveOverrides[table.cdpTable] = overrides[table.id];
    if (liveTables.some((item) => item.id === table.id)) {
      const fields = await loadLiveDataViewerFields(tabId, table);
      if (!fields.length) throw new Error(`CDP did not return columns for ${table.cdpTable}.`);
      table.liveFields = fields;
      table.enterableFieldIds = fields.filter((field) => !field.systemAttribute).map((field) => field.fieldId);
      table.parentTable = String(parentByTable?.[table.id] || parentByTable?.[table.cdpTable] || parentTableFromMetadataFields(fields) || "").trim();
    }
    table.recordConfig = dataViewerRecordConfigFor(table.cdpTable, await loadDataViewerRecordConfig(), effectiveOverrides,
      requested.some((entry) => String(typeof entry === "string" ? entry : entry?.label || entry?.cdpTable) === "Customer")
      && requested.some((entry) => String(typeof entry === "string" ? entry : entry?.label || entry?.cdpTable) === "ContactPoint"));
    resolved.push(table);
  }

  // Custom children can be inserted safely without forcing the user to select
  // Customer or Account manually. Add only the needed parent once per sequence.
  for (const child of [...resolved]) {
    const parentName = /^(Customer|Account)$/i.test(child.parentTable || "") ? child.parentTable : "";
    if (!parentName || resolved.some((table) => table.cdpTable.toLowerCase() === parentName.toLowerCase())) continue;
    const parent = staticTables.find((table) => table.cdpTable.toLowerCase() === parentName.toLowerCase());
    if (parent) {
      parent.recordConfig = dataViewerRecordConfigFor(parent.cdpTable, await loadDataViewerRecordConfig(), overrides, false);
      resolved.unshift(parent);
    }
  }
  const parentFirst = (table) => /^(Customer|Account)$/i.test(table.cdpTable) ? 0 : 1;
  return resolved.sort((left, right) => parentFirst(left) - parentFirst(right));
}


function recordEmailForSequence(sequence) {
  const recordNumber = Math.max(1, Number.parseInt(sequence, 10) || 1);
  const seededEmails = [
    "jagannath.patil@oracle.com",
    "jagan.test01@gmail.com",
    "jagan.test01@yahoo.com",
    "jagan.test02@gmail.com",
    "jagan.test02@yahoo.com"
  ];
  if (recordNumber <= seededEmails.length) return seededEmails[recordNumber - 1];
  return `jagan.record.${Date.now().toString(36)}${recordNumber}@example.com`;
}

function apiDummySourceKey(sequence, runDate = new Date()) {
  const pad = (value, width) => String(value).padStart(width, "0");
  const datePart = `${pad(runDate.getDate(), 2)}${pad(runDate.getMonth() + 1, 2)}${pad(runDate.getFullYear() % 100, 2)}`;
  return `${datePart}${pad(Math.max(1, Number(sequence) || 1), 3)}`;
}

function apiValueForLiveType(value, field) {
  const dataType = String(field?.dataType || "string").toLowerCase();
  if (/bool/.test(dataType)) return value === true || /^(true|y|yes|1)$/i.test(String(value));
  if (/bigint/.test(dataType)) {
    const exact = String(value);
    if (!/^-?\d+$/.test(exact) || BigInt(exact) < -(1n << 63n) || BigInt(exact) > (1n << 63n) - 1n) throw new Error(`${field.fieldId} is outside signed 64-bit range.`);
    return exact;
  }
  if (/decimal/.test(dataType)) {
    const exact = String(value);
    if (!/^-?\d+(?:\.\d+)?$/.test(exact)) throw new Error(`${field.fieldId} is not a valid decimal.`);
    return exact;
  }
  if (/(?:int|long|decimal|double|float|number)/.test(dataType)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  // CDP MAP<STRING, STRING> attributes must be JSON objects. A plain string
  // is accepted by JavaScript but is not a valid map value for the stream API.
  if (/map/.test(dataType)) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return { value: String(value ?? "") };
  }
  if (/(?:array|list|collection)/.test(dataType)) return Array.isArray(value) ? value : [value];
  return value;
}

function apiSupportedSourceField(field, sourceAttribute) {
  const key = importFieldKey(field);
  if (!/^source.+id$/i.test(key)) return true;
  const allowed = new Set([
    "sourceid",
    importFieldKey({ fieldId: sourceAttribute }),
    "sourcecustomerid",
    "sourceaccountid",
    "sourcecontactpointid"
  ]);
  // Do not fabricate values for unrelated standard fields such as
  // SourceAppID, SourcePushID, or SourceUserID. Only the object source key
  // and supported Customer/Account/ContactPoint relationship keys are sent.
  return allowed.has(key);
}

function apiFullPayloadField(field, sourceAttribute) {
  const dataType = String(field?.dataType || "string").toLowerCase();
  // Only ARRAY<STRING> has a known, safe stream shape. Other nested contracts
  // vary by tenant and must not be guessed from their display labels.
  if (/(?:array|list|collection)/.test(dataType) && field?.elementDataType !== "string") return false;
  if (/map/.test(dataType)) return false;
  // isApiManagedField has already removed created/modified audit columns.
  // Other timestamp/TS business attributes are valid scalar payload fields and
  // apiRecordFieldValue supplies each with a current ISO timestamp.
  return apiSupportedSourceField(field, sourceAttribute);
}

function apiRecordFieldValue(field, table, sourceId, sequence, recordConfig = {}, runDate = new Date(), position = 1, count = 1) {
  const fieldId = String(field?.fieldId || "");
  const displayName = String(field?.displayName || fieldId);
  const configured = recordConfig.values?.[fieldId] ?? recordConfig.values?.[displayName];
  const configuredValue = typeof configured === "object" && configured !== null ? configured.value : configured;
  const normalized = importFieldKey(field);
  const timestampDate = new Date(Date.now() + (sequence - 1) * 60_000);
  const date = timestampDate.toISOString().slice(0, 10);
  // CDP accepts business timestamp attributes in UTC as
  // `YYYY-MM-DD HH:mm:ss` (not the ISO `T` separator form). The Data Viewer
  // subsequently renders the stored epoch in the browser's local timezone.
  const timestamp = [
    timestampDate.getUTCFullYear(),
    String(timestampDate.getUTCMonth() + 1).padStart(2, "0"),
    String(timestampDate.getUTCDate()).padStart(2, "0")
  ].join("-") + " " + [
    String(timestampDate.getUTCHours()).padStart(2, "0"),
    String(timestampDate.getUTCMinutes()).padStart(2, "0"),
    String(timestampDate.getUTCSeconds()).padStart(2, "0")
  ].join(":");
  const typed = (value) => apiValueForLiveType(value, field);
  const profileValue = cdpRecordProfiles.value(normalized, { position, count, sequence, runDate });
  // SourceID identifies the CDP stream. Keep it stable even when a saved
  // record configuration contains an older override.
  if (normalized === "sourceid") return "CDP";
  if (/^source.+id$/i.test(normalized)) return cdpRecordProfiles.sourceKey(sequence, runDate, position, count);
  if (profileValue !== undefined) return typed(profileValue);
  // Customer birth components are real calendar values, not generic numeric
  // defaults. Keep them aligned with the generated BirthDate for this record.
  if (normalized === "birthdate") return typed(date);
  if (normalized === "birthday") return typed(timestampDate.getDate());
  if (normalized === "birthmonth") return typed(timestampDate.getMonth() + 1);
  if (normalized === "birthyear") return typed(timestampDate.getFullYear());
  if (normalized === "properties") return typed({ category: "customer", source: "CDP" });
  // EmailFrequency is a choice field, not an email-address field.
  if (normalized === "emailfrequency") return typed("Every day");
  if (/email/i.test(normalized) && (configuredValue === undefined || configuredValue === "" || configuredValue === "jagannath.patil@oracle.com" || configuredValue === "{{email}}")) return typed(cdpRecordProfiles.value("email", { position, count, sequence, runDate }) || recordEmailForSequence(sequence));
  if (configuredValue !== undefined && configuredValue !== "") {
    const substitute = (value) => String(value)
      .replace(/\{\{sourceId\}\}/g, sourceId)
      .replace(/\{\{sequence\}\}/g, String(sequence))
      .replace(/\{\{email\}\}/g, recordEmailForSequence(sequence))
      .replace(/\{\{date\}\}/g, date)
      .replace(/\{\{timestamp\}\}/g, timestamp);
    if (field?.dataType === "array" && field?.elementDataType === "string") {
      return (Array.isArray(configuredValue) ? configuredValue : String(configuredValue).split(","))
        .map((value) => substitute(value).trim()).filter(Boolean);
    }
    return typed(substitute(configuredValue));
  }
  const pick = (values) => values[(sequence - 1) % values.length];
  const modelGroup = String(table.cdpTable || table.label || "").split(/[_\s-]/)[0].toLowerCase();
  const typeExamples = {
    profile: { tags: ["Loyalty member", "Email subscriber"], note: "Customer prefers product updates by email.", number: 25, amount: 149.95 },
    behavioral: { tags: ["Product view", "Web visit"], note: "Customer viewed the Oracle CX product page.", number: 3, amount: 4.75 },
    transactional: { tags: ["Online order", "Paid"], note: "Order completed through the web store.", number: 2, amount: 249.95 },
    product: { tags: ["Cloud service", "Subscription"], note: "Annual Oracle Cloud subscription.", number: 40, amount: 99.95 },
    other: { tags: ["Enterprise account", "Renewal"], note: "Account renewal is scheduled this quarter.", number: 12, amount: 499.95 }
  };
  const example = typeExamples[modelGroup] || typeExamples.other;
  const typeCoverageValues = {
    arraystringvalues: example.tags,
    bigintvalue: 1000000 + sequence,
    booleanvalue: true,
    datevalue: date,
    decimalvalue: Number((example.amount + sequence).toFixed(2)),
    doublevalue: Number((0.8 + sequence / 1000).toFixed(3)),
    floatvalue: Number((4 + sequence / 10).toFixed(1)),
    intvalue: example.number + sequence,
    smallintvalue: 2 + sequence % 5,
    textvalue: example.note,
    timestampvalue: timestamp,
    tinyintvalue: sequence % 2
  };
  if (Object.hasOwn(typeCoverageValues, normalized)) return typed(typeCoverageValues[normalized]);
  const semanticValues = {
    firstname: ["Jagan", "Anika", "Rahul", "Meera", "Arjun"],
    middlename: ["Kumar", "Devi", "Raj", "Priya", "Singh"],
    lastname: ["Patil", "Sharma", "Nair", "Iyer", "Rao"],
    customertype: ["B2B", "B2C"], preferredchannel: ["Email", "SMS", "Push"],
    channel: ["Email", "SMS", "Push", "Web"], channeltype: ["Email", "SMS", "Push"],
    emailfrequency: ["Every day"], businessinterestarea: ["Oracle Cloud"],
    lifecyclestage: ["Prospect", "Lead", "Customer", "Advocate"], loyaltytier: ["Gold", "Silver", "Platinum"],
    industry: ["Technology", "Financial Services", "Retail", "Healthcare"], status: ["Active", "Qualified", "Engaged"],
    primarylanguage: ["English", "Hindi", "Spanish"], country: ["United States", "India", "United Kingdom"],
    countrycode: ["US", "IN", "GB"], region: ["North America", "Asia Pacific", "Europe"],
    city: ["Redwood City", "Bengaluru", "London"], state: ["CA", "KA", "London"], zipcode: ["94065", "560001", "EC1A1BB"],
    postalcode: ["94065", "560001", "EC1A1BB"], addressline1: ["500 Oracle Parkway", "100 Innovation Drive", "1 Cloud Street"],
    companyname: ["Oracle", "Acme Technologies", "Northwind Traders"], organizationname: ["Oracle", "Acme Technologies", "Northwind Traders"],
    jobtitle: ["Software Engineer", "Marketing Manager", "Product Analyst", "Sales Director"],
    jobdepartment: ["Engineering", "Marketing", "Product", "Sales"], jobspeciality: ["Platform", "Demand Generation", "Analytics", "Enterprise Sales"],
    productname: ["Oracle Cloud Subscription", "Oracle CX Platform", "Oracle Analytics Cloud"],
    productcode: ["OCI-STD-001", "OCX-PRM-002", "OAC-ENT-003"], productcategory: ["Cloud Services", "Customer Experience", "Analytics"],
    currencycode: ["USD", "INR", "GBP"], transactionstatus: ["Completed", "Processing", "Approved"],
    eventname: ["Product Viewed", "Form Submitted", "Webinar Registered", "Content Downloaded", "Demo Requested"],
    campaigncode: ["CMP-NURTURE-1001", "CMP-ADOPTION-1002", "CMP-EXPANSION-1003", "CMP-WEBINAR-1004", "CMP-RENEWAL-1005"],
    pageurl: ["https://www.oracle.com/cloud/", "https://www.oracle.com/cx/", "https://www.oracle.com/analytics/"],
    browser: ["Chrome", "Safari", "Firefox"], browsertype: ["Desktop", "Mobile"], devicetype: ["Desktop", "Mobile"],
    operatingsystem: ["macOS", "Windows", "iOS"], platformtype: ["Web", "Mobile App"], isp: ["Oracle", "Comcast", "Airtel"],
    gender: ["M", "F"], prefix: ["Mr", "Ms"], suffix: ["Jr", "Sr"], title: ["Engineer", "Manager"],
    mobilecarrier: ["Verizon", "Airtel", "Vodafone"], mobilecode: ["WELCOME10", "CX2026", "MEMBER20"],
    mobilekeyword: ["JOIN", "UPDATES", "OFFERS"], platformkey: ["WEB-PORTAL", "MOBILE-APP", "LOYALTY-HUB"],
    optoutreason: ["Preference update", "Email frequency change", "Channel preference"],
    nonsalesflag: ["False"], originalchannel: ["Email"], peerrank: ["High"], region: ["NA"], type: ["Guest"],
    oktocall: ["Y"], oktoemail: ["Y"], oktomail: ["Y"], oktonotify: ["Y"], oktotext: ["Y"],
    oktoshareinternally: ["Y"], oktosharewith3rdparties: ["Y"],
    description: ["Customer engagement profile", "Marketing preference record", "Product interest record"]
  };
  if (normalized === "transactionid") return typed(`ORD-${apiDummySourceKey(sequence, runDate)}`);
  if (normalized === "orderstatus") return typed("Completed");
  if (normalized === "accountname") return typed("Northwind Enterprise");
  if (normalized === "accounttier") return typed("Gold");
  if (normalized === "unitprice" || normalized === "orderamount") return typed(example.amount + sequence);
  if (/^source.+id$/i.test(normalized)) return apiDummySourceKey(sequence, runDate);
  if (normalized === "optinstatus" || normalized === "optin") return typed("In");
  if (normalized === "isdeliverable") return typed(true);
  if (/email/i.test(normalized)) return typed(recordEmailForSequence(sequence));
  if (normalized === "campaigncode") return typed("CMP-NURTURE-" + String(1000 + sequence));
  if (normalized === "productcode") return typed("PRD-CX-" + String(1000 + sequence));
  if (semanticValues[normalized]) return typed(pick(semanticValues[normalized]));
  if (/timestamp|(?:ts|dt)$/i.test(displayName) || /timestamp/.test(String(field?.dataType || "").toLowerCase())) return typed(timestamp);
  if (/date/i.test(displayName)) return typed(date);
  if (/^(is|has).+|deliverable|active|consent|enabled/i.test(displayName) || /bool/.test(String(field?.dataType || "").toLowerCase())) return typed(true);
  if (/age/i.test(displayName)) return typed(24 + sequence);
  if (/amount|revenue|score|count|number|rank|level|quantity/i.test(displayName) || /(?:int|long|decimal|double|float|number)/.test(String(field?.dataType || "").toLowerCase())) return typed(100 + sequence);
  if (/phone|mobile|fax/i.test(displayName)) return typed(pick(["4155550101", "9876543210", "2071838750"]));
  if (/cookie/i.test(displayName)) return typed("session_" + apiDummySourceKey(sequence, runDate));
  if (/url/i.test(displayName)) return typed(pick(["https://www.oracle.com/cx/", "https://www.oracle.com/cloud/", "https://www.oracle.com/marketing/"]));
  if (/comment|note|description/i.test(displayName)) return typed("Customer preference captured through a web form.");
  if (/code|key/i.test(displayName)) return typed("REF-" + apiDummySourceKey(sequence, runDate));
  const readableField = displayName.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return typed((readableField || "Customer attribute") + " " + apiDummySourceKey(sequence, runDate));
}

function metadataTenantId(response) {
  const visited = new Set();
  const find = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return null;
    visited.add(value);
    if (!Array.isArray(value) && Number.isFinite(Number(value.tenantId))) return Number(value.tenantId);
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const result = find(child);
      if (result) return result;
    }
    return null;
  };
  return find(response);
}

async function postCustomRecordsToCdp(tabId, payload, tenantId, exactNumericFields = []) {
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["recordProfiles.js"] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [payload, tenantId, exactNumericFields],
    func: async (body, resolvedTenantId, exactFields) => {
      const tenantKey = String(location.hostname || "").split(".")[0];
      if (!tenantKey) throw new Error("Could not determine the CDP tenant from the active tab.");
      const appId = "urn_opc_resource_fusion_" + tenantKey + "_unity_APPID";
      const csrfCookie = document.cookie.split(/;\s*/).find((item) => /^XSRF-TOKEN/i.test(item));
      const csrfToken = csrfCookie ? decodeURIComponent(csrfCookie.slice(csrfCookie.indexOf("=") + 1)) : "";
      const headers = {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-RESOURCE-SERVICE-INSTANCE-IDENTITY-APPNAME": appId,
        "x-cxu-tenantId": appId,
        "x-mcps-tenantkey": tenantKey,
        "x-platform": "KEYSTONE"
      };
      if (resolvedTenantId) headers["x-mcps-tenantId"] = String(resolvedTenantId);
      if (csrfToken) headers["X-Csrf-Token"] = csrfToken;
      // Exact int64/decimal values remain strings until this final wire step.
      const wireBody = globalThis.cdpRecordProfiles.serializeExactNumericPayload(body, exactFields);
      const response = await fetch(location.origin + "/api-stream/v1/" + tenantKey + "/data/streams", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: wireBody
      });
      const text = await response.text();
      if (!response.ok) throw new Error("CDP API load failed (" + response.status + "): " + text.slice(0, 500));
      try { return { status: response.status, body: text ? JSON.parse(text) : null }; }
      catch (_error) { return { status: response.status, body: text || null }; }
    }
  });
  return result;
}

async function runApiCustomRecords(tabId, tableIds, { recordsPerTable = 1, startingIndex = 1, sourceId = "UI", saveRecords = true, dataViewerOverrides = {} } = {}) {
  if (activeSequences.has(tabId)) throw new Error("An automation flow is already running in this tab.");
  if (!Number.isSafeInteger(recordsPerTable) || recordsPerTable < 1) throw new Error("Records per table must be a positive whole number.");
  if (!Number.isSafeInteger(startingIndex) || startingIndex < 1 || startingIndex > 999) throw new Error("API start index must be a whole number from 1 through 999.");
  if (startingIndex + recordsPerTable - 1 > 999) throw new Error("API start index plus records per table cannot exceed 999.");
  const runId = crypto.randomUUID();
  let failed = false;
  activeSequences.set(tabId, { runId, cancelled: false, status: "Running: API Load Custom Records" });
  await setE2EStatus("Running: API Load Custom Records", tabId);
  try {
    const tables = await resolveDataViewerTables(tabId, tableIds, dataViewerOverrides);
    const requestedIds = new Set((tableIds || []).map((entry) => String(typeof entry === "string" ? entry : entry?.id || entry?.tableId || entry?.cdpTable || "").toLowerCase()));
    // resolveDataViewerTables can append a related parent for UI-form FK planning.
    // The stream request contains only tables chosen by the user.
    const streamTables = tables.filter((table) => [table.id, table.tableId, table.cdpTable, table.label]
      .some((value) => requestedIds.has(String(value || "").toLowerCase())));
    if (!streamTables.length) throw new Error("Select at least one table to load through the API.");
    const payload = {};
    const exactNumericFields = new Set();
    let resolvedTenantId = null;
    const resolvedSourceId = String(sourceId || "").trim() || "CDP";
    const dummySourceRunDate = new Date();
    for (const table of streamTables) {
      const metadata = await fetchCdpMetadata(tabId, "tables/" + encodeURIComponent(table.tableId || table.id));
      resolvedTenantId ||= metadataTenantId(metadata);
      // The stream endpoint accepts API resource names, not the Data Viewer
      // labels. For example, ContactPoint and Customer map to `contactpoints`
      // and `customers` respectively.
      const resourceName = String(metadata?.resourceName || table.resourceName || "").trim();
      if (!resourceName) throw new Error("CDP did not return an API resource name for " + table.label + ".");
      // API loads must use the current schema: custom fields can be added after
      // the table list's versionTS snapshot was read. Do not reuse the
      // versioned `table.liveFields` here, or required fields such as Email_c
      // can be missing from the stream payload.
      const liveFields = liveDataViewerFieldsFromMetadata(metadata);
      liveFields.filter((field) => /^(bigint|decimal)$/i.test(field.dataType)).forEach((field) => exactNumericFields.add(field.fieldId));
      const fields = liveFields.filter((field) => (!field.systemAttribute || /^source(?:.+)?id$/i.test(importFieldKey(field)))
        && !isApiManagedField(field)
        && !isDerivedImportField(field, liveFields)
        && apiFullPayloadField(field, String(table.sourceAttribute || `Source${String(table.cdpTable || table.label || "").replace(/[^A-Za-z0-9]/g, "")}ID`).trim()));
      if (!fields.length) throw new Error("CDP did not return writable fields for " + table.label + ".");
      // CDP's stream endpoint requires the table-level source attribute even
      // when metadata classifies it as derived and therefore omits it from the
      // normal writable-field list. Example: SourceProfile_KiwiFix_04Sep_2239ID.
      const sourceAttribute = String(table.sourceAttribute || `Source${String(table.cdpTable || table.label || "").replace(/[^A-Za-z0-9]/g, "")}ID`).trim();
      const records = [];
      for (let offset = 0; offset < recordsPerTable; offset += 1) {
        const sequence = startingIndex + offset;
        const position = offset + 1;
        const profile = cdpRecordProfiles.kind(position, recordsPerTable);
        const record = {};
        for (const field of fields.filter((field) => apiSupportedSourceField(field, sourceAttribute))) {
          record[field.fieldId] = profile === "sparse" && !field.required && !/^source(?:.+)?id$/i.test(importFieldKey(field))
            ? null
            : apiRecordFieldValue(field, table, resolvedSourceId, sequence, table.recordConfig, dummySourceRunDate, position, recordsPerTable);
        }
        // SourceID is the stream-level origin marker. It is required alongside
        // the table-specific source attribute, but metadata can hide it from
        // the enterable-field collection.
        if (!Object.keys(record).some((key) => String(key).toLowerCase() === "sourceid")) record.SourceID = resolvedSourceId;
        if (sourceAttribute && record[sourceAttribute] === undefined) {
          record[sourceAttribute] = apiRecordFieldValue({ fieldId: sourceAttribute, displayName: sourceAttribute }, table, resolvedSourceId, sequence, table.recordConfig, dummySourceRunDate, position, recordsPerTable);
        }
        records.push(record);
      }
      payload[resourceName] = records;
      await appendRunLog("Prepared " + records.length + " API record" + (records.length === 1 ? "" : "s") + " with " + fields.length + " writable fields for resource " + resourceName + " (starting index " + startingIndex + ").", "info", table.label, "Prepare");
    }
    if (!saveRecords) {
      await appendRunLog("Dry run: API request was not sent.", "info", "API Load", "Dry run");
      return { payload, dryRun: true };
    }
    const response = await postCustomRecordsToCdp(tabId, payload, resolvedTenantId, [...exactNumericFields]);
    await appendRunLog("CDP stream API accepted " + streamTables.length + " table payload" + (streamTables.length === 1 ? "" : "s") + " (HTTP " + response.status + ").", "info", "API Load", "Save");
    return response;
  } catch (error) {
    failed = true;
    await setE2EStatus("Failed: API Load Custom Records — " + (error.message || error), tabId);
    throw error;
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (!failed) await setE2EStatus("", tabId);
    if (failed) await finalizeRunHistory("failed");
    else if (cancelled) await finalizeRunHistory("stopped");
    else await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

async function runDataViewer(tabId, tableIds, { recordsPerTable = 1, sourceId = "UI", parentSourceCustomerId = "", saveRecords = false, dataViewerOverrides = {} } = {}) {
  if (activeSequences.has(tabId)) throw new Error("An automation flow is already running in this tab.");
  if (!Number.isSafeInteger(recordsPerTable) || recordsPerTable < 1) throw new Error("Records per table must be a positive whole number.");
  const resolvedSourceId = String(sourceId || "").trim() || "CDP";
  const tables = await resolveDataViewerTables(tabId, tableIds, dataViewerOverrides);
  const runId = crypto.randomUUID();
  let failed = false;
  activeSequences.set(tabId, { runId, cancelled: false, status: "Running: Data Viewer Record" });
  await setE2EStatus("Running: Data Viewer Record", tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    await navigateAndWait(tabId, navigationUrl(tab.url, TASKS["dataViewer.js"].path, TASKS["dataViewer.js"].root));
    await activatePageAutomationRun(tabId, runId);
    await waitForPageElement(tabId, TASKS["dataViewer.js"].readySelector, 60000);
    await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: ["dataViewerClickBridge.js"] });
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["recordProfiles.js", "dataViewer.js"] });
    const [{ result: dataViewerResult }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [tables.map((table) => ({ id: table.id, label: table.label, cdpTable: table.cdpTable, sourceAttribute: table.sourceAttribute, enterableFieldIds: table.enterableFieldIds, liveFields: table.liveFields, recordConfig: table.recordConfig })), { recordsPerTable, sourceId: resolvedSourceId, parentSourceCustomerId: String(parentSourceCustomerId || "").trim(), saveRecords: Boolean(saveRecords) }],
      func: async (dataViewerTables, options) => {
        if (typeof window.runCdpDataViewer !== "function") throw new Error("Data Viewer automation did not load.");
        return window.runCdpDataViewer({ tables: dataViewerTables, ...options });
      }
    });
    await appendDataViewerRunLog(dataViewerResult, tables, { recordsPerTable, sourceId: resolvedSourceId, saveRecords: Boolean(saveRecords) });
  } catch (error) {
    failed = true;
    if (!/stopped by the user/i.test(error.message || "")) await setE2EStatus(`Failed: Data Viewer Record — ${error.message || error}`, tabId);
    throw error;
  } finally {
    const cancelled = activeSequences.get(tabId)?.runId === runId && activeSequences.get(tabId)?.cancelled;
    if (activeSequences.get(tabId)?.runId === runId) activeSequences.delete(tabId);
    if (!failed) await setE2EStatus("", tabId);
    if (failed) await finalizeRunHistory("failed");
    else if (cancelled) await finalizeRunHistory("stopped");
    else await finalizeRunHistory("completed");
    await clearFlowDraft();
  }
}

async function runFusionUserPreparation(tabId, user = {}) {
  const tab = await chrome.tabs.get(tabId);
  if (!/\.fusionapps\./i.test(new URL(tab.url).hostname)) throw new Error("Open the target Oracle Fusion Apps tab before preparing a user.");
  if (activeSequences.has(tabId)) throw new Error("An automation flow is already running in this tab.");
  if (!user.lastName || !user.email || !user.userName || !user.password) throw new Error("Last name, email, user name, and password are required.");
  if (user.password !== user.confirmPassword) throw new Error("Password and Confirm password must match.");

  const runId = crypto.randomUUID();
  activeSequences.set(tabId, { runId, cancelled: false, status: "Running: Prepare Fusion User" });
  await setE2EStatus("Running: Prepare Fusion User", tabId);
  try {
    const waitDeadline = Date.now() + 60000;
    let usersPageReady = false;
    while (Date.now() < waitDeadline) {
      const [{ result: state }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: () => {
          const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
          const controls = [...document.querySelectorAll("a,button,[role=button]")].filter((element) => element.getClientRects().length);
          const exact = (label) => controls.find((element) => normalize(element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent) === label);
          if (exact("add user account")) return "ready";

          // Security Console itself exposes Roles and Users.  Once there, go straight
          // to Users; from any other Fusion page, use the navigator menu first.
          const users = exact("users") || document.querySelector('[id*="ASE_FUSE_UM_WORKAREA"][id$="::disAcr"]');
          const roles = exact("roles") || document.querySelector('[id*="ASE_FUSE_RM_WORKAREA"][id$="::disAcr"]');
          if (users && roles) { users.click(); return "users"; }
          const consoleLink = exact("security console") || document.querySelector('[id^="ASE_FUSE_SECURITY_CONSOLE_"]');
          if (consoleLink && !window.__cdpFusionSecurityConsoleOpening) {
            window.__cdpFusionSecurityConsoleOpening = true;
            consoleLink.click();
            return "security-console";
          }
          // The standard Fusion route is Navigator → Tools → Security Console.
          // Only expand Tools after the Navigator drawer is open so an unrelated
          // home-page application tile cannot be selected by mistake.
          const tools = exact("tools");
          if (tools && window.__cdpFusionNavigatorOpened && !window.__cdpFusionToolsOpened) {
            window.__cdpFusionToolsOpened = true;
            tools.click();
            return "tools";
          }
          const navigator = controls.find((element) => normalize(element.getAttribute("aria-label") || element.getAttribute("title")) === "navigator");
          if (navigator && !window.__cdpFusionNavigatorOpened) {
            window.__cdpFusionNavigatorOpened = true;
            navigator.click();
            return "navigator";
          }
          // Some pods render the Navigator drawer asynchronously or omit the Tools
          // item from its DOM.  The global Fusion search is the equivalent route.
          const globalSearch = [...document.querySelectorAll("input,textarea")].find((element) => {
            const id = String(element.id || "");
            const label = normalize(element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("title"));
            return /_uisgsr/i.test(id) || label === "search" && /_uis/i.test(id);
          });
          if (globalSearch && !window.__cdpFusionSecuritySearchStarted) {
            window.__cdpFusionSecuritySearchStarted = true;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            setter?.call(globalSearch, "Security Console");
            globalSearch.dispatchEvent(new Event("input", { bubbles: true }));
            globalSearch.dispatchEvent(new Event("change", { bubbles: true }));
            globalSearch.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
            globalSearch.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
            return "global-search";
          }
          return "waiting";
        }
      });
      if (state === "ready") { usersPageReady = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!usersPageReady) throw new Error("Security Console → Users could not be opened automatically. Confirm the logged-in pod owner can access Security Console.");
    await installStopGuard(tabId);
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["fusionUser.js"] });
    const [{ result: prepared }] = await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN", args: [user],
      func: async (details) => window.cdpFusionPrepareUser(details)
    });
    if (!prepared?.formReady) throw new Error("Fusion did not open the Add User Account form.");
    // ADF ignores synthetic value events for several account fields. Re-enter
    // every populated value through Chrome's trusted keyboard input before Save.
    const typeFusionField = async (suffix, value, label) => {
      if (!value) return;
      const [{ result: inputId }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [suffix],
        func: (idSuffix) => document.querySelector(`input[id$="${idSuffix}"]`)?.id || ""
      });
      if (!inputId) throw new Error(`Fusion field unavailable: ${label}.`);
      await typeJetInput(tabId, inputId, value, `Fusion ${label}`);
    };
    await typeFusionField(":auFirstName::content", user.firstName, "First Name");
    await typeFusionField(":auLastName::content", user.lastName, "Last Name");
    await typeFusionField(":auEmail::content", user.email, "Email");
    await typeFusionField(":auPhone::content", user.phone, "Phone");
    const userNameDeadline = Date.now() + 15000;
    let emailDerivedUserName = false;
    while (Date.now() < userNameDeadline && !emailDerivedUserName) {
      const [{ result: populated }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: () => Boolean(document.querySelector('input[id$=":itUsrLoginAdd::content"]')?.value?.trim())
      });
      emailDerivedUserName = Boolean(populated);
      if (!emailDerivedUserName) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!emailDerivedUserName) throw new Error("Fusion did not populate User Name from Email; cannot safely replace it with the requested user name.");
    await typeFusionField(":itUsrLoginAdd::content", user.userName, "User Name");
    await typeFusionField(":itPasswd::content", user.password, "Password");
    await typeFusionField(":itConfPasswd::content", user.confirmPassword, "Confirm Password");
    // The role picker is intentionally opened only after ADF has committed the
    // account fields. This avoids a failed role search clearing the new form.
    const [{ result: roleSetup }] = await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN", args: [user.roles || []],
      func: async (roles) => window.cdpFusionAddUserRoles(roles)
    });
    if (!roleSetup?.rolesReady) throw new Error("Fusion did not finish assigning the selected roles.");
    const saveClickDeadline = Date.now() + 15000;
    let saveClicked = false;
    while (Date.now() < saveClickDeadline && !saveClicked) {
      const [{ result: saveTarget }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: () => {
          const xpath = "//button[@title='Save and Close' and contains(@id, ':sp1:saveBtn') ]";
          const save = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (!save || save.disabled || !save.getClientRects().length) return null;
          save.scrollIntoView({ block: "center" });
          const rect = save.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      });
      if (saveTarget) {
        await trustedSchedulerClick(tabId, saveTarget, "Fusion Save and Close");
        saveClicked = true;
      }
      if (!saveClicked) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!saveClicked) throw new Error("Fusion Save and Close was unavailable or disabled.");
    const saveDeadline = Date.now() + 5000;
    let userCreated = false;
    let saveValidationError = "";
    while (Date.now() < saveDeadline) {
      const [{ result: saveState }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: () => {
          const messages = [...document.querySelectorAll('[role="alert"], .af_message, .af_messages, .AFErrorText')]
            .filter((element) => element.getClientRects().length)
            .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
            .filter((message) => /error|required|invalid|already exists|must enter/i.test(message));
          const formOpen = [...document.querySelectorAll('h1, [title="Add User Account"]')]
            .some((element) => String(element.textContent || element.getAttribute("title") || "").replace(/\s+/g, " ").trim() === "Add User Account");
          return { formOpen, error: messages.join(" ") };
        }
      });
      if (saveState?.error) { saveValidationError = saveState.error; break; }
      if (!saveState?.formOpen) { userCreated = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (saveValidationError) throw new Error(`Fusion rejected Save and Close: ${saveValidationError}`);
    // This Fusion page often remains open without a confirmation after a valid
    // save. The caller confirmed that absence of an error is the success signal.
    userCreated = true;
    let instanceAdminAdded = false;
    if (user.instanceAdmin) {
      await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["fusionUser.js"] });
      const [{ result: instanceAdminSetup }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: async () => window.cdpFusionBeginInstanceAdminAssignment()
      });
      if (!instanceAdminSetup?.inputId) throw new Error("Fusion did not expose the Instance Admin role search field.");
      // This is an ADF autocomplete. Trusted typing is required for Fusion to
      // accept the text as a search term; a script-set value yields zero rows.
      await typeJetInput(tabId, instanceAdminSetup.inputId, "instance-admin", "Instance Admin role search");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const [{ result: instanceAdminResult }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", args: [user.userName],
        func: async (userName) => window.cdpFusionFinishInstanceAdminAssignment(userName)
      });
      if (!instanceAdminResult?.roleSaveReady) throw new Error("Fusion did not reach the Instance Admin Save and Close step.");
      const [{ result: roleSaveTarget }] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: () => {
          const xpath = "//button[@title='Save and Close' and contains(@id, 'cb1') ]";
          const save = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (!save || save.disabled || !save.getClientRects().length) return null;
          save.scrollIntoView({ block: "center" });
          const rect = save.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      });
      if (!roleSaveTarget) throw new Error("Fusion Instance Admin Save and Close button is unavailable or disabled.");
      await trustedSchedulerClick(tabId, roleSaveTarget, "Instance Admin Save and Close");
      instanceAdminAdded = true;
    }
    const result = { userName: user.userName, roles: roleSetup.roles || [...new Set(user.roles || [])], created: true, instanceAdminAdded };
    await appendRunLog(`Created ${result.userName} with ${result.roles.length} role${result.roles.length === 1 ? "" : "s"}${result.instanceAdminAdded ? " and assigned Instance Admin." : "."}`, "info", "Fusion User", "Created");
    activeSequences.delete(tabId);
    await setE2EStatus(result.instanceAdminAdded ? "Fusion user created and Instance Admin assigned." : "Fusion user created.", tabId);
    await finalizeRunHistory("completed");
    return result;
  } catch (error) {
    activeSequences.delete(tabId);
    await setE2EStatus(`Failed: Prepare Fusion User`, tabId);
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "connection-profile-list") {
    cdpReadConnectionProfiles().then((profiles) => sendResponse({ profiles }));
    return true;
  }
  if (message?.type === "connection-profile-save") {
    cdpWriteConnectionProfiles(message.profiles || []).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type === "template-list-private") {
    cdpReadTemplates().then((vault) => sendResponse({ locked: vault.locked, templates: vault.templates }));
    return true;
  }
  if (message?.type === "template-list") {
    cdpReadTemplates().then((vault) => sendResponse({ locked: vault.locked, templates: vault.templates.map(cdpTemplateSummary) }));
    return true;
  }
  if (message?.type === "template-save") {
    cdpWriteTemplates(message.templates || []).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  return undefined;
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "sequence-step-saved") return;
  const state = sequenceStepState.get(message.runId);
  if (state) state.add(message.stepId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "apply-new-scheduler") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "New scheduler could not determine the CDP tab." });
      return undefined;
    }
    applyTrustedNewScheduler(tabId, message.schedule || {})
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type === "trusted-data-viewer-next") {
    const tabId = sender.tab?.id;
    const rect = message.rect;
    if (!tabId || !rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) {
      sendResponse({ ok: false, error: "Missing Data Viewer Next button bounds." });
      return undefined;
    }
    const target = { tabId };
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    (async () => {
      let attached = false;
      try {
        await chrome.debugger.attach(target, "1.3");
        attached = true;
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
        if (attached) await chrome.debugger.detach(target);
        sendResponse({ ok: true });
      } catch (error) {
        if (attached) await chrome.debugger.detach(target).catch(() => undefined);
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    })();
    return true;
  }
  if (message?.type !== "stop-full-sequence" && message?.type !== "stop-current-flow") return;
  const tabId = message.tabId ?? sender.tab?.id;
  const activeSequence = activeSequences.get(tabId);
  if (activeSequence) activeSequence.cancelled = true;
  if (activeSequence && activeSequences.get(tabId)?.runId === activeSequence.runId) {
    activeSequences.delete(tabId);
  }
  // A flow has several long-running MAIN-world scripts. Removing the
  // background sequence alone cannot cancel JavaScript already executing in
  // the CDP SPA, and those stale scripts can leave the form unusable. Reload
  // the current route after Stop so the old automation is actually terminated
  // and the user can immediately start another run without a manual refresh.
  // Start reloading first. A long-running MAIN-world automation can prevent a
  // follow-up executeScript from being scheduled, which used to leave Stop
  // waiting indefinitely on the disabled form.
  const reload = chrome.tabs.reload(tabId).catch(() => undefined);
  Promise.all([setE2EStatus("", tabId), reload])
    .then(() => finalizeRunHistory("stopped"))
    .then(clearFlowDraft)
    .finally(() => sendResponse({ ok: true, stopped: Boolean(activeSequence) }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "get-current-run-status") return;
  sendResponse({ status: activeSequences.get(sender.tab?.id)?.status || "" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "individual-task-finished") return;
  for (const [tabId, activeRun] of activeSequences) {
    if (activeRun.runId !== message.runId || !activeRun.individual) continue;
    activeSequences.delete(tabId);
    rememberConnectionSequence(activeRun.connectionTemplateId, activeRun.connectionSequence).catch((error) => console.warn("Could not record confirmed connection name", error));
    setE2EStatus("", tabId);
    finalizeRunHistory("completed");
    clearFlowDraft();
    break;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "get-live-data-viewer-tables") {
    loadLiveDataViewerTables(message.tabId)
      .then((tables) => sendResponse({ ok: true, tables }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type === "get-live-data-viewer-fields") {
    loadLiveDataViewerFields(message.tabId, message.table)
      .then((fields) => sendResponse({ ok: true, fields }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "run-publish-all") return;

  runPublishAll(message.tabId)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("CDP publish failed", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "run-fusion-user") {
    runFusionUserPreparation(message.tabId, message.user || {})
      .then(() => sendResponse({ ok: true }))
      .catch((error) => { finalizeRunHistory("failed", error.message || String(error)); sendResponse({ ok: false, error: error.message || String(error) }); });
    return true;
  }
  if (message?.type === "run-data-model") {
    runDataModel(message.tabId, { purpose: message.connectionPurpose, groups: message.groups, saveObjects: message.saveObjects, attributeGroups: message.attributeGroups || [], addAttributes: message.addAttributes, columnOverrides: message.columnOverrides || {}, parentByGroup: message.parentByGroup || {} })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => { finalizeRunHistory("failed", error.message || String(error)); sendResponse({ ok: false, error: error.message || String(error) }); });
    return true;
  }
  if (message?.type === "run-data-model-attributes") {
    runDataModelAttributes(message.tabId, { group: message.group, objectName: message.objectName, columnOverrides: message.columnOverrides || {} })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => { finalizeRunHistory("failed", error.message || String(error)); sendResponse({ ok: false, error: error.message || String(error) }); });
    return true;
  }
  if (message?.type === "run-api-custom-records") {
    runApiCustomRecords(message.tabId, message.tableIds, { recordsPerTable: message.recordsPerTable, startingIndex: message.startingIndex, sourceId: message.sourceId, saveRecords: message.saveRecords, dataViewerOverrides: message.dataViewerOverrides })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (message?.type === "run-data-viewer") {
    runDataViewer(message.tabId, message.tableIds, { recordsPerTable: message.recordsPerTable, sourceId: message.sourceId, parentSourceCustomerId: message.parentSourceCustomerId, saveRecords: message.saveRecords, dataViewerOverrides: message.dataViewerOverrides })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => { finalizeRunHistory("failed", error.message || String(error)); sendResponse({ ok: false, error: error.message || String(error) }); });
    return true;
  }
  if (message?.type === "run-import-job") {
    runConfiguredFlow(message.tabId, {
      origin: "independent",
      templateId: message.templateId,
      connectionPurpose: message.connectionPurpose,
      steps: ["import"],
      importTableIds: message.tableIds,
      importCustomTables: message.customTables || [],
      importSchedule: message.schedule,
      staggerJobs: false
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("CDP import batch failed", error);
        finalizeRunHistory("failed", error.message || String(error));
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
  if (message?.type !== "run-task") return;

  if (["exportJob.js", "importJob.js", "importContacts.js"].includes(message.filename)) {
    const isExport = message.filename === "exportJob.js";
    const isResponsys = message.filename === "importJob.js";
    const flow = {
      origin: "independent",
      templateId: message.templateId,
      connectionPurpose: message.connectionPurpose,
      steps: [isExport ? "export" : (isResponsys ? "responsys" : "import")],
      exportPayloadName: message.exportPayloadName || "Customer",
      exportCustomTable: message.customTable || null,
      exportFilterRecords: message.filterRecords || message.filterRec || "UPDATED",
      exportPayloadType: message.exportPayloadType || message.payloadType || "data-object",
      importTableIds: isResponsys ? ["customer"] : (message.tableIds || ["customer"]),
      exportSchedule: message.schedule,
      importSchedule: message.schedule,
      importVariant: isResponsys ? "responsys" : "generic",
      staggerJobs: false
    };
    runConfiguredFlow(message.tabId, flow).then(() => sendResponse({ ok: true })).catch((error) => { finalizeRunHistory("failed", error.message || String(error)); sendResponse({ ok: false, error: error.message || String(error) }); });
    return true;
  }

  if (activeSequences.has(message.tabId)) {
    sendResponse({ ok: false, error: "An automation flow is already running in this tab." });
    return;
  }
  const runId = crypto.randomUUID();
  const label = {
    "source.js": "Create Source",
    "destination.js": "Create Destination",
    "exportJob.js": "Create Export Job",
    "importJob.js": "Import Responsys Profile",
    "importContacts.js": "Import Job"
  }[message.filename] || message.filename;
  activeSequences.set(message.tabId, { runId, cancelled: false, individual: true, status: `Running: ${label}` });
  setE2EStatus(`Running: ${label}`, message.tabId);

  selectedTransferTemplate(message.templateId)
    .then(async (template) => {
      template = { ...template, connectionPurpose: message.connectionPurpose || "" };
      const sequence = await nextConnectionSequence(template.id);
      const activeRun = activeSequences.get(message.tabId);
      if (activeRun) Object.assign(activeRun, { connectionTemplateId: template.id, connectionSequence: sequence });
      return runTask(message.tabId, message.filename, undefined, { ...message.schedule, runId }, undefined, message.exportPayloadName, undefined, message.filename === "source.js" ? connectionRuntime(template, "source", sequence) : connectionRuntime(template, "destination", sequence));
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      if (activeSequences.get(message.tabId)?.runId === runId) activeSequences.delete(message.tabId);
      setE2EStatus(`Failed: ${label}`, message.tabId);
      finalizeRunHistory("failed", error.message || String(error));
      clearFlowDraft();
      console.error("CDP automation failed", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "run-custom-flow") {
    runConfiguredFlow(message.tabId, { ...message.flow, origin: "custom-flow", templateId: message.templateId, connectionPurpose: message.connectionPurpose })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("CDP custom flow failed", error);
        finalizeRunHistory("failed", error.message || String(error));
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
  if (message?.type !== "run-full-sequence") return;

  runFullSequence(message.tabId, message.templateId, message.connectionPurpose)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error("CDP sequence failed", error);
      finalizeRunHistory("failed", error.message || String(error));
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});
