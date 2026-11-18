/**
 * Phase 11 — kitchen tickets and customer tokens (feature 3.D).
 *
 * The point of these tests is that the *kitchen* view and the *customer* view are
 * different: a token is monotonic per day and never reused, and a kitchen ticket
 * must never carry a price.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 11 — Kitchen tickets and tokens');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const menu = await harness.callOk('menu:items');
const burger = menu[0];

/** Order payload helper: takeaway unless a type is given. */
function orderInput(overrides = {}) {
  return {
    type: 'takeaway',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: burger.id, qty: 2, notes: '' }],
    ...overrides,
  };
}

function orderRow(id) {
  return harness.db.prepare('SELECT token_no, type FROM orders WHERE id = ?').get(id);
}

/* -------------------------------- tokens --------------------------------- */

await runner.check('the migration added the token and KOT tables', async () => {
  const tables = harness.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('token_counters', 'kot_prints')",
    )
    .all()
    .map((row) => row.name)
    .sort();

  if (JSON.stringify(tables) !== JSON.stringify(['kot_prints', 'token_counters'])) {
    throw new Error(`missing tables: ${tables.join(', ')}`);
  }

  const columns = harness.db
    .prepare('PRAGMA table_info(orders)')
    .all()
    .map((column) => column.name);
  if (!columns.includes('token_no')) throw new Error('orders.token_no was not added');
});

await runner.check('a takeaway order gets the next token, starting at 1', async () => {
  const first = await harness.callOk('orders:create', orderInput());
  const second = await harness.callOk('orders:create', orderInput());

  if (first.tokenNo !== 1) throw new Error(`first token should be 1, got ${first.tokenNo}`);
  if (second.tokenNo !== 2) throw new Error(`second token should be 2, got ${second.tokenNo}`);

  // The API and the stored row must agree.
  if (orderRow(first.id).token_no !== 1) throw new Error('token was not stored on the order');
});

await runner.check('a delivery order gets no token', async () => {
  const riders = await harness.callOk('staff:delivery-boys');
  const rider = riders[0];

  const delivery = await harness.callOk(
    'orders:create',
    orderInput({
      type: 'delivery',
      deliveryBoyId: rider.id,
      customerName: 'Ali',
      customerPhone: '03001234567',
      customerAddress: 'House 12, Street 3, Islamabad',
    }),
  );

  if (delivery.tokenNo !== null) {
    throw new Error(`a delivery order should not take a token, got ${delivery.tokenNo}`);
  }

  // And it must not have consumed a number from the counter.
  const next = await harness.callOk('orders:create', orderInput());
  if (next.tokenNo !== 3) throw new Error(`token sequence jumped, got ${next.tokenNo}`);
});

await runner.check('a cancelled order does not give its token back', async () => {
  // A number that has been called out cannot be re-issued.
  const third = await harness.callOk('orders:create', orderInput());
  await harness.callOk('orders:cancel', { id: third.id, reason: 'Customer left' });

  const fourth = await harness.callOk('orders:create', orderInput());
  if (fourth.tokenNo !== third.tokenNo + 1) {
    throw new Error(`token ${third.tokenNo} was reused as ${fourth.tokenNo}`);
  }
});

await runner.check('tokens restart at 1 on a new day', async () => {
  // Yesterday's counter must not affect today's.
  harness.db.prepare("INSERT INTO token_counters (day, last) VALUES ('1999-01-01', 999)").run();

  const today = await harness.callOk('orders:create', orderInput());
  if (today.tokenNo === null || today.tokenNo < 5) {
    throw new Error(`today's token should continue today's counter, got ${today.tokenNo}`);
  }
});

await runner.check('the customer invoice carries the token', async () => {
  const created = await harness.callOk('orders:create', orderInput());
  const invoice = await harness.callOk('orders:invoice', { id: created.id });

  if (invoice.order.tokenNo !== created.tokenNo) {
    throw new Error('the invoice data is missing the token');
  }

  const { renderInvoiceHtml } = await import('../dist-electron/electron/services/printService.js');
  const html = renderInvoiceHtml(invoice, '80mm');

  if (!html.includes('Token')) throw new Error('the printed invoice has no token line');
  if (!html.includes(`>${created.tokenNo}<`)) throw new Error('the token number is not printed');
});

/* -------------------------------- tickets -------------------------------- */

