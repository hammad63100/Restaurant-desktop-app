/**
 * Phase 24 — opening stock, the go-live screen.
 *
 * On the day the shop starts using the app there is already food in the kitchen and
 * a price was paid for it weeks ago. Without this screen the owner has three bad
 * options: invent a purchase (creates a supplier debt that never happened), count
 * the shelf (records quantity but no cost, so every recipe looks free), or start
 * from zero (the first sale shows an impossible profit).
 *
 * Opening stock is the fourth option: a quantity AND a cost, with no bill and no
 * supplier. This suite proves:
 *
 *   1. it adds the quantity and sets the average cost the owner named,
 *   2. it writes an `opening` movement, not a purchase,
 *   3. it creates no purchase row and no supplier balance,
 *   4. a recipe costed from opening stock is right on the very first sale,
 *   5. zero and negative rows are ignored, an empty sheet is refused,
 *   6. the ledger, the cache and the stock valuation all agree afterwards.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: false });
const runner = createRunner('Phase 24 — Opening stock (4.B, go-live)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);

/* --------------------------- what is in the kitchen ---------------- */

const bun = await call('stock:ingredient-save', {
  name: 'Bun',
  category: 'Bread',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 100,
  reorderLevel: 0,
  supplierId: null,
  active: true,
});

const chicken = await call('stock:ingredient-save', {
  name: 'Chicken',
  category: 'Meat',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  reorderLevel: 0,
  supplierId: null,
  active: true,
});

const supplier = await call('stock:supplier-save', {
  name: 'Al-Madina',
  phone: '0300-1112223',
  address: '',
  notes: '',
  active: true,
});

/* ------------------------------ 1. the sheet --------------------------- */

await runner.check('an empty sheet is refused', async () => {
  const empty = await harness.call('stock:opening', { lines: [] });
  if (empty.ok) throw new Error('an empty opening sheet was accepted');
});

await runner.check('opening stock sets the quantity and the cost', async () => {
  await call('stock:opening', {
    lines: [
      // 240 buns at 25 paisa each ("Rs 25 a packet of 100" is 0.25 a bun).
      { ingredientId: bun.id, qtyBase: 240, unitCostMilli: 25_000 },
      // 8 kg of chicken at Rs 0.70 a gram = 70,000 milli-paisa.
      { ingredientId: chicken.id, qtyBase: 8_000, unitCostMilli: 70_000 },
    ],
  });

  const afterBun = await call('stock:ingredient', { id: bun.id });
  if (afterBun.ingredient.qtyOnHand !== 240) {
    throw new Error(`buns on hand ${afterBun.ingredient.qtyOnHand}`);
  }
  if (afterBun.ingredient.avgCostMilli !== 25_000) {
    throw new Error(`bun average ${afterBun.ingredient.avgCostMilli}`);
  }

  const afterChicken = await call('stock:ingredient', { id: chicken.id });
  if (afterChicken.ingredient.qtyOnHand !== 8_000) throw new Error('chicken quantity');
  if (afterChicken.ingredient.avgCostMilli !== 70_000) throw new Error('chicken average');
});

await runner.check('it writes an opening movement, never a purchase', async () => {
  const movements = await call('stock:movements', { ingredientId: bun.id, limit: 50 });
  const opening = movements.filter((movement) => movement.kind === 'opening');

  if (opening.length !== 1) throw new Error(`${opening.length} opening movements`);
  if (opening[0].qty !== 240) throw new Error(`movement qty ${opening[0].qty}`);
  if (movements.some((movement) => movement.kind === 'purchase')) {
    throw new Error('opening stock created a purchase movement');
  }

  // Not one purchase row anywhere.
  const purchases = harness.db.prepare('SELECT COUNT(*) AS total FROM purchases').get();
  if (purchases.total !== 0) throw new Error('opening stock created a purchase bill');
});

await runner.check('no supplier is owed anything', async () => {
  const rows = harness.db
    .prepare('SELECT COUNT(*) AS total FROM purchases WHERE supplier_id = ?')
    .get(supplier.id);

  if (rows.total !== 0) throw new Error('the supplier has a bill from opening stock');

  const report = await call('reports:purchases', {
    fromDate: '2000-01-01',
    toDate: '2099-12-31',
  });
  if (report.received !== 0) throw new Error(`opening stock showed as purchases: ${report.received}`);
  if (report.outstanding !== 0) throw new Error('opening stock created a debt');
});

