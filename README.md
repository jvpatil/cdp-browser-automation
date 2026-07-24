# CDP Browser Automation

Chrome extension for creating Oracle CDP connections and jobs, adding Data Viewer records, publishing data feeds, and validating published jobs in the active CDP tenant.

The extension derives the tenant host key from the active CDP tab. Every extension-driven route navigation waits three seconds after browser load before the next action begins.

## Install or update

1. Open `chrome://extensions` and enable **Developer mode**.
2. Use **Load unpacked** and select this repository directory.
3. After a code or configuration change, click the extension reload icon and begin a fresh run.

## Getting started

1. Open an Oracle CDP tenant tab.
2. Open the extension popup and select a **Transfer template**.
3. Optionally enter a short purpose. It is used in the created connection and job names.
4. Use a quick action, **Run Sanity Flow**, or **Customize flow**.

Use **Manage templates** to maintain connection profiles and paired transfer templates. Profiles hold reusable provider values; templates pair one source profile and one destination profile with file settings. The extension creates new CDP connections from the selected template for each run.

Starter profiles/templates are bundled in `config/transfer-catalog.json`. They are added to Chrome local storage only when missing; browser-edited profiles and templates are not overwritten on extension reload.

## Popup actions

| Action | Purpose |
| --- | --- |
| Run Sanity Flow | Creates a Profile Data Model with its default attributes, then runs Data Viewer (Customer + ContactPoint), Source, Destination, Export, Import, Publish, and Verify in the safe order. |
| Customize flow | Runs a selected safe subset of Data Viewer, Source, Destination, Export, Import, Publish, and Verify. |
| Create Source / Destination | Creates that side of the selected transfer template. |
| Import Job | Creates one ingest job for one or more selected tables. |
| Export Job | Creates one export job for the selected payload. |
| Import Responsys Profile | Runs the separate Responsys ingest automation. |
| Data Viewer Record | Creates or dry-runs records for selected CDP tables. |
| Data Models | Creates selected custom data objects, or dry-runs the object setup. |
| Add New Attributes | Adds deliberately chosen new attributes to an existing custom object. |
| Publish all Data feeds | Publishes every selectable feed on the Publish Changes page. |

The popup and browser status pill display the active stage. Either Stop action cancels the active flow and reloads the current CDP route to remove stale automation.

## Tables and sample CSVs

`config/tables.json` is the catalog for Import, Export, and Data Viewer choices. It contains the CDP display table name and the linked sample CSV for every supported DW import table.

Each `sample-csv/*.csv` file has a header and two sample records. OOTB headers are lowercase with no spaces, matching CDP export output, for example `sourcecustomerid`, `registrationts`, and `age`.

Import preserves CSV headers exactly as authored:

- The uploaded combined sample CSV retains each source header unchanged.
- Source-field-to-table lookup uses that literal header.
- CDP data-model attribute selection ignores case, spaces, hyphens, and underscores only when comparing a source header with the CDP display label.
- A custom header that cannot be matched to a CDP attribute stops with an error naming that original header. An explicit custom alias mapping is not yet available.

To add a table, add its catalog entry and CSV fragment, then reload the extension. Do not edit generated browser storage directly.

## Data Model test columns

`config/data-model-columns.json` defines the default attributes created for each Data Model object group. Each entry has a `name` and CDP `dataType`; the initial Profile defaults are Email, FirstName, LastName, Age, and BirthDate.

When creating an object, its **Parent** selector can be left as **None**, set to **Customer** or **Account**, or set to **Other** and given an exact custom object name. After the object and its configured attributes are saved, the automation creates the CDP relationship with the new object as the child. CDP may add the compatible parent ID fields to that child automatically.

In **Add New Attributes**, choose the object group and enter the exact existing object name. Provide only the new attributes to add: rename them, change their type, remove them, or add more. **Load JSON** can populate the extension list for the selected group.

Use **Load JSON** to replace the selected group’s form rows for the current run. The file must be a JSON object whose keys are attribute names and values are CDP data types:

```json
{
  "Email": "string",
  "FirstName": "string",
  "Age": "int",
  "BirthDate": "date"
}
```

Supported types are `string`, `int`, `bigint`, `decimal`, `date`, `timestamp`, and `boolean`. Uploaded and edited rows are cleared after success, failure, or Stop; edit `config/data-model-columns.json` to change reusable defaults.

**Data Models** and **Add New Attributes** are intentionally separate. This lets you add new attributes to a known existing object without creating another table, and avoids accidentally reapplying defaults to an older object while an object-creation test is running.

## Scheduling and file limitations

Every Import, Export, and Responsys job scheduler has a **New / Legacy** selector. New is the default: it uses CDP’s current schedule UI with Daily, Weekly (selected days), Monthly (selected days), or Monthly (selected dates), followed by **Specific** or **Interval** timing.

New Specific timing defaults to **now +15 minutes** for Export and **now +30 minutes** for Import/Responsys; choose another preset or a custom time to change it. New Interval timing accepts an hourly interval, start time, and end time. The current weekday/date is selected automatically for the non-Daily frequencies.

Legacy preserves the previous On-demand/Scheduled controls: Hourly, Daily, or Weekly with Immediate (next exact hour) or +1 Hour. A flow containing both jobs retains the one-hour stagger only when both flow schedulers use Legacy. New schedules retain their explicit Export +15 minute / Import +30 minute defaults.

Current Import/Source support is limited to CSV or JSON. gzip and PGP import processing are not supported. Destination/export compression settings are separate from Import and are applied only where the relevant CDP destination/job control exists. For a Destination template value of `None`, the extension leaves CDP's default destination compression selection unchanged.

## Connection behavior

Connection creation fills the selected provider form and saves it as soon as CDP enables **Save and Close**. It does not click or wait for **Verify Connection**. If CDP never enables Save and Close, the flow stops because a dependent Import or Export job cannot use an unsaved connection.

Provider-specific field automation is registered in `connectionAdapters.js`; Oracle Object Storage is the most established path. Validate other provider forms in the target tenant before relying on them for an unattended flow.

## More detail

See [FLOW-LOGIC.md](FLOW-LOGIC.md) for step-by-step execution order, persistence, failure handling, and script ownership.
