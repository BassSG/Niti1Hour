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
- [ ] Configure LIFF ID and verify it belongs to the same LINE provider as the OA Messaging API channel.
- [ ] Configure verified admin LINE user IDs and decide Owner/Staff roles.
- [ ] Configure PromptPay recipient/QR approach and verify amount/recipient before showing any payment QR.
- [ ] Approve customer terms: sorting/color bleed, care-label, drying outcome, items not accepted, and claim/compensation wording.
- [x] Owner chose to retain Anyone-with-link viewer access on the supplied Drive folders; web upload and retrieval remain disabled.

## C. Staging test (no real customer data)

- [ ] Check `/health` says `mode: demo` and displays the released commit SHA.
- [ ] Try all price examples: 9+14=110; 14+21=150; 18+21=170; 27+25=220.
- [ ] Try all combinations; higher service tier controls fee.
- [ ] Create/advance only demo orders; verify customer-order state labels and all admin queue buckets.
- [ ] Test manual supply quote: no total/payment until customer accepts.
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
