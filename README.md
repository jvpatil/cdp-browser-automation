# CDP Automation

This version uses normal JavaScript files instead of bookmarklet URLs.

- `importJob.js` is the supplied ImportJob logic with only the `javascript:` prefix and URL encoding removed.
- `exportJob.js` is the supplied ExportJob logic with only the `javascript:` prefix and URL encoding removed.
- The popup injects the selected file directly into the active page's MAIN world.


## ImportJob With Mapping

This keeps the existing `importJob.js` unchanged and adds `importJobWithMapping.js`.

The new flow:
1. Selects or prompts for Source.
2. Clicks **Create source object**.
3. Enters `PROFILE_<HOSTKEY>`.
4. Opens the sample CSV file chooser.
5. Prompts you to select:
   `/Users/jaganpat/Documents/OracleContent/CDP/INJEST_JOB/cdp_field_mapping.csv`
6. Waits until **Start Mapping** is enabled, then clicks it.

Chrome does not allow an extension to populate a local file picker from an arbitrary `/Users/...` path. The file must be selected manually unless the CSV is packaged inside the extension.


## ImportJob Auto Mapping

This adds `importJobWithAutoMapping.js` and keeps the working manual flow unchanged.

The automatic flow:
1. Creates `PROFILE_<HOSTKEY>`.
2. Builds `cdp_field_mapping.csv` in memory from the embedded sample data.
3. Tries a synthetic drag-and-drop first.
4. Falls back to an `ojSelect` event on the Oracle file picker.
5. Confirms that Oracle displays `cdp_field_mapping.csv`.
6. Waits for **Start Mapping** to become enabled and clicks it.

If Oracle rejects synthetic file selection in a specific build, the existing manual mapping button remains available.


### Processing dialog handling

The automatic mapping flow now waits up to 120 seconds for the
**Processing. Please wait. / Cancel** dialog to close before continuing.


## Automatic field mapping

The uploaded mapping script is saved as `cdpFieldmapping.js`.

After **Start Mapping**:
1. The extension waits for the processing dialog to close.
2. It waits an additional 2 seconds for mapping rows to render.
3. It loads and executes `cdpFieldmapping.js`.


### Field-mapping loader fix

`cdpFieldmapping.js` is now injected before the auto-import script and exposes
`window.runCdpFieldMapping()`. The auto-import flow calls that function after
the processing dialog closes and the 2-second rendering delay. It no longer
uses `chrome.runtime.getURL()` from page context.


## Three automatic import variants

- `importCustomer.js`
  - Uses `cdpCustomerFieldMapping.js`
  - TARGET_TABLES: `["Customer"]`

- `importContacts.js`
  - Uses `cdpContactsFieldMapping.js`
  - TARGET_TABLES: `["Customer", "ContactPoint"]`

- `importContactAndAddress.js`
  - Uses `cdpContactAndAddressFieldMapping.js`
  - TARGET_TABLES: `["Customer", "ContactPoint", "Address"]`

`exportJob.js` is unchanged.


## Embedded CSV size

All three automatic import variants now embed only:
- the CSV header row
- the first sample data row

The remaining 14 sample rows were removed.


## Syntax and popup cleanup

- Fixed the embedded CSV string syntax in all three import files.
- Removed the obsolete generic auto-mapping files and popup button.
- Rebuilt the popup with aligned buttons and clearer labels.
