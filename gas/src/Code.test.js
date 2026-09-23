import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function paymentContext() {
  const source = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const order = {
    order_id: 'WD-DEMO-1',
    state: 'awaiting_payment',
    quote_total_baht: 110,
    row_version: 2,
    _row: 3
  };
  const writes = [];
  context.order_ = () => order;
  context.uuid_ = () => 'payment-test-1';
  context.now_ = () => '2026-09-23T09:00:00.000Z';
  context.publicOrder_ = () => ({ orderId: order.order_id, state: order.state });
  context.append_ = (table, row) => writes.push({ kind: 'append', table, row });
  context.update_ = (table, row, values) => writes.push({ kind: 'update', table, row, values });
  context.event_ = () => writes.push({ kind: 'event' });
  return { context, writes };
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
      { orderId: 'WD-DEMO-1', reportedAmount: 100 },
      { lineUserId: 'U-admin' },
      'request-2'
    ),
    /ยอดในแชตไม่ตรงกับยอดบิล/
  );
  assert.equal(writes.length, 0);
});
