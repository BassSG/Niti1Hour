# Staging and production rollback

## Staging

The Worker name is `niti1hour-valet-staging`, with `workers.dev` only, no custom domain/route, and `DEMO_MODE=true`. Roll back by redeploying the previous saved Worker version from Cloudflare dashboard or `wrangler rollback` in the same account. Confirm `/health` after rollback. Do not delete the Google Sheet or files to roll back code.

## Before any production cutover

1. Export the current LINE Rich Menu images, IDs, aliases, default menu and per-user assignments; note the existing webhook URL and production Worker version.
2. Save the current production source/commit and test rollback access before changing any endpoint.
3. Change one controlled Rich Menu assignment first; verify the old menu still operates. Do not replace the shared webhook for this LIFF-first design.
4. If a webhook router is later approved, deploy it dark first, verify signature and forwarding/regression tests, then switch endpoint. Rollback means restoring the saved old webhook and menu assignments—not deleting data.
5. Keep transaction rows and Events. Correct erroneous orders with an audited compensating action; never erase production rows to simulate rollback.

## Credentials

Keep Worker bindings in Cloudflare secret/environment settings and Apps Script credentials in Script Properties. Rotate exposed credentials rather than copying them into a backup or report. Record names and owners of settings, not their values.
