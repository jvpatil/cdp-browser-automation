/* Local transfer-template store. Credentials and key-file data are dummy
 * automation values, so no vault or unlock step is required. */
const CDP_TEMPLATE_STORE_KEY = "cdpTransferTemplates";
const CDP_CONNECTION_PROFILE_STORE_KEY = "cdpConnectionProfiles";
let cdpStarterRecordsPromise;

/*
 * The editable catalog is bundled with the unpacked extension.  Its entries
 * are added when missing, including after a new extension ID is loaded, but
 * never overwrite a profile or template that was edited in the browser.
 */
async function cdpEnsureStarterTransferRecords() {
  if (cdpStarterRecordsPromise) return cdpStarterRecordsPromise;

  cdpStarterRecordsPromise = (async () => {
    const response = await fetch(chrome.runtime.getURL("config/transfer-catalog.json"));
    if (!response.ok) throw new Error("Could not load config/transfer-catalog.json.");
    const catalog = await response.json();
    if (!Array.isArray(catalog.profiles) || !Array.isArray(catalog.templates)) {
      throw new Error("Transfer catalog must contain profiles and templates arrays.");
    }
    const stored = await chrome.storage.local.get([
      CDP_TEMPLATE_STORE_KEY,
      CDP_CONNECTION_PROFILE_STORE_KEY
    ]);
    const profiles = Array.isArray(stored[CDP_CONNECTION_PROFILE_STORE_KEY])
      ? [...stored[CDP_CONNECTION_PROFILE_STORE_KEY]]
      : [];
    const templates = Array.isArray(stored[CDP_TEMPLATE_STORE_KEY])
      ? [...stored[CDP_TEMPLATE_STORE_KEY]]
      : [];
    let profilesChanged = false;
    let templatesChanged = false;
    const profilesByKey = new Map();

    for (const definition of catalog.profiles) {
      if (!definition?.key || !definition.name || !definition.type) continue;
      let profile = profiles.find((item) => item.name === definition.name && item.type === definition.type);
      if (!profile) {
        profile = {
          id: `catalog-${definition.key}-profile`,
          name: definition.name,
          type: definition.type,
          fields: { ...(definition.fields || {}) }
        };
        profiles.push(profile);
        profilesChanged = true;
      }
      profilesByKey.set(definition.key, profile);
    }

    for (const definition of catalog.templates) {
      if (!definition?.name || templates.some((item) => item.name === definition.name)) continue;
      const source = profilesByKey.get(definition.sourceProfileKey);
      const destination = profilesByKey.get(definition.destinationProfileKey);
      if (!source || !destination) continue;
      const compressed = definition.compression || definition.fileContract?.compression || "none";
      const contract = {
        format: "CSV",
        filePatternMode: "automatic",
        filePattern: "",
        charset: "UTF-8",
        csvParser: "RFC 4180",
        delimiter: ",",
        destinationFileName: "PROFILE_{host}",
        dateFormat: "yyyy-MM-dd-HH-mm-ss-SSS",
        compression: compressed,
        decryptionPassphrase: "",
        encryptionFile: "",
        decryptionFile: "",
        ...(definition.fileContract || {}),
        compression: compressed
      };
      if (!contract.filePattern && contract.filePatternMode === "automatic") {
        contract.filePattern = compressed === "gzip" ? "^PROFILE_.*\\.gz$" : compressed === "PGP" ? "^PROFILE_.*\\.pgp$" : "";
      }
      templates.push({
          id: definition.id || `catalog-${definition.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name: definition.name,
          description: definition.description || "Starter transfer template — add connection values to the selected profile.",
          source: { profileId: source.id, type: source.type },
          destination: { profileId: destination.id, type: destination.type },
          fileContract: contract
      });
      templatesChanged = true;
    }

    const writes = {};
    if (profilesChanged) writes[CDP_CONNECTION_PROFILE_STORE_KEY] = profiles;
    if (templatesChanged) writes[CDP_TEMPLATE_STORE_KEY] = templates;
    if (Object.keys(writes).length) await chrome.storage.local.set(writes);
  })();

  return cdpStarterRecordsPromise;
}

async function cdpReadTemplates() {
  await cdpEnsureStarterTransferRecords();
  const { [CDP_TEMPLATE_STORE_KEY]: templates } = await chrome.storage.local.get(CDP_TEMPLATE_STORE_KEY);
  return { locked: false, configured: true, templates: Array.isArray(templates) ? templates : [] };
}

async function cdpWriteTemplates(templates) {
  if (!Array.isArray(templates)) throw new Error("Template data is invalid.");
  await chrome.storage.local.set({ [CDP_TEMPLATE_STORE_KEY]: templates });
}

async function cdpReadConnectionProfiles() {
  await cdpEnsureStarterTransferRecords();
  const { [CDP_CONNECTION_PROFILE_STORE_KEY]: profiles } = await chrome.storage.local.get(CDP_CONNECTION_PROFILE_STORE_KEY);
  return Array.isArray(profiles) ? profiles : [];
}

async function cdpWriteConnectionProfiles(profiles) {
  if (!Array.isArray(profiles)) throw new Error("Connection-profile data is invalid.");
  await chrome.storage.local.set({ [CDP_CONNECTION_PROFILE_STORE_KEY]: profiles });
}

function cdpTemplateSummary(template) {
  const contract = template.fileContract || {};
  return { id: template.id, name: template.name, description: template.description || "", sourceType: template.source?.type || "", destinationType: template.destination?.type || "", format: contract.format || "CSV", compression: contract.compression || "none" };
}
