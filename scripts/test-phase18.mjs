/**
 * Phase 18 — Roadmap 4.D: stock leaves the shelf when food is sold.
 *
 * The client: "jab koe customer ka order ata hay to mere stock say utna saman
 * minus hojaye taky mujhe pata lagy" — and the other half of his request, that
 * the owner sees the true profit on each bill.
 *
 * What is proven here:
 *   1. saving a Zinger Burger takes exactly the recipe's quantities off the shelf,
 *   2. the line's cost is frozen, so a later price rise cannot rewrite old profit,
 *   3. a bill cannot half-save: a blocked sale leaves order and stock untouched,
 *   4. the same line can never be deducted twice,
 *   5. cancelling uncooked food returns the stock; cancelling cooked food books
 *      the cost as wastage instead of silently losing it,
 *   6. amending a bill puts the old ingredients back and takes the new ones out,
 *   7. merge and split do not change stock at all,
 *   8. the per-order profit is net sales (ex tax) minus the frozen cost,
 *   9. the negative-stock setting decides whether an empty shelf blocks a sale.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 18 — Automatic stock deduction (4.D)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);

/* ------------------------------------------------------------------ */
/* A small kitchen with one burger on the menu.                        */
/* ------------------------------------------------------------------ */

async function ingredientWithPrice({
  name,
  baseUnit,
  purchaseUnit,
  unitsPerPurchase,
  qtyPurchaseMilli,
  unitPrice,
}) {
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

// Bun Rs 25, chicken Rs 0.70/g, mayo Rs 0.50/g, box Rs 10.
const bun = await ingredientWithPrice({
  name: 'Burger bun',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 100,
  qtyPurchaseMilli: 5_000, // 5 packets = 500 buns
  unitPrice: 250_000,
});

const chicken = await ingredientWithPrice({
  name: 'Chicken fillet',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  qtyPurchaseMilli: 10_000, // 10 kg
  unitPrice: 70_000,
});

const mayo = await ingredientWithPrice({
  name: 'Mayonnaise',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  qtyPurchaseMilli: 5_000, // 5 kg
  unitPrice: 50_000,
});

const box = await ingredientWithPrice({
  name: 'Burger box',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 100,
  qtyPurchaseMilli: 1_000, // 10 packets = 1,000 boxes
  unitPrice: 100_000,
});

const zinger = (await call('menu:items', {})).find((item) => item.name === 'Zinger Burger');
if (!zinger) throw new Error('demo menu is missing the Zinger Burger');

await call('recipes:save', {
  itemId: zinger.id,
  lines: [
    { ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 },
    { ingredientId: chicken.id, qtyBase: 150, wastePercentX100: 0 },
    { ingredientId: mayo.id, qtyBase: 20, wastePercentX100: 0 },
    { ingredientId: box.id, qtyBase: 1, wastePercentX100: 0 },
  ],
});

const stockOf = async (id) => (await call('stock:ingredient', { id })).ingredient;

/**
 * What the Menu page shows as one serving's cost, in paisa.
 *
 * Asserting against this instead of a hand-written number keeps the test honest
 * about the thing that matters: a saved bill freezes the cost the shop could see
 * at the moment of the sale, whatever the moving average happens to be.
 */
async function servingCost() {
  const overview = await call('recipes:menu-costs', {});
  const row = overview.rows.find((candidate) => candidate.itemId === zinger.id);
  if (!row || !row.hasRecipe) throw new Error('the Zinger Burger has no recipe');
  return row.costTotal;
}

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
    items: [{ itemId: zinger.id, qty: 2, notes: '' }],
    ...overrides,
  };
}

/* ------------------------- 1. the deduction -------------------------- */

const before = {
  bun: (await stockOf(bun.id)).qtyOnHand,
  chicken: (await stockOf(chicken.id)).qtyOnHand,
  mayo: (await stockOf(mayo.id)).qtyOnHand,
  box: (await stockOf(box.id)).qtyOnHand,
};

let firstOrder;

await runner.check('selling two Zingers takes exactly two burgers of ingredients', async () => {
  firstOrder = await call('orders:create', orderInput());

  const after = {
    bun: (await stockOf(bun.id)).qtyOnHand,
    chicken: (await stockOf(chicken.id)).qtyOnHand,
    mayo: (await stockOf(mayo.id)).qtyOnHand,
    box: (await stockOf(box.id)).qtyOnHand,
  };

  const expected = {
    bun: before.bun - 2,
    chicken: before.chicken - 300,
    mayo: before.mayo - 40,
    box: before.box - 2,
  };

  for (const key of Object.keys(expected)) {
    if (after[key] !== expected[key]) {
      throw new Error(`${key}: ${after[key]}, expected ${expected[key]}`);
    }
  }
});

