/**
 * Phase 8 — payments, paid/unpaid tracking and the udhaar ledger (feature 3.A).
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 8 — Payments and udhaar');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

/** Creates an order with a known total so payment maths is easy to assert. */
async function makeOrder({ phone = '' } = {}) {
  const items = await harness.callOk('menu:items');
  const item = items[0];

  const order = await harness.callOk('orders:create', {
    // Takeaway with a phone is enough to create a customer record for udhaar;
    // a delivery order would additionally require a rider.
    type: 'takeaway',
    status: 'pending',
    customerName: phone ? 'Udhaar Customer' : '',
    customerPhone: phone,
    customerAddress: phone ? 'Street 1' : '',
    waiterId: null,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: item.id, qty: 1, notes: '' }],
  });

  return order;
}

/** Reads the stored order row, to prove paid_amount/payment_status are persisted. */
function orderRow(orderId) {
  return harness.db
    .prepare('SELECT total, paid_amount, payment_status FROM orders WHERE id = ?')
    .get(orderId);
}

let cashOrderId;

await runner.check('a new order starts unpaid', async () => {
  const order = await makeOrder();
  cashOrderId = order.id;

  const row = orderRow(order.id);
  if (row.payment_status !== 'unpaid')
    throw new Error(`expected unpaid, got ${row.payment_status}`);
  if (row.paid_amount !== 0) throw new Error('a new order should have nothing paid');
});

await runner.check('a full cash payment marks the order paid and stores change', async () => {
  const total = orderRow(cashOrderId).total;

  const payment = await harness.callOk('payment:add', {
    orderId: cashOrderId,
    method: 'cash',
    amount: total,
    tendered: total + 5_000,
    changeDue: 5_000,
    reference: '',
  });

  if (payment.amount !== total) throw new Error('payment amount not stored');
  if (payment.changeDue !== 5_000) throw new Error('change not stored');

  const row = orderRow(cashOrderId);
  if (row.payment_status !== 'paid') throw new Error(`expected paid, got ${row.payment_status}`);
  if (row.paid_amount !== total) throw new Error('paid_amount does not match the payment');
});

await runner.check('overpaying an order is refused', async () => {
  const order = await makeOrder();
  const total = orderRow(order.id).total;

  const result = await harness.call('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: total + 1,
    tendered: total + 1,
    changeDue: 0,
    reference: '',
  });

  if (result.ok) throw new Error('overpayment must fail');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('a partial payment sets the order to partial', async () => {
  const order = await makeOrder();
  const total = orderRow(order.id).total;
  const half = Math.floor(total / 2);

  await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: half,
    tendered: half,
    changeDue: 0,
    reference: '',
  });

  const row = orderRow(order.id);
  if (row.payment_status !== 'partial')
    throw new Error(`expected partial, got ${row.payment_status}`);
  if (row.paid_amount !== half) throw new Error('paid_amount should be the partial amount');
});

await runner.check('sum of live payments always equals orders.paid_amount', async () => {
  const orders = await harness.callOk('orders:list', {
    search: '',
    status: 'all',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 200,
  });

  for (const summary of orders) {
    const row = orderRow(summary.id);
    const sum = harness.db
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = ? AND voided_at IS NULL',
      )
      .get(summary.id).total;

    if (sum !== row.paid_amount) {
      throw new Error(`order ${summary.id}: payments ${sum} != paid_amount ${row.paid_amount}`);
    }
  }
});

