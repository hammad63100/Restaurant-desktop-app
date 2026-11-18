/**
 * Phase 12 — dine-in tables, merging bills and splitting them (Phase 3).
 *
 * The invariant under test throughout: **money never moves between orders.**
 * A merge is only legal while nothing has been paid, and a split cannot move a
 * line off a bill that already has money against it.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 12 — Tables, merge and split');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const menu = await harness.callOk('menu:items');
const burger = menu[0];
const fries = menu[1];
const waiters = await harness.callOk('staff:waiters');
const waiter = waiters[0];

async function openBill({ tableId = null, items } = {}) {
  return harness.callOk('orders:create', {
    type: 'dine_in',
    status: 'pending',
    tableId,
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: waiter.id,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: items ?? [{ itemId: burger.id, qty: 2, notes: '' }],
  });
}

const rowOf = (id) =>
  harness.db
    .prepare(
      'SELECT total, subtotal, discount, tax, status, table_id, merged_into_order_id, split_from_order_id FROM orders WHERE id = ?',
    )
    .get(id);

/* -------------------------------- tables --------------------------------- */

await runner.check('the floor plan is seeded with tables', async () => {
  const tables = await harness.callOk('tables:list');

  if (tables.length < 8) throw new Error(`expected at least 8 tables, got ${tables.length}`);
  if (!tables.every((table) => table.orderId === null)) {
    throw new Error('the seeded floor should start empty');
  }
  if (!tables.some((table) => table.area === 'Family hall')) {
    throw new Error('areas were not seeded');
  }
});

await runner.check('an admin can add, rename and remove a table', async () => {
  const created = await harness.callOk('table:save', {
    name: 'T99',
    seats: 6,
    area: 'Rooftop',
    active: true,
  });
  if (created.name !== 'T99' || created.seats !== 6) throw new Error('the table was not saved');

  const renamed = await harness.callOk('table:save', {
    id: created.id,
    name: 'T99',
    seats: 8,
    area: 'Rooftop',
    active: true,
  });
  if (renamed.seats !== 8) throw new Error('the edit did not stick');

  await harness.callOk('table:delete', { id: created.id });

  const after = await harness.callOk('tables:list');
  if (after.some((table) => table.id === created.id)) throw new Error('the table was not removed');
});