await runner.check('the bill carries a frozen cost and a real profit', async () => {
  const detail = await call('orders:get', { id: firstOrder.id });

  // 2 × (25 + 105 + 10 + 10) = 2 × 150 = Rs 300 → 30,000 paisa.
  if (detail.items[0].costTotal !== 30_000) {
    throw new Error(`line cost ${detail.items[0].costTotal}, expected 30000`);
  }

  if (detail.costTotal !== 30_000) throw new Error(`order cost ${detail.costTotal}`);
  // Two burgers at Rs 450 = 90,000 paisa; profit 90,000 − 30,000 = 60,000.
  if (detail.profit !== 60_000) throw new Error(`order profit ${detail.profit}, expected 60000`);
});

await runner.check('the ledger shows one sale row per ingredient, naming the order', async () => {
  const movements = await call('stock:movements', { ingredientId: chicken.id, limit: 20 });
  const sale = movements.find((movement) => movement.kind === 'sale');

  if (!sale) throw new Error('no sale movement was written');
  if (sale.qty !== -300) throw new Error(`sale qty ${sale.qty}, expected -300`);
  if (sale.refOrderId !== firstOrder.id) throw new Error('the sale is not linked to the order');
  // Value is signed like the quantity: 300 g at Rs 0.70 is Rs 210 taken out.
  if (sale.value !== -21_000) throw new Error(`sale value ${sale.value}, expected -21000`);
});

/* ------------------------ 2. a frozen snapshot ----------------------- */

await runner.check('a later price rise does not rewrite the old bill', async () => {
  const oldBillBefore = await call('orders:get', { id: firstOrder.id });
  const costBefore = await servingCost();

  // Chicken doubles to Rs 1400/kg. The average moves, the shop's cost of a burger
  // moves with it — and yesterday's bill must not.
  await call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-21',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: chicken.id, qtyPurchaseMilli: 10_000, unitPrice: 140_000 }],
  });

  const costAfter = await servingCost();
  if (costAfter <= costBefore) {
    throw new Error(`the price rise did not reach the menu cost (${costBefore} → ${costAfter})`);
  }

  const oldBillAfter = await call('orders:get', { id: firstOrder.id });
  if (oldBillAfter.items[0].costTotal !== oldBillBefore.items[0].costTotal) {
    throw new Error(`the old bill was re-costed: ${oldBillBefore.items[0].costTotal} → ${oldBillAfter.items[0].costTotal}`);
  }
  if (oldBillAfter.profit !== oldBillBefore.profit) throw new Error('the old profit changed');

  // A new bill carries the new cost, twice over for two burgers.
  const newBill = await call('orders:create', orderInput());
  const newDetail = await call('orders:get', { id: newBill.id });
  if (newDetail.costTotal !== costAfter * 2) {
    throw new Error(`the new bill costs ${newDetail.costTotal}, expected ${costAfter * 2}`);
  }
});

await runner.check('editing the recipe does not rewrite an old bill either', async () => {
  await call('recipes:save', {
    itemId: zinger.id,
    lines: [
      { ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 },
      { ingredientId: chicken.id, qtyBase: 200, wastePercentX100: 0 },
      { ingredientId: mayo.id, qtyBase: 30, wastePercentX100: 0 },
      { ingredientId: box.id, qtyBase: 1, wastePercentX100: 0 },
    ],
  });

  const oldBill = await call('orders:get', { id: firstOrder.id });
  if (oldBill.items[0].costTotal !== 30_000) throw new Error('the recipe edit reached back in time');

  // Restore the recipe for the rest of the suite.
  await call('recipes:save', {
    itemId: zinger.id,
    lines: [
      { ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 },
      { ingredientId: chicken.id, qtyBase: 150, wastePercentX100: 0 },
      { ingredientId: mayo.id, qtyBase: 20, wastePercentX100: 0 },
      { ingredientId: box.id, qtyBase: 1, wastePercentX100: 0 },
    ],
  });
});

/* --------------------------- 3. atomicity ---------------------------- */

