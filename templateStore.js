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
    for (const template of templates) {
      if (Object.hasOwn(template, "description")) {
        delete template.description;
        templatesChanged = true;
      }
      // The export job now supplies TABLE_HOST_PURPOSE. Clear only the old
      // connection-level fallback so the new placeholder is visible; leave
      // every deliberate custom filename intact.
      if (["PROFILE_{host}", "PROFILE_{host}_{timestamp}"].includes(template.fileContract?.destinationFileName)) {
        template.fileContract.destinationFileName = "";
        templatesChanged = true;
      }
    }
    const profilesByKey = new Map();

    for (const definition of catalog.profiles) {
      if (!definition?.key || !definition.name || !definition.type) continue;
      let profile = profiles.find((item) => item.name === definition.name && item.type === definition.type);
      // CX Sales profiles are commonly created manually before the starter
      // catalog is introduced. Reuse the unambiguous existing profile rather
      // than adding a second blank credential record.
      if (!profile && definition.reuseExistingProfileOfType) {
        const matchingProfiles = profiles.filter((item) => item.type === definition.type);
        if (matchingProfiles.length === 1) profile = matchingProfiles[0];
      }
      // Connections contain credentials and must be explicitly created by the
      // user. The catalog can reference an existing matching profile, but it
      // must never add a blank/dummy profile during startup.
      if (!profile) continue;
      profilesByKey.set(definition.key, profile);
    }

    for (const definition of catalog.templates) {
      if (!definition?.name) continue;
      const legacyNames = Array.isArray(definition.legacyNames) ? definition.legacyNames : [];
      const existingTemplate = templates.find((item) => item.id === definition.id)
        || templates.find((item) => item.name === definition.name)
        || templates.find((item) => legacyNames.includes(item.name));
      // A catalog template keeps its stable ID and user-entered credentials,
      // keys, and contract. Only its display name is migrated when the
      // catalog naming convention changes.
      if (existingTemplate) {
        if (existingTemplate.name !== definition.name && existingTemplate.id === definition.id) {
          existingTemplate.name = definition.name;
          templatesChanged = true;
        }
        if (definition.kind === "direct" && existingTemplate.fileContract) {
          delete existingTemplate.fileContract;
          templatesChanged = true;
        }
        if (definition.kind === "direct" && existingTemplate.kind !== "direct") {
          existingTemplate.kind = "direct";
          templatesChanged = true;
        }
        continue;
      }
      const source = profilesByKey.get(definition.sourceProfileKey);
      const destination = profilesByKey.get(definition.destinationProfileKey);
      if (!source || !destination) continue;
      const isDirect = definition.kind === "direct";
      const compressed = definition.compression || definition.fileContract?.compression || "none";
      const contract = isDirect ? null : {
        format: "CSV",
        filePatternMode: "automatic",
        filePattern: "",
        charset: "UTF-8",
        csvParser: "RFC 4180",
        delimiter: ",",
        destinationFileName: "",
        dateFormat: "yyyy-MM-dd-HH-mm-ss-SSS",
        compression: compressed,
        decryptionPassphrase: "",
        encryptionFile: "",
        decryptionFile: "",
        ...(definition.fileContract || {}),
        compression: compressed
      };
      if (contract && !contract.filePattern && contract.filePatternMode === "automatic") {
        contract.filePattern = compressed === "gzip" ? "^PROFILE_.*\\.gz$" : compressed === "PGP" ? "^PROFILE_.*\\.pgp$" : "";
      }
      const template = {
          id: definition.id || `catalog-${definition.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name: definition.name,
          source: { profileId: source.id, type: source.type },
          destination: { profileId: destination.id, type: destination.type },
          kind: isDirect ? "direct" : "file"
      };
      if (contract) template.fileContract = contract;
      templates.push(template);
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
  return { id: template.id, name: template.name, sourceType: template.source?.type || "", destinationType: template.destination?.type || "", kind: template.kind || "file", format: template.kind === "direct" ? "Direct" : (contract.format || "CSV"), compression: template.kind === "direct" ? "" : (contract.compression || "none") };
}
