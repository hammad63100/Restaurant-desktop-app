/**
 * Phase 17 — Roadmap 4.C: recipes, cost, profit and margin.
 *
 * The client's request, in his words: "jab may koe item list kardo, jaise ek
 * zinger burger — usi may bun, chicken, mayo, cheese… wahi add kardy" and
 * "owner ko choice hay ke woh kitna rakhe ek item ka price, phir usi hisab say
 * profit alag ho".
 *
 * What is proven here:
 *   1. a Zinger Burger recipe costs exactly the sum of its lines,
 *   2. the cost follows the ingredient's *current* average price,
 *   3. the owner's selling price is never changed by the app,
 *   4. profit, margin and the price suggestion are right to the paisa,
 *   5. an item without a recipe shows "cost unknown", never a 100% margin,
 *   6. "can make N" is the tightest ingredient,
 *   7. the margin floor flags items below it,
 *   8. cost is invisible to a manager and a cashier, and a cashier cannot edit
 *      a recipe.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 17 — Recipes and costing (4.C)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);

/* ------------------------------------------------------------------ */
/* Fixtures: the Zinger Burger from the plan, at the plan's prices.    */
/* ------------------------------------------------------------------ */

/**
 * Creates an ingredient priced by buying it once, so its average cost is real
 * (no test hook writes costs directly).
 */
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

// Zinger bun: 1 packet holds 100 buns; 10 packets for Rs 25,000 → Rs 25 a bun.
const bun = await ingredientWithPrice({
  name: 'Zinger bun',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 100,
  qtyPurchaseMilli: 10_000,
  unitPrice: 250_000,
});

// Chicken: 10 kg at Rs 700/kg = Rs 7000 → Rs 0.70/g (70 paisa = 70,000 milli).
const chicken = await ingredientWithPrice({
  name: 'Chicken fillet',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  qtyPurchaseMilli: 10_000,
  unitPrice: 70_000,
});

// Mayo: 5 kg at Rs 500/kg = Rs 2500 → Rs 0.50/g.
const mayo = await ingredientWithPrice({
  name: 'Mayonnaise',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  qtyPurchaseMilli: 5_000,
  unitPrice: 50_000,
});

// Cheese slice: 120 slices for Rs 2160 → Rs 18 each.
const cheese = await ingredientWithPrice({
  name: 'Cheese slice',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 12,
  qtyPurchaseMilli: 10_000, // 10 packets = 120 slices
  unitPrice: 21_600,
});

// Lettuce: 2 kg at Rs 300/kg = Rs 600 → Rs 0.30/g.
const lettuce = await ingredientWithPrice({
  name: 'Lettuce',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  qtyPurchaseMilli: 2_000,
  unitPrice: 30_000,
});

// Burger box: 100 for Rs 1000 → Rs 10 each.
const box = await ingredientWithPrice({
  name: 'Burger box',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 100,
  qtyPurchaseMilli: 1_000,
  unitPrice: 100_000,
});

// The Zinger Burger the demo menu already sells at Rs 450 — the exact item the
// client named, costing it against the recipe he described.
const zinger = (await call('menu:items', {})).find((item) => item.name === 'Zinger Burger');
if (!zinger) throw new Error('the demo menu has no Zinger Burger to cost');
if (zinger.price !== 45_000) throw new Error(`the demo Zinger costs ${zinger.price}`);

/* ------------------------- 1. building a recipe ------------------------- */

await runner.check('an item starts with no recipe and cost unknown', async () => {
  const recipe = await call('recipes:get', { itemId: zinger.id });

  if (recipe.hasRecipe) throw new Error('a new item should have no recipe');
  if (recipe.profit !== null) throw new Error('profit must be null, never 0, without a recipe');
  if (recipe.marginPercentX100 !== null) throw new Error('margin must be null without a recipe');
  if (recipe.price !== 45_000) throw new Error('the owner price was not read back');
});

