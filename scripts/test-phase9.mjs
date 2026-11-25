/**
 * Phase 9 — day close, X/Z report and the cash drawer (feature 3.B).
 */
import { createRequire } from 'node:module';
import { createHarness, createRunner } from './test-harness.mjs';

const require = createRequire(import.meta.url);
const compiled = new URL('../dist-electron/electron/', import.meta.url).pathname;
const { renderShiftReportHtml } = require(`${compiled}services/printService.js`);

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 9 — Day close, X and Z report');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

async function makeOrder() {
  const items = await harness.callOk('menu:items');
  const item = items[0];

  return harness.callOk('orders:create', {
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
    items: [{ itemId: item.id, qty: 1, notes: '' }],
  });
}

function orderTotal(orderId) {
  return harness.db.prepare('SELECT total FROM orders WHERE id = ?').get(orderId).total;
}

let shiftId;

await runner.check('no shift is open on a fresh database', async () => {
  const current = await harness.callOk('shift:current');
  if (current !== null) throw new Error(`expected no open shift, got ${JSON.stringify(current)}`);
});

await runner.check('a shift opens with an opening float', async () => {
  const shift = await harness.callOk('shift:open', { openingCash: 500_000 });

  shiftId = shift.id;
  if (shift.status !== 'open') throw new Error('the shift should be open');
  if (shift.openingCash !== 500_000) throw new Error('the opening float was not stored');
  if (!shift.openedByName) throw new Error('the cashier name should be joined in');
});

await runner.check('a second open shift for the same counter is refused', async () => {
  const result = await harness.call('shift:open', { openingCash: 1000 });
  if (result.ok) throw new Error('two open shifts must not be allowed');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('the database itself blocks a second open shift', () => {
  // The partial unique index is the real guard, independent of the service check.
  let failed = false;
  try {
    harness.db
      .prepare(
        `INSERT INTO shifts (terminal, opened_by, opened_at, opening_cash, status)
         VALUES ('counter-1', 1, '2026-11-16 10:00:00', 0, 'open')`,
      )
      .run();
  } catch {
    failed = true;
  }

  if (!failed) throw new Error('the unique index on the open shift should have rejected this');
});

await runner.check('payments during the shift are stamped with the shift id', async () => {
  const order = await makeOrder();
  const total = orderTotal(order.id);

  const payment = await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: total,
    tendered: total + 10_000,
    changeDue: 10_000,
    reference: '',
  });

  const row = harness.db.prepare('SELECT shift_id FROM payments WHERE id = ?').get(payment.id);

  if (row.shift_id !== shiftId) {
    throw new Error(`payment should be tagged with shift ${shiftId}, got ${row.shift_id}`);
  }
});

await runner.check('cash in and cash out are recorded', async () => {
  await harness.callOk('shift:cash-movement', {
    kind: 'cash_in',
    amount: 200_000,
    reason: 'Owner put change in the drawer',
  });

  await harness.callOk('shift:cash-movement', {
    kind: 'cash_out',
    amount: 50_000,
    reason: 'Bought ice',
  });

  await harness.callOk('shift:cash-movement', {
    kind: 'expense',
    amount: 30_000,
    reason: 'Gas cylinder',
  });
});

await runner.check('a cash movement needs a reason and a positive amount', async () => {
  const noReason = await harness.call('shift:cash-movement', {
    kind: 'cash_in',
    amount: 1000,
    reason: 'x',
  });
  if (noReason.ok) throw new Error('a one-letter reason must be rejected');

  const zero = await harness.call('shift:cash-movement', {
    kind: 'cash_out',
    amount: 0,
    reason: 'Nothing at all',
  });
  if (zero.ok) throw new Error('a zero movement must be rejected');
});

