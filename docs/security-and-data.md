# Security and data handling

- No token, channel secret, HMAC secret, account number, or admin ID belongs in Git, static assets, Sheet cells, logs, or chat.
- Worker↔Apps Script uses timestamp + random nonce + HMAC-SHA256; Apps Script rejects expired/replayed requests and writes under a script lock with an idempotency ledger.
- LINE identity is taken from the server-verified ID token payload (`iss`, `sub`, `aud`, `exp`), never from a user ID supplied by the browser. Admin writes and slip retrieval require a verified ID on an allowlist.
- Slip images are limited to JPG/PNG/WebP and 5 MiB. Drive IDs, not public URLs, are stored in Sheet. Admin image reads go through the authenticated API.
- Log only request ID, action, status, and error code; do not log tokens, image contents, full LINE payloads, or bank credentials.
- The demo API rejects all writes. No live credentials or Script Properties have been configured in source.
- Apps Script manifest asks for spreadsheet and Drive OAuth scopes. The owner must review and approve Google authorization before running setup or creating/accessing private files.

## Current data model

`Customers`, `Orders`, `OrderItems`, `Machines`, `Payments`, `Timers`, `Files`, `Events`, `Settings`, `Idempotency`, `Migrations`. Setup is additive; `Sheet1` remains untouched.
