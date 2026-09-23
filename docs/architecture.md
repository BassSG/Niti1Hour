# Architecture & service workflow

## Separate service boundary

LINE OA เดิมเลือกเปิด LIFF ของบริการซัก–อบ–พับ แต่เว็บและข้อมูลบริการนี้เป็นคนละชุดกับระบบรีดผ้า/ซักแห้ง ขณะนี้ยังไม่มีการแก้ Rich Menu, alias หรือ webhook production. Staging Worker เสิร์ฟ assets/API ของบริการใหม่แยกชื่อจาก Worker เดิม.

```text
LINE OA → LIFF customer/admin → staging Worker → signed request → Apps Script → Niti1Hour Sheet
        └→ ลูกค้าส่งสลิปในแชต OA เดิม → แอดมินบันทึกยอดที่แจ้ง → ตรวจเงินจริง
```

## Customer lifecycle

1. ลูกค้าเลือกเครื่องซัก/อบและยอมรับเงื่อนไข → ส่งคำขอ; ระบบบันทึกยอดประเมินเป็น snapshot กับรายการ และแสดง PromptPay QR ที่ใส่ยอดนี้ทันที
2. QR แรกเป็นยอดประเมินจากเครื่องที่ลูกค้าเลือกและแสดงชื่อบัญชี; น้ำยาซักผ้า/ปรับผ้านุ่มลูกค้านำมาเอง หากขอให้ร้านจัดหา จะโอนค่าน้ำยาเพิ่มตามที่ร้านแจ้ง
3. เมื่อมีคำขอ ระบบส่ง Flex ให้แอดมินหนึ่งบัญชีและบันทึกคิวแจ้งเตือนสำหรับลองซ้ำ; LINE push นี้นับตามจำนวนผู้รับหนึ่งราย
4. ลูกค้าโอนยอดประเมินและส่งสลิปในแชต LINE OA → แอดมินบันทึกยอดที่แจ้งและตรวจยอดเงินจริง; งานยังต้องผ่านการรับผ้าและตรวจผ้าก่อนเริ่ม
5. ร้านยืนยันเครื่อง/ราคาจริง; ถ้าเปลี่ยนยอด ระบบหักเงินที่ตรวจแล้วและแสดง QR เฉพาะส่วนที่ยังขาด ถ้ารับเกินบิลล่าสุดต้องจัดการส่วนต่างด้วยคน
6. ถ้าร้านจัดหาน้ำยา ต้องแจ้งยอดเพิ่มและรอลูกค้ายืนยัน; ลูกค้าโอนเพิ่มตามยอดที่ขาด และแอดมินตรวจแต่ละยอดจริงก่อนสถานะ `paid`
7. แอดมินเลือกเลขเครื่องที่ว่างและกดเริ่มจริง → `washing` หรือ `drying`; timer เริ่มตอนนี้
8. ก่อนครบเวลาประมาณ 5 นาที ระบบส่ง Flex ให้แอดมินบัญชีเดียว ระบุซัก/อบและเลขเครื่อง ไม่เปลี่ยน state; ซักเสร็จไป `drying_pending`; อบเสร็จไป `folding`
9. หลังพับ/ตรวจ แอดมินกด `ready`, เลือกส่ง LINE เอง แล้วบันทึกรับคืนเป็น `collected`

## State map

`awaiting_dropoff → awaiting_quote → awaiting_payment → payment_review → paid → washing → drying_pending → drying → folding → ready → collected`. สามารถบันทึกยอดประเมินใน `awaiting_dropoff`/`awaiting_quote` ได้ก่อน และ `payment_state=partial` จะตามยอดตรวจจริงจนกว่าจะครบบิล; เมื่อยืนยันบิลแล้วและยอดครบ ระบบไป `paid`.

Manual-supply branch: `awaiting_quote → awaiting_customer_quote_acceptance → awaiting_payment` (or back to `awaiting_quote`). Timer state is separate from order state. Cancellation and adjustments need reasoned admin workflows before production.

## Data ownership

The dedicated Sheet is the source of truth. `Sheet1` is preserved. New tabs are append-only transaction tables; row numbers are not business IDs. Prices are snapshotted per quote version, including the initial customer-selected estimate. `Payments` records each reported and verified transfer; verified totals are subtracted before a new QR is displayed. `Events` and `Idempotency` protect audit/retry behavior; queued/sent admin notice events support a one-recipient retry loop. `Migrations` records schema version. ผู้ใช้เลือกคงสิทธิ์ Drive แบบ Anyone with link และปิดอัปโหลดสลิปผ่านเว็บ จึงไม่มีเส้นทางอัปโหลด/เปิดภาพใน API หรือ Apps Script. Worker สร้าง payload PromptPay ด้วยยอดที่อ่านจากรายการของลูกค้าฝั่ง Apps Script; `PROMPTPAY_ID` ต้องเก็บเป็น Cloudflare secret และห้ามฝังใน HTML/โค้ด/รายงาน. แอดมินตรวจสลิปในแชต LINE OA และยอดเงินจริงจากบัญชีด้วยตนเอง. QR ใน DEMO เป็น QR ที่เข้ารหัสข้อความตัวอย่าง ไม่ใช่ QR PromptPay.

## Price rules awaiting final owner confirmation

Single washer + single dryer cycle only in this release. Service tier map: washer 9→30, 14/18→40, 27→50; dryer 14→30, 21→40, 25→50; take the higher tier of the selected pair. Do not infer multi-cycle pricing. If actual work requires a different machine/cycle, revise the quote before payment and keep the prior quote snapshot in `OrderItems`.
