import { CATALOG, calculateQuote } from '../packages/shared/business.js';
import generatePromptPayPayload from 'promptpay-qr';

const MAX_JSON_BYTES = 6 * 1024 * 1024;
const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function safeError(code, message, status = 400, requestId = '') {
  return json({ ok: false, error: { code, message, requestId } }, status);
}

function b64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

async function lineSubject(request, env, fetchImpl = fetch) {
  if (!env.LIFF_ID) throw Object.assign(new Error('LINE LIFF ยังไม่ได้ตั้งค่า'), { status: 503, code: 'LINE_NOT_CONFIGURED' });
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token.length > 8192) throw Object.assign(new Error('กรุณาเปิดบริการผ่าน LINE เพื่อยืนยันตัวตน'), { status: 401, code: 'LINE_LOGIN_REQUIRED' });
  const form = new URLSearchParams({ id_token: token, client_id: env.LIFF_ID });
  const response = await fetchImpl(LINE_VERIFY_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  if (!response.ok) throw Object.assign(new Error('ยืนยันตัวตน LINE ไม่สำเร็จ กรุณาเข้าใหม่อีกครั้ง'), { status: 401, code: 'LINE_TOKEN_INVALID' });
  const claims = await response.json();
  if (claims.iss !== 'https://access.line.me' || !claims.sub || claims.aud !== env.LIFF_ID || Number(claims.exp) <= Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error('ข้อมูลยืนยันตัวตน LINE ไม่ถูกต้อง'), { status: 401, code: 'LINE_TOKEN_INVALID' });
  }
  return { lineUserId: claims.sub, displayName: typeof claims.name === 'string' ? claims.name : '' };
}

function isAdmin(lineUserId, env) {
  const allowed = String(env.ADMIN_LINE_USER_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return allowed.includes(lineUserId);
}

async function signedGasCall(action, payload, actor, env, requestId) {
  if (!env.GAS_BACKEND_URL || !env.GAS_SHARED_SECRET) {
    throw Object.assign(new Error('ระบบหลังบ้าน staging ยังไม่ได้ตั้งค่าการเชื่อมต่อ'), { status: 503, code: 'BACKEND_NOT_CONFIGURED' });
  }
  const message = JSON.stringify({ action, payload, actor, requestId });
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const signature = await hmac(env.GAS_SHARED_SECRET, timestamp + '\n' + nonce + '\n' + message);
  const response = await fetch(env.GAS_BACKEND_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timestamp, nonce, signature, body: message }),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { throw Object.assign(new Error('ระบบหลังบ้านตอบกลับไม่ใช่ข้อมูล JSON'), { status: 502, code: 'BACKEND_BAD_RESPONSE' }); }
  if (!response.ok || result.ok === false) {
    throw Object.assign(new Error(result.error?.message || 'ทำรายการไม่สำเร็จ'), { status: response.status >= 400 ? response.status : 400, code: result.error?.code || 'BACKEND_REJECTED' });
  }
  return result.data ?? result;
}

async function readRequestJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_JSON_BYTES) throw Object.assign(new Error('ไฟล์มีขนาดใหญ่เกินไป'), { status: 413, code: 'REQUEST_TOO_LARGE' });
  let value;
  try { value = await request.json(); } catch { throw Object.assign(new Error('อ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่'), { status: 400, code: 'INVALID_JSON' }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('รูปแบบข้อมูลไม่ถูกต้อง'), { status: 400, code: 'INVALID_JSON' });
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_JSON_BYTES) {
    throw Object.assign(new Error('ไฟล์มีขนาดใหญ่เกินไป'), { status: 413, code: 'REQUEST_TOO_LARGE' });
  }
  return value;
}