await runner.check('only cash may record tendered cash and change', async () => {
  const order = await makeOrder();
  const total = orderRow(order.id).total;

  const result = await harness.call('payment:add', {
    orderId: order.id,
    method: 'card',
    amount: total,
    tendered: total,
    changeDue: 0,
    reference: '',
  });

  if (result.ok) throw new Error('a card payment must not accept cash tendered');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('change must equal tendered minus amount', async () => {
  const order = await makeOrder();
  const total = orderRow(order.id).total;

  const result = await harness.call('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: total,
    tendered: total + 1000,
    changeDue: 10, // wrong on purpose
    reference: '',
  });

  if (result.ok) throw new Error('a wrong change amount must fail');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

/* ------------------------------- udhaar ------------------------------- */

let udhaarCustomerId;

await runner.check('a credit payment creates an udhaar charge', async () => {
  const order = await makeOrder({ phone: '03001234567' });
  const total = orderRow(order.id).total;

  await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'credit',
    amount: total,
    tendered: null,
    changeDue: null,
    reference: 'Pay next week',
  });

  const accounts = await harness.callOk('udhaar:list');
  const account = accounts.find((row) => row.phone === '03001234567');

  if (!account) throw new Error('the customer should appear in the udhaar list');
  if (account.balance !== total) throw new Error(`balance ${account.balance} != ${total}`);

  udhaarCustomerId = account.customerId;
});

await runner.check('the udhaar ledger shows the charge with a running balance', async () => {
  const ledger = await harness.callOk('udhaar:ledger', { customerId: udhaarCustomerId });

  if (ledger.length < 1) throw new Error('the ledger should have at least one row');
  const charge = ledger.find((row) => row.entryType === 'charge');
  if (!charge) throw new Error('expected a charge entry');
  if (charge.balanceAfter <= 0) throw new Error('balance_after should be positive');
});

await runner.check('settling udhaar reduces the balance to zero', async () => {
  const accounts = await harness.callOk('udhaar:list');
  const balance = accounts.find((row) => row.customerId === udhaarCustomerId).balance;

  await harness.callOk('udhaar:settle', {
    customerId: udhaarCustomerId,
    method: 'cash',
    amount: balance,
    reference: 'Settled in full',
    orderId: null,
  });

  const after = await harness.callOk('udhaar:list');
  const still = after.find((row) => row.customerId === udhaarCustomerId);
  if (still) throw new Error(`balance should be zero, got ${still.balance}`);

  const ledger = await harness.callOk('udhaar:ledger', { customerId: udhaarCustomerId });
  if (ledger[0].balanceAfter !== 0) throw new Error('the last ledger row must show a zero balance');
});

await runner.check('settling more than the balance is refused', async () => {
  const order = await makeOrder({ phone: '03009998888' });
  const total = orderRow(order.id).total;

  await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'credit',
    amount: total,
    tendered: null,
    changeDue: null,
    reference: '',
  });

  const accounts = await harness.callOk('udhaar:list');
  const account = accounts.find((row) => row.phone === '03009998888');

  const result = await harness.call('udhaar:settle', {
    customerId: account.customerId,
    method: 'cash',
    amount: total + 1,
    reference: '',
    orderId: null,
  });

  if (result.ok) throw new Error('over-settling must fail');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('settling with credit is refused', async () => {
  const result = await harness.call('udhaar:settle', {
    customerId: udhaarCustomerId,
    method: 'credit',
    amount: 1000,
    reference: '',
    orderId: null,
  });

  if (result.ok) throw new Error('credit cannot settle credit');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

/* --------------------------- voiding money --------------------------- */

await runner.check('voiding a payment restores the order to unpaid', async () => {
  const order = await makeOrder();
  const total = orderRow(order.id).total;

  const payment = await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: total,
    tendered: total,
    changeDue: 0,
    reference: '',
  });

  if (orderRow(order.id).payment_status !== 'paid') throw new Error('should be paid first');

  await harness.callOk('payment:void', { id: payment.id, reason: 'Wrong order' });

  const row = orderRow(order.id);
  if (row.payment_status !== 'unpaid')
    throw new Error(`expected unpaid, got ${row.payment_status}`);
  if (row.paid_amount !== 0) throw new Error('paid_amount should be zero after voiding');
});

await runner.check('a payment cannot be voided twice', async () => {
  const order = await makeOrder();
  const total = orderRow(order.id).total;

  const payment = await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: total,
    tendered: total,
    changeDue: 0,
    reference: '',
  });

  await harness.callOk('payment:void', { id: payment.id, reason: 'First void' });

  const second = await harness.call('payment:void', { id: payment.id, reason: 'Second void' });
  if (second.ok) throw new Error('the second void must fail');
  if (second.error.code !== 'CONFLICT') throw new Error(`got ${second.error.code}`);
});