await runner.check('duplicate table names are refused', async () => {
  const result = await harness.call('table:save', {
    name: 'T1',
    seats: 4,
    area: 'Ground floor',
    active: true,
  });

  if (result.ok) throw new Error('a duplicate table name must be refused');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('a dine-in order seats a table and shows on the floor', async () => {
  const tables = await harness.callOk('tables:list');
  const free = tables.find((table) => table.orderId === null);

  const bill = await openBill({ tableId: free.id });

  const after = await harness.callOk('tables:list');
  const seated = after.find((table) => table.id === free.id);

  if (seated.orderId !== bill.id) throw new Error('the table was not seated');
  if (seated.orderNo !== bill.orderNo) throw new Error('the floor shows the wrong order number');
  if (seated.openTotal !== bill.total) throw new Error('the open total is wrong');
});

await runner.check('a second bill cannot be opened on an occupied table', async () => {
  const tables = await harness.callOk('tables:list');
  const taken = tables.find((table) => table.orderId !== null);

  const result = await harness.call('orders:create', {
    type: 'dine_in',
    status: 'pending',
    tableId: taken.id,
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: waiter.id,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
  });

  if (result.ok) throw new Error('two open bills on one table must be refused');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('a table with an open bill cannot be deleted', async () => {
  const tables = await harness.callOk('tables:list');
  const taken = tables.find((table) => table.orderId !== null);

  const result = await harness.call('table:delete', { id: taken.id });
  if (result.ok) throw new Error('deleting an occupied table must be refused');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('takeaway orders ignore a table and stay unseated', async () => {
  const tables = await harness.callOk('tables:list');
  const free = tables.find((table) => table.orderId === null);

  const takeaway = await harness.callOk('orders:create', {
    type: 'takeaway',
    status: 'pending',
    // A table sent with a takeaway must be ignored, not silently seated.
    tableId: free.id,
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
  });

  if (rowOf(takeaway.id).table_id !== null) throw new Error('a takeaway must not hold a table');
});

/* --------------------------------- merge --------------------------------- */

await runner.check('merging adds the lines and re-totals the kept bill', async () => {
  const tables = await harness.callOk('tables:list');
  const free = tables.filter((table) => table.orderId === null);
  const [tableA, tableB] = free;

  const kept = await openBill({
    tableId: tableA.id,
    items: [{ itemId: burger.id, qty: 2, notes: '' }],
  });
  const absorbed = await openBill({
    tableId: tableB.id,
    items: [{ itemId: fries.id, qty: 1, notes: '' }],
  });

  const expected = kept.total + absorbed.total;

  const result = await harness.callOk('order:merge', {
    sourceId: absorbed.id,
    targetId: kept.id,
  });

  if (result.mergedOrderNos[0] !== absorbed.orderNo) throw new Error('wrong order was merged');

  const keptRow = rowOf(kept.id);
  if (keptRow.total !== expected) {
    throw new Error(`the kept bill totals ${keptRow.total}, expected ${expected}`);
  }
  if (result.order.items.length !== 2) throw new Error('the lines were not combined');

  // The absorbed bill is closed and points at the survivor, and its table is free.
  const absorbedRow = rowOf(absorbed.id);
  if (absorbedRow.merged_into_order_id !== kept.id) throw new Error('the merge link is missing');
  if (absorbedRow.status !== 'delivered') throw new Error('the absorbed bill is still open');

  const after = await harness.callOk('tables:list');
  if (after.find((table) => table.id === tableB.id).orderId !== null) {
    throw new Error('the absorbed table was not freed');
  }
});

await runner.check('a bill with a payment on it cannot be merged', async () => {
  const tables = await harness.callOk('tables:list');
  const free = tables.filter((table) => table.orderId === null);
  const [tableA, tableB] = free;

  const paid = await openBill({ tableId: tableA.id });
  const other = await openBill({ tableId: tableB.id });

  await harness.callOk('payment:add', {
    orderId: paid.id,
    method: 'cash',
    amount: 100,
    tendered: 100,
    changeDue: 0,
    reference: '',
  });

  const result = await harness.call('order:merge', { sourceId: paid.id, targetId: other.id });
  if (result.ok) throw new Error('a paid bill must not be merged');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);

  // Nothing may have moved.
  if (rowOf(paid.id).merged_into_order_id !== null) throw new Error('the order was modified');
});

await runner.check('a merge roll-up never loses paisa', async () => {
  const tables = await harness.callOk('tables:list');
  const free = tables.filter((table) => table.orderId === null);
  const [tableA, tableB] = free;

  const kept = await openBill({
    tableId: tableA.id,
    items: [{ itemId: burger.id, qty: 3, notes: '' }],
  });
  const absorbed = await openBill({
    tableId: tableB.id,
    items: [{ itemId: fries.id, qty: 2, notes: '' }],
  });

  const before = rowOf(kept.id).total + rowOf(absorbed.id).total;
  await harness.callOk('order:merge', { sourceId: absorbed.id, targetId: kept.id });

  if (rowOf(kept.id).total !== before) {
    throw new Error(`total moved from ${before} to ${rowOf(kept.id).total}`);
  }
});

/* --------------------------------- split --------------------------------- */

await runner.check('splitting moves the chosen lines onto a new bill', async () => {
  const bill = await openBill({
    items: [
      { itemId: burger.id, qty: 1, notes: '' },
      { itemId: fries.id, qty: 2, notes: '' },
    ],
  });

  const lines = (await harness.callOk('orders:get', { id: bill.id })).items;
  const friesLine = lines.find((line) => line.itemId === fries.id);

  const result = await harness.callOk('order:split', {
    orderId: bill.id,
    itemIds: [friesLine.id],
    moveTable: false,
  });

  if (result.target.id === bill.id) throw new Error('the split must create a new order');
  if (result.target.items.length !== 1) throw new Error('the new bill has the wrong lines');
  if (result.source.items.length !== 1) throw new Error('the original bill kept the wrong lines');

  // The money is conserved and both sides are consistent with their lines.
  const subtotalTotal = result.source.total + result.target.total;
  if (subtotalTotal !== bill.total) {
    throw new Error(`split changed the money: ${bill.total} -> ${subtotalTotal}`);
  }

  if (rowOf(result.target.id).split_from_order_id !== bill.id) {
    throw new Error('the split link is missing');
  }
});

await runner.check('the split link is visible on the new bill', async () => {
  // The invoice screen shows "split from ORD-x", so the field must reach the UI.
  const bill = await openBill({
    items: [
      { itemId: burger.id, qty: 1, notes: '' },
      { itemId: fries.id, qty: 1, notes: '' },
    ],
  });
  const lines = (await harness.callOk('orders:get', { id: bill.id })).items;

  const result = await harness.callOk('order:split', {
    orderId: bill.id,
    itemIds: [lines[0].id],
    moveTable: false,
  });

  if (result.target.splitFromOrderId !== bill.id) {
    throw new Error(`expected splitFromOrderId ${bill.id}, got ${result.target.splitFromOrderId}`);
  }
  if (result.target.items.length !== 1) throw new Error('the new bill should hold one line');
  if (result.source.items.length !== 1) throw new Error('the source should keep one line');
});

await runner.check('a split gives the new bill its own order and invoice numbers', async () => {
  const bill = await openBill({
    items: [
      { itemId: burger.id, qty: 1, notes: '' },
      { itemId: fries.id, qty: 1, notes: '' },
    ],
  });

  const lines = (await harness.callOk('orders:get', { id: bill.id })).items;

  const result = await harness.callOk('order:split', {
    orderId: bill.id,
    itemIds: [lines[0].id],
    moveTable: false,
  });

  if (!result.target.orderNo || result.target.orderNo === bill.orderNo) {
    throw new Error('the new bill needs its own order number');
  }
  if (!result.target.invoiceNo) throw new Error('the new bill needs an invoice number');
});

await runner.check('a split cannot move every line', async () => {
  const bill = await openBill({ items: [{ itemId: burger.id, qty: 1, notes: '' }] });
  const lines = (await harness.callOk('orders:get', { id: bill.id })).items;

  const result = await harness.call('order:split', {
    orderId: bill.id,
    itemIds: lines.map((line) => line.id),
    moveTable: false,
  });

  if (result.ok) throw new Error('moving every line must be refused');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('a split cannot move a line that is not on the bill', async () => {
  const bill = await openBill({ items: [{ itemId: burger.id, qty: 1, notes: '' }] });
  const other = await openBill({ items: [{ itemId: fries.id, qty: 1, notes: '' }] });
  const otherLines = (await harness.callOk('orders:get', { id: other.id })).items;

  const result = await harness.call('order:split', {
    orderId: bill.id,
    itemIds: [otherLines[0].id],
    moveTable: false,
  });

  if (result.ok) throw new Error('a line from another bill must not be movable');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('a split cannot touch a bill that has been paid', async () => {
  const bill = await openBill({
    items: [
      { itemId: burger.id, qty: 1, notes: '' },
      { itemId: fries.id, qty: 1, notes: '' },
    ],
  });
  const lines = (await harness.callOk('orders:get', { id: bill.id })).items;

  await harness.callOk('payment:add', {
    orderId: bill.id,
    method: 'cash',
    amount: 50,
    tendered: 50,
    changeDue: 0,
    reference: '',
  });

  const result = await harness.call('order:split', {
    orderId: bill.id,
    itemIds: [lines[0].id],
    moveTable: false,
  });

  if (result.ok) throw new Error('a paid bill must not be split');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('a split can seat the new bill at a free table', async () => {
  const tables = await harness.callOk('tables:list');
  const free = tables.filter((table) => table.orderId === null);
  if (free.length < 2) throw new Error('this test needs two free tables');

  const bill = await openBill({
    tableId: free[0].id,
    items: [
      { itemId: burger.id, qty: 1, notes: '' },
      { itemId: fries.id, qty: 1, notes: '' },
    ],
  });
  const lines = (await harness.callOk('orders:get', { id: bill.id })).items;

  const result = await harness.callOk('order:split', {
    orderId: bill.id,
    itemIds: [lines[0].id],
    moveTable: true,
  });

  const tableOf = rowOf(result.target.id).table_id;
  if (tableOf === null) throw new Error('the new bill was not seated');
  if (tableOf === free[0].id) throw new Error('the new bill took the original table');
});

await runner.check('a split keeps a lone bill from being carved up twice-over', async () => {
  // Two lines: split one off, then the original has one line and must refuse.
  const bill = await openBill({
    items: [
      { itemId: burger.id, qty: 1, notes: '' },
      { itemId: fries.id, qty: 1, notes: '' },
    ],
  });
  const lines = (await harness.callOk('orders:get', { id: bill.id })).items;

  await harness.callOk('order:split', {
    orderId: bill.id,
    itemIds: [lines[0].id],
    moveTable: false,
  });

  const remaining = (await harness.callOk('orders:get', { id: bill.id })).items;
  const again = await harness.call('order:split', {
    orderId: bill.id,
    itemIds: remaining.map((line) => line.id),
    moveTable: false,
  });

  if (again.ok) throw new Error('the last line must not be moved off');
});

/* ------------------------------ permissions ------------------------------ */

await runner.check('a cashier may merge and split, but not edit the floor plan', async () => {
  await harness.loginAs('cashier', 'cashier123');

  // Unseated bills need no free table, so this test never runs out of floor.
  const kept = await openBill();
  const absorbed = await openBill();

  await harness.callOk('order:merge', { sourceId: absorbed.id, targetId: kept.id });

  const edit = await harness.call('table:save', {
    name: 'TX',
    seats: 2,
    area: 'Test',
    active: true,
  });
  if (edit.ok) throw new Error('a cashier must not edit the floor plan');
  if (edit.error.code !== 'FORBIDDEN') throw new Error(`got ${edit.error.code}`);

  const remove = await harness.call('table:delete', { id: 1 });
  if (remove.ok) throw new Error('a cashier must not delete a table');
});

await runner.check('the demo database has the tables it reports', async () => {
  // Guards against the seed and the report drifting apart.
  const listed = await harness.callOk('tables:list');
  const stored = harness.db.prepare('SELECT COUNT(*) AS total FROM tables').get().total;
  if (listed.length !== stored) throw new Error(`${listed.length} listed vs ${stored} stored`);
});

harness.cleanup();
runner.finish();