function routeSpec(method, pathname) {
  if (method === 'GET' && pathname === '/api/catalog') return { action: 'catalog', role: 'public' };
  if (method === 'POST' && pathname === '/api/orders') return { action: 'customer.createOrder', role: 'customer' };
  if (method === 'GET' && pathname === '/api/orders') return { action: 'customer.listOrders', role: 'customer' };
  const paymentQr = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/payment-qr$/);
  if (method === 'GET' && paymentQr) return { action: 'customer.paymentQr', role: 'customer', orderId: paymentQr[1] };
  const customerAction = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/(accept-supply|decline-supply)$/);
  if (method === 'POST' && customerAction) return { action: 'customer.' + ({ 'accept-supply': 'acceptSupplyQuote', 'decline-supply': 'declineSupplyQuote' }[customerAction[2]]), role: 'customer', orderId: customerAction[1] };
  const adminId = pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9_-]+)\/([a-z-]+)$/);
  if (method === 'POST' && adminId) return { action: 'admin.' + adminId[2], role: 'admin', orderId: adminId[1] };
  if (method === 'GET' && pathname === '/api/admin/queue') return { action: 'admin.queue', role: 'admin' };
  if (method === 'GET' && pathname === '/api/admin/timers/due') return { action: 'admin.dueTimers', role: 'admin' };
  return null;
}

function promptpayPayload(recipient, amount) {
  const id = String(recipient || '').replace(/\D/g, '');
  const payable = Number(amount);
  if (![10, 13, 15].includes(id.length)) {
    throw Object.assign(new Error('ร้านยังตั้งค่าบัญชี PromptPay ไม่ครบ'), { status: 503, code: 'PROMPTPAY_NOT_CONFIGURED' });
  }
  if (!Number.isFinite(payable) || payable <= 0 || payable > 100000 || Math.round(payable * 100) !== payable * 100) {
    throw Object.assign(new Error('ยอดชำระไม่ถูกต้อง กรุณาติดต่อร้าน'), { status: 502, code: 'INVALID_PAYMENT_AMOUNT' });
  }
  return generatePromptPayPayload(id, { amount: payable });
}

function adminRecipient(env) {
  const id = String(env.ADMIN_NOTIFY_USER_ID || '').trim();
  return /^U[0-9a-f]{32}$/i.test(id) ? id : '';
}

function flexRow(label, value) {
  return { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
    { type: 'text', text: label, size: 'sm', color: '#71808A', flex: 2 },
    { type: 'text', text: String(value), size: 'sm', color: '#172C38', weight: 'bold', align: 'end', flex: 3, wrap: true },
  ] };
}

function adminOrderFlex(order) {
  const amount = Number(order.paymentAmountBaht);
  const name = String(order.displayName || 'ลูกค้า LINE').slice(0, 80);
  return { type: 'flex', altText: 'คำขอซัก–อบ–พับใหม่ ' + order.orderId, contents: {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#172C38', paddingAll: '20px', spacing: 'sm', contents: [
      { type: 'text', text: 'NITI · งานใหม่', size: 'sm', color: '#E8C29F', weight: 'bold' },
      { type: 'text', text: 'ลูกค้าส่งคำขอแล้ว', size: 'xl', color: '#FFFFFF', weight: 'bold', wrap: true },
    ] },
    body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
      flexRow('เลขงาน', order.orderId), flexRow('ลูกค้า', name),
      flexRow('เครื่องซัก', order.washerKg + ' กก.'), flexRow('เครื่องอบ', order.dryerKg + ' กก.'),
      { type: 'separator', margin: 'md', color: '#E6E8E4' },
      flexRow('ยอดประเมิน', Number.isFinite(amount) ? amount.toLocaleString('th-TH') + ' บาท' : 'รอตรวจยอด'),
      { type: 'text', text: order.supplyMode === 'shop_purchase_requested' ? 'ลูกค้าขอให้ร้านจัดหาน้ำยา · แจ้งยอดเพิ่มแยกต่างหาก' : 'ลูกค้านำน้ำยาซักผ้าและน้ำยาปรับผ้านุ่มมาเอง', size: 'sm', color: '#8F5B43', wrap: true },
    ] },
    footer: { type: 'box', layout: 'vertical', paddingAll: '18px', backgroundColor: '#F7F4EE', contents: [
      { type: 'text', text: 'ตรวจผ้าจริงและยอดเงินในหน้าแอดมิน', size: 'sm', color: '#52616A', wrap: true },
    ] },
  } };
}