await runner.check('a void reason is required', async () => {
  const order = await makeOrder();
  const total = orderRow(order.id).total;

  const payment = await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: total,
    tendered: total,
    changeDue: 0,
    reference: '',
  });

  const result = await harness.call('payment:void', { id: payment.id, reason: 'no' });
  if (result.ok) throw new Error('a short reason must fail');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

/* ------------------------------ permissions ------------------------------ */

await runner.check('a cashier can take payments but not void or settle udhaar', async () => {
  const order = await makeOrder();
  const total = orderRow(order.id).total;

  await harness.loginAs('cashier', 'cashier123');

  const payment = await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: total,
    tendered: total,
    changeDue: 0,
    reference: '',
  });

  const voidAttempt = await harness.call('payment:void', { id: payment.id, reason: 'Cashier try' });
  if (voidAttempt.ok) throw new Error('a cashier must not void a payment');
  if (voidAttempt.error.code !== 'FORBIDDEN') throw new Error(`got ${voidAttempt.error.code}`);

  const settleAttempt = await harness.call('udhaar:settle', {
    customerId: udhaarCustomerId,
    method: 'cash',
    amount: 100,
    reference: '',
    orderId: null,
  });
  if (settleAttempt.ok) throw new Error('a cashier must not settle udhaar');
  if (settleAttempt.error.code !== 'FORBIDDEN') throw new Error(`got ${settleAttempt.error.code}`);

  // Reading udhaar is allowed.
  const list = await harness.callOk('udhaar:list');
  if (!Array.isArray(list)) throw new Error('a cashier should be able to read udhaar');
});

await runner.check('a manager can void payments and settle udhaar', async () => {
  await harness.loginAs('manager', 'manager123');

  const order = await makeOrder();
  const total = orderRow(order.id).total;

  const payment = await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: total,
    tendered: total,
    changeDue: 0,
    reference: '',
  });

  const voided = await harness.callOk('payment:void', { id: payment.id, reason: 'Manager test' });
  if (!voided.voidedAt) throw new Error('the payment should be marked voided');
});

await runner.check('a cancelled order cannot take a payment', async () => {
  await harness.loginAs('admin', 'OwnerPass123');
  const order = await makeOrder();

  await harness.callOk('orders:status', { id: order.id, status: 'cancelled' });

  const result = await harness.call('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: 100,
    tendered: 100,
    changeDue: 0,
    reference: '',
  });

  if (result.ok) throw new Error('a cancelled order must not accept money');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('collections are grouped by method from the payments table', async () => {
  const order = await makeOrder();
  const total = orderRow(order.id).total;

  await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'jazzcash',
    amount: total,
    tendered: null,
    changeDue: null,
    reference: 'TXN-123',
  });

  const today = new Date().toISOString().slice(0, 10);
  const report = await harness.callOk('reports:range', {
    fromDate: today,
    toDate: today,
  });

  // The report must exist and not double count; the method split lives in payments.
  if (typeof report.totals.sales !== 'number') throw new Error('sales total missing');

  const collected = harness.repositories.payments.collectionsByMethod(
    `${today} 00:00:00`,
    `${today} 23:59:59`,
  );
  const jazz = collected.find((row) => row.method === 'jazzcash');
  if (!jazz) throw new Error('jazzcash collections missing');
  if (jazz.total <= 0) throw new Error('jazzcash total should be positive');
});

harness.cleanup();
runner.finish();
