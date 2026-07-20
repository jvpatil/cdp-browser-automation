// Shared field mapper for every table-based Import Job. The caller supplies the
// CDP data objects that correspond to the selected sample CSV.
window.runCdpFieldMapping = async function (targetTables, fieldToTable) {
    try {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const DELAY = {
            rowIntoView: 75,
            editOpen: 150,
            focus: 50,
            searchLoad: 250,
            renderExtra: 250,
            afterSelect: 200,
            afterTable: 125,
            ok: 250,
            scroll: 250
        };

        // Total max table-load wait:
        // focus 50ms + searchLoad 250ms + renderExtra 250ms + waitFor 1450ms = ~2000ms
        const TABLE_LOAD_TIMEOUT = 1450;

        const START_FROM_TOP = false;
        // Set to true if you want the script to jump to the first row before processing.

        const MAX_SCROLL_PASSES = 300;
        const MAX_NO_NEW_PASSES = 4;

        const waitFor = async (fn, timeout = 2500, interval = 80) => {
            const start = Date.now();

            while (Date.now() - start < timeout) {
                try {
                    if (fn()) return true;
                } catch (e) {
                    // ignore transient DOM/JET timing issues
                }

                await sleep(interval);
            }

            return false;
        };

        const realClick = el => {
            if (!el) return;

            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        };

        // Exact-name normalizer:
        // sourcecustomerid     -> sourcecustomerid
        // source_customer_id   -> sourcecustomerid
        // Source Customer ID   -> sourcecustomerid
        // Account ID           -> accountid
        const normalizeName = s => (s || "")
            .toLowerCase()
            .replace(/[_\-\s]+/g, "")
            .replace(/[^a-z0-9]/g, "");

        const isSelected = el => {
            if (!el) return false;

            return (
                el.classList.contains('oj-selected') ||
                el.getAttribute('aria-selected') === 'true' ||
                !!el.querySelector('.oj-selected, [aria-selected="true"]')
            );
        };

        const TARGET_TABLES = Array.isArray(targetTables) && targetTables.length
            ? targetTables
            : (() => { throw new Error("No target tables were supplied for Import Job mapping."); })();
        const FIELD_TO_TABLE = fieldToTable && typeof fieldToTable === "object"
            ? fieldToTable
            : (() => { throw new Error("No CSV field-to-table mapping was supplied for Import Job mapping."); })();

        const getVisibleRows = () => {
            return Array.from(
                document.querySelectorAll('#fieldMappingList ul li')
            ).filter(row => row.querySelector('[id^="row_"]'));
        };

        const getRowKey = row => {
            const valueDiv = row.querySelector('[id^="row_"]');
            if (!valueDiv) return null;

            const rawValue = valueDiv.getAttribute("value");
            if (!rawValue) return null;

            return `${valueDiv.id || ""}::${rawValue}`;
        };

        const getRowValue = row => {
            const valueDiv = row.querySelector('[id^="row_"]');
            if (!valueDiv) return null;

            const rawValue = valueDiv.getAttribute("value");
            if (!rawValue) return null;

            return rawValue.replace(/_+$/, '').trim();
        };

        const isScrollable = el => {
            if (!el) return false;

            const style = window.getComputedStyle(el);
            const overflowY = style.overflowY;

            return (
                el.scrollHeight > el.clientHeight + 20 &&
                (
                    overflowY === "auto" ||
                    overflowY === "scroll" ||
                    overflowY === "overlay"
                )
            );
        };

        const findScrollContainer = () => {
            const root = document.querySelector('#fieldMappingList');

            if (!root) {
                return document.scrollingElement || document.documentElement;
            }

            let el = root;

            while (el && el !== document.body && el !== document.documentElement) {
                if (isScrollable(el)) return el;
                el = el.parentElement;
            }

            const descendants = Array.from(root.querySelectorAll('*'))
                .filter(isScrollable)
                .sort((a, b) => {
                    const aScrollable = a.scrollHeight - a.clientHeight;
                    const bScrollable = b.scrollHeight - b.clientHeight;
                    return bScrollable - aScrollable;
                });

            if (descendants.length) return descendants[0];

            return document.scrollingElement || document.documentElement;
        };

        const getScrollTop = scroller => {
            if (
                scroller === document.scrollingElement ||
                scroller === document.documentElement ||
                scroller === document.body
            ) {
                return window.scrollY ||
                    document.documentElement.scrollTop ||
                    document.body.scrollTop ||
                    0;
            }

            return scroller.scrollTop;
        };

        const setScrollTop = (scroller, value) => {
            if (
                scroller === document.scrollingElement ||
                scroller === document.documentElement ||
                scroller === document.body
            ) {
                window.scrollTo(0, value);
            } else {
                scroller.scrollTop = value;
            }
        };

        const scrollDown = async scroller => {
            const before = getScrollTop(scroller);

            if (
                scroller === document.scrollingElement ||
                scroller === document.documentElement ||
                scroller === document.body
            ) {
                window.scrollBy(0, Math.floor(window.innerHeight * 0.75));
            } else {
                scroller.scrollTop += Math.floor(scroller.clientHeight * 0.75);
            }

            await sleep(DELAY.scroll);

            const after = getScrollTop(scroller);

            return Math.abs(after - before) > 5;
        };

        const findTableGroup = (listbox, tableName) => {
            if (!listbox) return null;

            const expected = `data object: ${tableName}`.toLowerCase();
            const optgroups = listbox.querySelectorAll('oj-optgroup');

            for (const group of optgroups) {
                const label = group.getAttribute('label')?.trim();

                if (label && label.toLowerCase() === expected) {
                    return group.closest('li.oj-listbox-results-depth-0');
                }
            }

            return null;
        };

        const loadDropdownForTable = async (comboInput, tableName) => {
            const searchText = `|${tableName}`;

            comboInput.focus();
            comboInput.select();
            await sleep(DELAY.focus);

            comboInput.value = searchText;
            comboInput.dispatchEvent(new Event('input', { bubbles: true }));

            await sleep(DELAY.searchLoad);

            const listboxId = comboInput.getAttribute("aria-controls");
            if (!listboxId) {
                return null;
            }

            let listbox = document.getElementById(listboxId);
            if (!listbox) {
                return null;
            }

            await sleep(DELAY.renderExtra);

            const loaded = await waitFor(() => {
                listbox = document.getElementById(listboxId);
                return listbox && findTableGroup(listbox, tableName);
            }, TABLE_LOAD_TIMEOUT, 80);

            return loaded ? listbox : null;
        };

        const processRow = async row => {

            row.scrollIntoView({ block: "center", inline: "nearest" });
            await sleep(DELAY.rowIntoView);

            const cleanedValue = getRowValue(row);
            if (!cleanedValue) return false;

            // This key must stay identical to the CSV header. CSV authors may
            // use a convention that differs from CDP's display labels; only
            // the later CDP-attribute comparison is formatting-tolerant.
            const sourceKey = cleanedValue;
            const mappedTables = FIELD_TO_TABLE[sourceKey];
            if (!Array.isArray(mappedTables) || !mappedTables.length) {
                throw new Error(`No target tables are configured for CSV field "${cleanedValue}".`);
            }
            if (mappedTables.some((tableName) => !TARGET_TABLES.includes(tableName))) {
                throw new Error(`CSV field "${cleanedValue}" maps to an unavailable selected table.`);
            }
            const tablesForField = mappedTables;

            console.log(`\nProcessing ${cleanedValue}`);
            console.log(`   exact sourceKey = ${sourceKey}`);

            const editIcon = row.querySelector('.oj-ux-ico-edit.edit_align_center');
            if (!editIcon) {
                console.log(`   ✖ No edit icon`);
                return false;
            }

            realClick(editIcon);
            await sleep(DELAY.editOpen);

            const comboInput = row.querySelector('input[role="combobox"]');
            if (!comboInput) {
                console.log(`   ✖ No combo input`);
                return false;
            }

            for (const tableName of tablesForField) {

                console.log(`   → Processing table: ${tableName}`);

                const listbox = await loadDropdownForTable(comboInput, tableName);

                if (!listbox) {
                    console.log(`      ✖ ${tableName}: dropdown/table group did not load`);
                    continue;
                }

                const groupContainer = findTableGroup(listbox, tableName);

                if (!groupContainer) {
                    console.log(`      ✖ ${tableName}: exact group not present`);
                    continue;
                }

                const childUL = groupContainer.querySelector('ul.oj-listbox-result-sub');

                if (!childUL) {
                    console.log(`      ✖ ${tableName}: no columns`);
                    continue;
                }

                const columnRows = childUL.querySelectorAll('li.oj-listbox-result-selectable');

                if (!columnRows.length) {
                    console.log(`      ✖ ${tableName}: empty columns`);
                    continue;
                }

                let matched = false;

                for (const colRow of columnRows) {

                    const columnSpan = colRow.querySelector('.data-object-name');
                    if (!columnSpan) continue;

                    const columnTextRaw = columnSpan.textContent.trim();
                    const columnKey = normalizeName(columnTextRaw);

                    // Exact normalized match only.
                    // sourcecustomerid matches Source Customer ID.
                    // accountid matches Account ID.
                    // accountid does NOT match Source Account ID.
                    if (columnKey !== sourceKey) {
                        continue;
                    }

                    if (isSelected(colRow)) {
                        console.log(
                            `      → ${tableName}: already selected exact match "${columnTextRaw}"`
                        );

                        matched = true;
                        break;
                    }

                    const clickTarget =
                        colRow.querySelector('oj-option') ||
                        colRow.querySelector('.oj-listbox-result-label') ||
                        colRow;

                    realClick(clickTarget);

                    console.log(
                        `      ✔ ${tableName}: Selected exact match "${columnTextRaw}"`
                    );

                    matched = true;
                    await sleep(DELAY.afterSelect);
                    break;
                }

                if (!matched) {
                    console.log(
                        `      ✖ ${tableName}: exact column not found for "${cleanedValue}"`
                    );
                }

                await sleep(DELAY.afterTable);
            }

            const okButton = document.querySelector(
                '[data-bind*="sourceFieldsToSchemaAttributesMappingOK"]'
            );

            if (okButton) {
                realClick(okButton);
                await sleep(DELAY.ok);
            }

            return true;
        };

        const scroller = findScrollContainer();

        if (START_FROM_TOP) {
            setScrollTop(scroller, 0);
            await sleep(DELAY.scroll);
        }

        const processed = new Set();

        let pass = 0;
        let noNewPasses = 0;

        while (pass < MAX_SCROLL_PASSES && noNewPasses < MAX_NO_NEW_PASSES) {

            const rows = getVisibleRows();

            let newCount = 0;

            for (const row of rows) {

                const rowKey = getRowKey(row);
                if (!rowKey) continue;

                if (processed.has(rowKey)) {
                    continue;
                }

                processed.add(rowKey);
                newCount += 1;

                await processRow(row);
            }

            console.log(
                `\nScroll pass ${pass + 1}: processed ${newCount} new visible row(s). Total processed: ${processed.size}`
            );

            if (newCount === 0) {
                noNewPasses += 1;
            } else {
                noNewPasses = 0;
            }

            const moved = await scrollDown(scroller);

            if (!moved && newCount === 0) {
                console.log("\nReached end of scroll area.");
                break;
            }

            pass += 1;
        }

        console.log(`\nDone. Total rows attempted: ${processed.size}`);

    } catch (err) {
        // A missing or mismatched field definition must stop the job. Continuing
        // would save an import with incomplete or incorrectly routed mappings.
        throw err;
    }

};
/*
Short Runtime Summary
======================
The script processes visible mapping rows, opens each row’s edit dialog, searches the target dropdown using |TableName, finds the matching Data Object: <Table> group, 
scans all columns under that group, and selects the column whose normalized name exactly matches the normalized incoming field name. 
After finishing the visible rows, it scrolls down and repeats until no new rows are found.
*/