function timerFlex(timer, now = Date.now()) {
  const remaining = Math.max(0, Math.ceil((Date.parse(timer.dueAt) - now) / 60000));
  const stage = timer.stage === 'wash' ? 'ซัก' : 'อบ';
  const headline = remaining > 0 ? 'ใกล้เสร็จ · เหลือประมาณ ' + remaining + ' นาที' : 'ครบเวลาโดยประมาณแล้ว';
  const due = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(timer.dueAt));
  return { type: 'flex', altText: 'เครื่อง' + stage + 'เลข ' + timer.machineDisplayNo + ' ' + headline, contents: {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#172C38', paddingAll: '20px', spacing: 'xs', contents: [
      { type: 'text', text: 'NITI · แจ้งเตือนเครื่อง', size: 'sm', color: '#E8C29F', weight: 'bold' },
      { type: 'text', text: headline, size: 'lg', color: '#FFFFFF', weight: 'bold', wrap: true },
    ] },
    body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md', contents: [
      { type: 'text', text: 'เครื่อง' + stage + ' เลข ' + timer.machineDisplayNo, size: 'xxl', weight: 'bold', color: '#172C38', wrap: true },
      flexRow('เลขงาน', timer.orderId), flexRow('เวลาครบโดยประมาณ', due + ' น.'),
      { type: 'separator', margin: 'md', color: '#E6E8E4' },
      { type: 'text', text: stage === 'ซัก' ? 'ตรวจเครื่องและผ้าจริง ก่อนเลือกเลขเครื่องอบในระบบ' : 'ตรวจผ้าจริง แล้วนำเข้าคิวพับในระบบ', size: 'sm', color: '#8F5B43', wrap: true },
    ] },
    footer: { type: 'box', layout: 'vertical', paddingAll: '18px', backgroundColor: '#F7F4EE', contents: [
      { type: 'text', text: 'เตือนแอดมินเท่านั้น · ยังไม่แจ้งลูกค้า', size: 'sm', color: '#52616A', wrap: true },
    ] },
  } };
}

async function lineRetryKey(value) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).slice(0, 16);
  hash[6] = (hash[6] & 15) | 80;
  hash[8] = (hash[8] & 63) | 128;
  const h = [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

async function pushAdminFlex(message, eventKey, env, fetchImpl = fetch) {
  const to = adminRecipient(env);
  if (!to || !env.LINE_CHANNEL_ACCESS_TOKEN) return false;
  const response = await fetchImpl(LINE_PUSH_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN, 'content-type': 'application/json', 'x-line-retry-key': await lineRetryKey(eventKey) },
    body: JSON.stringify({ to, messages: [message] }),
  });
  if (response.ok || (response.status === 409 && response.headers.has('x-line-accepted-request-id'))) return true;
  throw Object.assign(new Error('ส่ง LINE หาแอดมินไม่สำเร็จ'), { code: 'LINE_ADMIN_PUSH_FAILED', status: response.status });
}

