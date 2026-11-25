/**
 * Phase 16 — Roadmap 4.B: purchases and the stock ledger.
 *
 * The client's problem, in his words: "add stock may jo jo price hay woh alag hoga
 * hisab may" — every purchase has its own price. What is proven here:
 *
 *   1. a purchase adds stock and its own price, converted to base units,
 *   2. a second purchase at a different price moves the weighted average correctly,
 *   3. transport charges become part of the landed cost,
 *   4. the drawer is only touched by cash paid from it during an open shift,
 *   5. voiding a purchase reverses the stock and the drawer exactly,
 *   6. opening stock writes ledger rows and sets the starting average,
 *   7. the stock never changes without a ledger row (the cache always matches),
 *   8. a cashier cannot buy stock; a manager can.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 16 — Purchases and the stock ledger (4.B)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);

/** Chicken by the kg: 1000 g per kg. */
async function createChicken(name = 'Chicken fillet') {
  return call('stock:ingredient-save', {
    name,
    category: 'Chicken & meat',
    baseUnit: 'g',
    purchaseUnit: 'kg',
    unitsPerPurchase: 1000,
    reorderLevel: 3000,
    supplierId: null,
    active: true,
  });
}

const chicken = await createChicken();

const supplier = await call('stock:supplier-save', {
  name: 'Metro Cash & Carry',
  phone: '',
  address: '',
  notes: '',
  active: true,
});

/** Small helper: one-line purchase of chicken, priced per kg. */
async function buyChicken({ qtyKg, pricePerKg, extra = 0, method = 'credit', paid = 0 }) {
  return call('stock:purchase-create', {
    supplierId: supplier.id,
    billNo: '',
    purchasedOn: '2026-11-20',
    extraCharges: extra,
    paidAmount: paid,
    paymentMethod: method,
    notes: '',
    lines: [
      {
        ingredientId: chicken.id,
        qtyPurchaseMilli: Math.round(qtyKg * 1000),
        unitPrice: pricePerKg,
      },
    ],
  });
}

/* --------------------------- 1. first purchase --------------------------- */

await runner.check('a purchase adds stock in base units and records its own price', async () => {
  const purchase = await buyChicken({ qtyKg: 10, pricePerKg: 65_000 }); // Rs 650 / kg

  if (purchase.lines.length !== 1) throw new Error('the line was not saved');
  const line = purchase.lines[0];

  if (line.qtyBase !== 10_000) throw new Error(`qtyBase ${line.qtyBase}, expected 10000 g`);
  if (line.lineTotal !== 650_000) throw new Error(`line total ${line.lineTotal}, expected 650000 paisa`);
  if (line.unitPrice !== 65_000) throw new Error('the purchase price was not kept as typed');

  const ingredient = await call('stock:ingredient', { id: chicken.id });
  if (ingredient.ingredient.qtyOnHand !== 10_000) {
    throw new Error(`stock is ${ingredient.ingredient.qtyOnHand} g, expected 10000`);
  }
  // Rs 650/kg = 65,000 paisa per 1000 g = 65 paisa per gram = 65,000 milli.
  if (ingredient.ingredient.avgCostMilli !== 65_000) {
    throw new Error(`average cost ${ingredient.ingredient.avgCostMilli}, expected 65000 milli`);
  }
  if (ingredient.ingredient.lastCostMilli !== 65_000) {
    throw new Error('the last price was not recorded');
  }
});

await runner.check('the purchase wrote its ledger rows', async () => {
  const movements = await call('stock:movements', { ingredientId: chicken.id, limit: 50 });
  const buys = movements.filter((movement) => movement.kind === 'purchase');

  if (buys.length !== 1) throw new Error(`expected one purchase movement, got ${buys.length}`);
  if (buys[0].qty !== 10_000) throw new Error(`movement qty ${buys[0].qty}`);
  if (buys[0].value !== 650_000) throw new Error(`movement value ${buys[0].value}`);
});

/* ------------------------- 2. weighted average --------------------------- */

