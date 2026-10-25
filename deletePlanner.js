/* Build scoped Oracle Unity segment/delete definitions. No network calls here. */
(function (scope) {
  function deleteTablePairNames(purpose, date = new Date(), group = "Profile") {
    const type = ["Profile", "Behavioral", "Transactional", "Product", "Other"]
      .find((candidate) => candidate.toLowerCase() === String(group || "").trim().toLowerCase());
    if (!type) throw new Error("Select a supported custom data-model type.");
    const stamp = `${String(date.getDate()).padStart(2, "0")}${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getMonth()]}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
    const code = String(purpose || "TEST").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "TEST";
    // Oracle's object ID is capped at 40 characters and may acquire "_c".
    // Leave room for that suffix and use one shared purpose for both objects.
    const maxPurposeLength = 38 - `${type}_DELETE_`.length - 1 - stamp.length;
    const sharedPurpose = code.slice(0, maxPurposeLength).replace(/_+$/g, "") || "TEST";
    return { sourceName: `${type}_${sharedPurpose}_${stamp}`, targetName: `${type}_DELETE_${sharedPurpose}_${stamp}` };
  }
  function deleteTargetName(purpose, date = new Date(), group = "Profile") { return deleteTablePairNames(purpose, date, group).targetName; }
  function pairedDeleteSourceName(targetName) {
    const match = /^(PROFILE|BEHAVIORAL|TRANSACTIONAL|PRODUCT|OTHER)_DELETE_([A-Z0-9_]+)_(\d{2}[A-Z]{3}_\d{4})$/i.exec(String(targetName || "").replace(/_c$/i, ""));
    return match ? `${match[1]}_${match[2]}_${match[3]}` : "";
  }
  function pairedDeleteTargetName(sourceName) {
    const match = /^(PROFILE|BEHAVIORAL|TRANSACTIONAL|PRODUCT|OTHER)_([A-Z0-9_]+)_(\d{2}[A-Z]{3}_\d{4})$/i.exec(String(sourceName || "").replace(/_c$/i, ""));
    return match ? `${match[1]}_DELETE_${match[2]}_${match[3]}` : "";
  }
  function preferredDeleteTableId(target, tables = []) {
    if (!target?.id) return "";
    const pairedName = pairedDeleteTargetName(target.label);
    const paired = pairedName && tables.find((table) => table.isCustom && String(table.label || "").replace(/_c$/i, "").toUpperCase() === pairedName.toUpperCase());
    return paired?.id || target.id;
  }
  function defaultDeleteScope(target, tables = []) {
    const pairedId = preferredDeleteTableId(target, tables);
    return target?.id && pairedId !== target.id
      ? { mode: "table", tableId: pairedId }
      : { mode: "segment", tableId: "Customer" };
  }
  function tableDeletePreferences(preferences = {}) {
    return {
      deleteLinked: false,
      truncateCustomer360: preferences.truncateCustomer360 === true,
      truncateCube: preferences.truncateCube === true
    };
  }
  function deleteTableJobName(targetName, date = new Date()) {
    const match = /^(PROFILE|BEHAVIORAL|TRANSACTIONAL|PRODUCT|OTHER)_DELETE_([A-Z0-9_]+)_(\d{2}[A-Z]{3}_\d{4})$/i.exec(String(targetName || "").replace(/_c$/i, ""));
    if (!match) {
      const tableCode = String(targetName || "").trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase();
      if (!tableCode) throw new Error("Select a table for the entire-table Delete job.");
      const stamp = `${String(date.getDate()).padStart(2, "0")}${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getMonth()]}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
      return `DEL_${tableCode.slice(0, 50 - 4 - stamp.length - 1).replace(/_+$/g, "")}_${stamp}`;
    }
    // Different object types can share one purpose and creation minute.
    // Retain the established Profile name; qualify other types to avoid a
    // Delete-job collision in the same tenant.
    return `DEL_${match[1].toUpperCase() === "PROFILE" ? "" : `${match[1].toUpperCase()}_`}${match[2].toUpperCase()}_${match[3].toUpperCase()}`;
  }
  function reference(tableAlias, fieldId, kind = "ctype", alias) {
    return { [kind]: ".ReferenceAttribute", tableName: tableAlias, attributeName: fieldId, ...(alias ? { alias } : {}) };
  }

  function equals(tableAlias, fieldId, value) {
    return { ctype: ".Criteria", operator: "EQUALS", operands: [reference(tableAlias, fieldId), { ctype: ".StaticAttribute", data: value }] };
  }

  function staticValue(value, kind = "ctype") { return { [kind]: ".StaticAttribute", data: value }; }
  function textFunction(name, attributes, kind = "ctype") { return { [kind]: ".FunctionAttribute", type: "CUSTOM", functionName: name, attributes }; }
  function criteria(operator, left, right) { return { ctype: ".Criteria", operator, operands: [left, staticValue(right)] }; }

  function textCondition(tableAlias, fieldId, operator, value) {
    const field = reference(tableAlias, fieldId, "atype");
    if (operator === "matches") return criteria("EQUALS", textFunction("LOWER", [field]), value.toLowerCase());
    if (operator === "startsWith" || operator === "beginsWith") {
      return criteria("EQUALS", textFunction("SUBSTR", [field, staticValue(1, "atype"), staticValue(value.length, "atype")]), value);
    }
    if (operator === "endsWith") {
      return criteria("EQUALS", textFunction("SUBSTR", [field, staticValue(-value.length, "atype"), staticValue(value.length, "atype")]), value);
    }
    if (operator === "contains" || operator === "doesNotContain") {
      const search = textFunction("INSTR", [textFunction("LOWER", [field], "atype"), staticValue(value.toLowerCase(), "atype")]);
      return criteria(operator === "contains" ? "GREATER_THAN" : "EQUALS", search, 0);
    }
    throw new Error(`Unsupported Delete condition operator: ${operator}.`);
  }

  function chooseReportDestination({ tableName, exportJobs = [], defaultTemplateId }) {
    const relatedExport = exportJobs.find((job) => job.payloadName === tableName) || exportJobs[0] || null;
    return { templateId: relatedExport?.templateId || defaultTemplateId, relatedExport };
  }

  function buildDeletePlan({ table, fields, sourceId = "CDP", conditions = [{ field: "Email", operator: "startsWith", value: "delete" }], tenantId, uniqueId, purpose = "DELETE", date = new Date() }) {
    const tableName = String(table?.name || table?.label || table?.tableId || "").trim();
    if (!tableName || !Number.isFinite(Number(tenantId)) || !uniqueId) throw new Error("Delete needs a live table, tenant ID, and unique segment ID.");
    const fieldMap = new Map(fields.map((field) => [String(field.fieldId || "").toLowerCase(), field]));
    const idField = fieldMap.get("id")?.fieldId;
    const sourceIdField = fieldMap.get("sourceid")?.fieldId;
    if (!idField || !sourceIdField) throw new Error(`${tableName} must expose ID and SourceID in live metadata.`);
    const sourceValue = String(sourceId || "").trim();
    if (!sourceValue) throw new Error("Enter a Source ID for the Delete segment.");
    if (!Array.isArray(conditions) || !conditions.length) throw new Error("Add at least one condition beyond Source ID before preparing Delete.");
    const uiConditions = conditions.map((entry, index) => {
      const label = `Condition ${index + 1}`;
      const name = String(entry?.field || "").trim();
      const value = String(entry?.value || "").trim();
      if (!name || !value) throw new Error(`${label} needs both a field and a value.`);
      const field = fieldMap.get(name.toLowerCase());
      if (!field?.fieldId) throw new Error(`${label} field ${name} is not on ${tableName}.`);
      if ([idField, sourceIdField].includes(field.fieldId)) throw new Error(`${label} cannot replace ID or SourceID.`);
      const type = String(field.type?.dataType || "").toUpperCase();
      if (type && !["STRING", "TEXT", "VARCHAR", "CHAR"].includes(type)) throw new Error(`${label} uses a text operator, but ${field.fieldId} has type ${type}.`);
      return { fieldId: field.fieldId, displayName: String(field.name || field.fieldId), operator: entry.operator, value };
    });
    const checkedConditions = uiConditions.map((entry) => textCondition("D1", entry.fieldId, entry.operator, entry.value));
    const alias = "D1";
    const outputAlias = `${tableName}_ID`;
    const allConditions = [equals(alias, sourceIdField, sourceValue), ...checkedConditions];
    const objectSet = {
      ctype: ".ObjectSet", name: alias, uniqueId: `${uniqueId}_object`, tenantId: Number(tenantId), objectName: tableName, distinct: true,
      outputAttributes: [reference(alias, idField, "atype", outputAlias)],
      criteria: { ctype: ".Criteria", operator: "AND", operands: allConditions }
    };
    const purposeCode = String(purpose || "DELETE").trim().replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "DELETE";
    const stamp = `${String(date.getDate()).padStart(2, "0")}${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][date.getMonth()]}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
    const segmentName = `SEGMENT_${purposeCode.slice(0, 128 - 8 - stamp.length - 1)}_${stamp}`;
    const jobName = `DEL_${purposeCode.slice(0, 50 - 4 - stamp.length - 1)}_${stamp}`;
    const query = {
      MCPSQuery: {
        tenantId: Number(tenantId), name: segmentName, uniqueId, description: `${tableName}: SourceID ${sourceValue} and ${checkedConditions.length} additional condition(s). Review count before activation.`, active: true,
        operation: { ctype: ".SetOperation", name: "DeleteScope", tenantId: Number(tenantId), uniqueId: `${uniqueId}_op`, operands: [objectSet], operator: "INTERSECTION", outputAttributes: [reference(alias, outputAlias, "atype", outputAlias)], distinct: true }
      }
    };
    return { tableName, isCustom: Boolean(table.isCustom || /_c$/i.test(tableName)), tenantId: Number(tenantId), outputAlias, segmentName, jobName, uniqueId, sourceId: sourceValue, sourceIdField: { fieldId: sourceIdField, displayName: String(fieldMap.get("sourceid")?.name || sourceIdField) }, conditions: uiConditions, query, segment: { description: query.MCPSQuery.description, uniqueId, baseObjectId: tableName } };
  }

  function buildDeleteJob(plan, destinationId, reportFileName) {
    const sink = String(destinationId || "").trim();
    if (!sink) throw new Error("The Delete report destination was not found in this tenant.");
    const fileName = String(reportFileName || "").trim();
    if (!/^DELETE_[A-Z0-9_]+$/.test(fileName) || fileName.length > 180) throw new Error("Delete report filename must use the DELETE_<table>_<host>_<purpose> base-name convention.");
    const jobId = plan.jobName;
    return {
      tenantId: plan.tenantId, name: jobId, jobId, description: `Inactive scoped delete for ${plan.tableName}; review before publishing or starting.`, active: false,
      jobData: {
        ctype: ".DataCleanJobData",
        tableOptions: { delete: { tableTypes: ["DW", "R", "RS"], cascadeMode: "OFF", queryDeleteOptions: [{ mcpsQueryId: plan.uniqueId, queryObjectIdColumn: plan.outputAlias, object: plan.tableName }] } },
        templateInfo: {
          workflowComponents: [{ left: "SINK", right: sink }],
          workflowComponentConfig: { [sink]: { fileName } }
        }
      }
    };
  }

  scope.CdpDeletePlanner = { buildDeletePlan, buildDeleteJob, chooseReportDestination, deleteTablePairNames, deleteTargetName, pairedDeleteSourceName, pairedDeleteTargetName, preferredDeleteTableId, defaultDeleteScope, tableDeletePreferences, deleteTableJobName };
  if (typeof module !== "undefined") module.exports = scope.CdpDeletePlanner;
})(typeof globalThis !== "undefined" ? globalThis : this);