async function notifyAdminOrder(order, env) {
  if (!adminRecipient(env) || !env.LINE_CHANNEL_ACCESS_TOKEN) return false;
  const sent = await pushAdminFlex(adminOrderFlex(order), 'new-order:' + order.orderId, env);
  if (sent) await signedGasCall('system.recordAdminOrderNotice', { orderId: order.orderId }, { role: 'system' }, env, crypto.randomUUID());
  return sent;
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const spec = routeSpec(request.method, url.pathname);
  const requestId = request.headers.get('idempotency-key') || request.headers.get('x-request-id') || crypto.randomUUID();
  if (requestId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(requestId)) {
    return safeError('INVALID_REQUEST_ID', 'รหัสคำขอไม่ถูกต้อง', 400, '');
  }
  if (!spec) return safeError('NOT_FOUND', 'ไม่พบรายการที่ต้องการ', 404, requestId);

  if (String(env.DEMO_MODE).toLowerCase() === 'true') {
    if (spec.action === 'catalog') return json({ ok: true, data: { ...CATALOG, mode: 'demo', notice: 'ข้อมูลจำลองเท่านั้น ไม่มีการบันทึกเงินจริง' }, requestId });
    return safeError('DEMO_READ_ONLY', 'โหมดสาธิตไม่รับคำสั่งจริง ข้อมูลในตัวอย่างบันทึกเฉพาะในเครื่อง', 403, requestId);
  }

  let actor = null;
  if (spec.role !== 'public') {
    const identity = await lineSubject(request, env);
    actor = { lineUserId: identity.lineUserId, displayName: identity.displayName, role: spec.role };
    if (spec.role === 'admin' && !isAdmin(identity.lineUserId, env)) {
      return safeError('ADMIN_REQUIRED', 'บัญชี LINE นี้ไม่มีสิทธิ์ผู้ดูแล', 403, requestId);
    }
  }
  const payload = request.method === 'GET' ? {} : await readRequestJson(request);
  if (spec.orderId) payload.orderId = spec.orderId;
  try {
    if (spec.action === 'customer.paymentQr') {
      if (!env.PROMPTPAY_ID) throw Object.assign(new Error('ร้านยังไม่ได้ตั้งค่า QR รับเงิน กรุณาติดต่อร้านก่อนโอน'), { status: 503, code: 'PROMPTPAY_NOT_CONFIGURED' });
      const payment = await signedGasCall(spec.action, payload, actor, env, requestId);
      const qrPayload = promptpayPayload(env.PROMPTPAY_ID, payment.amountBaht);
      return json({ ok: true, data: { ...payment, qrPayload }, requestId });
    }
    if (spec.action === 'admin.notify-ready') {
      if (!env.LINE_CHANNEL_ACCESS_TOKEN) throw Object.assign(new Error('ยังไม่ได้ตั้งค่าการส่งข้อความ LINE'), { status: 503, code: 'LINE_PUSH_NOT_CONFIGURED' });
      const notice = await signedGasCall(spec.action, payload, actor, env, requestId);
      if (notice.alreadySent) return json({ ok: true, data: notice, requestId });
      const pushed = await fetch(LINE_PUSH_URL, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ to: notice.to, messages: [{ type: 'text', text: notice.message }] }),
      });
      if (!pushed.ok) throw Object.assign(new Error('LINE ยังยืนยันการส่งไม่ได้ กรุณาตรวจประวัติแชตก่อนลองซ้ำ'), { status: 502, code: 'LINE_DELIVERY_UNCONFIRMED' });
      await signedGasCall('admin.record-ready-notification', { orderId: spec.orderId }, actor, env, requestId + '-sent');
      return json({ ok: true, data: { state: 'ready', message: 'ส่ง LINE แจ้งพร้อมรับแล้ว' }, requestId });
    }
    let data = await signedGasCall(spec.action, payload, actor, env, requestId);
    if (spec.action === 'customer.createOrder') {
      const notice = notifyAdminOrder({ ...data, displayName: actor.displayName }, env).catch(error => {
        console.error(JSON.stringify({ event: 'admin_order_notice_failed', orderId: data.orderId, code: error.code || 'UNEXPECTED' }));
      });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notice);
      else await notice;
    }
    if (spec.action === 'catalog' && data.washerOptions) data = { ...data, washers: data.washerOptions, dryers: data.dryerOptions };
    return json({ ok: true, data, requestId });
  } catch (error) {
    return safeError(error.code || 'SERVICE_ERROR', error.message || 'ระบบขัดข้อง กรุณาลองใหม่', error.status || 502, requestId);
  }
}

