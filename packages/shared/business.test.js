import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote, SUPPLY_MODES, assertTransition, canStartMachine, isTimerDue, makeDemoOrder } from './business.js';

test('9kg wash + 14kg dry + smallest service tier totals 110 baht', () => {
  const quote = calculateQuote({ washerKg: 9, dryerKg: 14, machineConfirmed: true });
  assert.equal(quote.washerBaht, 40);
  assert.equal(quote.dryerBaht, 40);
  assert.equal(quote.shopServiceBaht, 30);
  assert.equal(quote.totalBaht, 110);
  assert.equal(quote.readyForPayment, true);
});

test('middle and largest combinations match the approved working tariff', () => {
  assert.equal(calculateQuote({ washerKg: 14, dryerKg: 21 }).baseTotalBaht, 150);
  assert.equal(calculateQuote({ washerKg: 18, dryerKg: 21 }).baseTotalBaht, 170);
  assert.equal(calculateQuote({ washerKg: 27, dryerKg: 25 }).baseTotalBaht, 220);
});

test('mixed capacities use the higher service tier', () => {
  assert.equal(calculateQuote({ washerKg: 9, dryerKg: 25 }).shopServiceBaht, 50);
  assert.equal(calculateQuote({ washerKg: 27, dryerKg: 14 }).shopServiceBaht, 50);
});

test('unsupported machine capacities and customer-added detergent charges are rejected', () => {
  assert.throws(() => calculateQuote({ washerKg: 10, dryerKg: 14 }), RangeError);
  assert.throws(() => calculateQuote({ washerKg: 9, dryerKg: 30 }), RangeError);
  assert.throws(() => calculateQuote({ washerKg: 9, dryerKg: 14, supplyBaht: 5 }), RangeError);
});

test('shop-supplied detergent blocks final payable amount until price and customer acceptance', () => {
  const pending = calculateQuote({ washerKg: 9, dryerKg: 14, supplyMode: SUPPLY_MODES.SHOP_PURCHASE_REQUESTED });
  const awaitingAcceptance = calculateQuote({ washerKg: 9, dryerKg: 14, supplyMode: SUPPLY_MODES.SHOP_PURCHASE_REQUESTED, supplyBaht: 25, machineConfirmed: true });
  const accepted = calculateQuote({ washerKg: 9, dryerKg: 14, supplyMode: SUPPLY_MODES.SHOP_PURCHASE_REQUESTED, supplyBaht: 25, supplyAccepted: true, machineConfirmed: true });
  assert.equal(pending.totalBaht, null);
  assert.equal(pending.readyForPayment, false);
  assert.equal(awaitingAcceptance.totalBaht, null);
  assert.equal(accepted.totalBaht, 135);
  assert.equal(accepted.readyForPayment, true);
});

test('machine work cannot start before payment, or on a busy/inactive machine', () => {
  assert.equal(canStartMachine({ orderState: 'paid', machineActive: true, currentOrderId: '', orderId: 'A' }), true);
  assert.equal(canStartMachine({ orderState: 'awaiting_payment', machineActive: true, currentOrderId: '', orderId: 'A' }), false);
  assert.equal(canStartMachine({ orderState: 'paid', machineActive: true, currentOrderId: 'B', orderId: 'A' }), false);
  assert.equal(canStartMachine({ orderState: 'paid', machineActive: false, currentOrderId: '', orderId: 'A' }), false);
});

test('only explicit transitions are allowed; timer due does not transition the order', () => {
  assert.equal(assertTransition('washing', 'drying_pending'), true);
  assert.equal(assertTransition('drying_pending', 'drying'), true);
  assert.throws(() => assertTransition('washing', 'ready'));
  assert.equal(isTimerDue({ dueAt: '2026-09-23T12:30:00.000Z', completedAt: null }, Date.parse('2026-09-23T12:31:00Z')), true);
  assert.equal(isTimerDue({ dueAt: '2026-09-23T12:30:00.000Z', completedAt: '2026-09-23T12:30:00.000Z' }, Date.parse('2026-09-23T12:31:00Z')), false);
});

test('demo order is explicitly marked as simulated and uses no real customer data', () => {
  const order = makeDemoOrder();
  assert.equal(order.demo, true);
  assert.equal(order.orderId, 'DEMO-20260923-001');
  assert.equal(order.quote.totalBaht, 110);
});