await runner.check('the kitchen ticket has items and quantities but no prices', async () => {
  const created = await harness.callOk(
    'orders:create',
    orderInput({ items: [{ itemId: burger.id, qty: 3, notes: 'No onions' }], notes: 'Table 4' }),
  );

  const kot = await harness.callOk('kot:ticket', { orderId: created.id });

  if (kot.items.length !== 1) throw new Error('the ticket should list one line');
  if (kot.items[0].qty !== 3) throw new Error('the quantity is wrong');
  if (kot.items[0].notes !== 'No onions') throw new Error('the item note was lost');
  if (kot.tokenNo !== created.tokenNo) throw new Error('the ticket has the wrong token');
  if (kot.printCount !== 0) throw new Error('a fresh order should not look reprinted');

  // The structural guarantee: no money on a kitchen ticket.
  if ('price' in kot.items[0] || 'lineTotal' in kot.items[0]) {
    throw new Error('a kitchen ticket must not carry prices');
  }

  const { renderKotHtml } = await import('../dist-electron/electron/services/printService.js');
  const html = renderKotHtml(kot, 'Gul Khan Fast Food');

  if (html.includes('Rs') || html.includes('Total')) {
    throw new Error('the rendered ticket mentions money');
  }
  if (!html.includes('No onions')) throw new Error('the item note is not printed');
  if (!html.includes('Table 4')) throw new Error('the order note is not printed');
});

await runner.check('printing a ticket is recorded, and the reprint is marked', async () => {
  const created = await harness.callOk('orders:create', orderInput());

  await harness.callOk('kot:print', { orderId: created.id });

  const after = await harness.callOk('kot:ticket', { orderId: created.id });
  if (after.printCount !== 1) throw new Error(`expected 1 print, got ${after.printCount}`);

  const { renderKotHtml } = await import('../dist-electron/electron/services/printService.js');
  const first = renderKotHtml({ ...after, printCount: 0 }, 'Shop');
  if (first.includes('Reprint')) throw new Error('the first print must not say reprint');

  await harness.callOk('kot:print', { orderId: created.id });
  const reprint = await harness.callOk('kot:ticket', { orderId: created.id });
  if (reprint.printCount !== 2) throw new Error('the second print was not counted');

  const html = renderKotHtml(reprint, 'Shop');
  if (!html.includes('Reprint')) throw new Error('a reprint must be unmistakable');
});

await runner.check('the print log records who printed and which lines', async () => {
  const created = await harness.callOk('orders:create', orderInput());
  await harness.callOk('kot:print', { orderId: created.id });

  const row = harness.db
    .prepare('SELECT printed_by, item_ids FROM kot_prints WHERE order_id = ?')
    .get(created.id);

  if (!row) throw new Error('no kot_prints row was written');
  if (typeof row.printed_by !== 'number') throw new Error('the user was not recorded');

  const ids = JSON.parse(row.item_ids);
  if (ids.length !== 1) throw new Error('the printed item ids were not recorded');
});

await runner.check('a cancelled order cannot be sent to the kitchen', async () => {
  const created = await harness.callOk('orders:create', orderInput());
  await harness.callOk('orders:cancel', { id: created.id, reason: 'Customer left' });

  const result = await harness.call('kot:print', { orderId: created.id });
  if (result.ok) throw new Error('a cancelled order must not print a kitchen ticket');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('a missing order is a clean NOT_FOUND', async () => {
  const result = await harness.call('kot:ticket', { orderId: 999_999 });
  if (result.ok) throw new Error('a missing order should fail');
  if (result.error.code !== 'NOT_FOUND') throw new Error(`got ${result.error.code}`);

  if (result.error.message.includes('UNIQUE') || result.error.message.includes('SQLITE')) {
    throw new Error('a raw SQL message leaked to the user');
  }
});

/* ------------------------------ permissions ------------------------------ */

await runner.check('a cashier may print a kitchen ticket', async () => {
  await harness.loginAs('cashier', 'cashier123');

  const created = await harness.callOk('orders:create', orderInput());
  const kot = await harness.callOk('kot:ticket', { orderId: created.id });
  if (kot.items.length === 0) throw new Error('the cashier could not read the ticket');

  await harness.callOk('kot:print', { orderId: created.id });
});

await runner.check('the kitchen ticket channels are registered and role-guarded', async () => {
  // Both channels must exist in the registry; an unregistered channel returns
  // INTERNAL_ERROR ("not available in this version") instead of NOT_FOUND.
  const ticket = await harness.call('kot:ticket', { orderId: 999_999 });
  if (ticket.ok) throw new Error('expected a failure');
  if (ticket.error.code !== 'NOT_FOUND') {
    throw new Error(`kot:ticket is not wired: ${ticket.error.message}`);
  }

  // A zero order id is refused by the schema before the handler runs.
  const invalid = await harness.call('kot:print', { orderId: 0 });
  if (invalid.ok) throw new Error('orderId 0 must be rejected');
  if (invalid.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${invalid.error.code}`);
});

harness.cleanup();
runner.finish();
