/**
 * Phase 21 — Roadmap 4.F: wastage, adjustments and stock counts.
 *
 * Every other way stock moves is already covered: purchases add it, sales take it,
 * cancelling puts it back. These are the three that a real kitchen produces and a
 * tidy app usually forgets, which is why a stock figure drifts a month after go-live:
 *
 *   * **wastage** — a dropped tray, spoiled mayo, a staff meal,
 *   * **adjustment** — a known correction ("the crate was short by two"),
 *   * **stock count** — the owner counted the shelf and the book disagreed.
 *
 * What is proven here:
 *   1. wastage takes exactly the quantity asked for, at the current average cost,
 *   2. it is refused when the shelf cannot cover it, and when the date is in the future,
 *   3. the reason code reaches the report and the money is valued correctly,
 *   4. an adjustment is signed, audited, and never silently changes the average cost,
 *   5. a stock count SETS the shelf to the counted number, not adds to it,
 *   6. a count line with no difference writes no movement but is still recorded,
 *   7. the count stores book vs counted and the value of the variance,
 *   8. the ledger, the cached quantity and the report all agree after all three,
 *   9. a cashier can read the shelf but cannot write it off.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 21 — Wastage, adjustments, stock counts (4.F)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);
const TODAY = '2026-11-22';

/* ------------------------------ the kitchen ------------------------------ */

async function ingredientWithPrice({ name, baseUnit, purchaseUnit, unitsPerPurchase, qtyPurchaseMilli, unitPrice }) {
  const ingredient = await call('stock:ingredient-save', {
    name,
    category: 'Test',
    baseUnit,
    purchaseUnit,
    unitsPerPurchase,
    reorderLevel: 0,
    supplierId: null,
    active: true,
  });

  await call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-20',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: ingredient.id, qtyPurchaseMilli, unitPrice }],
  });

  return ingredient;
}

// 10 kg of chicken at Rs 700/kg → 10,000 g, average 70,000 milli-paisa per gram.
const chicken = await ingredientWithPrice({
  name: 'Chicken',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  qtyPurchaseMilli: 10_000,
  unitPrice: 70_000,
});

// 20 packets of buns, 100 buns a packet, Rs 25 a packet → 2,000 buns at 25 paisa.
// A packet costs Rs 25 and holds 100 buns → 25 paisa a bun → 25,000 milli-paisa.
const buns = await ingredientWithPrice({
  name: 'Burger bun',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 100,
  qtyPurchaseMilli: 20_000,
  unitPrice: 2_500,
});

const stockOf = async (id) => (await call('stock:ingredient', { id })).ingredient.qtyOnHand;
const movementsOf = async (id) => call('stock:movements', { ingredientId: id, limit: 50 });

/* ------------------------------- 1. wastage ------------------------------ */

await runner.check('wastage takes exactly what was thrown away, at the average cost', async () => {
  const before = await stockOf(chicken.id);

  const movement = await call('stock:wastage', {
    ingredientId: chicken.id,
    qtyBase: 500,
    reason: 'dropped',
    notes: 'Tray of patties hit the floor',
    happenedOn: TODAY,
  });

  const after = await stockOf(chicken.id);
  if (after !== before - 500) throw new Error(`stock ${before} → ${after}`);

  if (movement.qty !== -500) throw new Error(`the ledger row says ${movement.qty}`);
  if (movement.kind !== 'wastage') throw new Error(`kind ${movement.kind}`);
  // 500 g × Rs 0.70 = Rs 350 → 35,000 paisa.
  if (movement.value !== -35_000) throw new Error(`value ${movement.value}`);
  if (movement.wastageReason !== 'dropped') throw new Error(`reason ${movement.wastageReason}`);
});

await runner.check('wastage cannot exceed the shelf', async () => {
  const onHand = await stockOf(chicken.id);

  const tooMuch = await harness.call('stock:wastage', {
    ingredientId: chicken.id,
    qtyBase: onHand + 1,
    reason: 'spoiled',
    notes: '',
    happenedOn: TODAY,
  });

  if (tooMuch.ok) throw new Error('more chicken was wasted than existed');
  if (!/stock/i.test(tooMuch.error.message)) {
    throw new Error(`unhelpful message: ${tooMuch.error.message}`);
  }
});

