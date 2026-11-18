/**
 * Phase 13 — amending a saved bill (Phase 3).
 *
 * The theme: an amendment may change what the customer owes, but it may never
 * quietly take back money already collected, and it must always leave a trail
 * of what the bill used to say.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 13 — Order amendments');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const menu = await harness.callOk('menu:items');
const burger = menu[0];
const fries = menu[1];
const drink = menu[2];

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

const rowOf = (id) =>
  harness.db
    .prepare(
      'SELECT subtotal, discount, tax, total, amendment_count, notes FROM orders WHERE id = ?',
    )
    .get(id);

/* ------------------------------- the basics ------------------------------- */

await runner.check('the migration added the amendment table and counter', async () => {
  const tables = harness.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'order_amendments'")
    .all();
  if (tables.length !== 1) throw new Error('order_amendments is missing');

  const columns = harness.db
    .prepare('PRAGMA table_info(orders)')
    .all()
    .map((column) => column.name);
  if (!columns.includes('amendment_count')) throw new Error('orders.amendment_count is missing');
});

await runner.check('an amendment replaces the lines and re-totals the bill', async () => {
  const bill = await harness.callOk('orders:create', orderInput());

  const amended = await harness.callOk('order:amend', {
    id: bill.id,
    reason: 'Customer added fries',
    items: [
      { itemId: burger.id, qty: 2, notes: '' },
      { itemId: fries.id, qty: 1, notes: 'Extra salt' },
    ],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  if (amended.items.length !== 2) throw new Error('the new line was not added');

  const expected = burger.price * 2 + fries.price;
  if (amended.total !== expected) {
    throw new Error(`total is ${amended.total}, expected ${expected}`);
  }
  if (rowOf(bill.id).total !== expected) throw new Error('the stored total is stale');
});

await runner.check('removing a line lowers the total', async () => {
  const bill = await harness.callOk(
    'orders:create',
    orderInput({
      items: [
        { itemId: burger.id, qty: 1, notes: '' },
        { itemId: fries.id, qty: 1, notes: '' },
      ],
    }),
  );

  const amended = await harness.callOk('order:amend', {
    id: bill.id,
    reason: 'Fries were never served',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  if (amended.items.length !== 1) throw new Error('the removed line is still there');
  if (amended.total !== burger.price) throw new Error(`got ${amended.total}`);
});

await runner.check('an amendment writes a before/after snapshot', async () => {
  const bill = await harness.callOk('orders:create', orderInput());

  await harness.callOk('order:amend', {
    id: bill.id,
    reason: 'Added a drink',
    items: [
      { itemId: burger.id, qty: 2, notes: '' },
      { itemId: drink.id, qty: 1, notes: '' },
    ],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  const history = await harness.callOk('order:amendments', { id: bill.id });
  if (history.length !== 1) throw new Error(`expected 1 amendment, got ${history.length}`);

  const [edit] = history;
  if (edit.version !== 1) throw new Error('the version number is wrong');
  if (edit.reason !== 'Added a drink') throw new Error('the reason was not stored');

  // Before: two burgers only. After: two burgers and a drink.
  if (edit.before.items.length !== 1) throw new Error('the before snapshot is wrong');
  if (edit.after.items.length !== 2) throw new Error('the after snapshot is wrong');
  if (edit.before.total !== bill.total) throw new Error('the before total is wrong');
  if (edit.after.total <= edit.before.total) throw new Error('the after total is wrong');
  if (!edit.changedByName) throw new Error('who made the change was not recorded');
});

await runner.check('the second amendment is version 2 and counts up', async () => {
  const bill = await harness.callOk('orders:create', orderInput());

  for (const qty of [3, 4]) {
    await harness.callOk('order:amend', {
      id: bill.id,
      reason: `Changed to ${qty}`,
      items: [{ itemId: burger.id, qty, notes: '' }],
      discount: 0,
      taxPercent: 0,
      notes: '',
    });
  }

  const history = await harness.callOk('order:amendments', { id: bill.id });
  if (history.length !== 2) throw new Error('both edits should be kept');
  if (history[1].version !== 2) throw new Error('the versions are not sequential');

  if (rowOf(bill.id).amendment_count !== 2) throw new Error('the counter is wrong');
});

await runner.check('an amendment keeps the tax rate it was created with', async () => {
  const bill = await harness.callOk('orders:create', orderInput({ taxPercent: 5 }));

  const amended = await harness.callOk('order:amend', {
    id: bill.id,
    reason: 'Another burger',
    items: [{ itemId: burger.id, qty: 3, notes: '' }],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  const subtotal = burger.price * 3;
  const expectedTax = Math.round(subtotal * 0.05);
  if (amended.tax !== expectedTax) {
    throw new Error(`tax is ${amended.tax}, expected ${expectedTax}`);
  }
});

/* ---------------------------- money protection ---------------------------- */

await runner.check('an amendment cannot drop the total below what was paid', async () => {
  const bill = await harness.callOk(
    'orders:create',
    orderInput({
      items: [
        { itemId: burger.id, qty: 2, notes: '' },
        { itemId: fries.id, qty: 1, notes: '' },
      ],
    }),
  );

  // The customer pays the full bill.
  await harness.callOk('payment:add', {
    orderId: bill.id,
    method: 'cash',
    amount: bill.total,
    tendered: bill.total,
    changeDue: 0,
    reference: '',
  });

  // Then asks to remove everything except one cheap item.
  const result = await harness.call('order:amend', {
    id: bill.id,
    reason: 'Customer changed their mind',
    items: [{ itemId: fries.id, qty: 1, notes: '' }],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  if (result.ok) throw new Error('dropping below the paid total must be refused');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('an amendment that keeps the total above what was paid is allowed', async () => {
  const bill = await harness.callOk('orders:create', orderInput());

  await harness.callOk('payment:add', {
    orderId: bill.id,
    method: 'cash',
    amount: 100,
    tendered: 100,
    changeDue: 0,
    reference: '',
  });

  // Adding food keeps the new total well above the 100 paisa paid.
  const amended = await harness.callOk('order:amend', {
    id: bill.id,
    reason: 'Added another burger',
    items: [{ itemId: burger.id, qty: 3, notes: '' }],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  if (amended.total < 100) throw new Error('the total fell below the payment');
});

await runner.check('a cancelled bill cannot be amended', async () => {
  const bill = await harness.callOk('orders:create', orderInput());
  await harness.callOk('orders:cancel', { id: bill.id, reason: 'Customer left' });

  const result = await harness.call('order:amend', {
    id: bill.id,
    reason: 'Trying anyway',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  if (result.ok) throw new Error('a cancelled bill must not be amended');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('a merged-away bill cannot be amended', async () => {
  const kept = await harness.callOk('orders:create', orderInput());

  // Merging needs dine-in bills, so build them properly.
  const waiters = await harness.callOk('staff:waiters');
  const tables = await harness.callOk('tables:list');
  const free = tables.filter((table) => table.orderId === null);

  const a = await harness.callOk('orders:create', {
    ...orderInput(),
    type: 'dine_in',
    waiterId: waiters[0].id,
    tableId: free[0].id,
  });
  const b = await harness.callOk('orders:create', {
    ...orderInput(),
    type: 'dine_in',
    waiterId: waiters[0].id,
    tableId: free[1].id,
  });

  await harness.callOk('order:merge', { sourceId: b.id, targetId: a.id });

  const result = await harness.call('order:amend', {
    id: b.id,
    reason: 'Trying to edit an absorbed bill',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  if (result.ok) throw new Error('an absorbed bill must not be amended');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);

  if (kept.id === null) throw new Error('unreachable');
});

await runner.check('an empty amendment is refused', async () => {
  const bill = await harness.callOk('orders:create', orderInput());

  const result = await harness.call('order:amend', {
    id: bill.id,
    reason: 'Clearing the bill',
    items: [],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  if (result.ok) throw new Error('an empty bill must be refused');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('the reason is mandatory', async () => {
  const bill = await harness.callOk('orders:create', orderInput());

  const result = await harness.call('order:amend', {
    id: bill.id,
    reason: '',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  if (result.ok) throw new Error('an amendment without a reason must be refused');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

/* ---------------------------- discount on edit ---------------------------- */

await runner.check('an amendment cannot slip a cashier past their discount ceiling', async () => {
  const bill = await harness.callOk(
    'orders:create',
    orderInput({ items: [{ itemId: burger.id, qty: 4, notes: '' }] }),
  );

  await harness.loginAs('cashier', 'cashier123');

  const subtotal = burger.price * 4;
  // 20% is far above the cashier's 10% ceiling.
  const result = await harness.call('order:amend', {
    id: bill.id,
    reason: 'Giving a big discount',
    items: [{ itemId: burger.id, qty: 4, notes: '' }],
    discount: Math.round(subtotal * 0.2),
    taxPercent: 0,
    notes: '',
  });

  if (result.ok) throw new Error('the cashier ceiling must apply to amendments too');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('a cashier may still make a small discount while amending', async () => {
  const bill = await harness.callOk(
    'orders:create',
    orderInput({ items: [{ itemId: burger.id, qty: 4, notes: '' }] }),
  );

  await harness.loginAs('cashier', 'cashier123');

  const subtotal = burger.price * 4;
  const amended = await harness.callOk('order:amend', {
    id: bill.id,
    reason: 'Small goodwill discount',
    items: [{ itemId: burger.id, qty: 4, notes: '' }],
    discount: Math.round(subtotal * 0.03),
    taxPercent: 0,
    notes: '',
  });

  if (amended.discount === 0) throw new Error('the discount was not applied');
});

/* ------------------------------ permissions ------------------------------ */

await runner.check('only someone who can take orders may amend', async () => {
  const bill = await harness.callOk('orders:create', orderInput());

  // There is no read-only role in the seed, so this asserts the capability exists
  // and that the channel is not open to an anonymous caller.
  await harness.callOk('auth:logout', {});

  const result = await harness.call('order:amend', {
    id: bill.id,
    reason: 'Not logged in',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
    discount: 0,
    taxPercent: 0,
    notes: '',
  });

  if (result.ok) throw new Error('an anonymous caller must not amend a bill');
});

await runner.check('the amendment history of a missing order is a clean NOT_FOUND', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  const result = await harness.call('order:amendments', { id: 999_999 });
  if (result.ok) throw new Error('a missing order should fail');
  if (result.error.code !== 'NOT_FOUND') throw new Error(`got ${result.error.code}`);
});

harness.cleanup();
runner.finish();