await runner.check('a second purchase at a new price moves the weighted average', async () => {
  // (10 kg × 650 + 20 kg × 710) ÷ 30 kg = 690 exactly.
  await buyChicken({ qtyKg: 20, pricePerKg: 71_000 });

  const { ingredient } = await call('stock:ingredient', { id: chicken.id });

  if (ingredient.qtyOnHand !== 30_000) throw new Error(`stock ${ingredient.qtyOnHand}, expected 30000`);
  if (ingredient.avgCostMilli !== 69_000) {
    throw new Error(`average ${ingredient.avgCostMilli}, expected 69000 milli (Rs 690/kg)`);
  }
  if (ingredient.lastCostMilli !== 71_000) throw new Error('the last price should now be Rs 710/kg');
});

await runner.check('a third purchase keeps the average honest (rounding once)', async () => {
  // 30 kg × 690 + 5 kg × 700 = 20,700 + 3,500 = 24,200 ÷ 35 = 691.42857… → 691.43
  await buyChicken({ qtyKg: 5, pricePerKg: 70_000 });

  const { ingredient } = await call('stock:ingredient', { id: chicken.id });

  if (ingredient.qtyOnHand !== 35_000) throw new Error(`stock ${ingredient.qtyOnHand}`);
  if (ingredient.avgCostMilli !== 69_143) {
    throw new Error(`average ${ingredient.avgCostMilli}, expected 69143 milli`);
  }
});

await runner.check('the old purchase lines still show their own prices', async () => {
  const purchases = await call('stock:purchases', {
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
    limit: 50,
  });

  const prices = purchases.map((purchase) => purchase.lines[0].unitPrice).sort((a, b) => a - b);
  if (prices.join(',') !== '65000,70000,71000') {
    throw new Error(`purchase prices are ${prices.join(',')}, expected 65000,70000,71000`);
  }
});

/* --------------------------- 3. landed cost ----------------------------- */

await runner.check('transport charges become part of the landed unit cost', async () => {
  // A fresh ingredient, so the arithmetic is easy to follow:
  // 10 kg at Rs 100/kg = 100,000 paisa, plus 5,000 paisa transport.
  const flour = await call('stock:ingredient-save', {
    name: 'Flour (maida)',
    category: 'Coating & dry goods',
    baseUnit: 'g',
    purchaseUnit: 'kg',
    unitsPerPurchase: 1000,
    reorderLevel: 0,
    supplierId: null,
    active: true,
  });

  const purchase = await call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-20',
    extraCharges: 5_000,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: flour.id, qtyPurchaseMilli: 10_000, unitPrice: 10_000 }],
  });

  // 105,000 paisa ÷ 10,000 g = 10.5 paisa per gram = 10,500 milli.
  const line = purchase.lines[0];
  if (line.landedCostMilli !== 10_500) {
    throw new Error(`landed cost ${line.landedCostMilli}, expected 10500 milli`);
  }

  const { ingredient } = await call('stock:ingredient', { id: flour.id });
  if (ingredient.avgCostMilli !== 10_500) {
    throw new Error(`the average ignored transport: ${ingredient.avgCostMilli}`);
  }
});

await runner.check('a tiny quantity of a cheap ingredient keeps a usable cost', async () => {
  // Salt: 1 kg at Rs 60, bought as 50 g, would round to zero in whole paisa per
  // gram — milli-paisa is what keeps it alive.
  const salt = await call('stock:ingredient-save', {
    name: 'Salt',
    category: 'Coating & dry goods',
    baseUnit: 'g',
    purchaseUnit: 'kg',
    unitsPerPurchase: 1000,
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
    lines: [{ ingredientId: salt.id, qtyPurchaseMilli: 50, unitPrice: 6_000 }], // 50 g for Rs 60
  });

  const { ingredient } = await call('stock:ingredient', { id: salt.id });

  // Rs 60 per kg = 6 paisa per gram = 6,000 milli-paisa per gram. In whole paisa
  // the salt would round to 6 and stay usable; at 1/10 of that price (Rs 6/kg,
  // 0.6 paisa/g) whole paisa would round to 1 and drift 40%. Milli-paisa is what
  // keeps the cheap side of the shelf honest.
  if (ingredient.qtyOnHand !== 50) throw new Error(`stock ${ingredient.qtyOnHand}, expected 50 g`);
  if (ingredient.avgCostMilli !== 6_000) {
    throw new Error(`salt cost ${ingredient.avgCostMilli}, expected 6000 milli`);
  }
});

