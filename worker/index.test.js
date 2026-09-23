import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import worker, { adminRecipient, adminOrderFlex, timerFlex, pushAdminFlex, lineSubject, promptpayPayload, routeSpec } from './index.js';

test('LINE ID-token verification uses verified issuer, audience, subject, and expiration claims', async () => {
  let requestBody;
  const fetchStub = async (_url, init) => {
    requestBody = new URLSearchParams(init.body);
    return Response.json({ iss: 'https://access.line.me', sub: 'U-demo-user', aud: '1234567890', exp: Math.floor(Date.now() / 1000) + 120 });
  };
  const request = new Request('https://staging.example/api/orders', { method: 'POST', headers: { authorization: 'Bearer test-id-token' }, body: '{}' });
  const subject = await lineSubject(request, { LIFF_ID: '1234567890' }, fetchStub);
  assert.equal(subject.lineUserId, 'U-demo-user');
  assert.equal(requestBody.get('id_token'), 'test-id-token');
  assert.equal(requestBody.get('client_id'), '1234567890');
});

test('LINE ID-token verification rejects an audience mismatch and an expired token', async () => {
  const request = new Request('https://staging.example/api/orders', { method: 'POST', headers: { authorization: 'Bearer test-id-token' }, body: '{}' });
  const invalidAudience = async () => Response.json({ iss: 'https://access.line.me', sub: 'U-demo-user', aud: 'wrong', exp: Math.floor(Date.now() / 1000) + 120 });
  await assert.rejects(lineSubject(request, { LIFF_ID: '1234567890' }, invalidAudience), { code: 'LINE_TOKEN_INVALID' });
  const expired = async () => Response.json({ iss: 'https://access.line.me', sub: 'U-demo-user', aud: '1234567890', exp: Math.floor(Date.now() / 1000) - 1 });
  await assert.rejects(lineSubject(request, { LIFF_ID: '1234567890' }, expired), { code: 'LINE_TOKEN_INVALID' });
});

test('payment slips stay outside the app while admin can record LINE chat reports', () => {
  assert.deepEqual(routeSpec('GET', '/api/catalog'), { action: 'catalog', role: 'public' });
  assert.deepEqual(routeSpec('GET', '/api/orders/WD-1/payment-qr'), { action: 'customer.paymentQr', role: 'customer', orderId: 'WD-1' });
  assert.deepEqual(routeSpec('POST', '/api/admin/orders/WD-1/report-payment-from-chat'), { action: 'admin.report-payment-from-chat', role: 'admin', orderId: 'WD-1' });
  assert.equal(routeSpec('POST', '/api/orders/WD-260923-ABC123/slip'), null);
  assert.equal(routeSpec('GET', '/api/admin/orders/WD-1/slip'), null);
  assert.equal(routeSpec('POST', '/api/orders/WD-1/payment'), null);
  assert.equal(routeSpec('DELETE', '/api/orders/WD-1'), null);
});

test('PromptPay QR payload contains a server-selected amount and renders to a downloadable PNG', async () => {
  const payload = promptpayPayload('0812345678', 110);
  assert.match(payload, /5303764/);
  assert.match(payload, /5406110\.00/);
  const png = await QRCode.toDataURL(payload, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
  assert.match(png, /^data:image\/png;base64,/);
});

test('PromptPay QR generation rejects incomplete recipient configuration and invalid amounts', () => {
  assert.throws(() => promptpayPayload('', 110), { code: 'PROMPTPAY_NOT_CONFIGURED' });
  assert.throws(() => promptpayPayload('0812345678', 0), { code: 'INVALID_PAYMENT_AMOUNT' });
  assert.throws(() => promptpayPayload('0812345678', 110.001), { code: 'INVALID_PAYMENT_AMOUNT' });
});

test('admin LINE alert targets one configured account and includes order and machine number', async () => {
  const to = 'U' + '1'.repeat(32);
  const order = { orderId: 'WD-1', displayName: 'ลูกค้าทดสอบ', washerKg: 9, dryerKg: 14, paymentAmountBaht: 110, supplyMode: 'customer_own' };
  const message = adminOrderFlex(order);
  assert.equal(message.type, 'flex');
  assert.match(JSON.stringify(message), /WD-1/);
  assert.match(JSON.stringify(message), /110/);
  const timer = timerFlex({ timerId: 'timer-1', orderId: 'WD-1', stage: 'wash', machineDisplayNo: '12', dueAt: '2026-09-23T10:30:00.000Z' }, Date.parse('2026-09-23T10:26:00.000Z'));
  assert.match(JSON.stringify(timer), /เครื่องซัก เลข 12/);
  assert.match(JSON.stringify(timer), /4 นาที/);
  assert.equal(adminRecipient({ ADMIN_NOTIFY_USER_ID: to + ',U' + '2'.repeat(32) }), '');
  let pushed;
  await pushAdminFlex(message, 'new-order:WD-1', { ADMIN_NOTIFY_USER_ID: to, LINE_CHANNEL_ACCESS_TOKEN: 'dummy' }, async (_url, init) => {
    pushed = { header: init.headers['x-line-retry-key'], body: JSON.parse(init.body) };
    return new Response('', { status: 200 });
  });
  assert.equal(pushed.body.to, to);
  assert.equal(pushed.body.messages.length, 1);
  assert.match(pushed.header, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('demo API exposes catalog but rejects every write without contacting real services', async () => {
  const env = { DEMO_MODE: 'true', ASSETS: { fetch: async () => new Response('asset') } };
  const catalog = await worker.fetch(new Request('https://stage.example/api/catalog'), env, {});
  assert.equal(catalog.status, 200);
  assert.equal((await catalog.json()).data.mode, 'demo');
  const write = await worker.fetch(new Request('https://stage.example/api/orders', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ washerKg: 9, dryerKg: 14 }),
  }), env, {});
  assert.equal(write.status, 403);
  assert.equal((await write.json()).error.code, 'DEMO_READ_ONLY');
  const paymentQr = await worker.fetch(new Request('https://stage.example/api/orders/WD-1/payment-qr'), env, {});
  assert.equal(paymentQr.status, 403);
  assert.equal((await paymentQr.json()).error.code, 'DEMO_READ_ONLY');
});

test('customer and admin pages receive only public demo configuration', async () => {
  const env = {
    DEMO_MODE: 'true', LIFF_ID: '',
    ASSETS: { fetch: async () => new Response('<html><head></head><body>demo</body></html>', { headers: { 'content-type': 'text/html' } }) },
  };
  const response = await worker.fetch(new Request('https://stage.example/admin/'), env, {});
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /"demo":true/);
  assert.match(html, /"liffId":""/);
});
