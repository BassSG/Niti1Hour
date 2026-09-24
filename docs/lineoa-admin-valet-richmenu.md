# LINE OA — Admin Rich Menu for Wash–Dry–Fold

## Intended experience

- The existing admin menu keeps its current six shop actions. Its top-right tile is the only switch into a dedicated wash–dry–fold admin Rich Menu.
- The wash–dry–fold admin menu has six queue actions: waiting to wash, washing, waiting to dry, drying, folding, and ready for pickup. Each action replies privately to the staff member who tapped it.
- The washing and drying replies are Flex carousels, one Bubble per order, with the assigned machine number. An unassigned machine is shown as a warning, never guessed. A reply is limited to 12 Bubbles.
- The wash–dry–fold menu has exactly one web entry and one switch-back action to the existing admin menu.

## Current verified state — 2026-09-24 (Bangkok)

- The dedicated `Niti1Hour` spreadsheet is the WDF queue database. It contains `Orders`, `Customers`, `Machines`, `Timers`, and the other operational tabs; it does **not** contain a `RichMenus` tab.
- Rich Menu configuration belongs to the legacy `Nitiซักแห้ง` spreadsheet, tab `RichMenus`. The main `ADMIN` row is row 3 and currently points to LINE menu `richmenu-947fd86f9de020945bfe8a34bc0140c5`.
- New premium main-admin artwork is committed locally at `assets/richmenus/admin-main-valet-v2.jpg` and uploaded to Drive as `admin-main-valet-v2.jpg` (file ID `10Jao5_bB7SC1WaNmLs9f0p1akbQuUJZo`). The `ADMIN` row's `image_file_id` now points to that file. Updating this sheet cell does not change the already-published LINE menu image.
- Legacy Apps Script source was pushed to project HEAD, including the corrected hitbox for the top-right admin-menu switch. No versioned deployment or active LINE menu was replaced in this step.
- The WDF Apps Script project has its sheet ID, shared secret, and admin LINE ID configured in Script Properties. A readiness-audit helper is in source. It has not been run successfully because Google presents an unverified-app authorization warning; the owner must review and authorize it.
- A versioned GAS Web App deployment is still missing. The project has reached Apps Script's 200-version limit; no old versions were deleted. The only listed deployment was an API executable, whose `/exec` check returned 404 for the WDF handler.
- The Cloudflare Worker is staging-only and `/health` reports `mode: demo`, version `7886686`. The authorized secret names are configured in Cloudflare, including the correct LINE OA token and admin-only recipient. Secret values are intentionally not recorded here. `GAS_BACKEND_URL` is not configured because there is no verified WDF web-app deployment.
- The admin/customer staging UI now clears the old seeded/sample orders once on first load in each browser, starts with an empty queue, and exposes a demo-only clear action for later locally created test orders. This does not clear or alter Google Sheets or LINE OA data. The demo label remains visible and demo submissions remain local only.
- The active LINE menu and staff assignment were not switched. `ADMIN_VALET` remains `CONFIG_PENDING`; do not treat the Rich Menu flow or admin Flex notifications as live.
- The connected WDF spreadsheet currently has no real order history. Local UI demo records are browser-only and not proof of backend operation.

## Verification already performed

- Worker and shared JavaScript syntax checks passed; `npm run check` passed 21 tests.
- Rich Menu definitions were simulated: six queue actions, one WDF web entry, and one switch-back action. Simulated washing/drying Bubbles included machine numbers and correctly flagged missing assignments.
- LINE Bot Info was verified for the target OA. This did not verify WDF web-app writes or admin Flex delivery end-to-end.
- The Rich Menu asset in Drive was verified as a JPEG, 2500×1686, approximately 394 KB.

## Remaining before real activation

1. The owner must review the Google OAuth warning and authorize the WDF Apps Script project; Codex must not bypass that warning.
2. Resolve the GAS version cap without deleting historical versions, or explicitly authorize a new backend project if that becomes necessary.
3. Publish and verify the WDF Apps Script Web App, then configure its URL as the Worker `GAS_BACKEND_URL` secret.
4. Run end-to-end staging tests with a non-customer test identity: LIFF auth, order request, quote, QR generation, upload/payment claim, admin review, machine selection, timer alert, and final pickup notification.
5. Only after the owner reviews UAT should the LINE admin menu be created/updated and linked to staff. Do not change the customer Rich Menus or legacy webhook as part of this rollout.

## Rollback

- Keep the currently active LINE `ADMIN` Rich Menu ID and existing staff assignments until the replacement menu is validated.
- The legacy Apps Script source includes `rollbackAdminValetRichMenuFlow()` to restore the saved previous menu alias/staff assignment after activation. Run it only if a rollout has actually occurred; it is not a substitute for preserving the current IDs and link state.
- Leave the new WDF Rich Menu unlinked during staging. Reverting the `ADMIN` image file pointer to its prior value (`1qtfbsa2iKluanLzk28TlGoLJB41l3KJM`) restores the prior source artwork reference; it does not itself alter LINE's published image.