/* ----------------------------- 4. the drawer ---------------------------- */

await runner.check('a cash purchase with no open shift does not touch a shift', async () => {
  const before = harness.db.prepare('SELECT COUNT(*) AS total FROM cash_movements').get().total;

  await buyChicken({ qtyKg: 1, pricePerKg: 70_000, method: 'cash', paid: 70_000 });

  const after = harness.db.prepare('SELECT COUNT(*) AS total FROM cash_movements').get().total;
  if (after !== before) throw new Error('a purchase wrote a cash movement with no shift open');
});

await runner.check('a cash purchase inside an open shift is an expense in the drawer', async () => {
  await call('shift:open', { openingCash: 500_000 });

  const purchase = await buyChicken({ qtyKg: 2, pricePerKg: 70_000, method: 'cash', paid: 140_000 });

  const movements = await call('shift:x-report', {});
  const expense = movements.movements.find((movement) =>
    movement.reason.includes(purchase.purchaseNo),
  );

  if (!expense) throw new Error('no drawer movement was written for the cash purchase');
  if (expense.kind !== 'expense') throw new Error(`kind is ${expense.kind}, expected expense`);
  if (expense.amount !== 140_000) throw new Error(`amount ${expense.amount}, expected 140000`);
});

await runner.check('a credit purchase does not touch the drawer', async () => {
  const report = await call('shift:x-report', {});
  const before = report.expenses;

  await buyChicken({ qtyKg: 1, pricePerKg: 70_000, method: 'credit', paid: 0 });

  const after = await call('shift:x-report', {});
  if (after.expenses !== before) throw new Error('a credit purchase reduced the drawer');
});

/* ------------------------------ 5. voiding ------------------------------ */

await runner.check('voiding a purchase takes exactly its stock back out', async () => {
  const fresh = await createChicken('Test chicken for void');
  const purchase = await buyChicken({ qtyKg: 3, pricePerKg: 80_000 });
  // The helper buys the shared chicken; buy this one directly so it is isolated.
  void purchase;

  const own = await call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-20',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: fresh.id, qtyPurchaseMilli: 3_000, unitPrice: 80_000 }],
  });

  const afterBuy = await call('stock:ingredient', { id: fresh.id });
  if (afterBuy.ingredient.qtyOnHand !== 3_000) {
    throw new Error(`after buying, stock is ${afterBuy.ingredient.qtyOnHand}`);
  }

  await call('stock:purchase-void', { id: own.id, reason: 'Wrong price on the slip' });

  const afterVoid = await call('stock:ingredient', { id: fresh.id });
  if (afterVoid.ingredient.qtyOnHand !== 0) {
    throw new Error(`after voiding, stock is ${afterVoid.ingredient.qtyOnHand}, expected 0`);
  }
});

await runner.check('a void is kept in history with its reason, never deleted', async () => {
  const purchases = await call('stock:purchases', {
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
    limit: 100,
  });

  const voids = purchases.filter((purchase) => purchase.status === 'void');
  if (voids.length !== 1) throw new Error(`expected one voided purchase, found ${voids.length}`);
  if (!voids[0].voidReason.includes('Wrong price')) throw new Error('the void reason was lost');
  if (!voids[0].voidedAt) throw new Error('the void timestamp was lost');
});

await runner.check('voiding twice is refused', async () => {
  const purchases = await call('stock:purchases', {
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
    limit: 100,
  });
  const voided = purchases.find((purchase) => purchase.status === 'void');

  const result = await harness.call('stock:purchase-void', {
    id: voided.id,
    reason: 'Again',
  });

  if (result.ok) throw new Error('a voided purchase was voided a second time');
  if (result.error.code !== 'CONFLICT') throw new Error(`expected CONFLICT, got ${result.error.code}`);
});