/* ---------------------- 2. it makes costing right --------------------- */

await runner.check('a recipe costed from opening stock is right on the first sale', async () => {
  const category = await call('menu:category-save', {
    name: 'Burgers',
    sortOrder: 1,
    active: true,
  });
  const burger = await call('menu:item-save', {
    categoryId: category.id,
    name: 'Zinger',
    price: 45_000,
    available: true,
    image: null,
  });

  await call('recipes:save', {
    itemId: burger.id,
    lines: [
      { ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 },
      { ingredientId: chicken.id, qtyBase: 120, wastePercentX100: 0 },
    ],
  });

  // 1 bun (25 paisa) + 120 g chicken at Rs 0.70 (8,400) = 8,425 paisa.
  const costs = await call('recipes:menu-costs', {});
  const row = costs.rows.find((entry) => entry.itemId === burger.id);
  if (row.costTotal !== 8_425) throw new Error(`recipe cost ${row.costTotal}, expected 8425`);

  const order = await call('orders:create', {
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
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
  });

  const pnl = await call('reports:profit', { fromDate: '2000-01-01', toDate: '2099-12-31' });
  if (pnl.cogs !== 8_425) throw new Error(`cogs ${pnl.cogs}, expected 8425`);
  if (pnl.unpricedBills !== 0) throw new Error('the very first bill was unpriced');

  // And the shelf actually fell.
  const after = await call('stock:ingredient', { id: chicken.id });
  if (after.ingredient.qtyOnHand !== 8_000 - 120) {
    throw new Error(`chicken after sale ${after.ingredient.qtyOnHand}`);
  }
  if (order.items.length !== 1) throw new Error('the order did not save');
});

/* --------------------------- 3. bad input ---------------------------- */

await runner.check('a zero row is skipped, a negative one is refused', async () => {
  const before = (await call('stock:ingredient', { id: bun.id })).ingredient.qtyOnHand;

  // A half-filled sheet: only the box the owner typed is applied.
  const result = await call('stock:opening', {
    lines: [
      { ingredientId: bun.id, qtyBase: 0, unitCostMilli: 25_000 },
      { ingredientId: bun.id, qtyBase: 10, unitCostMilli: 25_000 },
    ],
  });

  if (result.applied !== 1) throw new Error(`${result.applied} lines applied, expected 1`);

  const after = (await call('stock:ingredient', { id: bun.id })).ingredient.qtyOnHand;
  if (after !== before + 10) throw new Error(`buns ${before} → ${after}`);

  // Opening stock can only add. A minus is refused rather than used to remove stock
  // without a reason — that is what wastage and adjustments are for.
  const negative = await harness.call('stock:opening', {
    lines: [{ ingredientId: bun.id, qtyBase: -50, unitCostMilli: 25_000 }],
  });
  if (negative.ok) throw new Error('a negative opening quantity was accepted');

  // A free shelf is refused too: it would make every recipe cost zero.
  const free = await harness.call('stock:opening', {
    lines: [{ ingredientId: bun.id, qtyBase: 5, unitCostMilli: -1 }],
  });
  if (free.ok) throw new Error('a negative cost was accepted');
});

/* ------------------------ 4. everything agrees ----------------------- */

await runner.check('ledger, cache and valuation still agree after opening stock', async () => {
  for (const ingredient of [bun, chicken]) {
    const row = harness.db
      .prepare('SELECT qty_on_hand FROM ingredients WHERE id = ?')
      .get(ingredient.id);
    const ledger = harness.db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS total FROM stock_movements WHERE ingredient_id = ?')
      .get(ingredient.id);

    if (row.qty_on_hand !== ledger.total) {
      throw new Error(`${ingredient.name}: cache ${row.qty_on_hand} vs ledger ${ledger.total}`);
    }
  }

  const valuation = await call('reports:stock-valuation', {});
  const bunRow = valuation.rows.find((row) => row.ingredientId === bun.id);
  if (!bunRow) throw new Error('the buns are missing from the valuation');
  if (bunRow.value !== Math.round((bunRow.qtyOnHand * bunRow.avgCostMilli) / 1000)) {
    throw new Error('the valuation is not qty × average cost');
  }
});

/* -------------------------- 5. supplier return ------------------------ */

