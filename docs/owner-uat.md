# Owner UAT & go-live gates

This checklist is mandatory. A successful staging/demo deploy is not a production launch.

## A. Audit baseline

- [x] Confirmed supplied GitHub repository was empty before work.
- [x] Confirmed supplied Apps Script project had only the starter `Code.gs`, zero deployments and zero triggers.
- [x] Confirmed supplied Sheet had empty `Sheet1`; no existing shop data was migrated or deleted.
- [x] Confirmed dedicated Drive folder initially had no files; created separate `payment-proofs` and `service-photos` child folders.
- [x] Inspected the existing laundry Worker read-only; no changes to its deploy, routes, menu, or webhook.

## B. Owner decisions still required

- [ ] Confirm 30/40/50 service fee mapping and whether any order can use multiple cycles. Current implementation is single wash + single dry cycle.
- [ ] Provide/enter real washer/dryer display numbers and capacity mapping in `Machines`.
- [x] Created a separate LINE Login channel `2011712978` (“นิติ รีดเรียบ บริการ”) under provider EBassWave and linked it to `@031zrlhu/นิติ รีดเรียบ`. Customer LIFF `2011712978-YfVzJ8rn` points to `/customer/`; admin LIFF `2011712978-lnzgYFc8` points to `/admin/`. Both request only `openid`, have the add-friend prompt off, and remain on a Developing channel and DEMO website. The unrelated `2006452639` (“LIFF TEST”) channel was not changed.
- [ ] Before real use, publish the new LINE Login channel after owner UAT, test both LIFF URLs with controlled LINE accounts, verify the admin allowlist, and approve the switch from DEMO to live. Creating LIFF apps alone does not configure a Rich Menu or make the service live.
- [ ] Verify the intended single admin LINE account is a friend of this OA and configure it as Worker secret `ADMIN_NOTIFY_USER_ID`; separately configure the admin allowlist in Worker and Apps Script.
- [ ] Rotate the channel access token that was shared in chat, then store the replacement only as Worker secret `LINE_CHANNEL_ACCESS_TOKEN`. Check that the Messaging API channel is the shop's intended OA.
- [ ] Provide the shop's original, unredacted PromptPay QR or recipient ID; set only the ID as Cloudflare Worker secret `PROMPTPAY_ID` (never in source/HTML/logs).
- [ ] Before showing a real payment QR, scan a test amount with the owner's bank app and verify the recipient name, exact amount, and downloadable PNG.
- [ ] Approve customer terms: sorting/color bleed, care-label, drying outcome, items not accepted, and claim/compensation wording.
- [x] Owner chose to retain Anyone-with-link viewer access on the supplied Drive folders; web upload and retrieval remain disabled.

## C. Staging test (no real customer data)

- [ ] Check `/health` says `mode: demo` and displays the released commit SHA.
- [ ] Try all price examples: 9+14=110; 14+21=150; 18+21=170; 27+25=220.
- [ ] Create a DEMO order and verify the estimate QR is visibly marked as non-payable and the downloaded PNG retains the DEMO warning.
- [ ] In controlled UAT, verify the customer's selected-size estimate is prefilled in PromptPay; if shop-supplied products are selected, verify the initial QR excludes that unquoted product cost and the confirmed QR changes only after customer acceptance.
- [ ] Verify the account name shown on the page/downloaded image matches the name displayed by a banking app after scanning. A name string alone does not configure PromptPay.
- [ ] Test an early 110-baht transfer, inspection that adds a 20-baht product cost, and a second QR for only 20 baht. Verify each transfer against the bank separately and confirm the machine cannot start before the full bill is verified.
- [ ] Test that a new order pushes one Flex only to the selected admin account, and a wash/dry timer pushes one Flex with the correct machine number around five minutes before due; also test retry without duplicate delivery.
- [ ] Test an inspection that changes the selected machine size after the customer has paid the estimate; reconcile any difference manually and do not start the machine until the actual received amount matches the confirmed bill. Automated refund/partial-payment reconciliation is not implemented.
- [ ] Try all combinations; higher service tier controls fee.
- [ ] Create/advance only demo orders; verify customer-order state labels and all admin queue buckets.
- [ ] Test manual supply quote: base service may be paid first; the product cost is charged separately after customer accepts.
- [ ] Test that slip upload and retrieval URLs have no route and the customer page has no upload control.
- [ ] Test admin can record the amount a customer reports in the LINE OA chat only when it matches the confirmed bill; test actual bank verification separately.
- [ ] Check timers start only on actual machine start and complete without auto-advancing or customer notification.
- [ ] Check ready notice requires a separate explicit click; collect removes from open queue but retains history.
- [ ] Test double-click, retry, wrong/expired LINE token, slow network, mobile and desktop.

## D. Real UAT after configuration

Use owner/staff LINE accounts and an explicitly labeled test order; do not message ordinary customers. Verify actual money is not accepted automatically, LINE notice reaches only the correct test account, no images are stored in the link-shared Drive folders, and old dry-cleaning/pressing workflows still work unchanged.

## E. Production approval gate

Only after every required test above passes, the owner explicitly approves go-live. Before changing any Rich Menu/webhook, save current menu IDs/aliases, default and per-user assignments, webhook destination and existing deployment identifier; test the replacement against a controlled account. Keep slip exchange in the existing LINE OA chat. Have the rollback procedure open and verified.

## F. What staging is not

DEMO is not a real order service: it has no live LINE identity, backend write, PromptPay QR, payment, Drive upload, timer push or customer notification. Never tell a customer to pay/use this demo link.