await runner.check('voiding a drawer-paid purchase puts the expense back to zero', async () => {
  const report = await call('shift:x-report', {});
  const beforeExpenses = report.expenses;
  const beforeExpected = report.expectedCash;

  const purchase = await buyChicken({ qtyKg: 1, pricePerKg: 70_000, method: 'cash', paid: 70_000 });

  const during = await call('shift:x-report', {});
  if (during.expenses !== beforeExpenses + 70_000) {
    throw new Error('the cash purchase did not appear as an expense');
  }
  if (during.expectedCash !== beforeExpected - 70_000) {
    throw new Error('the cash purchase did not leave the drawer');
  }

  await call('stock:purchase-void', { id: purchase.id, reason: 'Supplier brought the wrong bag' });

  const after = await call('shift:x-report', {});
  if (after.expenses !== beforeExpenses) {
    throw new Error(`expenses ${after.expenses} should be back to ${beforeExpenses}`);
  }
  if (after.expectedCash !== beforeExpected) {
    throw new Error(`drawer ${after.expectedCash} should be back to ${beforeExpected}`);
  }
  if (after.cashIn !== report.cashIn) {
    throw new Error('a purchase reversal must not be reported as takings');
  }
});

await runner.check('a closed shift is never rewritten; the reversal lands in the open one', async () => {
  // Pay cash in the open shift, close it, open a new one, then void the old
  // purchase. A printed, closed day must keep its figures, so the cash-back is
  // posted to today's open shift instead — the standard way to correct books
  // after they are closed.
  const before = await call('shift:x-report', {});
  const beforeExpenses = before.expenses;

  const purchase = await buyChicken({ qtyKg: 1, pricePerKg: 70_000, method: 'cash', paid: 70_000 });
  const oldShift = await call('shift:current', {});

  await call('shift:close', { countedCash: 500_000, notes: '' });
  const newShift = await call('shift:open', { openingCash: 500_000 });

  await call('stock:purchase-void', { id: purchase.id, reason: 'Paid twice for the same bag' });

  const oldReport = await call('shift:x-report', { shiftId: oldShift.id });
  if (oldReport.expenses !== beforeExpenses + 70_000) {
    throw new Error(
      `the closed shift was rewritten: ${oldReport.expenses} should still be ${beforeExpenses + 70_000}`,
    );
  }
  if (!oldReport.shift.expectedCash && oldReport.shift.expectedCash !== 0) {
    throw new Error('the closed shift lost its stored expected cash');
  }

  const newReport = await call('shift:x-report', { shiftId: newShift.id });
  // From the NEW shift's point of view nothing ever left the till for that bag:
  // it inherited no expense, so its expense figure is zero.
  // Nothing left today's till for that bag, so today shows no expense for it…
  if (newReport.expenses !== 0) throw new Error('the reversal was booked as an expense');
  // …and because the paying shift is closed, the returned cash is today's cash in
  // (netting it against a shift that never paid would push its expenses negative).
  if (newReport.cashIn !== 70_000) {
    throw new Error(`the return is not in today's drawer: ${newReport.cashIn}`);
  }
  if (newReport.purchaseReversals !== 0) {
    throw new Error('a cross-shift reversal must not be netted in the new shift');
  }
  if (newReport.expectedCash !== 500_000 + 70_000) {
    throw new Error(
      `the returned cash should be in the new drawer: ${newReport.expectedCash}`,
    );
  }
});

/* --------------------------- 6. opening stock --------------------------- */

await runner.check('opening stock writes ledger rows and sets the starting cost', async () => {
  const oil = await call('stock:ingredient-save', {
    name: 'Cooking oil',
    category: 'Oil & fuel',
    baseUnit: 'ml',
    purchaseUnit: 'litre',
    unitsPerPurchase: 1000,
    reorderLevel: 0,
    supplierId: null,
    active: true,
  });

  // 5 litres on the shelf at Rs 550/litre = 55,000 paisa per litre = 55,000 milli/ml.
  const result = await call('stock:opening', {
    lines: [{ ingredientId: oil.id, qtyBase: 5_000, unitCostMilli: 55_000 }],
  });

  if (result.applied !== 1) throw new Error(`applied ${result.applied}`);

  const detail = await call('stock:ingredient', { id: oil.id });
  if (detail.ingredient.qtyOnHand !== 5_000) throw new Error('opening stock did not land');
  if (detail.ingredient.avgCostMilli !== 55_000) throw new Error('opening cost was not used');

  const opening = detail.movements.find((movement) => movement.kind === 'opening');
  if (!opening) throw new Error('no opening movement was written');
  if (opening.qty !== 5_000) throw new Error(`opening qty ${opening.qty}`);
});