await runner.check('a return takes stock off the shelf and keeps the bill', async () => {
  // A real delivery first, so there is a bill to protect.
  const purchase = await call('stock:purchase-create', {
    supplierId: supplier.id,
    billNo: 'B-77',
    purchasedOn: '2026-11-10',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: bun.id, qtyPurchaseMilli: 1_000, unitPrice: 25_000 }],
  });

  const before = (await call('stock:ingredient', { id: bun.id })).ingredient;
  const averageBefore = before.avgCostMilli;

  const returned = await call('stock:supplier-return', {
    ingredientId: bun.id,
    qtyBase: 40,
    supplierId: supplier.id,
    reason: 'Two packets crushed in the van',
    happenedOn: '2026-11-11',
  });

  if (returned.kind !== 'supplier_return') throw new Error(`kind ${returned.kind}`);
  if (returned.qty !== -40) throw new Error(`qty ${returned.qty}`);

  const after = (await call('stock:ingredient', { id: bun.id })).ingredient;
  if (after.qtyOnHand !== before.qtyOnHand - 40) {
    throw new Error(`shelf ${before.qtyOnHand} → ${after.qtyOnHand}`);
  }
  // A return is a quantity event, like wastage: it must not reprice the shelf.
  if (after.avgCostMilli !== averageBefore) {
    throw new Error(`the average moved ${averageBefore} → ${after.avgCostMilli}`);
  }

  // The bill is untouched — the rest of the delivery was kept and sold.
  const still = await call('stock:purchases', {
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
    limit: 50,
  });
  const bill = still.find((row) => row.id === purchase.id);
  if (!bill) throw new Error('the bill disappeared');
  if (bill.status !== 'posted') throw new Error(`the bill is ${bill.status}`);
});

await runner.check('a return cannot exceed the shelf, and needs a reason', async () => {
  const onHand = (await call('stock:ingredient', { id: bun.id })).ingredient.qtyOnHand;

  const tooMuch = await harness.call('stock:supplier-return', {
    ingredientId: bun.id,
    qtyBase: onHand + 1,
    supplierId: supplier.id,
    reason: 'Trying to send back more than exists',
    happenedOn: '2026-11-11',
  });
  if (tooMuch.ok) throw new Error('more was returned than was on the shelf');

  const noReason = await harness.call('stock:supplier-return', {
    ingredientId: bun.id,
    qtyBase: 5,
    supplierId: supplier.id,
    reason: 'x',
    happenedOn: '2026-11-11',
  });
  if (noReason.ok) throw new Error('a return with no real reason was accepted');
});

/* --------------------- 6. purchase price trend ------------------------ */

await runner.check('the purchase report shows a price trend per ingredient', async () => {
  // Buns have now been bought at Rs 25 a packet (opening stock was 25 paisa a bun
  // and the B-77 bill was 2,500 paisa a packet) — then a dearer delivery arrives.
  await call('stock:purchase-create', {
    supplierId: supplier.id,
    billNo: 'B-78',
    purchasedOn: '2026-11-20',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: bun.id, qtyPurchaseMilli: 1_000, unitPrice: 40_000 }],
  });

  const report = await call('reports:purchases', {
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
  });

  const row = report.byIngredient.find((entry) => entry.ingredientId === bun.id);
  if (!row) throw new Error('the buns are missing from the ingredient view');
  if (row.purchaseCount !== 2) throw new Error(`bill count ${row.purchaseCount}`);
  if (row.lastCostMilli <= row.firstCostMilli) {
    throw new Error(`price did not rise: ${row.firstCostMilli} → ${row.lastCostMilli}`);
  }
  if (row.changeX100 === null || row.changeX100 <= 0) {
    throw new Error(`change ${row.changeX100}`);
  }

  // Total spend on the two bills: 25,000 + 40,000 = 65,000 paisa.
  if (row.spend !== 65_000) throw new Error(`spend ${row.spend}`);

  // And the CSV carries it.
  const csv = harness.csv.buildCsv('purchases_by_ingredient', {
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
  });
  if (!csv.split('\r\n')[0].startsWith('Ingredient')) {
    throw new Error(`the CSV header is "${csv.split('\r\n')[0]}"`);
  }
});

/* --------------------- 7. recurring bills (4.E2) ---------------------- */

const { categories } = await call('expenses:overview', {
  from: '2026-01-01',
  to: '2026-12-31',
});
const rentCategoryId = (categories.find((row) => /rent/i.test(row.name)) ?? categories[0]).id;

/** The month the app believes it is today, so a test never depends on the clock. */
function todayPeriod() {
  return new Date().toISOString().slice(0, 7);
}