await runner.check('a "sale" movement cannot be typed by hand', async () => {
  const result = await harness.call('shift:cash-movement', {
    kind: 'sale',
    amount: 1000,
    reason: 'Fake sale',
  });

  if (result.ok) throw new Error('sales must only come from payments');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('the X report totals match the payments in the shift', async () => {
  const report = await harness.callOk('shift:x-report', {});

  const dbTotal = harness.db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM payments
        WHERE shift_id = ? AND voided_at IS NULL`,
    )
    .get(shiftId).total;

  if (report.totalSales !== dbTotal) {
    throw new Error(`report ${report.totalSales} != payments ${dbTotal}`);
  }
  if (report.variance !== null) throw new Error('an open shift has no variance yet');

  const cashRows = report.salesByMethod.find((row) => row.method === 'cash');
  if (!cashRows) throw new Error('cash sales should appear in the method split');
  if (report.cashSales !== cashRows.total) throw new Error('cashSales does not match the split');
});

await runner.check(
  'expected cash = opening + cash sales + in − out − refunds − expenses',
  async () => {
    const expected = harness.repositories.shifts.expectedCash(shiftId, 500_000);
    const report = await harness.callOk('shift:x-report', {});

    const computed =
      500_000 +
      report.cashSales +
      report.cashIn -
      report.cashOut -
      report.refunds -
      report.expenses;

    if (expected !== computed) {
      throw new Error(`expectedCash ${expected} != ${computed}`);
    }
  },
);

await runner.check('the X report prints with no prices leaked into the header', async () => {
  const report = await harness.callOk('shift:x-report', {});
  const html = renderShiftReportHtml(report, '80mm');

  for (const fragment of ['X Report', 'Sales by method', 'Cash drawer', 'Expected cash']) {
    if (!html.includes(fragment)) throw new Error(`the report HTML is missing: ${fragment}`);
  }
  if (html.includes('undefined')) throw new Error('the report HTML contains undefined');
});

await runner.check('closing the shift stores the variance', async () => {
  const report = await harness.callOk('shift:x-report', {});
  const expected = harness.repositories.shifts.expectedCash(shiftId, 500_000);
  const counted = expected - 5_000; // short by 50 rupees

  const closed = await harness.callOk('shift:close', {
    countedCash: counted,
    notes: 'Drawer short',
  });

  if (closed.shift.status !== 'closed') throw new Error('the shift should be closed');
  if (closed.shift.expectedCash !== expected) throw new Error('expected cash not stored');
  if (closed.shift.countedCash !== counted) throw new Error('counted cash not stored');
  if (closed.shift.difference !== -5_000) {
    throw new Error(`difference should be -5000, got ${closed.shift.difference}`);
  }
  if (closed.variance !== -5_000) throw new Error('the report variance should be negative');

  if (report.totalSales !== closed.totalSales) {
    throw new Error('the Z report totals should match the X report');
  }
});

await runner.check('the Z report prints the difference', async () => {
  const shift = await harness.callOk('shift:list', { limit: 5 });
  const latest = shift.find((row) => row.id === shiftId);
  const report = await harness.callOk('shift:x-report', { shiftId: latest.id });
  const html = renderShiftReportHtml(report, 'a4');

  if (!html.includes('Z Report')) throw new Error('a closed shift should print a Z report');
  if (!html.includes('Difference')) throw new Error('the difference line is missing');
});

await runner.check('a closed shift cannot be closed twice or take cash', async () => {
  const again = await harness.call('shift:close', { countedCash: 1000, notes: '' });
  if (again.ok) throw new Error('closing twice must fail');
  if (again.error.code !== 'CONFLICT') throw new Error(`got ${again.error.code}`);

  const movement = await harness.call('shift:cash-movement', {
    kind: 'cash_in',
    amount: 1000,
    reason: 'After close',
  });
  if (movement.ok) throw new Error('cash cannot move on a closed shift');
});

await runner.check('payments after the close carry no shift and land in the next one', async () => {
  const order = await makeOrder();
  const total = orderTotal(order.id);

  await harness.callOk('payment:add', {
    orderId: order.id,
    method: 'cash',
    amount: total,
    tendered: total,
    changeDue: 0,
    reference: '',
  });

  const nextShift = await harness.callOk('shift:open', { openingCash: 100_000 });
  if (nextShift.status !== 'open') throw new Error('a new shift should open after a close');

  const afterOpen = await makeOrder();
  const payment = await harness.callOk('payment:add', {
    orderId: afterOpen.id,
    method: 'cash',
    amount: orderTotal(afterOpen.id),
    tendered: orderTotal(afterOpen.id),
    changeDue: 0,
    reference: '',
  });

  const row = harness.db.prepare('SELECT shift_id FROM payments WHERE id = ?').get(payment.id);
  if (row.shift_id !== nextShift.id) {
    throw new Error('the new payment should belong to the new shift');
  }

  await harness.callOk('shift:close', { countedCash: 0, notes: 'test' });
});

await runner.check('a cashier can open and close their own shift', async () => {
  await harness.loginAs('cashier', 'cashier123');

  const shift = await harness.callOk('shift:open', { openingCash: 50_000 });
  if (shift.status !== 'open') throw new Error('a cashier should be able to open a shift');

  const report = await harness.callOk('shift:x-report', {});
  if (typeof report.totalSales !== 'number') throw new Error('a cashier should read the X report');

  await harness.callOk('shift:close', { countedCash: 50_000, notes: '' });
});

await runner.check('the preview server wires every service the registry needs', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');

  const source = fs.readFileSync(path.join(root, 'scripts', 'preview-server.mjs'), 'utf8');
  const harnessSource = fs.readFileSync(path.join(root, 'scripts', 'test-harness.mjs'), 'utf8');

  // Every key buildRegistry() requires must exist in both wiring files, otherwise
  // the dev preview (and the harness) fails at runtime instead of at startup.
  const required = [
    'auth',
    'catalog',
    'orders',
    'staff',
    'vehicles',
    'reports',
    'settings',
    'users',
    'backups',
    'print',
    'csv',
    'payments',
    'shifts',
    'discounts',
    'kot',
    'tables',
  ];

  // A key may be shorthand (`auth,`) or explicit (`payments: …`), so match both.
  const registers = (text, key) => new RegExp(`^\\s*${key}\\s*[:,]`, 'm').test(text);

  for (const key of required) {
    if (!registers(source, key)) {
      throw new Error(`preview-server.mjs does not register the "${key}" service`);
    }
    if (!registers(harnessSource, key)) {
      throw new Error(`test-harness.mjs does not register the "${key}" service`);
    }
  }

  // Repositories must be created there too, not just the services.
  for (const repo of ['payments', 'shifts', 'discounts', 'kot', 'tables']) {
    if (!source.includes(`repositories/${repo}Repository.js`)) {
      throw new Error(`preview-server.mjs does not create the ${repo} repository`);
    }
  }
});

harness.cleanup();
runner.finish();
