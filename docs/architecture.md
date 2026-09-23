# Architecture & service workflow

## Separate service boundary

LINE OA เดิมเลือกเปิด LIFF ของบริการซัก–อบ–พับ แต่เว็บและข้อมูลบริการนี้เป็นคนละชุดกับระบบรีดผ้า/ซักแห้ง ขณะนี้ยังไม่มีการแก้ Rich Menu, alias หรือ webhook production. Staging Worker เสิร์ฟ assets/API ของบริการใหม่แยกชื่อจาก Worker เดิม.

```text
LINE OA → LIFF customer/admin → staging Worker → signed request → Apps Script → Niti1Hour Sheet
        └→ ลูกค้าส่งสลิปในแชต OA เดิม → แอดมินบันทึกยอดที่แจ้ง → ตรวจเงินจริง
```

## Customer lifecycle

1. เลือกเครื่องซัก/อบและยอมรับเงื่อนไข → ส่งคำขอ ไม่ใช่ยืนยันบิล
2. ร้านรับและตรวจผ้าจริง → ยืนยันเครื่อง/ราคา/จำนวนรอบ
3. ถ้าร้านจัดหาน้ำยา ต้องแจ้งยอดเพิ่มและรอลูกค้ายืนยัน; ห้ามสร้างยอดสุดท้ายก่อนยืนยัน
4. ลูกค้าชำระตามยอดที่ร้านยืนยันและส่งสลิปในแชต LINE OA เดิม → แอดมินบันทึกยอดที่ลูกค้าแจ้ง → `payment_review`
5. ร้านเทียบเงินจริง/ยอดบิล/ยอดแจ้ง แล้วแอดมินยืนยัน → `paid`
6. แอดมินเลือกเลขเครื่องที่ว่างและกดเริ่มจริง → `washing` หรือ `drying`; timer เริ่มตอนนี้
7. ครบเวลาเป็นเพียงการเตือนแอดมิน ไม่เปลี่ยน state; ซักเสร็จไป `drying_pending`; อบเสร็จไป `folding`
8. หลังพับ/ตรวจ แอดมินกด `ready`, เลือกส่ง LINE เอง แล้วบันทึกรับคืนเป็น `collected`

## State map

`awaiting_dropoff → awaiting_quote → awaiting_payment → payment_review → paid → washing → drying_pending → drying → folding → ready → collected`

Manual-supply branch: `awaiting_quote → awaiting_customer_quote_acceptance → awaiting_payment` (or back to `awaiting_quote`). Timer state is separate from order state. Cancellation and adjustments need reasoned admin workflows before production.

## Data ownership

The dedicated Sheet is the source of truth. `Sheet1` is preserved. New tabs are append-only transaction tables; row numbers are not business IDs. Prices are snapshotted per quote version. `Events` and `Idempotency` protect audit/retry behavior; `Migrations` records schema version. ผู้ใช้เลือกคงสิทธิ์ Drive แบบ Anyone with link และปิดอัปโหลดสลิปผ่านเว็บ จึงไม่มีเส้นทางอัปโหลด/เปิดภาพใน API หรือ Apps Script. แอดมินตรวจสลิปในแชต LINE OA และยอดเงินจริงจากบัญชีด้วยตนเอง.

## Price rules awaiting final owner confirmation

Single washer + single dryer cycle only in this release. Service tier map: washer 9→30, 14/18→40, 27→50; dryer 14→30, 21→40, 25→50; take the higher tier of the selected pair. Do not infer multi-cycle pricing. If actual work requires a different machine/cycle, revise the quote before payment and keep the prior quote snapshot in `OrderItems`.
