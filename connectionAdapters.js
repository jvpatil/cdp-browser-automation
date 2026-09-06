/*
 * Provider-adapter registry.
 *
 * This is intentionally the only place to add CDP field selectors for a new
 * provider. The profile editor collects the logical field names below; the
 * adapter turns those values into source/destination form interactions.
 */
window.CDP_CONNECTION_ADAPTERS = {
  "Oracle Object Storage": {
    status: "ready",
    fields: ["path", "endpoint", "key", "secret"],
    source: { name: "source-name-input|input", sourceId: "source-id-input|input", save: "create-source-saveClose", fields: { path: "oos-path|input", endpoint: "oos-storeEndpoint|input", key: "oos-storeKey|input", secret: "oos-storeSecret|input" } },
    destination: { name: "source-name-input|input", destinationId: "destination-id-input|input", save: "dst-saveClose-btn", fields: { path: "oos-path|input", endpoint: "oos-storeEndpoint|input", key: "oos-storeKey|input", secret: "oos-storeSecret|input" } }
  },
  "Secure FTP": {
    status: "ready",
    fields: ["server", "authenticationKey", "folder"],
    source: { name: "source-name-input|input", sourceId: "source-id-input|input", save: "create-source-saveClose", fields: { server: "server-name|input", folder: "folder-name-input|input", authenticationKey: "input[type=file]" } },
    destination: { name: "source-name-input|input", destinationId: "destination-id-input|input", save: "dst-saveClose-btn", fields: { server: "server-name|input", authenticationKey: "auth-key|input", folder: "folder-name-input|input", fileName: "file-name|input" } },
    note: "Capture the live verify/save interaction before enabling."
  },
  "AWS": {
    status: "ready",
    fields: ["path", "endpoint", "accessKey", "secretKey"],
    source: { name: "source-name-input|input", sourceId: "source-id-input|input", save: "create-source-saveClose", fields: { path: "oos-path|input", endpoint: "oos-storeEndpoint|input", accessKey: "oos-storeKey|input", secretKey: "oos-storeSecret|input" } },
    destination: { name: "source-name-input|input", destinationId: "destination-id-input|input", save: "dst-saveClose-btn", fields: { path: "oos-path|input", endpoint: "oos-storeEndpoint|input", accessKey: "oos-storeKey|input", secretKey: "oos-storeSecret|input" } },
    note: "Capture the live verify/save interaction before enabling."
  },
  "Google Cloud Storage": {
    status: "ready",
    fields: ["path", "endpoint", "key", "secret"],
    source: { name: "source-name-input|input", sourceId: "source-id-input|input", save: "create-source-saveClose", fields: { path: "oos-path|input", endpoint: "oos-storeEndpoint|input", key: "oos-storeKey|input", secret: "oos-storeSecret|input" } },
    destination: { name: "source-name-input|input", destinationId: "destination-id-input|input", save: "dst-saveClose-btn", fields: { path: "oos-path|input", endpoint: "oos-storeEndpoint|input", key: "oos-storeKey|input", secret: "oos-storeSecret|input" } },
    note: "Capture the live verify/save interaction before enabling."
  },
  "Salesforce CRM": {
    status: "ready",
    fields: ["instanceUrl", "clientId", "clientSecret", "securityToken", "username", "password"],
    source: { name: "source-name-input|input", sourceId: "source-id-input|input", save: "create-source-saveClose", fields: { instanceUrl: "auth-url|input", clientId: "ClientIdInput|input", clientSecret: "ClientSecretEncryptedInput|input", securityToken: "SecurityTokenEncryptedInput|input", username: "UsernameInput|input", password: "PasswordEncryptedInput|input" } },
    destination: { name: "source-name-input|input", destinationId: "destination-id-input|input", save: "dst-saveClose-btn", fields: { instanceUrl: "auth-url|input", clientId: "ClientIdInput|input", clientSecret: "ClientSecretEncryptedInput|input", securityToken: "SecurityTokenEncryptedInput|input", username: "UsernameInput|input", password: "PasswordEncryptedInput|input" } },
    note: "Capture the live verify/save interaction before enabling."
  },
  "CX Sales": {
    status: "ready",
    fields: ["serviceUrl", "username", "password"],
    source: { name: "source-name-input|input", sourceId: "source-id-input|input", save: "create-source-saveClose", fields: { serviceUrl: "auth-url|input", username: "UsernameInput|input", password: "PasswordEncryptedInput|input" } },
    note: "Capture the live Source and Destination form selectors before enabling."
  }
};