function applyPublicConfig(response, env) {
  return response.text().then((html) => {
    const config = { liffId: env.LIFF_ID || '', demo: String(env.DEMO_MODE).toLowerCase() === 'true' };
    const snippet = '<script>window.NITI_CONFIG=' + JSON.stringify(config).replace(/</g, '\\u003c') + ';</script>';
    return new Response(html.replace('</head>', snippet + '</head>'), {
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  });
}

async function fetchHandler(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname === '/health') {
    return json({ ok: true, service: 'niti1hour-wash-dry-fold', mode: String(env.DEMO_MODE).toLowerCase() === 'true' ? 'demo' : 'live', version: env.DEPLOYMENT_SHA || 'local' });
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(request, env, ctx);
  if (request.method !== 'GET' && request.method !== 'HEAD') return safeError('METHOD_NOT_ALLOWED', 'ไม่รองรับคำสั่งนี้', 405);
  if (url.pathname === '/') return Response.redirect(new URL('/customer/', url), 302);
  if (url.pathname === '/customer' || url.pathname === '/customer/index.html') url.pathname = '/customer/';
  if (url.pathname === '/admin' || url.pathname === '/admin/index.html') url.pathname = '/admin/';
  const asset = await env.ASSETS.fetch(new Request(url, request));
  if (asset.status === 404) return safeError('PAGE_NOT_FOUND', 'ไม่พบหน้าที่ต้องการ', 404);
  if (/^\/(customer|admin)\/$/.test(url.pathname)) return applyPublicConfig(asset, env);
  return asset;
}

export default {
  fetch(request, env, ctx) {
    return fetchHandler(request, env, ctx).catch((error) => {
      const requestId = request.headers.get('idempotency-key') || request.headers.get('x-request-id') || 'unavailable';
      console.error(JSON.stringify({ event: 'request_error', requestId, code: error.code || 'UNEXPECTED' }));
      return safeError(error.code || 'UNEXPECTED', error.message || 'ระบบขัดข้อง กรุณาลองใหม่', error.status || 500, requestId);
    });
  },
  async scheduled(event, env, ctx) {
    if (String(env.DEMO_MODE).toLowerCase() === 'true' || !env.GAS_BACKEND_URL || !env.GAS_SHARED_SECRET) return;
    if (!env.LINE_CHANNEL_ACCESS_TOKEN || !adminRecipient(env)) return;
    const requestId = crypto.randomUUID();
    try {
      const pending = await signedGasCall('system.pendingAdminOrderNotices', {}, { role: 'system' }, env, requestId + '-orders');
      for (const order of (pending.orders || [])) {
        try { await notifyAdminOrder(order, env); }
        catch (error) { console.error(JSON.stringify({ event: 'admin_order_notice_failed', orderId: order.orderId, code: error.code || 'UNEXPECTED' })); }
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'order_notice_check_failed', requestId, code: error.code || 'UNEXPECTED' }));
    }
    try {
      const due = await signedGasCall('system.dueTimers', { now: new Date().toISOString() }, { role: 'system' }, env, requestId);
      for (const timer of (due.timers || [])) {
        try {
          const claim = await signedGasCall('system.claimDueTimer', { timerId: timer.timerId }, { role: 'system' }, env, requestId + '-' + timer.timerId + '-claim');
          if (!claim.claimed) continue;
          if (await pushAdminFlex(timerFlex(timer), 'timer-near-done:' + timer.timerId, env)) {
            await signedGasCall('system.completeTimerReminder', { timerId: timer.timerId }, { role: 'system' }, env, requestId + '-' + timer.timerId + '-complete');
          }
        } catch (error) { console.error(JSON.stringify({ event: 'timer_notice_failed', timerId: timer.timerId, code: error.code || 'UNEXPECTED' })); }
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'timer_check_failed', requestId, code: error.code || 'UNEXPECTED' }));
    }
  },
};

export { adminRecipient, adminOrderFlex, timerFlex, lineRetryKey, pushAdminFlex, b64url, hmac, lineSubject, promptpayPayload, routeSpec, handleApi, fetchHandler };