await runner.check('the Zinger Burger recipe costs exactly the sum of its lines', async () => {
  const recipe = await call('recipes:save', {
    itemId: zinger.id,
    lines: [
      { ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 },
      { ingredientId: chicken.id, qtyBase: 150, wastePercentX100: 0 },
      { ingredientId: mayo.id, qtyBase: 20, wastePercentX100: 0 },
      { ingredientId: cheese.id, qtyBase: 1, wastePercentX100: 0 },
      { ingredientId: lettuce.id, qtyBase: 10, wastePercentX100: 0 },
      { ingredientId: box.id, qtyBase: 1, wastePercentX100: 0 },
    ],
  });

  // 25.00 + 105.00 + 10.00 + 18.00 + 3.00 + 10.00 = 171.00 → 17,100 paisa.
  const expected = 17_100;
  if (recipe.costTotal !== expected) {
    throw new Error(`recipe cost ${recipe.costTotal}, expected ${expected} paisa`);
  }
  if (!recipe.hasRecipe) throw new Error('hasRecipe should be true');

  // Profit 450 − 171 = 279 → 27,900 paisa; margin 279/450 = 62% → 6200.
  if (recipe.profit !== 27_900) throw new Error(`profit ${recipe.profit}, expected 27900`);
  if (recipe.marginPercentX100 !== 6_200) {
    throw new Error(`margin ${recipe.marginPercentX100}, expected 6200`);
  }
});

await runner.check('each line carries its own readable cost', async () => {
  const recipe = await call('recipes:get', { itemId: zinger.id });
  const byName = new Map(recipe.lines.map((line) => [line.ingredientName, line]));

  const checks = [
    ['Zinger bun', 2_500],
    ['Chicken fillet', 10_500],
    ['Mayonnaise', 1_000],
    ['Cheese slice', 1_800],
    ['Lettuce', 300],
    ['Burger box', 1_000],
  ];

  for (const [name, expected] of checks) {
    const line = byName.get(name);
    if (!line) throw new Error(`${name} is missing from the recipe`);
    if (line.lineCost !== expected) {
      throw new Error(`${name} costs ${line.lineCost}, expected ${expected}`);
    }
  }
});

/* ---------------------- 2. the price follows stock --------------------- */

await runner.check('a chicken price rise moves the recipe cost and the margin', async () => {
  // 10 kg more at Rs 900/kg (90,000 paisa): (10 × 700 + 10 × 900) ÷ 20 =
  // Rs 800/kg = Rs 0.80/g.
  await call('stock:purchase-create', {
    supplierId: null,
    billNo: '',
    purchasedOn: '2026-11-21',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: chicken.id, qtyPurchaseMilli: 10_000, unitPrice: 90_000 }],
  });

  const recipe = await call('recipes:get', { itemId: zinger.id });

  // Chicken line: 150 g × 0.80 = Rs 120 → 12,000 paisa (was 10,500).
  // New total: 17,100 + 1,500 = 18,600; profit 450 − 186 = 264 → 26,400.
  if (recipe.costTotal !== 18_600) {
    throw new Error(`cost ${recipe.costTotal}, expected 18600 after the price rise`);
  }
  if (recipe.profit !== 26_400) throw new Error(`profit ${recipe.profit}, expected 26400`);
  if (recipe.marginPercentX100 !== 5_867) {
    throw new Error(`margin ${recipe.marginPercentX100}, expected 5867 (58.67%)`);
  }

  // The plan's example, in the owner's own numbers: Rs 186 cost on a Rs 450 burger.
  if (recipe.price !== 45_000) {
    throw new Error('a stock price change must never touch the selling price');
  }
});

await runner.check('the menu cost table agrees with the single recipe read', async () => {
  const table = await call('recipes:menu-costs', {});
  const row = table.rows.find((candidate) => candidate.itemId === zinger.id);
  const recipe = await call('recipes:get', { itemId: zinger.id });

  if (!row) throw new Error('the Zinger Burger is missing from the cost table');
  if (row.costTotal !== recipe.costTotal) throw new Error('the table cost disagrees');
  if (row.profit !== recipe.profit) throw new Error('the table profit disagrees');
  if (row.marginPercentX100 !== recipe.marginPercentX100) throw new Error('the margin disagrees');
});

/* ------------------------- 3. the price helper ------------------------- */

await runner.check('the price suggestion hits the target margin', async () => {
  // Cost 18,600 at a 55% target: 18,600 ÷ 0.45 = 41,333.33 → rounded up to a
  // whole rupee: 41,400.
  const suggestion = await call('recipes:suggest-price', {
    costTotal: 18_600,
    marginPercentX100: 5_500,
  });

  if (suggestion.price !== 41_400) {
    throw new Error(`suggested ${suggestion.price}, expected 41400`);
  }

  // And the suggested price really delivers at least the margin asked for.
  const margin = Math.round(((suggestion.price - 18_600) * 10_000) / suggestion.price);
  if (margin < 5_500) throw new Error(`the suggestion only reaches ${margin / 100}% margin`);
});

