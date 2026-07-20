# Flow and Logic Reference

## Shared runtime rules

- All extension navigation uses the current tenant host key and waits three seconds after route load before page automation begins.
- The background worker owns navigation, active-run state, stop handling, configuration loading, and cross-page sequencing.
- Page scripts fill and operate the CDP UI. The browser status pill mirrors the stored active-run status.
- Stop cancels the active sequence, clears the running status/draft, and reloads the current CDP route so stale page scripts cannot continue.
- A stage proceeds only after its Save action/success signal is observed. Failure stops remaining stages.

## Sanity Flow

`Data Viewer → Source → Destination → Export → Import → Publish → Verify`

1. Add and save one Customer record and one related ContactPoint record. `SourceID` is `UI`.
2. Create a new Source from the selected template.
3. Create a new Destination from the selected template.
4. Create Export using the selected/default payload and schedule it for the next exact hour.
5. Create Import using Customer + ContactPoint and schedule it for the following exact hour.
6. Select only this run's created Import/Export feeds on Publish Changes and start the publish job.
7. Open Integrations and wait for both created jobs to show Published.

## Custom Flow

Custom Flow lets the user enable a subset of these fixed-safe-order stages:

`Data Viewer → Source → Destination → Export → Import → Publish → Verify`

- Data Viewer runs once per selected table, saves records, and uses `SourceID=UI`; it does not inherit the standalone Data Viewer dry-run/repeat settings.
- Selecting Import automatically includes Source; selecting Export automatically includes Destination.
- If both jobs are selected, Export/Import schedules are locked to the one-hour stagger.
- Publish requires a job created by the same flow. Verify requires Publish.

## Quick actions

| Action | Sequence |
| --- | --- |
| Create Source | Navigate to Sources → Create → select provider → fill template values → Save and Close. |
| Create Destination | Navigate to Destinations → Create → select provider → fill template values → Save and Close. |
| Import Job | Create a Source if needed → create one Import job with selected table CSV fragments. |
| Export Job | Create a Destination if needed → create one Export job for the selected payload. |
| Data Viewer Record | Navigate to Data Viewer → selected table(s) → Add record → fill fields/keys → Save or discard based on the standalone Dry run control. |
| Publish All | Navigate to Publish Changes → select all available feeds → Publish → confirm → Start publish job. |

## Data and configuration ownership

| Location | Owns |
| --- | --- |
| `config/tables.json` | Import table catalog, export payloads, and Data Viewer table choices. |
| `sample-csv/` | One editable two-record sample CSV per OOTB DW import table. |
| `config/data-viewer-records.json` | Default Data Viewer values and declared FK relationships. |
| `config/transfer-catalog.json` | Seed connection profiles and templates added when missing. |
| Chrome local storage | Browser-edited profiles/templates, popup drafts, active-run metadata, last-run summary, and status. |

## CSV mapping logic

1. Read selected CSV fragments without changing any headers.
2. Combine unique literal headers into one sample upload.
3. Record the selected CDP table(s) for each literal source header.
4. On the field-mapping page, open each source field and select matching attributes from its configured CDP table(s).
5. Attribute comparison is formatting-tolerant, but source-header lookup is exact. A nonmatching custom header fails with its original text.

## Naming and connections

The selected template supplies the provider pair and file contract. An optional popup purpose is included in generated connection/job names. If CDP rejects a connection name as a duplicate, the automation adds a numeric suffix only after CDP reports the duplicate-name error.

Connection Verify is intentionally skipped. The automation waits for Save and Close; without a saved connection, dependent job creation is stopped.

