# CDP Browser Automation

A Chrome extension that automates common Oracle CDP setup and data-feed tasks
in the currently open CDP tenant. It derives the tenant host key from the
active Oracle CDP tab and navigates to the required page before it begins work.

## Install and update

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Use **Load unpacked** and select this repository directory.
4. After changing any extension file, click the extension's reload icon, then
   start a fresh run. Existing forms are not reused after a reload.

## Popup actions

| Action | Behavior |
| --- | --- |
| Create Source | Opens Sources, creates a source, selects Oracle Object Storage, and continues with the source automation. |
| Create Destination | Opens Destinations, creates a destination, selects Oracle Object Storage, and continues with the destination automation. |
| Export Job | Opens the export-job page. Select one payload and a schedule: On-demand, Next hour, or +1 hour. |
| Import Responsys Profile | Runs the dedicated Responsys-profile ingest automation. |
| Import Jobs | Creates one generic ingest job for the selected tables, using one shared schedule. |
| Run default E2E flow | Creates Source → Destination → Export Job → Import Job → publishes the created jobs → verifies their Published status. |
| Customize flow | Selects a safe ordered subset of Source, Destination, Export, Import, Publish, and Verify; Import/Export settings are configured inline. |
| Publish All Data Feeds | Opens Publish Changes and selectively publishes every available Data feed. |
| Stop Current Flow | Stops the E2E or individual automation currently running in the active tab. |

The green **Running** pill in the browser has the same Stop action. It is
rendered on each Oracle CDP page and is removed when the run completes or is
stopped.

## Generic Import Jobs

The **Import Jobs** picker creates one job, even when multiple tables are
selected. It currently supports:

- Customer → CDP `Customer`
- Contacts → CDP `ContactPoint`
- Address → CDP `Address`

The table and payload configuration is centralized in `config/tables.json`.
Both the popup and the background automation load this catalog, so it is the
single editable source of truth.

### Editable CSV fragments

Each table has an editable sample CSV in `sample-csv/`:

- `customer.csv`
- `contactpoint.csv`
- `address.csv`

Each file must contain a header row and at least one sample data row. The
extension combines the selected fragments into one CSV, uploads it, and maps
each field only to its configured CDP table. A header used by multiple selected
tables appears once in the combined CSV and maps to every matching table.

`importTables` may list any CDP Data Warehouse table. To make a listed table
usable for an Import job, create its CSV fragment and add its `csvFile` value
alongside `id`, `label`, and `cdpTable`. Tables without a `csvFile` remain
visible but show a clear message until their sample CSV is configured. Add
Export choices under `exportPayloads`. Reload the extension after editing the
catalog or a CSV file.

## Scheduling and E2E

Individual Import and Export jobs use **On-demand** or **Scheduled** mode.
Scheduled jobs support **Hourly**, **Daily**, and **Weekly** frequency plus an
**Immediate** (next exact hour) or **+1 Hour** start time. Weekly uses the
current local weekday.

For the default E2E flow, Export is scheduled for the next exact hour and
Import is scheduled for the exact hour after Export. A custom flow with both
jobs uses the same stagger. A custom flow with one job uses its selected
On-demand, Next hour, or +1 hour schedule. Flow steps always run in the safe
fixed order, and publishing selects only jobs created by that flow.

If E2E cannot load its editable Customer/ContactPoint CSV fragments, it uses
its bundled fallback sample and mapping so that the flow can continue. A
standalone generic Import Job always uses the selected editable CSV fragments.

## Automation completion

Creation stages use Oracle's Save action and the corresponding success signal.
Publishing completes after **Start publish job** is clicked. The final E2E
stage navigates to Integrations and waits for the created jobs to be marked
Published.
# CDP Browser Automation

## Transfer templates

Open the extension’s **Manage** link to create a paired transfer template before running a Source, Destination, Import, Export, Sanity, or Custom flow. Templates contain the provider settings for both sides and the shared file contract.

The popup shows template names and summaries. It creates fresh CDP connections from the selected template for each run. Provider key files are stored as local file content, not as machine paths.

Supported connection types are Oracle Object Storage, Secure FTP, Salesforce CRM, AWS, Google Cloud Storage, and CX Sales. File settings apply to the file-based providers; CX Sales omits them. Selecting gzip adds a compatible gzip filename contract for the paired import.