await runner.check('a 100% target margin is refused instead of dividing by zero', async () => {
  const result = await harness.call('recipes:suggest-price', {
    costTotal: 18_600,
    marginPercentX100: 10_000,
  });

  if (result.ok) throw new Error('a 100% margin was accepted');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('the owner can set a price from the costing screen', async () => {
  const row = await call('recipes:set-item-price', { itemId: zinger.id, price: 50_000 });

  if (row.price !== 50_000) throw new Error('the price was not saved');
  if (row.profit !== 50_000 - 18_600) throw new Error('profit did not follow the new price');

  // Put it back so the later checks read the documented numbers.
  await call('recipes:set-item-price', { itemId: zinger.id, price: 45_000 });
});

/* ---------------------------- 4. can make ----------------------------- */

await runner.check('"can make" is the tightest ingredient in the recipe', async () => {
  // Buns: 1,000 ÷ 1 = 1000. Chicken: 20,000 g ÷ 150 = 133. Mayo: 5,000 ÷ 20 = 250.
  // Cheese: 120 ÷ 1 = 120. Lettuce: 2,000 ÷ 10 = 200. Boxes: 100 ÷ 1 = 100.
  // The box is the tightest ingredient, so the answer is 100 burgers.
  const table = await call('recipes:menu-costs', {});
  const row = table.rows.find((candidate) => candidate.itemId === zinger.id);

  if (row.canMake !== 100) throw new Error(`canMake ${row.canMake}, expected 100`);
});

/* ------------------------- 5. no-recipe handling ---------------------- */

await runner.check('an item without a recipe is listed as cost unknown', async () => {
  const fries = await call('menu:item-save', {
    categoryId: 1,
    name: 'Plain Fries',
    price: 20_000,
    available: true,
    image: null,
  });

  const table = await call('recipes:menu-costs', {});
  const row = table.rows.find((candidate) => candidate.itemId === fries.id);

  if (!row) throw new Error('the item is missing from the cost table');
  if (row.hasRecipe) throw new Error('it has no recipe, it should say so');
  if (row.profit !== null) throw new Error('profit must be null, not the whole price');
  if (row.belowTarget) throw new Error('an unknown cost must not be flagged below target');
  if (table.missingRecipeCount < 1) throw new Error('the missing-recipe count did not move');
});

/* -------------------------- 6. the margin floor ----------------------- */

await runner.check('an item under the margin floor is flagged', async () => {
  // 30% floor. A burger costing 186 sold at 200 is a 7% margin: flagged.
  await call('stock:settings-save', {
    allowNegativeStock: true,
    autoSoldOut: false,
    marginAlertPercentX100: 3_000,
  });

  await call('recipes:set-item-price', { itemId: zinger.id, price: 20_000 });

  const table = await call('recipes:menu-costs', {});
  const row = table.rows.find((candidate) => candidate.itemId === zinger.id);

  if (!row.belowTarget) throw new Error('a 7% margin was not flagged against a 30% floor');

  await call('recipes:set-item-price', { itemId: zinger.id, price: 45_000 });
  const after = await call('recipes:menu-costs', {});
  const fixed = after.rows.find((candidate) => candidate.itemId === zinger.id);
  if (fixed.belowTarget) throw new Error('the flag did not clear at a healthy price');
});

/* ------------------------- 7. recipe validation ----------------------- */

await runner.check('a zero quantity is refused', async () => {
  const result = await harness.call('recipes:save', {
    itemId: zinger.id,
    lines: [{ ingredientId: bun.id, qtyBase: 0, wastePercentX100: 0 }],
  });

  if (result.ok) throw new Error('a zero quantity was accepted');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('a fractional quantity (0.5 g) is refused', async () => {
  const result = await harness.call('recipes:save', {
    itemId: zinger.id,
    lines: [{ ingredientId: chicken.id, qtyBase: 0.5, wastePercentX100: 0 }],
  });

  if (result.ok) throw new Error('a fractional quantity was accepted');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('the same ingredient twice is refused', async () => {
  const result = await harness.call('recipes:save', {
    itemId: zinger.id,
    lines: [
      { ingredientId: mayo.id, qtyBase: 20, wastePercentX100: 0 },
      { ingredientId: mayo.id, qtyBase: 30, wastePercentX100: 0 },
    ],
  });

  if (result.ok) throw new Error('a duplicate ingredient was accepted');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('saving an empty recipe removes it (cost unknown again)', async () => {
  const fries = await call('menu:item-save', {
    categoryId: 1,
    name: 'Test item for empty recipe',
    price: 10_000,
    available: true,
    image: null,
  });

  await call('recipes:save', {
    itemId: fries.id,
    lines: [{ ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 }],
  });
  const withRecipe = await call('recipes:get', { itemId: fries.id });
  if (!withRecipe.hasRecipe) throw new Error('the test recipe was not saved');

  const cleared = await call('recipes:save', { itemId: fries.id, lines: [] });
  if (cleared.hasRecipe) throw new Error('the recipe was not cleared');
  if (cleared.costTotal !== 0) throw new Error('a cleared recipe must cost nothing');
  if (cleared.profit !== null) throw new Error('a cleared recipe must report cost unknown');
});

/* -------------------- 8. an ingredient in a recipe ------------------- */

await runner.check('an ingredient used in a recipe cannot be deleted', async () => {
  const result = await harness.call('stock:ingredient-delete', { id: cheese.id });

  if (result.ok) throw new Error('an ingredient used by a recipe was deleted');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

/* ------------------------- 9. permissions ---------------------------- */

await runner.check('a manager and a cashier cannot see costs', async () => {
  for (const [username, password] of [
    ['manager', 'manager123'],
    ['cashier', 'cashier123'],
  ]) {
    await harness.loginAs(username, password);

    for (const [channel, payload] of [
      ['recipes:menu-costs', {}],
      ['recipes:get', { itemId: zinger.id }],
      ['recipes:suggest-price', { costTotal: 18_600, marginPercentX100: 5_500 }],
    ]) {
      const result = await harness.call(channel, payload);
      if (result.ok) throw new Error(`${username} was allowed to call ${channel}`);
      if (result.error.code !== 'FORBIDDEN') {
        throw new Error(`${username} ${channel} returned ${result.error.code}`);
      }
    }
  }
});

await runner.check('a cashier cannot edit a recipe', async () => {
  await harness.loginAs('cashier', 'cashier123');

  const result = await harness.call('recipes:save', {
    itemId: zinger.id,
    lines: [{ ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 }],
  });

  if (result.ok) throw new Error('a cashier edited a recipe');
  if (result.error.code !== 'FORBIDDEN') throw new Error(`got ${result.error.code}`);
});

await runner.check('a manager can edit a recipe even without seeing the cost table', async () => {
  await harness.loginAs('manager', 'manager123');

  const recipe = await call('recipes:save', {
    itemId: zinger.id,
    lines: [
      { ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 },
      { ingredientId: chicken.id, qtyBase: 150, wastePercentX100: 0 },
      { ingredientId: mayo.id, qtyBase: 20, wastePercentX100: 0 },
      { ingredientId: cheese.id, qtyBase: 1, wastePercentX100: 0 },
      { ingredientId: lettuce.id, qtyBase: 10, wastePercentX100: 0 },
      { ingredientId: box.id, qtyBase: 1, wastePercentX100: 0 },
    ],
  });

  if (!recipe.hasRecipe) throw new Error('the manager could not save the recipe');
});

/* ---------------------- 10. settings round trip ---------------------- */

await runner.check('stock settings round-trip and validate the margin floor', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  const saved = await call('stock:settings-save', {
    allowNegativeStock: false,
    autoSoldOut: true,
    marginAlertPercentX100: 4_000,
  });

  if (saved.allowNegativeStock !== false) throw new Error('allowNegativeStock did not persist');
  if (saved.autoSoldOut !== true) throw new Error('autoSoldOut did not persist');
  if (saved.marginAlertPercentX100 !== 4_000) throw new Error('the margin floor did not persist');

  const read = await call('stock:settings', {});
  if (read.marginAlertPercentX100 !== 4_000) throw new Error('the settings did not read back');

  const bad = await harness.call('stock:settings-save', {
    allowNegativeStock: true,
    autoSoldOut: false,
    marginAlertPercentX100: 12_000,
  });
  if (bad.ok) throw new Error('a 120% margin floor was accepted');

  // Leave the defaults the rest of the suite expects.
  await call('stock:settings-save', {
    allowNegativeStock: true,
    autoSoldOut: false,
    marginAlertPercentX100: 3_500,
  });
});

harness.cleanup();
runner.finish();