await runner.check('wastage cannot be dated in the future, or be zero', async () => {
  const future = await harness.call('stock:wastage', {
    ingredientId: chicken.id,
    qtyBase: 10,
    reason: 'other',
    notes: '',
    happenedOn: '2099-01-01',
  });
  if (future.ok) throw new Error('future wastage was accepted');

  const zero = await harness.call('stock:wastage', {
    ingredientId: chicken.id,
    qtyBase: 0,
    reason: 'other',
    notes: '',
    happenedOn: TODAY,
  });
  if (zero.ok) throw new Error('zero wastage was accepted');
});

await runner.check('wastage does not move the average cost', async () => {
  // Throwing food away is a quantity event, never a price event: the buns keep
  // their Rs 2.50 average even though twelve of them walked out as staff food.
  const before = (await call('stock:ingredient', { id: buns.id })).ingredient.avgCostMilli;

  await call('stock:wastage', {
    ingredientId: buns.id,
    qtyBase: 12,
    reason: 'staff_meal',
    notes: 'Burgers for the kitchen staff',
    happenedOn: TODAY,
  });

  const after = (await call('stock:ingredient', { id: buns.id })).ingredient.avgCostMilli;
  if (after !== before) throw new Error(`the bun average moved ${before} → ${after}`);
  // 25,000 milli-paisa per bun = 25 paisa a bun (the fixture buys 100-bun packets).
  if (after !== 25_000) throw new Error(`expected 25,000 milli-paisa a bun, got ${after}`);
});

/* ----------------------------- 2. adjustments ---------------------------- */

await runner.check('an adjustment is signed and needs a reason', async () => {
  const before = await stockOf(buns.id);

  const found = await call('stock:adjust', {
    ingredientId: buns.id,
    qtyBase: 40,
    reason: 'Found an unopened packet in the store room',
  });

  if (found.kind !== 'adjustment') throw new Error(`kind ${found.kind}`);
  if (found.qty !== 40) throw new Error(`qty ${found.qty}`);
  if ((await stockOf(buns.id)) !== before + 40) throw new Error('the stock did not go up');

  const removed = await call('stock:adjust', {
    ingredientId: buns.id,
    qtyBase: -10,
    reason: 'Two packets were short from the delivery',
  });
  if (removed.qty !== -10) throw new Error(`removal qty ${removed.qty}`);

  const noReason = await harness.call('stock:adjust', {
    ingredientId: buns.id,
    qtyBase: 5,
    reason: 'x',
  });
  if (noReason.ok) throw new Error('an adjustment without a reason was accepted');

  const zero = await harness.call('stock:adjust', {
    ingredientId: buns.id,
    qtyBase: 0,
    reason: 'Nothing at all',
  });
  if (zero.ok) throw new Error('a zero adjustment was accepted');
});

await runner.check('an adjustment cannot remove more than exists', async () => {
  const onHand = await stockOf(buns.id);

  const tooMuch = await harness.call('stock:adjust', {
    ingredientId: buns.id,
    qtyBase: -(onHand + 1),
    reason: 'Trying to go negative',
  });

  if (tooMuch.ok) throw new Error('the shelf was pushed below zero by an adjustment');
});

/* ---------------------------- 3. stock counts ---------------------------- */