await runner.check('a blocked sale leaves both the order and the shelf untouched', async () => {
  // Blocking mode, and the boxes run out: 1,000 initially, 4 sold so far, so 996
  // remain. A 1,000-burger order cannot be filled.
  await call('stock:settings-save', {
    allowNegativeStock: false,
    autoSoldOut: false,
    marginAlertPercentX100: 3_500,
  });

  const ordersBefore = harness.db.prepare('SELECT COUNT(*) AS total FROM orders').get().total;
  const chickenBefore = (await stockOf(chicken.id)).qtyOnHand;

  const result = await harness.call('orders:create', orderInput({ items: [{ itemId: zinger.id, qty: 999, notes: '' }] }));

  if (result.ok) throw new Error('a sale beyond the shelf was accepted in blocking mode');

  const ordersAfter = harness.db.prepare('SELECT COUNT(*) AS total FROM orders').get().total;
  if (ordersAfter !== ordersBefore) throw new Error('a failed sale left an order behind');

  const chickenAfter = (await stockOf(chicken.id)).qtyOnHand;
  if (chickenAfter !== chickenBefore) {
    throw new Error(`a failed sale moved stock: ${chickenBefore} → ${chickenAfter}`);
  }

  await call('stock:settings-save', {
    allowNegativeStock: true,
    autoSoldOut: false,
    marginAlertPercentX100: 3_500,
  });
});

await runner.check('with negative stock allowed, the sale goes through and the shelf goes negative', async () => {
  // Empty the box shelf the honest way (a stock count would be nicer; this test
  // only needs the number to be small) and then sell more than exists.
  harness.db.prepare('UPDATE ingredients SET qty_on_hand = 1 WHERE id = ?').run(box.id);

  const sale = await call('orders:create', orderInput({ items: [{ itemId: zinger.id, qty: 5, notes: '' }] }));

  if (!sale.id) throw new Error('the sale was not saved');

  const ingredient = await stockOf(box.id);
  if (ingredient.qtyOnHand >= 0) {
    throw new Error(`stock should be negative, it is ${ingredient.qtyOnHand}`);
  }

  // Put the shop back to a believable state for the next checks.
  await call('orders:cancel', { id: sale.id, prepared: false });
  await call('stock:settings-save', {
    allowNegativeStock: true,
    autoSoldOut: false,
    marginAlertPercentX100: 3_500,
  });
});

/* ------------------------ 4. no double deduction --------------------- */

await runner.check('a line cannot be deducted twice (the database refuses it)', async () => {
  const detail = await call('orders:get', { id: firstOrder.id });
  const lineId = detail.items[0].id;
  const ingredientId = chicken.id;

  const before2 = (await stockOf(chicken.id)).qtyOnHand;

  let threw = false;
  try {
    harness.db
      .prepare(
        `INSERT INTO stock_movements
           (ingredient_id, kind, qty, unit_cost_milli, reason, ref_order_id,
            ref_order_item_id, created_by, created_at)
         VALUES (?, 'sale', -150, 70000, 'replay', ?, ?, 1, datetime('now'))`,
      )
      .run(ingredientId, firstOrder.id, lineId);
  } catch (error) {
    threw = String(error).includes('UNIQUE') || String(error).includes('constraint');
  }

  if (!threw) throw new Error('the database allowed a second sale deduction of the same line');
  if ((await stockOf(chicken.id)).qtyOnHand !== before2) throw new Error('stock moved on a failed replay');
});

/* ---------------------- 5. cancel: cooked or not --------------------- */

await runner.check('cancelling a pending bill gives every gram back', async () => {
  const beforeOrder = {
    bun: (await stockOf(bun.id)).qtyOnHand,
    chicken: (await stockOf(chicken.id)).qtyOnHand,
    mayo: (await stockOf(mayo.id)).qtyOnHand,
    box: (await stockOf(box.id)).qtyOnHand,
  };

  const order = await call('orders:create', orderInput());

  await call('orders:cancel', { id: order.id, prepared: false });

  const afterOrder = {
    bun: (await stockOf(bun.id)).qtyOnHand,
    chicken: (await stockOf(chicken.id)).qtyOnHand,
    mayo: (await stockOf(mayo.id)).qtyOnHand,
    box: (await stockOf(box.id)).qtyOnHand,
  };

  for (const key of Object.keys(beforeOrder)) {
    if (afterOrder[key] !== beforeOrder[key]) {
      throw new Error(`${key} was not returned: ${afterOrder[key]} vs ${beforeOrder[key]}`);
    }
  }
});

