/**
 * Phase 22 — Roadmap 4.G, part two: the reports the owner reads after the P&L.
 *
 * The P&L answers "did I make money?". These five answer the follow-up questions:
 *
 *   * **Item profit** — which dish actually makes money, not just which sells most.
 *   * **Stock value** — how much of my cash is sitting on the shelf right now.
 *   * **Purchases** — what left for stock, and what I still owe a supplier.
 *   * **Wastage** — what I threw away, and which reason keeps costing me.
 *   * **Expenses** — where the running costs went, by category and by wallet.
 *
 * The value of this suite is not that the endpoints return something. It is that
 * every number reconciles: item profit against the P&L, stock value against the
 * ledger, the purchase total against the bills, and the CSV against the screen.
 */
import { createHarness, createRunner } from './test-harness.mjs';

/*
 * A clean database. Reports are totals, so any seeded bill would make the
 * arithmetic impossible to prove to the paisa.
 */
const harness = createHarness({ withDemoData: false });
const runner = createRunner('Phase 22 — Item profit, stock value and spend reports (4.G)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);
const range = { fromDate: '2026-11-01', toDate: '2026-11-30' };

/* ------------------------------- the shop ------------------------------- */

const bun = await call('stock:ingredient-save', {
  name: 'Bun',
  category: 'Bread',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 100,
  reorderLevel: 50,
  supplierId: null,
  active: true,
});

const chicken = await call('stock:ingredient-save', {
  name: 'Chicken',
  category: 'Meat',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  reorderLevel: 500,
  supplierId: null,
  active: true,
});

// A supplier, so the purchase report has a name to group by.
const supplier = await call('stock:supplier-save', {
  name: 'Al-Madina',
  phone: '0300-1112223',
  address: '',
  notes: '',
  active: true,
});

// 10 packets of 100 buns at Rs 250 a packet = 1,000 buns for Rs 2,500, so 25
// paisa a bun (25,000 milli-paisa). Cheap, which matters for the low-stock step.
await call('stock:purchase-create', {
  supplierId: supplier.id,
  billNo: 'B-1',
  purchasedOn: '2026-11-10',
  extraCharges: 0,
  paidAmount: 0,
  paymentMethod: 'credit',
  notes: '',
  lines: [{ ingredientId: bun.id, qtyPurchaseMilli: 10_000, unitPrice: 25_000 }],
});

// 10 kg of chicken at Rs 700/kg (70,000 paisa a kg) → Rs 0.70/g, Rs 70 a serving.
await call('stock:purchase-create', {
  supplierId: supplier.id,
  billNo: 'B-2',
  purchasedOn: '2026-11-11',
  extraCharges: 0,
  paidAmount: 300_000, // Rs 3,000 of the Rs 7,000 bill
  paymentMethod: 'credit',
  notes: '',
  lines: [{ ingredientId: chicken.id, qtyPurchaseMilli: 10_000, unitPrice: 70_000 }],
});

const category = await call('menu:category-save', { name: 'Burgers', sortOrder: 1, active: true });

const zinger = await call('menu:item-save', {
  categoryId: category.id,
  name: 'Zinger Burger',
  price: 45_000, // Rs 450
  available: true,
  image: null,
});

// Sold but never given a recipe: its cost is genuinely unknown.
const plain = await call('menu:item-save', {
  categoryId: category.id,
  name: 'Plain Burger',
  price: 20_000, // Rs 200
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

// 1 bun (2,500 milli-paisa) + 100 g chicken (70,000 milli a gram) = 7,250 paisa.
const ZINGER_COST = 7_250;

const sell = (items, extra = {}) =>
  call('orders:create', {
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
    items,
    ...extra,
  });

/* ---------------------------- 1. item profit ---------------------------- */

await runner.check('item profit is revenue minus the frozen cost, per item', async () => {
  await sell([{ itemId: zinger.id, qty: 3, notes: '' }]); // Rs 1,350, cost Rs 217.50
  await sell([{ itemId: zinger.id, qty: 1, notes: '' }]); // Rs 450, cost Rs 72.50

  const rows = await call('reports:item-profit', range);
  const zingerRow = rows.find((row) => row.itemId === zinger.id);

  if (!zingerRow) throw new Error('the burger is missing from the report');
  if (zingerRow.qty !== 4) throw new Error(`qty ${zingerRow.qty}`);
  if (zingerRow.revenue !== 180_000) throw new Error(`revenue ${zingerRow.revenue}`);
  // 29,000 paisa = 4 × 7,250. Let the fixture state the real number rather than
  // hiding a wrong constant behind a symbol.
  if (zingerRow.cost !== 29_000) throw new Error(`cost ${zingerRow.cost}`);
  if (zingerRow.profit !== 180_000 - ZINGER_COST * 4) {
    throw new Error(`profit ${zingerRow.profit}`);
  }

  // 151,000 profit on 180,000 revenue = 83.89%.
  if (zingerRow.marginX100 !== Math.round(((180_000 - ZINGER_COST * 4) * 10_000) / 180_000)) {
    throw new Error(`margin ${zingerRow.marginX100}`);
  }
  if (!zingerRow.hasRecipe) throw new Error('a costed item was marked recipe-less');
  if (zingerRow.unpricedReason !== null) {
    throw new Error(`a fully costed item reported ${zingerRow.unpricedReason}`);
  }
});

await runner.check('an item with no recipe reports unknown margin, not 100%', async () => {
  await sell([{ itemId: plain.id, qty: 2, notes: '' }]); // Rs 400, cost unknown

  const rows = await call('reports:item-profit', range);
  const plainRow = rows.find((row) => row.itemId === plain.id);

  if (!plainRow) throw new Error('the plain burger is missing');
  if (plainRow.marginX100 !== null) {
    throw new Error(`a recipe-less item reported a margin of ${plainRow.marginX100}`);
  }
  if (plainRow.pricedRevenue !== 0) throw new Error(`priced revenue ${plainRow.pricedRevenue}`);
  if (plainRow.unpricedRevenue !== 40_000) {
    throw new Error(`unpriced revenue ${plainRow.unpricedRevenue}`);
  }
  if (plainRow.unpricedQty !== 2) throw new Error(`unpriced qty ${plainRow.unpricedQty}`);
  if (plainRow.hasRecipe) throw new Error('a recipe-less item was marked costed');
  if (plainRow.unpricedReason !== 'no_recipe') {
    throw new Error(`the reason came back as ${plainRow.unpricedReason}`);
  }
});

await runner.check('an item given a recipe later says so, not "no recipe"', async () => {
  /*
   * The plain burger sold before it had a recipe. Its old bills can never be priced
   * — that is honest and permanent — but the ITEM is fixed now. Telling the owner
   * "no recipe" would send them looking for a problem that no longer exists, so the
   * row names the real reason: these bills predate the recipe.
   */
  await call('recipes:save', {
    itemId: plain.id,
    lines: [{ ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 }],
  });

  const rows = await call('reports:item-profit', range);
  const plainRow = rows.find((row) => row.itemId === plain.id);

  if (!plainRow) throw new Error('the plain burger disappeared');
  if (plainRow.unpricedReason !== 'sold_before_recipe') {
    throw new Error(`the reason came back as ${plainRow.unpricedReason}`);
  }
  if (!plainRow.hasRecipe) throw new Error('the item has a recipe now but the row denies it');
  // The old bills stay unpriced: a recipe added today is not a time machine.
  if (plainRow.unpricedRevenue !== 40_000) {
    throw new Error(`old revenue was repriced: ${plainRow.unpricedRevenue}`);
  }
  // And a NEW sale of the same item is costed from now on.
  await sell([{ itemId: plain.id, qty: 1, notes: '' }]);
  const after = (await call('reports:item-profit', range)).find((row) => row.itemId === plain.id);
  if (after.pricedRevenue !== 20_000) {
    throw new Error(`the new sale was not costed: priced ${after.pricedRevenue}`);
  }
  if (after.unpricedRevenue !== 40_000) {
    throw new Error(`the old sales moved: unpriced ${after.unpricedRevenue}`);
  }
});

await runner.check('item profit reconciles with the P&L to the paisa', async () => {
  const rows = await call('reports:item-profit', range);
  const pnl = await call('reports:profit', range);

  const pricedRevenue = rows.reduce((total, row) => total + row.pricedRevenue, 0);
  const cost = rows.reduce((total, row) => total + row.cost, 0);
  const unpriced = rows.reduce((total, row) => total + row.unpricedRevenue, 0);

  // The P&L splits sales by bill, the item report by line. Both must reach the
  // same two numbers, or one of the screens is lying.
  if (pricedRevenue !== pnl.knownNetSales) {
    throw new Error(`priced revenue ${pricedRevenue} vs P&L ${pnl.knownNetSales}`);
  }
  if (cost !== pnl.cogs) throw new Error(`cost ${cost} vs P&L ${pnl.cogs}`);
  if (unpriced !== pnl.unknownNetSales) {
    throw new Error(`unpriced ${unpriced} vs P&L ${pnl.unknownNetSales}`);
  }
});

await runner.check('a cancelled bill leaves the item report', async () => {
  const order = await sell([{ itemId: zinger.id, qty: 10, notes: '' }]);
  await call('orders:cancel', { id: order.id });

  const rows = await call('reports:item-profit', range);
  const zingerRow = rows.find((row) => row.itemId === zinger.id);

  if (zingerRow.qty !== 4) throw new Error(`the cancelled bill still counts: qty ${zingerRow.qty}`);
});

/* --------------------------- 2. stock valuation ------------------------- */

await runner.check('stock value is the shelf at average cost, and matches the ledger', async () => {
  const valuation = await call('reports:stock-valuation', {});

  if (valuation.itemCount !== 2) throw new Error(`item count ${valuation.itemCount}`);

  for (const row of valuation.rows) {
    const ledger = harness.db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS total FROM stock_movements WHERE ingredient_id = ?')
      .get(row.ingredientId);

    if (row.qtyOnHand !== ledger.total) {
      throw new Error(`${row.name}: valuation ${row.qtyOnHand} vs ledger ${ledger.total}`);
    }
    if (row.value !== Math.round((row.qtyOnHand * row.avgCostMilli) / 1000)) {
      throw new Error(`${row.name}: value ${row.value} is not qty × cost`);
    }
  }

  const summed = valuation.rows.reduce((total, row) => total + row.value, 0);
  if (valuation.totalValue !== summed) throw new Error('the total does not add up');
});

await runner.check('stock value separates the money sitting in low stock', async () => {
  // The buns started at 100 with a reorder level of 50; four have been sold, so
  // they are still healthy. Bring them under 50 with a wastage entry instead.
  const valuationBefore = await call('reports:stock-valuation', {});
  const bunRow = valuationBefore.rows.find((row) => row.ingredientId === bun.id);
  const below = bunRow.qtyOnHand - 49;

  await call('stock:wastage', {
    ingredientId: bun.id,
    qtyBase: below,
    reason: 'spoiled',
    notes: 'Found mouldy',
    happenedOn: '2026-11-20',
  });

  const valuation = await call('reports:stock-valuation', {});
  const after = valuation.rows.find((row) => row.ingredientId === bun.id);

  if (!after.lowStock) throw new Error('the buns are not flagged as low stock');
  if (valuation.lowStockCount < 1) throw new Error('the low-stock count did not move');
  if (valuation.lowStockValue < after.value) {
    throw new Error('the low-stock value is smaller than the item inside it');
  }

  const categoryBread = valuation.byCategory.find((group) => group.category === 'Bread');
  if (!categoryBread) throw new Error('the Bread category is missing');
  if (categoryBread.itemCount !== 1) throw new Error(`Bread holds ${categoryBread.itemCount}`);
});

/* ---------------------------- 3. purchases ------------------------------ */

await runner.check('the purchase report says what was received and what is owed', async () => {
  const report = await call('reports:purchases', range);

  if (report.rows.length !== 2) throw new Error(`${report.rows.length} purchases listed`);

  // B-1: 10 packets at Rs 250 = Rs 2,500 (250,000 paisa), unpaid.
  // B-2: 10 kg chicken at Rs 700 a kg = Rs 7,000 (700,000 paisa), Rs 3,000 paid.
  if (report.received !== 950_000) {
    throw new Error(`received ${report.received}`);
  }
  if (report.paid !== 300_000) throw new Error(`paid ${report.paid}`);
  if (report.outstanding !== 950_000 - 300_000) {
    throw new Error(`outstanding ${report.outstanding}`);
  }

  const bySupplier = report.bySupplier.find((row) => row.supplierName === 'Al-Madina');
  if (!bySupplier) throw new Error('the supplier is missing from the summary');
  if (bySupplier.count !== 2) throw new Error(`supplier count ${bySupplier.count}`);
});

await runner.check('a voided purchase is counted but never costs money', async () => {
  const purchase = await call('stock:purchase-create', {
    supplierId: supplier.id,
    billNo: 'B-3',
    purchasedOn: '2026-11-15',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: bun.id, qtyPurchaseMilli: 1_000, unitPrice: 25_000 }],
  });

  await call('stock:purchase-void', { id: purchase.id, reason: 'Wrong delivery accepted' });

  const report = await call('reports:purchases', range);

  if (report.voidedCount !== 1) throw new Error(`voided count ${report.voidedCount}`);
  // One packet of 100 buns at Rs 250 = 25,000 paisa.
  if (report.voidedValue !== 25_000) throw new Error(`voided value ${report.voidedValue}`);
  // The live money must not have moved by the voided bill's value.
  if (report.received !== 950_000) {
    throw new Error(`a voided bill is still in received: ${report.received}`);
  }
  if (report.outstanding !== 650_000) throw new Error(`outstanding ${report.outstanding}`);
});

/* ----------------------------- 4. wastage ------------------------------- */

await runner.check('the wastage report adds a daily trend and the worst reason', async () => {
  await call('stock:wastage', {
    ingredientId: chicken.id,
    qtyBase: 500,
    reason: 'dropped',
    notes: 'Tray fell',
    happenedOn: '2026-11-20',
  });

  const report = await call('reports:wastage', range);

  if (report.rows.length < 2) throw new Error(`only ${report.rows.length} rows`);
  if (report.byDay.length === 0) throw new Error('the daily trend is empty');

  const trendTotal = report.byDay.reduce((total, day) => total + day.value, 0);
  if (trendTotal !== report.total) {
    throw new Error(`trend total ${trendTotal} vs report total ${report.total}`);
  }

  if (!report.worstReason) throw new Error('no worst reason was reported');
  // The mouldy buns (hundreds of them at 25 paisa) cost more than 500 g of
  // dropped chicken at Rs 0.70, so "spoiled" must be the biggest line.
  if (report.worstReason.reason !== 'spoiled') {
    throw new Error(`worst reason came back as ${report.worstReason.reason}`);
  }
  if (report.worstReason.value <= 0) throw new Error('the worst reason is worth nothing');
});

await runner.check('the wastage total here equals the P&L wastage line', async () => {
  const report = await call('reports:wastage', range);
  const pnl = await call('reports:profit', range);

  if (report.total !== pnl.wastageValue) {
    throw new Error(`report ${report.total} vs P&L ${pnl.wastageValue}`);
  }
  if (report.qty !== pnl.wastageQty) throw new Error('the wasted quantity disagrees');
});

/* ----------------------------- 5. expenses ------------------------------ */

await runner.check('the expense report groups by category, wallet and day', async () => {
  await call('shift:open', { openingCash: 500_000 });

  const before = await call('expenses:overview', {
    from: range.fromDate,
    to: range.toDate,
  });
  const rent = before.categories.find((row) => row.name === 'Rent');
  const bills = before.categories.find((row) => row.name === 'Electricity');

  if (!rent || !bills) throw new Error('the Rent and Electricity categories are missing');

  await call('expenses:save', {
    categoryId: rent.id,
    spentOn: '2026-11-05',
    amount: 5_000_000,
    paidFrom: 'bank',
    payee: 'Landlord',
    notes: '',
  });

  await call('expenses:save', {
    categoryId: bills.id,
    spentOn: '2026-11-06',
    amount: 450_000,
    paidFrom: 'cash',
    payee: 'IESCO',
    notes: '',
  });

  const report = await call('reports:expenses', range);

  if (report.count !== 2) throw new Error(`count ${report.count}`);
  if (report.total !== 5_450_000) throw new Error(`total ${report.total}`);

  const rentRow = report.byCategory.find((row) => row.categoryName === 'Rent');
  if (!rentRow || rentRow.total !== 5_000_000) throw new Error('Rent is wrong');

  const bank = report.byPaidFrom.find((row) => row.paidFrom === 'bank');
  const cash = report.byPaidFrom.find((row) => row.paidFrom === 'cash');
  if (!bank || bank.total !== 5_000_000) throw new Error('the bank total is wrong');
  if (!cash || cash.total !== 450_000) throw new Error('the cash total is wrong');

  if (report.byDay.length !== 2) throw new Error(`byDay has ${report.byDay.length} rows`);
});

await runner.check('a voided expense keeps its place but leaves the total', async () => {
  const overview = await call('expenses:overview', {
    from: range.fromDate,
    to: range.toDate,
    status: 'active',
  });
  const cash = overview.expenses.find((row) => row.payee === 'IESCO');

  await call('expenses:void', { id: cash.id, reason: 'Wrong bill posted' });

  const report = await call('reports:expenses', range);

  if (report.total !== 5_000_000) throw new Error(`total after void ${report.total}`);
  if (report.voidedCount !== 1) throw new Error(`voided count ${report.voidedCount}`);
  if (report.voidedValue !== 450_000) throw new Error(`voided value ${report.voidedValue}`);
});

await runner.check('the expense total here is the P&L shop-expenses line', async () => {
  const report = await call('reports:expenses', range);
  const pnl = await call('reports:profit', range);

  if (report.total !== pnl.shopExpenses) {
    throw new Error(`report ${report.total} vs P&L ${pnl.shopExpenses}`);
  }
});

/* ------------------------------ 6. CSV export --------------------------- */

await runner.check('every new report writes a CSV with a header and real rows', async () => {
  const cases = [
    { report: 'profit', firstCell: 'Line' },
    { report: 'item_profit', firstCell: 'Item' },
    { report: 'stock_value', firstCell: 'Ingredient' },
    { report: 'purchases', firstCell: 'Date' },
    { report: 'wastage', firstCell: 'Ingredient' },
    { report: 'expenses', firstCell: 'Category' },
  ];

  for (const entry of cases) {
    const csv = harness.csv.buildCsv(entry.report, range);
    const lines = csv.split('\r\n');

    if (!lines[0].startsWith(entry.firstCell)) {
      throw new Error(`${entry.report}: header is "${lines[0]}"`);
    }
    if (lines.length < 2) throw new Error(`${entry.report}: the file has no rows`);
  }
});

/* --------------------------- 7. the dashboard --------------------------- */

await runner.check('the dashboard cards carry the day profit, stock and spend', async () => {
  const stats = await call('reports:dashboard');

  if (!stats.stock) throw new Error('the stock card is missing');
  if (stats.stock.value <= 0) throw new Error('the shelf is worth nothing');

  // Today's bills are none: the harness sells on 2026-11-22? Check honestly.
  const today = new Date().toISOString().slice(0, 10);
  const todaySales = harness.db
    .prepare(
      "SELECT COUNT(*) AS total FROM orders WHERE status <> 'cancelled' AND date(created_at) = ?",
    )
    .get(today);

  if (todaySales.total === 0) {
    if (stats.todayProfit !== null) throw new Error('a day with no bills produced a profit card');
  } else if (!stats.todayProfit) {
    throw new Error('a day with bills produced no profit card');
  }

  // Both items have recipes by now — the plain burger got one in the previous
  // check — so the card must read zero. A card that kept counting a fixed problem
  // would train the owner to ignore it.
  if (stats.missingRecipes !== 0) {
    throw new Error(`missing recipes ${stats.missingRecipes}, expected none`);
  }

  // ...and a brand-new item with a price but no recipe must move it to 1.
  await call('menu:item-save', {
    categoryId: category.id,
    name: 'Special Platter',
    price: 90_000,
    available: true,
    image: null,
  });

  const afterNew = await call('reports:dashboard');
  if (afterNew.missingRecipes !== 1) {
    throw new Error(`a new uncosted item did not reach the card (${afterNew.missingRecipes})`);
  }
  if (typeof stats.todayExpenses !== 'number') throw new Error('today expenses is not a number');
});

await runner.check('a price rise shows up on the dashboard', async () => {
  // Chicken goes from Rs 700/kg to Rs 900/kg — a 28.6% rise on the average.
  await call('stock:purchase-create', {
    supplierId: supplier.id,
    billNo: 'B-4',
    purchasedOn: '2026-11-21',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: chicken.id, qtyPurchaseMilli: 10_000, unitPrice: 90_000 }],
  });

  const stats = await call('reports:dashboard');
  const rise = stats.priceChecks.find((row) => row.ingredientId === chicken.id);

  if (!rise) throw new Error('the price rise was not flagged');
  if (rise.changeX100 <= 0) throw new Error(`change ${rise.changeX100}`);
  if (rise.newCostMilli <= rise.oldCostMilli) throw new Error('the new cost is not higher');
});