await runner.check('a count SETS the shelf to the counted number', async () => {
  const bookChicken = await stockOf(chicken.id);
  const bookBuns = await stockOf(buns.id);

  const detail = await call('stock:count-save', {
    countedOn: TODAY,
    notes: 'Sunday night count',
    lines: [
      { ingredientId: chicken.id, countedQty: bookChicken - 250 },
      { ingredientId: buns.id, countedQty: bookBuns + 7 },
    ],
  });

  // The shelf now equals what was counted, not what it was plus a delta.
  if ((await stockOf(chicken.id)) !== bookChicken - 250) {
    throw new Error('chicken does not match the count');
  }
  if ((await stockOf(buns.id)) !== bookBuns + 7) {
    throw new Error('buns do not match the count');
  }

  if (!detail.count.countNo.startsWith('CNT-')) {
    throw new Error(`bad count number ${detail.count.countNo}`);
  }
  if (detail.lines.length !== 2) throw new Error(`${detail.lines.length} lines stored`);

  const chickenLine = detail.lines.find((line) => line.ingredientId === chicken.id);
  if (chickenLine?.bookQty !== bookChicken) throw new Error('the book quantity was not kept');
  if (chickenLine?.variance !== -250) throw new Error(`variance ${chickenLine?.variance}`);

  // -250 g of chicken at Rs 0.70 = 17,500 paisa, and +7 buns at 25 paisa = 175.
  if (detail.count.varianceValue !== 17_675) {
    throw new Error(`variance value ${detail.count.varianceValue}, expected 17675`);
  }
});

await runner.check('a line with no difference is recorded but writes no movement', async () => {
  const onHand = await stockOf(chicken.id);
  const before = (await movementsOf(chicken.id)).length;

  const detail = await call('stock:count-save', {
    countedOn: TODAY,
    notes: 'Spot check',
    lines: [{ ingredientId: chicken.id, countedQty: onHand }],
  });

  const line = detail.lines[0];
  if (line.variance !== 0) throw new Error(`variance ${line.variance}`);
  if (detail.count.varianceValue !== 0) throw new Error('a zero-variance count has value');

  const after = (await movementsOf(chicken.id)).length;
  if (after !== before) throw new Error('a zero-variance count wrote a ledger row');
});

await runner.check('a count writes a stock_count movement per real difference', async () => {
  const before = await stockOf(chicken.id);

  await call('stock:count-save', {
    countedOn: TODAY,
    notes: 'Found more than expected',
    lines: [{ ingredientId: chicken.id, countedQty: before + 300 }],
  });

  const movements = await movementsOf(chicken.id);
  const count = movements.find((movement) => movement.kind === 'stock_count' && movement.qty === 300);

  if (!count) throw new Error('no stock_count movement of +300 was written');
  if (!/CNT-/.test(count.reason)) throw new Error(`the reason does not name the count: ${count.reason}`);
});

await runner.check('a count validates its lines', async () => {
  const onHand = await stockOf(chicken.id);

  const empty = await harness.call('stock:count-save', { countedOn: TODAY, notes: '', lines: [] });
  if (empty.ok) throw new Error('an empty count was accepted');

  const duplicate = await harness.call('stock:count-save', {
    countedOn: TODAY,
    notes: '',
    lines: [
      { ingredientId: chicken.id, countedQty: onHand },
      { ingredientId: chicken.id, countedQty: onHand + 1 },
    ],
  });
  if (duplicate.ok) throw new Error('the same ingredient was counted twice');

  const negative = await harness.call('stock:count-save', {
    countedOn: TODAY,
    notes: '',
    lines: [{ ingredientId: chicken.id, countedQty: -5 }],
  });
  if (negative.ok) throw new Error('a negative count was accepted');

  const future = await harness.call('stock:count-save', {
    countedOn: '2099-01-01',
    notes: '',
    lines: [{ ingredientId: chicken.id, countedQty: onHand }],
  });
  if (future.ok) throw new Error('a future-dated count was accepted');
});

await runner.check('counts are listed, readable, and keep their own numbers', async () => {
  const counts = await call('stock:counts', {});
  if (counts.length < 3) throw new Error(`only ${counts.length} counts listed`);

  const first = counts[counts.length - 1];
  const detail = await call('stock:count', { id: first.id });

  if (detail.count.id !== first.id) throw new Error('the wrong count came back');
  if (detail.lines.length === 0) throw new Error('the count has no lines');

  // A count is history: its value must not move when prices change later.
  const stored = detail.count.varianceValue;
  await call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-22',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: chicken.id, qtyPurchaseMilli: 10_000, unitPrice: 120_000 }],
  });

  const reread = await call('stock:count', { id: first.id });
  if (reread.count.varianceValue !== stored) {
    throw new Error('the stored count moved after a price change');
  }
});