await runner.check('cancelling cooked food keeps the stock out and books wastage', async () => {
  const order = await call('orders:create', orderInput());
  const chickenAfterSale = (await stockOf(chicken.id)).qtyOnHand;

  // The kitchen started cooking: preparing + cancel = cooked and thrown away.
  await call('orders:status', { id: order.id, status: 'preparing' });
  await call('orders:cancel', { id: order.id, prepared: true });

  const chickenAfterCancel = (await stockOf(chicken.id)).qtyOnHand;
  if (chickenAfterCancel !== chickenAfterSale) {
    throw new Error('cooked food was put back on the shelf');
  }

  const movements = await call('stock:movements', { ingredientId: chicken.id, limit: 20 });
  const wastage = movements.find(
    (movement) => movement.kind === 'wastage' && movement.refOrderId === order.id,
  );

  if (!wastage) throw new Error('the cooked loss was not booked as wastage');
  if (wastage.qty !== -300) throw new Error(`wastage qty ${wastage.qty}, expected -300`);
});

await runner.check('the default follows the status: pending returns, preparing keeps', async () => {
  const pending = await call('orders:create', orderInput());
  const beforePendingCancel = (await stockOf(box.id)).qtyOnHand;
  await call('orders:cancel', { id: pending.id });
  const afterPendingCancel = (await stockOf(box.id)).qtyOnHand;
  if (afterPendingCancel !== beforePendingCancel + 2) {
    throw new Error('a pending cancel did not return the stock by default');
  }

  const preparing = await call('orders:create', orderInput());
  await call('orders:status', { id: preparing.id, status: 'preparing' });
  const beforePreparedCancel = (await stockOf(box.id)).qtyOnHand;
  await call('orders:cancel', { id: preparing.id });
  const afterPreparedCancel = (await stockOf(box.id)).qtyOnHand;
  if (afterPreparedCancel !== beforePreparedCancel) {
    throw new Error('a preparing cancel should keep the stock out by default');
  }
});

/* --------------------------- 6. amendments --------------------------- */

await runner.check('amending a bill puts the old ingredients back and takes the new ones', async () => {
  const chickenBefore = (await stockOf(chicken.id)).qtyOnHand;
  const order = await call('orders:create', orderInput()); // 2 burgers → 300 g

  const afterCreate = (await stockOf(chicken.id)).qtyOnHand;
  if (afterCreate !== chickenBefore - 300) throw new Error('the sale did not deduct');

  const amendment = await call('order:amend', {
    id: order.id,
    reason: 'Customer changed the order',
    items: [{ itemId: zinger.id, qty: 3, notes: '' }],
    discount: 0,
    approvedBy: null,
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    notes: '',
  });

  // The old 300 g must be back before the new 450 g comes out: net −450 total.
  const afterAmend = (await stockOf(chicken.id)).qtyOnHand;
  if (afterAmend !== chickenBefore - 450) {
    throw new Error(`after the amendment stock is ${afterAmend}, expected ${chickenBefore - 450}`);
  }

  // The amendment states what is being eaten now, so it is costed now.
  const serving = await servingCost();
  const detail = await call('orders:get', { id: amendment.id });
  if (detail.costTotal !== serving * 3) {
    throw new Error(`the amended bill costs ${detail.costTotal}, expected ${serving * 3}`);
  }
  if (detail.profit === null) throw new Error('the amended bill lost its cost data');
});

/* ----------------------- 7. merge and split -------------------------- */

await runner.check('merging two bills changes no stock at all', async () => {
  const first = await call('orders:create', orderInput({ type: 'dine_in', waiterId: 1, tableId: null }));
  const second = await call('orders:create', orderInput({ type: 'dine_in', waiterId: 1, tableId: null }));

  const beforeMerge = (await stockOf(chicken.id)).qtyOnHand;

  await call('order:merge', { sourceId: second.id, targetId: first.id });

  const afterMerge = (await stockOf(chicken.id)).qtyOnHand;
  if (afterMerge !== beforeMerge) {
    throw new Error(`merge moved stock: ${beforeMerge} → ${afterMerge}`);
  }
});

await runner.check('splitting a bill changes no stock at all', async () => {
  const order = await call('orders:create', orderInput({ type: 'dine_in', waiterId: 1 }));
  // Add a second line so the bill can be split (one line must stay behind).
  const amended = await call('order:amend', {
    id: order.id,
    reason: 'Two items for the split test',
    items: [
      { itemId: zinger.id, qty: 1, notes: '' },
      { itemId: zinger.id, qty: 1, notes: '' },
    ],
    discount: 0,
    approvedBy: null,
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: 1,
    notes: '',
  });

  const lines = (await call('orders:get', { id: amended.id })).items;
  const beforeSplit = (await stockOf(chicken.id)).qtyOnHand;

  await call('order:split', { orderId: amended.id, itemIds: [lines[0].id], moveTable: false });

  const afterSplit = (await stockOf(chicken.id)).qtyOnHand;
  if (afterSplit !== beforeSplit) {
    throw new Error(`split moved stock: ${beforeSplit} → ${afterSplit}`);
  }
});

