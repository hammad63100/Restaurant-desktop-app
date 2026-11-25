/**
 * Phase 20 — Roadmap 4.G: profit & loss, the answer to "mera munafa kitna hai?".
 *
 * Everything the earlier phases stored comes together here:
 *
 *   net sales (food, ex tax, after discounts)
 *     − cost of the food sold (frozen at sale time, never re-costed)
 *       = gross profit
 *         − the shop's running expenses
 *           = net profit
 *
 * The test proves the arithmetic rather than trusting it: every figure is rebuilt
 * from the individual bills and expenses, and the totals must match exactly.
 *
 * It also guards the two ways a P&L usually lies:
 *   * counting tax as income, which inflates every margin,
 *   * treating an item with no recipe as costing nothing, which invents profit.
 */
import { createHarness, createRunner } from './test-harness.mjs';

/*
 * No demo data on purpose. The P&L is a total over a period, so any bill seeded
 * by something else would make the arithmetic unprovable. A clean database with
 * two menu items of our own means every paisa in the report can be traced.
 */
const harness = createHarness({ withDemoData: false });
const runner = createRunner('Phase 20 — Profit & loss (4.G)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);
const range = { fromDate: '2026-11-01', toDate: '2026-11-30' };

/* --------------------------- a small kitchen ---------------------------- */

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

const bun = await ingredientWithPrice({
  name: 'Bun',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 100,
  qtyPurchaseMilli: 10_000,
  unitPrice: 25_000, // Rs 250 for the 100-bun packet → Rs 2.50 a bun
});

const chicken = await ingredientWithPrice({
  name: 'Chicken',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  qtyPurchaseMilli: 10_000,
  unitPrice: 70_000, // Rs 700/kg → Rs 0.70/g
});

const category = await call('menu:category-save', { name: 'Burgers', sortOrder: 1, active: true });

const zinger = await call('menu:item-save', {
  categoryId: category.id,
  name: 'Zinger Burger',
  price: 45_000,
  available: true,
  image: null,
});

const fries = await call('menu:item-save', {
  categoryId: category.id,
  name: 'French Fries',
  price: 25_000,
  available: true,
  image: null,
});

await call('recipes:save', {
  itemId: zinger.id,
  lines: [
    { ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 },
    { ingredientId: chicken.id, qtyBase: 100, wastePercentX100: 0 },
  ],
});

// One bun (Rs 2.50) + 100 g chicken (Rs 70) = Rs 72.50 → 7,250 paisa a burger.
const SERVING_COST = 7_250; // Rs 72.50

function sell(qty, extra = {}) {
  return call('orders:create', {
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
    items: [{ itemId: zinger.id, qty, notes: '' }],
    ...extra,
  });
}

/* ------------------------- 1. a clean, empty start ---------------------- */

await runner.check('before anything is sold the P&L is all zeros, not null', async () => {
  const report = await call('reports:profit', range);

  if (report.netSales !== 0) throw new Error(`net sales ${report.netSales}`);
  if (report.cogs !== 0) throw new Error(`cogs ${report.cogs}`);
  if (report.knownNetSales !== 0) throw new Error(`priced sales ${report.knownNetSales}`);
  if (report.unknownNetSales !== 0) throw new Error(`unpriced sales ${report.unknownNetSales}`);
  if (report.grossProfit !== 0) throw new Error(`gross profit ${report.grossProfit}`);
  if (report.netProfit !== 0) throw new Error(`net profit ${report.netProfit}`);
  if (report.orderCount !== 0) throw new Error(`orders ${report.orderCount}`);
});

/* ---------------------------- 2. one clean day -------------------------- */

await runner.check('gross profit is net sales minus the frozen cost of the food', async () => {
  // Two burgers at Rs 450 = Rs 900; cost 2 × Rs 72.50 = Rs 145.
  await sell(2);

  const report = await call('reports:profit', range);

  if (report.subtotal !== 90_000) throw new Error(`subtotal ${report.subtotal}`);
  if (report.netSales !== 90_000) throw new Error(`net sales ${report.netSales}`);
  if (report.cogs !== SERVING_COST * 2) throw new Error(`cogs ${report.cogs}`);
  if (report.grossProfit !== 90_000 - SERVING_COST * 2) {
    throw new Error(`gross profit ${report.grossProfit}`);
  }

  // No expenses yet, so net profit equals gross profit.
  if (report.netProfit !== report.grossProfit) throw new Error('net profit drifted');
});

await runner.check('a discount reduces net sales, and therefore the profit', async () => {
  // Rs 900 with Rs 100 off, plus 5% tax on the discounted amount.
  await sell(2, { discount: 10_000, discountReason: 'Regular customer', taxPercent: 5 });

  const report = await call('reports:profit', range);

  // Subtotals: 90,000 + 90,000 = 180,000. Discounts 0 + 10,000.
  if (report.subtotal !== 180_000) throw new Error(`subtotal ${report.subtotal}`);
  if (report.discount !== 10_000) throw new Error(`discount ${report.discount}`);
  if (report.netSales !== 170_000) throw new Error(`net sales ${report.netSales}`);

  // Tax is 5% of 80,000 = 4,000, collected on top and NOT part of net sales.
  if (report.tax !== 4_000) throw new Error(`tax ${report.tax}`);
  if (report.totalCollected !== 174_000) throw new Error(`collected ${report.totalCollected}`);

  if (report.cogs !== SERVING_COST * 4) throw new Error(`cogs ${report.cogs}`);
  if (report.grossProfit !== 170_000 - SERVING_COST * 4) {
    throw new Error(`gross profit ${report.grossProfit}`);
  }
});

await runner.check('tax never becomes income: profit ignores it entirely', async () => {
  const report = await call('reports:profit', range);

  // If tax leaked into the profit it would be totalCollected − cogs instead.
  const withTax = report.totalCollected - (report.cogs ?? 0);
  if (report.grossProfit === withTax) {
    throw new Error('gross profit was computed from the tax-inclusive total');
  }
});

/* ------------------------- 3. expenses reduce profit -------------------- */

await runner.check('shop expenses turn gross profit into net profit', async () => {
  const rent = (await call('expenses:overview', {
    from: range.fromDate,
    to: range.toDate,
  })).categories.find((category) => category.name === 'Rent');

  const before = await call('reports:profit', range);

  await call('expenses:save', {
    categoryId: rent.id,
    spentOn: '2026-11-22',
    amount: 20_000, // Rs 200
    paidFrom: 'other',
    payee: 'Landlord',
    notes: 'A month of rent, apparently',
  });

  const after = await call('reports:profit', range);

  if (after.shopExpenses - before.shopExpenses !== 20_000) {
    throw new Error(`shop expenses moved by ${after.shopExpenses - before.shopExpenses}`);
  }
  if (after.grossProfit !== before.grossProfit) throw new Error('the expense changed gross profit');
  if (after.netProfit !== after.grossProfit - 20_000) {
    throw new Error(`net profit ${after.netProfit}`);
  }
});

await runner.check('voiding an expense restores the net profit', async () => {
  const overview = await call('expenses:overview', { from: range.fromDate, to: range.toDate });
  const expense = overview.expenses.find((row) => row.amount === 20_000);

  const before = await call('reports:profit', range);
  await call('expenses:void', { id: expense.id, reason: 'Charged twice' });
  const after = await call('reports:profit', range);

  if (after.shopExpenses !== before.shopExpenses - 20_000) {
    throw new Error('the void did not leave the P&L');
  }
  if (after.netProfit !== after.grossProfit) throw new Error('net profit did not recover');
});

/* ------------------------ 4. cancellations and wastage ------------------ */

await runner.check('a cancelled bill leaves the P&L entirely', async () => {
  const before = await call('reports:profit', range);

  const order = await sell(3);
  const withOrder = await call('reports:profit', range);
  if (withOrder.orderCount !== before.orderCount + 1) throw new Error('the bill was not counted');

  // Never cooked → the stock comes back and the sale disappears.
  await call('orders:cancel', { id: order.id, prepared: false });

  const after = await call('reports:profit', range);
  if (after.orderCount !== before.orderCount) throw new Error('the cancelled bill is still counted');
  if (after.netSales !== before.netSales) throw new Error('its sales are still counted');
  if (after.cancelledCount !== before.cancelledCount + 1) {
    throw new Error('the cancellation is not listed');
  }
  if (after.cancelledValue <= before.cancelledValue) {
    throw new Error('the cancelled value is not recorded');
  }
});

await runner.check('cooked food cancelled shows up as wastage, and the cost stays spent', async () => {
  const before = await call('reports:profit', range);

  const order = await sell(1);
  await call('orders:status', { id: order.id, status: 'preparing' });
  await call('orders:cancel', { id: order.id, prepared: true });

  const after = await call('reports:profit', range);

  // The food was bought and used, so the wastage must be visible.
  if (after.wastageValue <= before.wastageValue) {
    throw new Error('cooked waste was not recorded as wastage value');
  }
  if (after.wastageQty <= before.wastageQty) throw new Error('no wastage quantity');
});

/* -------------------- 5. the unknown-cost rule -------------------------- */

await runner.check('an unpriced bill is set aside, not silently counted as free', async () => {
  // French Fries has no recipe in this test.
  const bill = await call('orders:create', {
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
    items: [
      { itemId: zinger.id, qty: 1, notes: '' },
      { itemId: fries.id, qty: 1, notes: '' },
    ],
  });

  const report = await call('reports:profit', range);

  // The mixed bill's sales must NOT be in the priced half, or the profit would be
  // flattered by the price of a burger whose cost nobody knows.
  if (report.unknownNetSales !== 70_000) {
    throw new Error(`unpriced sales ${report.unknownNetSales}, expected 70000`);
  }
  if (report.unpricedBills !== 1) throw new Error(`unpriced bills ${report.unpricedBills}`);
  if (report.linesWithoutCost !== 1) throw new Error(`unpriced lines ${report.linesWithoutCost}`);

  // Sales split cleanly into the two halves.
  if (report.knownNetSales + report.unknownNetSales !== report.netSales) {
    throw new Error('the two halves of the sales do not add up to the whole');
  }

  // And the profit is built only from what could be proven.
  if (report.grossProfit !== report.knownNetSales - report.cogs) {
    throw new Error('gross profit used sales it could not cost');
  }

  /*
   * `cogs` must contain the cost of COSTED bills only.
   *
   * The mixed bill has one priced line (the burger) and one unpriced (the fries).
   * Its sales are excluded from `knownNetSales` because the bill cannot be priced
   * as a whole — so its burger cost must be excluded from `cogs` too. Summing
   * every bill's cost while counting only the costed bills' sales charges a real
   * cost against sales that were set aside, and the P&L reports a loss on a day
   * that made money. That is a silent lie, so it is pinned here.
   */
  const pricedBillsCost = harness.db
    .prepare(
      `SELECT COALESCE(SUM(bill.cost), 0) AS total
         FROM (
           SELECT o.id, SUM(CASE WHEN oi.cost_total IS NULL THEN 1 ELSE 0 END) AS unknown,
                  COALESCE(SUM(oi.cost_total), 0) AS cost
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
            WHERE o.status <> 'cancelled' AND date(o.created_at) BETWEEN ? AND ?
            GROUP BY o.id
         ) bill
        WHERE bill.unknown = 0`,
    )
    .get(range.fromDate, range.toDate);

  if (report.cogs !== pricedBillsCost.total) {
    throw new Error(
      `cogs ${report.cogs} includes cost from a bill whose sales were excluded ` +
        `(${pricedBillsCost.total} is the honest figure)`,
    );
  }

  // Giving the fries a recipe makes the whole period known again.
  const oil = await ingredientWithPrice({
    name: 'Frying oil',
    baseUnit: 'ml',
    purchaseUnit: 'litre',
    unitsPerPurchase: 1000,
    qtyPurchaseMilli: 5_000,
    unitPrice: 45_000,
  });

  await call('recipes:save', {
    itemId: fries.id,
    lines: [{ ingredientId: oil.id, qtyBase: 100, wastePercentX100: 0 }],
  });

  /*
   * The old bill keeps no cost even now that a recipe exists. It has no snapshot:
   * the app did not know the cost at sale time, and back-filling it would rewrite
   * history with a number the shop never saw. It stays in the "unpriced" half.
   */
  const stillUnknown = await call('reports:profit', range);
  if (stillUnknown.unpricedBills !== 1) {
    throw new Error('an old bill was silently re-costed by a new recipe');
  }

  // Amending the bill is the documented way to give it a cost: the owner is
  // restating what he sold, so it is priced at today's recipe and today's cost.
  await call('order:amend', {
    id: bill.id,
    reason: 'Recipes have been added since this bill',
    items: [
      { itemId: zinger.id, qty: 1, notes: '' },
      { itemId: fries.id, qty: 1, notes: '' },
    ],
    discount: 0,
    approvedBy: null,
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    notes: '',
  });

  const amended = await call('reports:profit', range);
  if (amended.unknownNetSales !== 0) throw new Error('the amended bill is still unpriced');
  if (amended.unpricedBills !== 0) throw new Error('the amended bill still has no cost');

  const prices = (await call('recipes:menu-costs', {})).rows;
  const fryCost = prices.find((row) => row.itemId === fries.id)?.costTotal ?? 0;
  const burgerCost = prices.find((row) => row.itemId === zinger.id)?.costTotal ?? 0;

  // Priced sales in this period: 2 + 2 + 1(fries bill, amended) + the 1-burger
  // line of the mixed bill. Four earlier burgers were sold, one was made and
  // thrown away, one was in the cancelled bill and is gone.
  if (amended.cogs !== SERVING_COST * 4 + fryCost + burgerCost) {
    throw new Error(`cogs after the amendment ${amended.cogs}, expected ${SERVING_COST * 4 + fryCost + burgerCost}`);
  }
});

/* ------------------------- 6. the arithmetic ties ----------------------- */

await runner.check('every figure reconciles with the individual bills', async () => {
  const report = await call('reports:profit', range);
  const orders = await call('orders:list', {
    fromDate: range.fromDate,
    toDate: range.toDate,
    status: 'all',
    limit: 200,
  });

  const active = orders.filter((order) => order.status !== 'cancelled');

  const subtotal = active.reduce((sum, order) => sum + order.subtotal, 0);
  const discount = active.reduce((sum, order) => sum + order.discount, 0);
  const total = active.reduce((sum, order) => sum + order.total, 0);
  const tax = active.reduce((sum, order) => sum + order.tax, 0);

  if (report.subtotal !== subtotal) throw new Error(`subtotal ${report.subtotal} vs ${subtotal}`);
  if (report.discount !== discount) throw new Error(`discount ${report.discount} vs ${discount}`);
  if (report.totalCollected !== total) throw new Error(`collected ${report.totalCollected} vs ${total}`);
  if (report.tax !== tax) throw new Error(`tax ${report.tax} vs ${tax}`);
  if (report.orderCount !== active.length) {
    throw new Error(`orders ${report.orderCount} vs ${active.length}`);
  }

  // And the identity the whole screen rests on.
  if (report.netSales !== report.subtotal - report.discount) {
    throw new Error('net sales does not equal subtotal minus discount');
  }
  if (report.grossProfit !== report.knownNetSales - report.cogs) {
    throw new Error('gross profit does not equal priced sales minus cogs');
  }
  if (report.netProfit !== report.grossProfit - report.shopExpenses) {
    throw new Error('net profit does not equal gross profit minus expenses');
  }
});

await runner.check('the period boundaries are respected to the day', async () => {
  const before = await call('reports:profit', { fromDate: '2020-01-01', toDate: '2020-12-31' });
  const after = await call('reports:profit', { fromDate: '2030-01-01', toDate: '2030-12-31' });

  for (const report of [before, after]) {
    if (report.orderCount !== 0 || report.netSales !== 0) {
      throw new Error('an empty period reported sales');
    }
    if (report.cogs !== 0) throw new Error('an empty period reported a cost');
    if (report.netProfit !== 0) throw new Error('an empty period reported a profit');
    if (report.unknownNetSales !== 0) throw new Error('an empty period reported unpriced sales');
  }
});

/* ---------------------------- 7. who may see it ------------------------- */

await runner.check('the P&L is the owner’s: a manager cannot read it', async () => {
  // Build the two other roles: this database has no demo data.
  await call('users:save', {
    username: 'manager',
    fullName: 'Manager',
    role: 'manager',
    password: 'manager123',
    active: true,
  });
  await call('users:save', {
    username: 'cashier',
    fullName: 'Cashier',
    role: 'cashier',
    password: 'cashier123',
    active: true,
  });

  await harness.loginAs('manager', 'manager123');
  const denied = await harness.call('reports:profit', range);
  if (denied.ok) throw new Error('a manager could read the cost and profit figures');

  const allowed = await harness.call('reports:range', range);
  if (!allowed.ok) throw new Error('a manager should still be able to read the sales report');

  await harness.loginAs('cashier', 'cashier123');
  const cashier = await harness.call('reports:profit', range);
  if (cashier.ok) throw new Error('a cashier could read the profit and loss');
});

harness.cleanup();
runner.finish();
