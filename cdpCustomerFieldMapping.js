// Shared field mapper for every table-based Import Job. The caller supplies the
// CDP data objects that correspond to the selected sample CSV.
window.runCdpFieldMapping = async function (targetTables, fieldToTable, mappingOptions = {}) {
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

        // CDP can keep its Processing overlay visible after the mapping rows
        // appear. Allow each table lookup enough time to catch up, but do not
        // let an unavailable table stop every later CSV field.
        const TABLE_LOAD_TIMEOUT = 10000;

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
        // Column - SourceID    -> columnsourceid
        // Account ID           -> accountid
        const normalizeName = s => (s || "")
            .toLowerCase()
            .replace(/[_\-\s]+/g, "")
            .replace(/[^a-z0-9]/g, "");
        const comparisonKeys = value => {
            const raw = String(value || "").trim();
            const keys = new Set([normalizeName(raw)]);
            // Export retains physical `*_c` IDs; CDP can show the target
            // attribute without that suffix. This is comparison-only.
            if (/_c$/i.test(raw)) keys.add(normalizeName(raw.replace(/_c$/i, "")));
            return keys;
        };

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
        // CDP may add a trailing underscore or alter the case of the source
        // field shown in the mapping row. Resolve the generated header using
        // the exact same canonical key used for target attributes.
        const FIELD_TO_TABLE_BY_KEY = new Map();
        for (const [field, tables] of Object.entries(FIELD_TO_TABLE)) {
            for (const key of comparisonKeys(field)) FIELD_TO_TABLE_BY_KEY.set(key, tables);
        }
        const TARGET_ATTRIBUTES = mappingOptions.fieldTargetAttributes && typeof mappingOptions.fieldTargetAttributes === "object"
            ? mappingOptions.fieldTargetAttributes
            : {};
        const STATIC_TRANSFORMS = mappingOptions.fieldStaticTransforms && typeof mappingOptions.fieldStaticTransforms === "object"
            ? mappingOptions.fieldStaticTransforms
            : {};

        const ruleForSource = (rules, sourceKey) => {
            const direct = rules[sourceKey];
            if (direct) return direct;
            const sourceKeys = comparisonKeys(sourceKey);
            return Object.entries(rules).find(([key]) => [...comparisonKeys(key)].some((candidate) => sourceKeys.has(candidate)))?.[1] || {};
        };
        const targetNamesFor = (sourceKey, tableName) => {
            const override = ruleForSource(TARGET_ATTRIBUTES, sourceKey);
            const names = override[tableName];
            return Array.isArray(names) && names.length ? names : [sourceKey];
        };
        const staticTransformsFor = (sourceKey, tableName) => {
            const sourceRules = ruleForSource(STATIC_TRANSFORMS, sourceKey);
            return sourceRules[tableName] && typeof sourceRules[tableName] === "object" ? sourceRules[tableName] : {};
        };

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
            // CDP/JET does not consistently return custom-object attributes
            // for a programmatic full-name search. Its normal UI reliably
            // returns them for the stable object-family prefix; we still
            // require the exact full data-object group below.
            const prefix = String(tableName || '').split('_').slice(0, 2).join('_') || tableName;
            const searchText = `|${prefix}`;

            comboInput.focus();
            comboInput.select();
            await sleep(DELAY.focus);

            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(comboInput, '');
            else comboInput.value = '';
            comboInput.dispatchEvent(new Event('input', { bubbles: true }));
            comboInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Backspace' }));
            await sleep(DELAY.focus);
            if (setter) setter.call(comboInput, searchText);
            else comboInput.value = searchText;
            comboInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: searchText.at(-1) }));
            comboInput.dispatchEvent(new Event('input', { bubbles: true }));
            comboInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: searchText.at(-1) }));

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

            if (!loaded && listbox) {
                const lookupDebug = {
                    tableName,
                    searchText,
                    listboxId,
                    optgroupLabels: [...listbox.querySelectorAll("oj-optgroup")].map((group) => group.getAttribute("label") || ""),
                    visibleAttributeNames: [...listbox.querySelectorAll(".data-object-name")].map((cell) => cell.textContent.trim())
                };
                console.info("[CDP mapping] table lookup failed", lookupDebug);
                console.info("[CDP mapping] table lookup JSON " + JSON.stringify(lookupDebug));
            }

            return loaded ? listbox : null;
        };

        const visible = el => Boolean(el && el.isConnected && el.getClientRects().length);

        const setInputValue = (input, value) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(input, value);
            else input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: String(value).slice(-1) }));
        };

        const transformLinkFor = (row, targetName) => {
            const targetKey = normalizeName(targetName);
            return [...row.querySelectorAll(".schema-attribute-transform")].find(link => {
                let node = link.parentElement;
                // The mapping card contains its attribute name and Transform
                // link. Do not inspect the whole source row or another card
                // can make every link appear to match.
                for (let level = 0; node && node !== row && level < 5; level += 1, node = node.parentElement) {
                    if (normalizeName(node.textContent).includes(targetKey)) return true;
                }
                return false;
            }) || null;
        };

        const optionByText = (text) => [...document.querySelectorAll("li[role=row], [role=option], oj-option")]
            .find(option => visible(option) && normalizeName(option.textContent) === normalizeName(text));

        const applyStaticTransform = async (row, targetName, staticValue) => {
            const transformLink = await (async () => {
                await waitFor(() => transformLinkFor(row, targetName), 5000, 100);
                return transformLinkFor(row, targetName);
            })();
            if (!transformLink) {
                console.warn(`[CDP mapping] ${targetName}: Transform link was unavailable.`);
                return false;
            }
            realClick(transformLink);
            const dialogReady = await waitFor(() => visible(document.querySelector("#transformation-modal")), 5000, 100);
            const dialog = document.querySelector("#transformation-modal");
            if (!dialogReady || !dialog) {
                console.warn(`[CDP mapping] ${targetName}: Transform dialog did not open.`);
                return false;
            }
            const typeInput = dialog.querySelector(".transform-type-select input[role=combobox]");
            if (!typeInput) {
                console.warn(`[CDP mapping] ${targetName}: Transformation type selector was unavailable.`);
                return false;
            }
            realClick(typeInput);
            const staticType = await (async () => {
                await waitFor(() => optionByText("Static/Lookup"), 3000, 75);
                return optionByText("Static/Lookup");
            })();
            if (!staticType) {
                console.warn(`[CDP mapping] ${targetName}: Static/Lookup was unavailable.`);
                return false;
            }
            realClick(staticType);
            await sleep(DELAY.renderExtra);

            // Static/Lookup renders an Equals selector and then its editable
            // value input. Select Equals if JET has not already made it the
            // default; this keeps the static literal independent of CSV data.
            const staticSelector = dialog.querySelector(".static-transform-dropdown input[role=combobox]");
            if (staticSelector && !dialog.querySelector("input[id^='value-input-']")) {
                realClick(staticSelector);
                await waitFor(() => optionByText("Equals"), 2000, 75);
                const equals = optionByText("Equals");
                if (equals) realClick(equals);
            }
            const valueInputReady = await waitFor(() => visible(dialog.querySelector("input[id^='value-input-'], input.trans-editable-field:not([readonly])")), 4000, 75);
            const valueInput = dialog.querySelector("input[id^='value-input-'], input.trans-editable-field:not([readonly])");
            if (!valueInputReady || !valueInput) {
                console.warn(`[CDP mapping] ${targetName}: Static value input was unavailable.`);
                return false;
            }
            setInputValue(valueInput, staticValue);
            await sleep(DELAY.focus);
            const apply = dialog.querySelector("#applyButton button, button[aria-labelledby^='applyButton']");
            if (!apply || apply.disabled) {
                console.warn(`[CDP mapping] ${targetName}: Transform Apply button was unavailable.`);
                return false;
            }
            realClick(apply);
            await waitFor(() => !visible(document.querySelector("#transformation-modal")), 4000, 100);
            console.info(`[CDP mapping] ${targetName}: applied static value ${staticValue}.`);
            return true;
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
            const normalizedSourceKey = normalizeName(sourceKey);
            const sourceComparisonKeys = comparisonKeys(sourceKey);
            const mappedTables = FIELD_TO_TABLE[sourceKey] || [...sourceComparisonKeys].map((key) => FIELD_TO_TABLE_BY_KEY.get(key)).find(Boolean);
            const debugSourceKey = /^source/i.test(normalizedSourceKey);
            if (debugSourceKey) {
                console.info("[CDP mapping] source row", {
                    rawValue: row.querySelector('[id^="row_"]')?.getAttribute("value") || "",
                    cleanedValue,
                    sourceKey,
                    normalizedSourceKey,
                    configuredTargets: mappedTables || [],
                    fieldToTable: FIELD_TO_TABLE
                });
            }
            if (!Array.isArray(mappedTables) || !mappedTables.length) {
                console.warn(`Skipping CSV field "${cleanedValue}": no configured target table.`);
                return false;
            }
            if (mappedTables.some((tableName) => !TARGET_TABLES.includes(tableName))) {
                console.warn(`Skipping CSV field "${cleanedValue}": its target table is not selected.`);
                return false;
            }
            const tablesForField = mappedTables;

            console.log(`\nProcessing ${cleanedValue}`);
            console.log(`   exact sourceKey = ${sourceKey}`);

            const editIcon = row.querySelector('.oj-ux-ico-edit.edit_align_center');
            if (!editIcon) {
                console.warn(`Skipping CSV field "${cleanedValue}": mapping editor is unavailable.`);
                return false;
            }

            realClick(editIcon);
            await sleep(DELAY.editOpen);

            const comboInput = row.querySelector('input[role="combobox"]');
            if (!comboInput) {
                console.warn(`Skipping CSV field "${cleanedValue}": mapping selector is unavailable.`);
                return false;
            }

            let mapped = false;
            const pendingStaticTransforms = [];

            for (const tableName of tablesForField) {

                console.log(`   → Processing table: ${tableName}`);

                const desiredTargets = targetNamesFor(sourceKey, tableName);
                const staticForTable = staticTransformsFor(sourceKey, tableName);
                let matchedCount = 0;

                for (const desiredTarget of desiredTargets) {
                    // Selecting an option can cause Oracle JET to replace the
                    // listbox DOM. Reload it for every target so a multi-map
                    // such as SourceCustomerID → SourceContactPointID does
                    // not inspect stale option elements after the first pick.
                    const listbox = await loadDropdownForTable(comboInput, tableName);
                    const groupContainer = listbox && findTableGroup(listbox, tableName);
                    const childUL = groupContainer?.querySelector('ul.oj-listbox-result-sub');
                    const columnRows = childUL?.querySelectorAll('li.oj-listbox-result-selectable') || [];
                    if (!columnRows.length) {
                        console.warn(`Skipping ${tableName}.${desiredTarget} for CSV field "${cleanedValue}": data object attributes are unavailable.`);
                        continue;
                    }
                    const normalizedDesiredTarget = normalizeName(desiredTarget);
                    const desiredComparisonKeys = comparisonKeys(desiredTarget);
                    let matched = false;
                    for (const colRow of columnRows) {
                        const columnNameCell = colRow.querySelector('.data-object-name');
                        if (!columnNameCell) continue;

                        const columnTextRaw = columnNameCell.textContent.trim();
                        const columnKey = normalizeName(columnTextRaw);
                        // CDP displays custom-object system fields as
                        // "Column - Source…". Retain that as a comparison
                        // alias only; generated CSV headers remain real
                        // export headers such as sourceid.
                        const columnHeaderAlias = columnKey.replace(/^column/, "");
                        if (debugSourceKey) {
                            console.info("[CDP mapping] target candidate", {
                                sourceKey,
                                normalizedSourceKey,
                                desiredTarget,
                                normalizedDesiredTarget,
                                tableName,
                                columnTextRaw,
                                columnKey,
                                columnHeaderAlias,
                                directMatch: desiredComparisonKeys.has(columnKey),
                                aliasMatch: desiredComparisonKeys.has(columnHeaderAlias),
                                selected: isSelected(colRow)
                            });
                        }
                        if (!desiredComparisonKeys.has(columnKey) && !desiredComparisonKeys.has(columnHeaderAlias)) continue;

                        if (!isSelected(colRow)) {
                            const clickTarget = colRow.querySelector('oj-option') || colRow.querySelector('.oj-listbox-result-label') || colRow;
                            realClick(clickTarget);
                            await sleep(DELAY.afterSelect);
                        }
                        if (debugSourceKey) {
                            console.info("[CDP mapping] selected target", {
                                sourceKey,
                                tableName,
                                desiredTarget,
                                columnTextRaw,
                                selectedAfterClick: isSelected(colRow)
                            });
                        }
                        console.log(`      ✔ ${tableName}: Selected exact match "${columnTextRaw}"`);
                        matched = true;
                        matchedCount += 1;
                        if (Object.prototype.hasOwnProperty.call(staticForTable, desiredTarget)) {
                            pendingStaticTransforms.push({ targetName: desiredTarget, value: staticForTable[desiredTarget] });
                        }
                        break;
                    }
                    if (!matched) console.warn(`Skipping ${tableName}.${desiredTarget} for CSV field "${cleanedValue}": no matching attribute.`);
                }

                if (!matchedCount) {
                    console.warn(`Skipping ${tableName} for CSV field "${cleanedValue}": no matching attribute.`);
                    continue;
                }

                mapped = true;

                await sleep(DELAY.afterTable);
            }

            const okButton = document.querySelector(
                '[data-bind*="sourceFieldsToSchemaAttributesMappingOK"]'
            );

            if (okButton) {
                realClick(okButton);
                await sleep(DELAY.ok);
            }

            for (const transform of pendingStaticTransforms) {
                await applyStaticTransform(row, transform.targetName, transform.value);
            }

            return mapped;
        };

        const scroller = findScrollContainer();

        if (START_FROM_TOP) {
            setScrollTop(scroller, 0);
            await sleep(DELAY.scroll);
        }

        const processed = new Set();
        const mappedSourceFields = new Set();

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

                try {
                    if (await processRow(row)) mappedSourceFields.add(getRowValue(row));
                } catch (error) {
                    // A transient JET row/editor failure must not abort the
                    // complete import mapping. Record it and continue to the
                    // next source field.
                    console.warn(`Skipping mapping row: ${error.message || error}`);
                }
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

        console.log(`\nDone. Total rows mapped: ${mappedSourceFields.size}; skipped: ${processed.size - mappedSourceFields.size}`);
        return { mappedRows: mappedSourceFields.size, attemptedRows: processed.size, skippedRows: processed.size - mappedSourceFields.size };

    } catch (err) {
        // The mapping screen is asynchronous and can be partially available.
        // Return a non-fatal result so the caller can proceed with the job.
        console.warn(`Field mapping ended early: ${err.message || err}`);
        return { mappedRows: 0, attemptedRows: 0, skippedRows: 0, error: String(err.message || err) };
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