/* ------------------------- 7. ledger integrity -------------------------- */

await runner.check('every cached quantity equals the sum of its ledger', async () => {
  const rows = harness.db
    .prepare(
      `SELECT i.id, i.qty_on_hand,
              COALESCE((SELECT SUM(m.qty) FROM stock_movements m WHERE m.ingredient_id = i.id), 0) AS ledger
         FROM ingredients i`,
    )
    .all();

  for (const row of rows) {
    if (row.qty_on_hand !== row.ledger) {
      throw new Error(
        `ingredient ${row.id}: cached ${row.qty_on_hand} but ledger says ${row.ledger}`,
      );
    }
  }
});

await runner.check('the stock value matches qty × average cost', async () => {
  const overview = await call('stock:overview', {});
  const expected = overview.ingredients.reduce((total, ingredient) => {
    const value = Math.round((ingredient.qtyOnHand * ingredient.avgCostMilli) / 1000);
    return total + (ingredient.qtyOnHand > 0 ? value : 0);
  }, 0);

  if (overview.totalValue !== expected) {
    throw new Error(`total value ${overview.totalValue}, expected ${expected}`);
  }
});

/* --------------------------- 8. permissions ---------------------------- */

await runner.check('a cashier cannot buy stock or void a purchase', async () => {
  const purchases = await call('stock:purchases', {
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
    limit: 5,
  });

  await harness.loginAs('cashier', 'cashier123');

  const attempt = await harness.call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-20',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: chicken.id, qtyPurchaseMilli: 1000, unitPrice: 1000 }],
  });

  if (attempt.ok) throw new Error('a cashier was allowed to buy stock');
  if (attempt.error.code !== 'FORBIDDEN') throw new Error(`got ${attempt.error.code}`);

  const voidAttempt = await harness.call('stock:purchase-void', {
    id: purchases[0].id,
    reason: 'cashier attempt',
  });
  if (voidAttempt.ok) throw new Error('a cashier was allowed to void a purchase');
  if (voidAttempt.error.code !== 'FORBIDDEN') throw new Error(`got ${voidAttempt.error.code}`);
});

await runner.check('a manager can post a purchase', async () => {
  await harness.loginAs('manager', 'manager123');

  const purchase = await call('stock:purchase-create', {
    supplierId: null,
    billNo: 'M-1',
    purchasedOn: '2026-11-20',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: 'manager entry',
    lines: [{ ingredientId: chicken.id, qtyPurchaseMilli: 1000, unitPrice: 70_000 }],
  });

  if (!purchase.purchaseNo.startsWith('PUR-')) throw new Error('no purchase number was allocated');
});

/* --------------------------- 9. validation ----------------------------- */

await runner.check('a purchase with no lines is refused', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  const result = await harness.call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-20',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [],
  });

  if (result.ok) throw new Error('an empty purchase was accepted');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('the same ingredient twice in one purchase is refused', async () => {
  const result = await harness.call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-20',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [
      { ingredientId: chicken.id, qtyPurchaseMilli: 1000, unitPrice: 70_000 },
      { ingredientId: chicken.id, qtyPurchaseMilli: 2000, unitPrice: 71_000 },
    ],
  });

  if (result.ok) throw new Error('a duplicated ingredient line was accepted');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('paying more than the purchase total is refused', async () => {
  const result = await harness.call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-20',
    extraCharges: 0,
    paidAmount: 999_999,
    paymentMethod: 'cash',
    notes: '',
    lines: [{ ingredientId: chicken.id, qtyPurchaseMilli: 1000, unitPrice: 1_000 }],
  });

  if (result.ok) throw new Error('an overpayment was accepted');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

harness.cleanup();
runner.finish();
