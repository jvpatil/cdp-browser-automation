const assert = require("node:assert/strict");
const { buildDeletePlan, buildDeleteJob, chooseReportDestination } = require("./deletePlanner.js");

const table = { name: "Customer" };
const fields = ["ID", "SourceID", "SourceCustomerID", "Email", "Region"].map((fieldId) => ({ fieldId }));
const plan = buildDeletePlan({ table, fields, tenantId: 100, uniqueId: "test123" });
const namedPlan = buildDeletePlan({ table, fields, tenantId: 100, uniqueId: "test123", purpose: "Sales cleanup", date: new Date(2026, 9, 22, 22, 32) });
assert.equal(namedPlan.segmentName, "SEGMENT_SALES_CLEANUP_22OCT_2232");
assert.equal(namedPlan.jobName, "DEL_SALES_CLEANUP_22OCT_2232");
const longNamedPlan = buildDeletePlan({ table, fields, tenantId: 100, uniqueId: "long-name", purpose: "A very long purpose with several descriptive words and a suffix", date: new Date(2026, 9, 22, 22, 32) });
assert.ok(longNamedPlan.jobName.length <= 50);
assert.match(longNamedPlan.jobName, /^DEL_[A-Z0-9_]+_22OCT_2232$/);
assert.equal(namedPlan.sourceId, "CDP");
assert.equal(namedPlan.sourceIdField.fieldId, "SourceID");
assert.deepEqual(namedPlan.conditions, [{ fieldId: "Email", displayName: "Email", operator: "startsWith", value: "delete" }]);
const criteria = plan.query.MCPSQuery.operation.operands[0].criteria;
assert.equal(criteria.operator, "AND");
assert.equal(criteria.operands.length, 2);
assert.equal(criteria.operands[0].operands[0].attributeName, "SourceID");
assert.equal(criteria.operands[0].operands[1].data, "CDP");
assert.equal(criteria.operands[1].operator, "EQUALS");
assert.equal(criteria.operands[1].operands[0].functionName, "SUBSTR");
assert.equal(criteria.operands[1].operands[0].attributes[0].attributeName, "Email");
assert.equal(criteria.operands[1].operands[0].attributes[2].data, 6);
assert.equal(criteria.operands[1].operands[1].data, "delete");
assert.equal(plan.segment.baseObjectId, "Customer");
const job = buildDeleteJob(plan, "OOS_QA", "DELETE_CUSTOMER_CPDCKQCQY_TEST");
assert.equal(job.name, plan.jobName);
assert.equal(job.active, false);
assert.equal(job.jobData.tableOptions.delete.cascadeMode, "OFF");
assert.equal(job.jobData.tableOptions.delete.queryDeleteOptions[0].queryObjectIdColumn, "Customer_ID");
assert.equal(job.jobData.templateInfo.workflowComponents[0].right, "OOS_QA");
assert.equal(job.jobData.templateInfo.workflowComponentConfig.OOS_QA.fileName, "DELETE_CUSTOMER_CPDCKQCQY_TEST");
assert.throws(() => buildDeleteJob(plan, "OOS_QA", "DELETE_CUSTOMER.csv"), /filename/i);
assert.equal(job.jobData.idGraphOptions, undefined);
assert.equal(job.jobData.cubeOptions, undefined);

const narrowed = buildDeletePlan({ table, fields, conditions: [
  { field: "Email", operator: "startsWith", value: "delete" },
  { field: "Region", operator: "matches", value: "NA" },
  { field: "Email", operator: "contains", value: "example" },
  { field: "Email", operator: "doesNotContain", value: "blocked" },
  { field: "Email", operator: "endsWith", value: ".com" }
], tenantId: 100, uniqueId: "narrowed" });
const narrowedCriteria = narrowed.query.MCPSQuery.operation.operands[0].criteria;
assert.equal(narrowedCriteria.operands.length, 6);
assert.equal(narrowedCriteria.operands[2].operands[0].functionName, "LOWER");
assert.equal(narrowedCriteria.operands[3].operands[0].functionName, "INSTR");
assert.equal(narrowedCriteria.operands[3].operator, "GREATER_THAN");
assert.equal(narrowedCriteria.operands[4].operator, "EQUALS");
assert.equal(narrowedCriteria.operands[5].operands[0].functionName, "SUBSTR");
assert.throws(() => buildDeletePlan({ table, fields, sourceId: "", tenantId: 100, uniqueId: "x" }), /Source ID/i);
assert.throws(() => buildDeletePlan({ table, fields, conditions: [], tenantId: 100, uniqueId: "x" }), /at least one condition/i);
assert.throws(() => buildDeletePlan({ table, fields, conditions: [{ field: "Unknown", operator: "matches", value: "x" }], tenantId: 100, uniqueId: "x" }), /not on Customer/i);
assert.throws(() => buildDeletePlan({ table, fields, conditions: [{ field: "Region", operator: "matches", value: "" }], tenantId: 100, uniqueId: "x" }), /field and a value/i);
assert.throws(() => buildDeletePlan({ table, fields, conditions: [{ field: "SourceID", operator: "matches", value: "other" }], tenantId: 100, uniqueId: "x" }), /cannot replace/i);

const customPlan = buildDeletePlan({ table: { name: "Profile_27D_c", isCustom: true }, fields: [
  { name: "Column - ID", fieldId: "ID" },
  { name: "Column - Source ID", fieldId: "SourceID" },
  { name: "Email", fieldId: "Email_c" }
], conditions: [{ field: "Email_c", operator: "startsWith", value: "delete" }], tenantId: 100, uniqueId: "custom" });
const customCriteria = customPlan.query.MCPSQuery.operation.operands[0].criteria;
assert.equal(customCriteria.operands[0].operands[0].attributeName, "SourceID");
assert.equal(customCriteria.operands[1].operands[0].attributes[0].attributeName, "Email_c");

const exportJobs = [{ payloadName: "Profile", templateId: "oos" }, { payloadName: "Customer", templateId: "sftp" }];
assert.equal(chooseReportDestination({ tableName: "Customer", exportJobs, defaultTemplateId: "default" }).templateId, "sftp");
assert.equal(chooseReportDestination({ tableName: "Account", exportJobs, defaultTemplateId: "default" }).templateId, "oos");
assert.equal(chooseReportDestination({ tableName: "Customer", defaultTemplateId: "default" }).templateId, "default");