// A second template due on the 5th, used for the settle/unsettle checks — a day that
// exists in every month, so those assertions are about money and not about calendars.
const rentMonth = await call('expenses:recurring-save', {
  categoryId: rentCategoryId,
  name: 'Rent (early)',
  typicalAmount: 5_000_000,
  dueDay: 5,
  remindDays: 3,
  payee: 'Malik sahab',
  paidFrom: 'bank',
  notes: '',
  active: true,
});
const rentMonthId = rentMonth.id;

/** Set in check 7, reused by check 11 to prove a deactivated bill stops nagging. */
let rent;

await runner.check('a bill due on the 31st lands on the last day of a short month', async () => {
  // February has no 31st. The straightforward "string-concatenate the day" approach
  // produces 2027-02-31, which no report can ever match — so this is pinned here.
  rent = await call('expenses:recurring-save', {
    categoryId: rentCategoryId,
    name: 'Shop rent',
    typicalAmount: 5_000_000,
    dueDay: 31,
    remindDays: 3,
    payee: 'Malik sahab',
    paidFrom: 'bank',
    notes: '',
    active: true,
  });

  const feb = await call('expenses:recurring', { period: '2027-02' });
  const row = feb.rows.find((entry) => entry.bill.id === rent.id);
  if (!row) throw new Error('the rent is missing from February');
  if (row.dueDate !== '2027-02-28') throw new Error(`February due date ${row.dueDate}`);

  // A leap year is the other half of the same rule.
  const leap = await call('expenses:recurring', { period: '2028-02' });
  const leapRow = leap.rows.find((entry) => entry.bill.id === rent.id);
  if (leapRow.dueDate !== '2028-02-29') throw new Error(`leap due date ${leapRow.dueDate}`);

  // And a 30-day month.
  const apr = await call('expenses:recurring', { period: '2027-04' });
  const aprRow = apr.rows.find((entry) => entry.bill.id === rent.id);
  if (aprRow.dueDate !== '2027-04-30') throw new Error(`April due date ${aprRow.dueDate}`);
});

await runner.check('paying a bill books exactly one expense, dated in its own month', async () => {
  const before = await call('reports:purchases', {
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
  });
  void before;

  const settled = await call('expenses:recurring-settle', {
    templateId: rentMonthId,
    period: '2026-10',
    status: 'paid',
    amount: 5_000_000,
    note: 'October rent, paid late',
  });

  if (settled.state !== 'paid') throw new Error(`state ${settled.state}`);
  if (!settled.payment?.expenseId) throw new Error('no expense was created');

  const expense = await call('expenses:overview', {
    from: '2026-10-01',
    to: '2026-10-31',
  });
  const booked = expense.expenses.find((entry) => entry.id === settled.payment.expenseId);
  if (!booked) throw new Error('the expense is not in October');
  if (booked.amount !== 5_000_000) throw new Error(`amount ${booked.amount}`);
  // Dated the due day, not the day it was confirmed.
  if (booked.spentOn !== '2026-10-05') throw new Error(`dated ${booked.spentOn}`);

  // It must appear in November zero times — one month, one expense.
  const november = await call('expenses:overview', {
    from: '2026-11-01',
    to: '2026-11-30',
  });
  if (november.expenses.some((entry) => entry.id === settled.payment.expenseId)) {
    throw new Error('the October expense leaked into November');
  }
});

await runner.check('a month cannot be paid twice, and a skip books nothing', async () => {
  const again = await harness.call('expenses:recurring-settle', {
    templateId: rentMonthId,
    period: '2026-10',
    status: 'paid',
    amount: 5_000_000,
    note: '',
  });
  if (again.ok) throw new Error('the same month was paid twice');

  const expensesBefore = await call('expenses:overview', {
    from: '2026-11-01',
    to: '2026-11-30',
  });

  const skipped = await call('expenses:recurring-settle', {
    templateId: rentMonthId,
    period: '2026-11',
    status: 'skipped',
    amount: 0,
    note: 'Shop was closed for two weeks',
  });
  if (skipped.state !== 'skipped') throw new Error(`state ${skipped.state}`);
  if (skipped.payment?.expenseId) throw new Error('a skip created an expense');

  const expensesAfter = await call('expenses:overview', {
    from: '2026-11-01',
    to: '2026-11-30',
  });
  if (expensesAfter.total !== expensesBefore.total) {
    throw new Error(`skipping changed the month's spend ${expensesBefore.total} → ${expensesAfter.total}`);
  }

  // And it no longer shows as needing attention.
  const month = await call('expenses:recurring', { period: '2026-11' });
  const row = month.rows.find((entry) => entry.bill.id === rentMonthId);
  if (row.state !== 'skipped') throw new Error(`overview state ${row.state}`);
});

