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
| Run Sanity Flow | Runs Data Viewer (Customer + ContactPoint), Source, Destination, Export, Import, Publish, and Verify in the safe order. |
| Customize flow | Runs a selected safe subset of Data Viewer, Source, Destination, Export, Import, Publish, and Verify. |
| Create Source / Destination | Creates that side of the selected transfer template. |
| Import Job | Creates one ingest job for one or more selected tables. |
| Export Job | Creates one export job for the selected payload. |
| Import Responsys Profile | Runs the separate Responsys ingest automation. |
| Data Viewer Record | Creates or dry-runs records for selected CDP tables. |
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

## Scheduling and file limitations

Import and Export support **On-demand** or **Scheduled** mode. Scheduled mode offers Hourly, Daily, or Weekly frequency and Immediate (next exact hour) or +1 Hour start time.

When a flow contains both Export and Import, Export is scheduled at the next exact hour and Import one hour later. This stagger overrides individual flow start-time controls.

Current Import/Source support is limited to CSV or JSON. gzip and PGP import processing are not supported. Destination/export compression settings are separate from Import and are applied only where the relevant CDP destination/job control exists. For a Destination template value of `None`, the extension leaves CDP's default destination compression selection unchanged.

## Connection behavior

Connection creation fills the selected provider form and saves it as soon as CDP enables **Save and Close**. It does not click or wait for **Verify Connection**. If CDP never enables Save and Close, the flow stops because a dependent Import or Export job cannot use an unsaved connection.

Provider-specific field automation is registered in `connectionAdapters.js`; Oracle Object Storage is the most established path. Validate other provider forms in the target tenant before relying on them for an unattended flow.

## More detail

See [FLOW-LOGIC.md](FLOW-LOGIC.md) for step-by-step execution order, persistence, failure handling, and script ownership.
