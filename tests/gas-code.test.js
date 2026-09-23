import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function paymentContext() {
  const source = readFileSync(new URL('../gas/src/Code.gs', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const order = {
    order_id: 'WD-DEMO-1',
    state: 'awaiting_payment',
    payment_state: 'unpaid',
    quote_json: JSON.stringify({ quoteKind: 'confirmed', paymentAmountBaht: 110 }),
    quote_total_baht: 110,
    row_version: 2,
    _row: 3
  };
  const writes = [];
  const paymentRows = [];
  let nextId = 0;
  context.order_ = () => order;
  context.table_ = name => name === 'Payments' ? paymentRows : [];
  context.uuid_ = () => 'payment-test-' + ++nextId;
  context.now_ = () => '2026-09-23T09:00:00.000Z';
  context.publicOrder_ = () => ({ orderId: order.order_id, state: order.state });
  context.append_ = (table, row) => {
    writes.push({ kind: 'append', table, row });
    if (table === 'Payments') paymentRows.push({ ...row, _row: paymentRows.length + 3 });
  };
  context.update_ = (table, row, values) => {
    writes.push({ kind: 'update', table, row, values });
    if (table === 'Orders') Object.assign(order, values);
    if (table === 'Payments') Object.assign(paymentRows.find(p => p._row === row), values);
  };
  context.event_ = () => writes.push({ kind: 'event' });
  return { context, writes, order, paymentRows };
}

test('chat payment report records a review without a Drive slip or confirmed payment', () => {
  const { context, writes } = paymentContext();
  const result = context.recordChatPayment_(
    { orderId: 'WD-DEMO-1', reportedAmount: 110 },
    { lineUserId: 'U-admin' },
    'request-1'
  );
  assert.equal(result.state, 'payment_review');
  const payment = writes.find(item => item.table === 'Payments');
  assert.equal(payment.row.reported_amount_baht, 110);
  assert.equal(payment.row.status, 'review');
  assert.equal(payment.row.slip_file_id, '');
  assert.equal(writes.find(item => item.table === 'Orders').values.payment_state, 'review');
});

test('chat payment report rejects a mismatch before writing', () => {
  const { context, writes } = paymentContext();
  assert.throws(
    () => context.recordChatPayment_(
      { orderId: 'WD-DEMO-1', reportedAmount: 120 },
      { lineUserId: 'U-admin' },
      'request-2'
    ),
    /ยอดที่แจ้งเกินยอดค้าง/
  );
  assert.equal(writes.length, 0);
});

test('an early estimate transfer stays pending inspection, then an extra transfer completes the confirmed bill', () => {
  const { context, order, paymentRows } = paymentContext();
  order.state = 'awaiting_dropoff';
  order.quote_json = JSON.stringify({ quoteKind: 'estimate', paymentAmountBaht: 110 });
  context.recordChatPayment_({ orderId: order.order_id, reportedAmount: 110 }, { lineUserId: 'U-admin' }, 'deposit');
  assert.equal(order.state, 'awaiting_dropoff');
  context.verifyPayment_({ orderId: order.order_id, verifiedAmount: 110 }, { lineUserId: 'U-admin' }, 'deposit-verified');
  assert.equal(order.state, 'awaiting_dropoff');
  assert.equal(order.payment_state, 'partial');
  order.state = 'awaiting_payment';
  order.quote_total_baht = 130;
  order.quote_json = JSON.stringify({ quoteKind: 'confirmed', paymentAmountBaht: 130 });
  context.recordChatPayment_({ orderId: order.order_id, reportedAmount: 20 }, { lineUserId: 'U-admin' }, 'extra');
  context.verifyPayment_({ orderId: order.order_id, verifiedAmount: 20 }, { lineUserId: 'U-admin' }, 'extra-verified');
  assert.equal(order.state, 'paid');
  assert.equal(order.payment_state, 'verified');
  assert.deepEqual(paymentRows.map(p => p.verified_amount_baht), [110, 20]);
});

test('customer payment QR returns only the order-owned amount and rejects another customer', () => {
  const source = readFileSync(new URL('../gas/src/Code.gs', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const order = {
    order_id: 'WD-DEMO-2', customer_id: 'C-1', state: 'awaiting_dropoff',
    payment_state: 'unpaid', requested_washer_kg: 9, requested_dryer_kg: 14,
    supply_mode: 'customer_own', quote_json: JSON.stringify({ quoteKind: 'estimate', paymentAmountBaht: 110 })
  };
  context.order_ = () => order;
  context.table_ = () => [{ customer_id: 'C-1', line_user_id: 'U-customer' }];
  context.apiError_ = (code, message, status) => Object.assign(new Error(message), { code, status });
  const details = context.customerPaymentQr_({ orderId: order.order_id }, { lineUserId: 'U-customer' });
  assert.equal(details.amountBaht, 110);
  assert.equal(details.quoteKind, 'estimate');
  assert.throws(
    () => context.customerPaymentQr_({ orderId: order.order_id }, { lineUserId: 'U-other' }),
    { code: 'NOT_FOUND' }
  );
});

test('initial service estimate keeps shop-bought detergent separate from its payable QR amount', () => {
  const source = readFileSync(new URL('../gas/src/Code.gs', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  context.catalog_ = () => ({
    washerOptions: { 9: { machineBaht: 40, serviceTier: 1 } },
    dryerOptions: { 14: { machineBaht: 40, serviceTier: 1 } },
    serviceFees: { 1: 30 }, tariffVersion: 'test'
  });
  const quote = context.quoteCalc_(9, 14, 'shop_purchase_requested', null, false, false);
  quote.quoteKind = 'estimate';
  quote.estimatedTotalBaht = quote.baseTotalBaht;
  quote.paymentAmountBaht = quote.baseTotalBaht;
  assert.equal(quote.totalBaht, null);
  assert.equal(quote.paymentAmountBaht, 110);
});