await runner.check('un-settling voids the expense instead of deleting it', async () => {
  const settled = await call('expenses:recurring', { period: '2026-10' });
  const row = settled.rows.find((entry) => entry.bill.id === rentMonthId);
  const expenseId = row.payment.expenseId;

  await call('expenses:recurring-unsettle', { templateId: rentMonthId, period: '2026-10' });

  const open = await call('expenses:overview', {
    from: '2026-10-01',
    to: '2026-10-31',
    status: 'all',
  });
  const voided = open.expenses.find((entry) => entry.id === expenseId);
  if (!voided) throw new Error('the expense was deleted, not voided');
  if (voided.status !== 'void') throw new Error(`status ${voided.status}`);

  // The month is open again.
  const month = await call('expenses:recurring', { period: '2026-10' });
  const again = month.rows.find((entry) => entry.bill.id === rentMonthId);
  if (again.state === 'paid') throw new Error('the month still reads as paid');
});

await runner.check('the reminder counts only bills that are actually due', async () => {
  // A bill due in three days, and one due in twenty.
  const soon = await call('expenses:recurring', { period: todayPeriod() });
  const rentRow = soon.rows.find((entry) => entry.bill.id === rentMonthId);

  // The states must agree with the arithmetic, whatever today happens to be.
  for (const row of soon.rows) {
    if (row.payment) continue;
    const overdue = row.daysUntilDue < 0;
    if (overdue && row.state !== 'overdue') {
      throw new Error(`${row.bill.name} is ${row.daysUntilDue} days overdue but reads ${row.state}`);
    }
    if (!overdue && row.daysUntilDue > row.bill.remindDays && row.state !== 'upcoming') {
      throw new Error(`${row.bill.name} is ${row.daysUntilDue} days away but reads ${row.state}`);
    }
  }

  if (!rentRow) throw new Error('the rent is missing from this month');

  // Deactivating a bill takes it out of the reminder count without losing history.
  await call('expenses:recurring-save', {
    id: rent.id,
    categoryId: rentCategoryId,
    name: 'Shop rent',
    typicalAmount: 5_000_000,
    dueDay: 31,
    remindDays: 3,
    payee: 'Malik sahab',
    paidFrom: 'bank',
    notes: '',
    active: false,
  });

  const after = await call('expenses:recurring', { period: todayPeriod() });
  const inactive = after.rows.find((entry) => entry.bill.id === rent.id);
  if (inactive.bill.active) throw new Error('the bill is still active');
  if (inactive.state === 'due' || inactive.state === 'overdue') {
    throw new Error(`an inactive bill is nagging: ${inactive.state}`);
  }
});

await runner.check('the dashboard nags about a due bill without booking anything', async () => {
  // Make today's month have exactly one unpaid bill, dated yesterday, so the banner
  // must appear whatever the calendar says.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const period = yesterday.slice(0, 7);

  const chase = await call('expenses:recurring-save', {
    categoryId: rentCategoryId,
    name: 'Internet',
    typicalAmount: 400_000,
    dueDay: Number(yesterday.slice(8, 10)),
    remindDays: 3,
    payee: 'PTCL',
    paidFrom: 'bank',
    notes: '',
    active: true,
  });

  const before = await call('reports:dashboard');
  const banner = before.billsDue.find((bill) => bill.id === chase.id);
  if (!banner) throw new Error('the dashboard does not mention the overdue bill');
  if (!banner.overdue) throw new Error('the bill is not flagged overdue');

  // Opening the dashboard must not have created an expense.
  const month = await call('expenses:recurring', { period });
  const row = month.rows.find((entry) => entry.bill.id === chase.id);
  if (row.payment) throw new Error('the dashboard booked a payment by itself');
  if (row.state !== 'overdue') throw new Error(`state ${row.state}`);

  // Paying it takes the nudge away.
  await call('expenses:recurring-settle', {
    templateId: chase.id,
    period,
    status: 'paid',
    amount: 420_000,
    note: '',
  });

  const after = await call('reports:dashboard');
  if (after.billsDue.some((bill) => bill.id === chase.id)) {
    throw new Error('the paid bill is still nagging');
  }
});

harness.cleanup();
runner.finish();