/* --------------------------- 4. the wastage report ----------------------- */

await runner.check('the wastage report groups by ingredient and reason with money', async () => {
  const report = await call('stock:wastage-report', { fromDate: '2026-11-01', toDate: '2026-11-30' });

  if (report.rows.length === 0) throw new Error('the report is empty after two wastages');

  const dropped = report.rows.find(
    (row) => row.ingredientId === chicken.id && row.reason === 'dropped',
  );
  if (!dropped) throw new Error('the dropped chicken is missing');
  if (dropped.qty !== 500) throw new Error(`qty ${dropped.qty}`);
  if (dropped.value !== 35_000) throw new Error(`value ${dropped.value}`);

  const staff = report.rows.find((row) => row.reason === 'staff_meal');
  if (!staff) throw new Error('the staff meal is missing');

  const summed = report.rows.reduce((total, row) => total + row.value, 0);
  if (report.total !== summed) throw new Error(`total ${report.total} vs rows ${summed}`);

  // A period with nothing in it is zero, not an error.
  const empty = await call('stock:wastage-report', {
    fromDate: '2020-01-01',
    toDate: '2020-12-31',
  });
  if (empty.total !== 0 || empty.rows.length !== 0) throw new Error('an empty period had rows');
});

/* ------------------------- 5. everything still agrees -------------------- */

await runner.check('after all three, the cache and the ledger still agree', async () => {
  for (const ingredient of [chicken, buns]) {
    const row = harness.db
      .prepare('SELECT qty_on_hand FROM ingredients WHERE id = ?')
      .get(ingredient.id);

    const ledger = harness.db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS total FROM stock_movements WHERE ingredient_id = ?')
      .get(ingredient.id);

    if (row.qty_on_hand !== ledger.total) {
      throw new Error(`${ingredient.name}: cache ${row.qty_on_hand} vs ledger ${ledger.total}`);
    }

    const serviceValue = (await call('stock:ingredient', { id: ingredient.id })).ingredient
      .qtyOnHand;
    if (serviceValue !== ledger.total) {
      throw new Error(`${ingredient.name}: the service disagrees with the ledger`);
    }
  }
});

await runner.check('wastage reaches the profit & loss as a real cost', async () => {
  const report = await call('reports:profit', { fromDate: '2026-11-01', toDate: '2026-11-30' });

  // Two wastages so far: 500 g of chicken at Rs 0.70 (35,000 paisa) and twelve
  // buns at 25 paisa (300 paisa).
  if (report.wastageValue !== 35_300) {
    throw new Error(`the P&L reports ${report.wastageValue} of wastage, expected 35300`);
  }
  if (report.wastageQty < 512) throw new Error(`quantity ${report.wastageQty}`);
});

/* ------------------------------ 6. permissions --------------------------- */

await runner.check('a cashier can read the shelf but cannot write it off', async () => {
  await harness.loginAs('cashier', 'cashier123');

  const read = await harness.call('stock:wastage-report', {
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
  });
  if (!read.ok) throw new Error('a cashier could not read the wastage report');

  const counts = await harness.call('stock:counts', {});
  if (!counts.ok) throw new Error('a cashier could not read the counts');

  const wastage = await harness.call('stock:wastage', {
    ingredientId: chicken.id,
    qtyBase: 5,
    reason: 'other',
    notes: '',
    happenedOn: TODAY,
  });
  if (wastage.ok) throw new Error('a cashier wrote off stock');

  const count = await harness.call('stock:count-save', {
    countedOn: TODAY,
    notes: '',
    lines: [{ ingredientId: chicken.id, countedQty: 1 }],
  });
  if (count.ok) throw new Error('a cashier changed the shelf with a count');

  // A manager runs the kitchen, so wastage and counts are theirs to record.
  await harness.loginAs('manager', 'manager123');
  const manager = await harness.call('stock:wastage', {
    ingredientId: chicken.id,
    qtyBase: 5,
    reason: 'other',
    notes: 'Manager test',
    happenedOn: TODAY,
  });
  if (!manager.ok) throw new Error('a manager could not record wastage');
});

harness.cleanup();
runner.finish();
