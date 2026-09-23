import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { lineSubject, routeSpec } from './index.js';

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
  assert.deepEqual(routeSpec('POST', '/api/admin/orders/WD-1/report-payment-from-chat'), { action: 'admin.report-payment-from-chat', role: 'admin', orderId: 'WD-1' });
  assert.equal(routeSpec('POST', '/api/orders/WD-260923-ABC123/slip'), null);
  assert.equal(routeSpec('GET', '/api/admin/orders/WD-1/slip'), null);
  assert.equal(routeSpec('POST', '/api/orders/WD-1/payment'), null);
  assert.equal(routeSpec('DELETE', '/api/orders/WD-1'), null);
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