/*
Logic / Flow:

1. Target tables
   - The script maps each incoming/source field against the configured target tables.
   - Current target tables:
       Customer
       ContactPoint
   - Update TARGET_TABLES if more data objects need to be checked.

2. Row discovery and scrolling
   - The script reads visible rows from:
       #fieldMappingList ul li
   - Each row is identified using the value from the div whose id starts with "row_".
   - After processing all currently visible rows, the script scrolls down.
   - It keeps repeating this until no new rows are found or the scroll area ends.
   - This handles long field-mapping pages where not all rows are visible initially.

3. Source field cleanup
   - For each row, the script reads:
       valueDiv.getAttribute("value")
   - It removes trailing underscores.
   - Examples:
       sourcecustomerid_  -> sourcecustomerid
       accountid_         -> accountid
       source_account_id_ -> source_account_id

4. Exact normalized matching
   - Both source field name and target column name are normalized before comparison.
   - Normalization removes:
       spaces
       underscores
       hyphens
       special characters
   - It also lowercases the value.
   - Examples:
       sourcecustomerid     -> sourcecustomerid
       source_customer_id   -> sourcecustomerid
       Source Customer ID   -> sourcecustomerid
       Account ID           -> accountid

   - The script selects only when:
       normalizedSourceName === normalizedTargetColumnName

   - Therefore:
       accountid matches Account ID
       accountid does NOT match Source Account ID
       sourcecustomerid matches Source Customer ID

5. Opening the mapping editor
   - For each row, the script clicks the edit icon:
       .oj-ux-ico-edit.edit_align_center
   - Then it finds the target combobox inside that row:
       input[role="combobox"]

6. Loading table columns
   - For each target table, the script searches the combobox using:
       |Customer
       |ContactPoint

   - This loads the table group and all columns for that data object.
   - It waits up to about 2 seconds per table for the dropdown/table group to appear.
   - Timeout is controlled by:
       TABLE_LOAD_TIMEOUT = 1450

   - Total approximate table wait:
       focus delay + search load delay + render delay + TABLE_LOAD_TIMEOUT
       50ms + 250ms + 250ms + 1450ms = about 2 seconds

7. Finding the correct table group
   - The script looks for an oj-optgroup label exactly matching:
       Data Object: Customer
       Data Object: ContactPoint

   - Once found, it goes to the parent LI:
       li.oj-listbox-results-depth-0

   - That same LI contains the child UL with the table columns:
       ul.oj-listbox-result-sub

8. Scanning target columns
   - The script loops through all selectable column rows under that table group:
       li.oj-listbox-result-selectable

   - It reads the target column label from:
       .data-object-name

   - It normalizes the target column label and compares it to the normalized source field.

9. Selecting the column
   - When an exact normalized match is found, the script clicks:
       oj-option
     or falls back to:
       .oj-listbox-result-label
     or the row itself.

   - It selects only the first exact match for that table.
   - This avoids fuzzy/partial matches.

10. Saving the row
   - After checking all target tables for the row, the script clicks the OK button:
       [data-bind*="sourceFieldsToSchemaAttributesMappingOK"]

11. Duplicate prevention
   - The script tracks processed rows using a row key built from:
       row div id + raw value
   - This prevents the same visible row from being processed repeatedly while scrolling.

Important behavior:
- This script performs exact normalized matching, not fuzzy matching.
- It is intended for source fields like:
    sourcecustomerid
    accountid
    sourceaccountid
  and target columns like:
    Source Customer ID
    Account ID
    Source Account ID

- It will not map:
    accountid -> Source Account ID
  because after normalization:
    accountid !== sourceaccountid

Timing controls:
- Main delay settings are in the DELAY object.
- Table-load timeout is controlled by TABLE_LOAD_TIMEOUT.
- To make the script faster, reduce afterSelect, afterTable, ok, and scroll delays first.
- To make dropdown loading more stable, increase TABLE_LOAD_TIMEOUT or searchLoad.
*/
