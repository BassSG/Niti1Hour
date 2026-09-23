import { CATALOG, calculateQuote } from '../packages/shared/business.js';

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
  const customerAction = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/(payment|accept-supply|decline-supply)$/);
  if (method === 'POST' && customerAction) return { action: 'customer.' + ({ payment: 'reportPayment', 'accept-supply': 'acceptSupplyQuote', 'decline-supply': 'declineSupplyQuote' }[customerAction[2]]), role: 'customer', orderId: customerAction[1] };
  const customerSlip = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)\/slip$/);
  if (method === 'POST' && customerSlip) return { action: 'customer.uploadSlip', role: 'customer', orderId: customerSlip[1] };
  const adminSlip = pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9_-]+)\/slip$/);
  if (method === 'GET' && adminSlip) return { action: 'admin.get-slip', role: 'admin', orderId: adminSlip[1] };
  const adminId = pathname.match(/^\/api\/admin\/orders\/([A-Za-z0-9_-]+)\/([a-z-]+)$/);
  if (method === 'POST' && adminId) return { action: 'admin.' + adminId[2], role: 'admin', orderId: adminId[1] };
  if (method === 'GET' && pathname === '/api/admin/queue') return { action: 'admin.queue', role: 'admin' };
  if (method === 'GET' && pathname === '/api/admin/timers/due') return { action: 'admin.dueTimers', role: 'admin' };
  return null;
}

async function handleApi(request, env) {
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
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(request, env);
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
    const adminIds = String(env.ADMIN_LINE_USER_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!env.LINE_CHANNEL_ACCESS_TOKEN || adminIds.length === 0) return;
    const requestId = crypto.randomUUID();
    try {
      const due = await signedGasCall('system.dueTimers', { now: new Date().toISOString() }, { role: 'system' }, env, requestId);
      for (const timer of (due.timers || [])) {
        const claim = await signedGasCall('system.claimDueTimer', { timerId: timer.timerId }, { role: 'system' }, env, requestId + '-' + timer.timerId + '-claim');
        if (!claim.claimed) continue;
        const text = 'ครบเวลาขั้นตอน' + (timer.stage === 'wash' ? 'ซัก' : 'อบ') + 'แล้ว · งาน ' + timer.orderId + ' · เครื่อง ' + timer.machineDisplayNo + ' กรุณาตรวจและกดขั้นตอนถัดไปในระบบ';
        let allSent = true;
        for (const to of adminIds) {
          const response = await fetch(LINE_PUSH_URL, {
            method: 'POST',
            headers: { authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN, 'content-type': 'application/json' },
            body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
          });
          if (!response.ok) allSent = false;
        }
        if (allSent) await signedGasCall('system.completeTimerReminder', { timerId: timer.timerId }, { role: 'system' }, env, requestId + '-' + timer.timerId + '-complete');
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'timer_check_failed', requestId, code: error.code || 'UNEXPECTED' }));
    }
  },
};

export { b64url, hmac, lineSubject, routeSpec, handleApi, fetchHandler };