/* ---------------------------- 8. permissions ---------------------------- */

await runner.check('a manager sees the reports but never the costs', async () => {
  // No demo data in this suite, so the manager does not exist yet.
  const managerRole = await call('users:save', {
    fullName: 'Shop Manager',
    username: 'manager',
    password: 'manager123',
    role: 'manager',
    active: true,
  });
  if (!managerRole?.id) throw new Error('the manager account was not created');

  await harness.loginAs('manager', 'manager123');

  const allowed = await harness.call('reports:item-profit', range);
  if (allowed.ok) throw new Error('a manager read item profit');

  const stock = await harness.call('reports:stock-valuation', {});
  if (stock.ok) throw new Error('a manager read the stock valuation');

  const purchases = await harness.call('reports:purchases', range);
  if (purchases.ok) throw new Error('a manager read the purchase report');

  const wastage = await harness.call('reports:wastage', range);
  if (wastage.ok) throw new Error('a manager read the wastage report');

  const expenses = await harness.call('reports:expenses', range);
  if (expenses.ok) throw new Error('a manager read the expense report');

  // But the manager still runs the shop: the ordinary reports stay open.
  const sales = await harness.call('reports:range', range);
  if (!sales.ok) throw new Error('a manager lost the sales report');
});

harness.cleanup();
runner.finish();