/* --------------------------- 8. order profit ------------------------- */

await runner.check('discounts reduce profit; tax never counts as profit', async () => {
  const order = await call(
    'orders:create',
    orderInput({ discount: 5_000, discountReason: 'Regular customer', taxPercent: 5 }),
  );

  const detail = await call('orders:get', { id: order.id });

  // Subtotal 90,000; discount 5,000; tax 5% of 85,000 = 4,250; total 89,250.
  // Profit = subtotal − discount − cost. The 4,250 of tax is the government's and
  // must never be counted as profit, which is exactly what this asserts.
  const expectedProfit = detail.subtotal - detail.discount - detail.costTotal;
  if (detail.profit !== expectedProfit) {
    throw new Error(`profit ${detail.profit}, expected ${expectedProfit}`);
  }
  if (detail.profit === detail.total - detail.costTotal) {
    throw new Error('profit was computed from the tax-inclusive total');
  }
  // The bill is for two burgers, so it carries two servings' worth of cost.
  if (detail.costTotal !== (await servingCost()) * 2) {
    throw new Error('the bill did not freeze the serving cost it was sold at');
  }
});

await runner.check('a bill with an item that has no recipe reports cost unknown', async () => {
  const fries = (await call('menu:items', {})).find((item) => item.name === 'French Fries');
  if (!fries) throw new Error('the demo menu is missing French Fries');

  const order = await call(
    'orders:create',
    orderInput({
      items: [
        { itemId: zinger.id, qty: 1, notes: '' },
        { itemId: fries.id, qty: 1, notes: '' },
      ],
    }),
  );

  const detail = await call('orders:get', { id: order.id });
  if (detail.costTotal !== null) {
    throw new Error(`a mixed bill reported a full cost of ${detail.costTotal}`);
  }
  if (detail.profit !== null) {
    throw new Error('a bill with unknown cost must not report a profit number');
  }
});

/* --------------------------- 9. sold out ---------------------------- */

await runner.check('auto sold-out can switch an item off when the shelf is empty', async () => {
  // Give the shop a clean, empty box shelf and turn the setting on.
  await call('stock:settings-save', {
    allowNegativeStock: true,
    autoSoldOut: true,
    marginAlertPercentX100: 3_500,
  });

  harness.db.prepare('UPDATE ingredients SET qty_on_hand = 0 WHERE id = ?').run(box.id);

  // Saving a recipe re-checks availability (0 boxes = nothing can be made).
  await call('recipes:save', {
    itemId: zinger.id,
    lines: [
      { ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 },
      { ingredientId: chicken.id, qtyBase: 150, wastePercentX100: 0 },
      { ingredientId: mayo.id, qtyBase: 20, wastePercentX100: 0 },
      { ingredientId: box.id, qtyBase: 1, wastePercentX100: 0 },
    ],
  });

  const item = (await call('menu:items', {})).find((candidate) => candidate.id === zinger.id);
  if (item.available) throw new Error('the empty shelf did not switch the item off');

  // The cashier must always be able to put it back on by hand.
  await call('menu:item-toggle', { id: zinger.id, available: true });

  await call('stock:settings-save', {
    allowNegativeStock: true,
    autoSoldOut: false,
    marginAlertPercentX100: 3_500,
  });
});

/* ------------------------- 10. cashier rights ------------------------ */

await runner.check('a cashier sells (and deducts) but cannot change stock by hand', async () => {
  const boxesBefore = (await stockOf(box.id)).qtyOnHand;

  await harness.loginAs('cashier', 'cashier123');

  const order = await call('orders:create', orderInput({ items: [{ itemId: zinger.id, qty: 1, notes: '' }] }));
  if (!order.id) throw new Error('a cashier could not sell');

  const boxesAfter = (await stockOf(box.id)).qtyOnHand;
  if (boxesAfter !== boxesBefore - 1) throw new Error('a cashier sale did not deduct stock');

  // Hands off the ledger.
  const attempt = await harness.call('stock:opening', {
    lines: [{ ingredientId: box.id, qtyBase: 500, unitCostMilli: 10_000 }],
  });
  if (attempt.ok) throw new Error('a cashier was allowed to add stock by hand');
});

harness.cleanup();
runner.finish();
