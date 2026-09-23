export const CATALOG = Object.freeze({
  currency: 'THB',
  washers: Object.freeze({
    9: Object.freeze({ machineBaht: 40, serviceTier: 1 }),
    14: Object.freeze({ machineBaht: 50, serviceTier: 2 }),
    18: Object.freeze({ machineBaht: 70, serviceTier: 2 }),
    27: Object.freeze({ machineBaht: 100, serviceTier: 3 }),
  }),
  dryers: Object.freeze({
    14: Object.freeze({ machineBaht: 40, serviceTier: 1 }),
    21: Object.freeze({ machineBaht: 60, serviceTier: 2 }),
    25: Object.freeze({ machineBaht: 70, serviceTier: 3 }),
  }),
  serviceFees: Object.freeze({ 1: 30, 2: 40, 3: 50 }),
  defaultStageMinutes: 30,
  cyclesPerOrder: 1,
});

export const ORDER_STATES = Object.freeze([
  'awaiting_dropoff', 'awaiting_quote', 'awaiting_customer_quote_acceptance',
  'awaiting_payment', 'payment_review', 'paid', 'washing', 'drying_pending',
  'drying', 'folding', 'ready', 'collected', 'cancelled',
]);

export const TRANSITIONS = Object.freeze({
  awaiting_dropoff: ['awaiting_quote', 'cancelled'],
  awaiting_quote: ['awaiting_payment', 'awaiting_customer_quote_acceptance', 'cancelled'],
  awaiting_customer_quote_acceptance: ['awaiting_payment', 'awaiting_quote', 'cancelled'],
  awaiting_payment: ['payment_review', 'cancelled'],
  payment_review: ['paid', 'awaiting_payment'],
  paid: ['washing'],
  washing: ['drying_pending'],
  drying_pending: ['drying', 'cancelled'],
  drying: ['folding'],
  folding: ['ready'],
  ready: ['collected'],
  collected: [],
  cancelled: [],
});

export const SUPPLY_MODES = Object.freeze({
  CUSTOMER_OWN: 'customer_own',
  SHOP_PURCHASE_REQUESTED: 'shop_purchase_requested',
});

export function calculateQuote({ washerKg, dryerKg, supplyMode = SUPPLY_MODES.CUSTOMER_OWN,
  supplyBaht = null, supplyAccepted = false, machineConfirmed = false }) {
  const washer = CATALOG.washers[Number(washerKg)];
  const dryer = CATALOG.dryers[Number(dryerKg)];
  if (!washer || !dryer) throw new RangeError('เลือกขนาดเครื่องซักและอบที่ร้านมีให้บริการ');
  if (!Object.values(SUPPLY_MODES).includes(supplyMode)) throw new RangeError('รูปแบบน้ำยาไม่ถูกต้อง');
  if (supplyMode === SUPPLY_MODES.CUSTOMER_OWN && supplyBaht !== null && Number(supplyBaht) !== 0) {
    throw new RangeError('กรณีนำผลิตภัณฑ์มาเอง ไม่มีค่าน้ำยา');
  }
  if (supplyBaht !== null && (!Number.isFinite(Number(supplyBaht)) || Number(supplyBaht) < 0)) {
    throw new RangeError('ค่าผลิตภัณฑ์ต้องเป็นจำนวนเงินตั้งแต่ 0 บาท');
  }

  const serviceTier = Math.max(washer.serviceTier, dryer.serviceTier);
  const shopServiceBaht = CATALOG.serviceFees[serviceTier];
  const machineSubtotalBaht = washer.machineBaht + dryer.machineBaht;
  const baseTotalBaht = machineSubtotalBaht + shopServiceBaht;
  const needsManualSupplyQuote = supplyMode === SUPPLY_MODES.SHOP_PURCHASE_REQUESTED;
  const supplyCostBaht = needsManualSupplyQuote && supplyBaht !== null ? Number(supplyBaht) : 0;
  const customerAcceptedSupply = !needsManualSupplyQuote || (supplyBaht !== null && supplyAccepted);
  const totalBaht = customerAcceptedSupply ? baseTotalBaht + supplyCostBaht : null;
  const blockers = [];
  if (!machineConfirmed) blockers.push('admin_machine_confirmation');
  if (needsManualSupplyQuote && supplyBaht === null) blockers.push('manual_supply_quote');
  if (needsManualSupplyQuote && supplyBaht !== null && !supplyAccepted) blockers.push('customer_supply_quote_acceptance');

  return Object.freeze({
    washerKg: Number(washerKg), dryerKg: Number(dryerKg), cycles: 1,
    washerBaht: washer.machineBaht, dryerBaht: dryer.machineBaht,
    shopServiceBaht, serviceTier, supplyMode, needsManualSupplyQuote,
    supplyBaht: needsManualSupplyQuote ? (supplyBaht === null ? null : supplyCostBaht) : 0,
    machineSubtotalBaht, baseTotalBaht, totalBaht,
    readyForPayment: blockers.length === 0,
    paymentBlockers: Object.freeze(blockers),
    tariffVersion: 'draft-2026-09-23-v1',
  });
}

export function assertTransition(from, to) {
  if (!ORDER_STATES.includes(from) || !ORDER_STATES.includes(to) || !TRANSITIONS[from]?.includes(to)) {
    throw new Error('ไม่สามารถเปลี่ยนสถานะงานจาก ' + from + ' เป็น ' + to + ' ได้');
  }
  return true;
}

export function canStartMachine({ orderState, stage = 'wash', machineActive, currentOrderId, orderId }) {
  const expectedState = stage === 'wash' ? 'paid' : 'drying_pending';
  return orderState === expectedState && machineActive === true && (!currentOrderId || currentOrderId === orderId);
}

export function isTimerDue(timer, now = Date.now()) {
  return Boolean(timer && !timer.completedAt && Number(new Date(timer.dueAt)) <= Number(now));
}

export function makeDemoOrder(id = 'DEMO-20260923-001') {
  const quote = calculateQuote({ washerKg: 9, dryerKg: 14, machineConfirmed: true });
  return {
    orderId: id, displayName: 'ลูกค้าทดสอบ', state: 'awaiting_payment',
    supplyMode: SUPPLY_MODES.CUSTOMER_OWN, quote, paymentState: 'unpaid',
    createdAt: '2026-09-23T12:00:00.000Z', demo: true,
  };
}
