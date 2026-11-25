/**
 * Phase 25 — house-made ingredients (Roadmap 4.I).
 *
 * The client's answer to §15 Q4: some things the kitchen makes itself — mayo,
 * marinade, a coating mix. Until this existed, a house sauce could only be faked
 * with a guessed purchase price: a number that would then be wrong forever,
 * silently, and would never notice when the price of oil went up.
 *
 * This suite proves the model rather than the code:
 *
 *   1. the cost of a made ingredient is DERIVED from its components, not typed,
 *   2. making a batch takes the components OFF the shelf and puts the product ON,
 *   3. the value the ledger loses equals the value it gains — the shelf does not
 *      conjure or destroy money when the kitchen cooks,
 *   4. the product's weighted average becomes the batch's computed cost, so a
 *      burger using house mayo is costed correctly on the next sale,
 *   5. the batch is FROZEN: a price rise tomorrow never rewrites yesterday's batch,
 *   6. a sub-recipe inside a sub-recipe is refused, with a message that says why,
 *   7. nonsense is refused: no components, self-reference, a batch of zero,
 *   8. a manager without `costs:read` cannot read the made cost (`costs:read`),
 *   9. turning the yield back to 0 returns the ingredient to being bought,
 *  10. the ledger rebuild in migration 023 kept every historical movement intact.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: false });
const runner = createRunner('Phase 25 — House-made ingredients / sub-recipes (4.I)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);

/* ------------------------------- fixtures ------------------------------ */

// Buy oil at Rs 600/litre and eggs at Rs 20 each — round prices so the
// arithmetic in the assertions below can be followed by eye.
const oil = await call('stock:ingredient-save', {
  name: 'Cooking oil',
  category: 'Oil',
  baseUnit: 'ml',
  purchaseUnit: 'litre',
  unitsPerPurchase: 1000,
  reorderLevel: 500,
  supplierId: null,
  active: true,
});
const egg = await call('stock:ingredient-save', {
  name: 'Egg',
  category: 'Dairy',
  baseUnit: 'pcs',
  purchaseUnit: 'dozen',
  unitsPerPurchase: 12,
  reorderLevel: 6,
  supplierId: null,
  active: true,
});
const mayo = await call('stock:ingredient-save', {
  name: 'House mayo',
  category: 'Sauces',
  baseUnit: 'g',
  purchaseUnit: 'kg',
  unitsPerPurchase: 1000,
  reorderLevel: 200,
  supplierId: null,
  active: true,
});

const supplier = await call('stock:supplier-save', {
  name: 'Metro Cash',
  phone: '0300-1112223',
  address: 'Blue Area',
  notes: '',
  active: true,
});

/**
 * One purchase: `qtyPurchaseMilli` thousandths of a purchase unit, `unitPrice`
 * in paisa per WHOLE purchase unit. The caller does the arithmetic, because the
 * purchase unit differs per ingredient (a litre is 1000 base units, a dozen 12)
 * and a helper that guessed would hide exactly the mistake worth catching.
 */
async function buy(ingredientId, qtyPurchaseMilli, unitPrice) {
  await call('stock:purchase-create', {
    supplierId: supplier.id,
    billNo: '',
    purchasedOn: '2026-11-02',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId, qtyPurchaseMilli, unitPrice }],
  });
}

// Oil: 60,000 paisa a litre → 60 paisa per ml → 60,000 milli-paisa per ml.
// Eggs: 28,800 paisa a dozen → 2,400 paisa each → 2,400,000 milli-paisa per egg.
await buy(oil.id, 1000, 60_000);
await buy(egg.id, 1000, 28_800);

const oilAfter = (await call('stock:ingredient', { id: oil.id })).ingredient;
const eggAfter = (await call('stock:ingredient', { id: egg.id })).ingredient;

if (oilAfter.avgCostMilli !== 60_000) {
  throw new Error(`fixture: oil landed at ${oilAfter.avgCostMilli}, expected 60000`);
}
if (eggAfter.avgCostMilli !== 2_400_000) {
  throw new Error(`fixture: egg landed at ${eggAfter.avgCostMilli}, expected 2400000`);
}

/* -------------------- 1. the cost is derived, not typed ---------------- */

await runner.check('a made ingredient costs what its components cost, per batch yield', async () => {
  // One batch = 400 ml oil + 2 eggs = 24,000 + 4,800 = 28,800 paisa.
  // The batch yields 1,000 g, so mayo costs 28.8 paisa per gram (28,800 milli).
  const saved = await call('stock:sub-recipe-save', {
    ingredientId: mayo.id,
    batchYieldBase: 1000,
    lines: [
      { componentId: oil.id, qtyBase: 400, wastePercentX100: 0 },
      { componentId: egg.id, qtyBase: 2, wastePercentX100: 0 },
    ],
  });

  if (!saved.isMade) throw new Error('the ingredient is not flagged as made');
  if (saved.batchCost !== 28_800) throw new Error(`batch cost ${saved.batchCost}, expected 28800`);
  if (saved.unitCostMilli !== 28_800) {
    throw new Error(`unit cost ${saved.unitCostMilli}, expected 28800`);
  }

  // Nothing was booked just by writing the recipe: a recipe is a plan.
  const oils = (await call('stock:ingredient', { id: oil.id })).ingredient;
  if (oils.qtyOnHand !== oilAfter.qtyOnHand) {
    throw new Error('saving the recipe moved stock');
  }

  // The list view agrees with the detail view.
  const overview = await call('stock:sub-recipes');
  const row = overview.rows.find((entry) => entry.ingredientId === mayo.id);
  if (!row) throw new Error('the made ingredient is missing from the overview');
  if (row.madeUnitCostMilli !== 28_800) throw new Error(`overview cost ${row.madeUnitCostMilli}`);
  if (row.lineCount !== 2) throw new Error(`line count ${row.lineCount}`);
});

/* -------------------- 2. making a batch moves both sides --------------- */

await runner.check('making a batch empties the pantry and fills the jar', async () => {
  const before = {
    oil: (await call('stock:ingredient', { id: oil.id })).ingredient,
    egg: (await call('stock:ingredient', { id: egg.id })).ingredient,
    mayo: (await call('stock:ingredient', { id: mayo.id })).ingredient,
  };

  const batch = await call('stock:sub-recipe-make', {
    ingredientId: mayo.id,
    batches: 2,
    madeOn: '2026-11-10',
    notes: 'Sunday prep',
  });

  if (batch.batchNo !== 'BAT-00001') throw new Error(`batch number ${batch.batchNo}`);
  if (batch.qtyBase !== 2000) throw new Error(`produced ${batch.qtyBase}, expected 2000`);
  if (batch.totalCost !== 57_600) throw new Error(`batch total ${batch.totalCost}`);
  // 2 batches: 57,600 paisa ÷ 2,000 g = 28.8 paisa per g
  if (batch.unitCostMilli !== 28_800) throw new Error(`batch unit cost ${batch.unitCostMilli}`);

  const after = {
    oil: (await call('stock:ingredient', { id: oil.id })).ingredient,
    egg: (await call('stock:ingredient', { id: egg.id })).ingredient,
    mayo: (await call('stock:ingredient', { id: mayo.id })).ingredient,
  };

  // Two batches consume 800 ml oil and 4 eggs.
  if (after.oil.qtyOnHand !== before.oil.qtyOnHand - 800) {
    throw new Error(`oil ${before.oil.qtyOnHand} → ${after.oil.qtyOnHand}`);
  }
  if (after.egg.qtyOnHand !== before.egg.qtyOnHand - 4) {
    throw new Error(`egg ${before.egg.qtyOnHand} → ${after.egg.qtyOnHand}`);
  }
  if (after.mayo.qtyOnHand !== before.mayo.qtyOnHand + 2000) {
    throw new Error(`mayo ${before.mayo.qtyOnHand} → ${after.mayo.qtyOnHand}`);
  }

  // The product's average is now the derived cost.
  if (after.mayo.avgCostMilli !== 28_800) {
    throw new Error(`mayo average ${after.mayo.avgCostMilli}, expected 28800`);
  }

  // And the jar knows what went into it.
  if (batch.lines.length !== 2) throw new Error(`batch lines ${batch.lines.length}`);
  const oilLine = batch.lines.find((line) => line.componentId === oil.id);
  if (!oilLine) throw new Error('the oil line is missing from the batch');
  if (oilLine.qtyBase !== 800) throw new Error(`oil consumed ${oilLine.qtyBase}, expected 800`);
  if (oilLine.cost !== 48_000) throw new Error(`oil line cost ${oilLine.cost}, expected 48000`);
});

/* --------------- 3. the shelf neither conjures nor destroys value ------ */

await runner.check('the value taken off the shelf equals the value put back', async () => {
  // Re-read the ledger's own accounting: every sub_recipe_make movement, signed.
  const movementValue = await harness.db
    .prepare(
      `SELECT COALESCE(SUM(ROUND(qty * unit_cost_milli / 1000.0)), 0) AS value
         FROM stock_movements
        WHERE kind = 'sub_recipe_make'`,
    )
    .get();

  // Components leave (−57,600) and the product arrives (+57,600), so the whole
  // operation is value-neutral. This is the assertion that would catch a rounding
  // rule applied on one side and not the other.
  if (Math.abs(movementValue.value) > 2) {
    throw new Error(`the batch was not value-neutral: ${movementValue.value}`);
  }

  // The ledger and the cached shelf agree for every ingredient touched.
  for (const id of [oil.id, egg.id, mayo.id]) {
    const ledger = await harness.db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS qty FROM stock_movements WHERE ingredient_id = ?')
      .get(id);
    const cached = (await call('stock:ingredient', { id })).ingredient;
    if (ledger.qty !== cached.qtyOnHand) {
      throw new Error(
        `ingredient ${id}: ledger says ${ledger.qty}, shelf says ${cached.qtyOnHand}`,
      );
    }
  }
});

/* ------------------ 4. a recipe that uses house mayo costs in ---------- */

await runner.check('a burger using house mayo is costed from its made price', async () => {
  const category = await call('menu:category-save', {
    name: 'Burgers',
    sortOrder: 1,
    active: true,
  });
  const burger = await call('menu:item-save', {
    categoryId: category.id,
    name: 'Mayo Burger',
    price: 25_000,
    available: true,
    image: null,
  });

  await call('recipes:save', {
    itemId: burger.id,
    lines: [{ ingredientId: mayo.id, qtyBase: 20, wastePercentX100: 0 }],
  });

  const recipe = await call('recipes:get', { itemId: burger.id });
  // 20 g of mayo at 28.8 paisa per g = 576 paisa.
  if (recipe.costTotal !== 576) throw new Error(`recipe cost ${recipe.costTotal}, expected 576`);
});

/* --------------------- 5. made cost follows live prices ---------------- */

await runner.check('a price rise changes the next batch but not the last one', async () => {
  const batchBefore = await call('stock:sub-recipe', { ingredientId: mayo.id });

  // Oil doubles: Rs 1,200 a litre.
  await call('stock:purchase-create', {
    supplierId: supplier.id,
    billNo: '',
    purchasedOn: '2026-11-15',
    extraCharges: 0,
    paidAmount: 0,
    paymentMethod: 'credit',
    notes: '',
    lines: [{ ingredientId: oil.id, qtyPurchaseMilli: 1000, unitPrice: 120_000 }],
  });

  const batchAfter = await call('stock:sub-recipe', { ingredientId: mayo.id });

  // The plan gets dearer: the average oil price rose, so the *next* batch costs
  // more. The read model is live on purpose — "what does it cost me today?".
  if (!(batchAfter.batchCost > batchBefore.batchCost)) {
    throw new Error(
      `the plan did not follow the price: ${batchBefore.batchCost} → ${batchAfter.batchCost}`,
    );
  }

  // The batch already made stays frozen at what it cost that day.
  const batches = await call('stock:sub-recipe-batches', { ingredientId: mayo.id });
  const first = batches.find((batch) => batch.batchNo === 'BAT-00001');
  if (!first) throw new Error('the first batch disappeared');
  if (first.totalCost !== 57_600) {
    throw new Error(`the old batch was rewritten to ${first.totalCost}`);
  }

  // The shelf's own average has NOT moved: the mayo on hand was made at 28,800
  // and no second batch has been made yet.
  const shelf = (await call('stock:ingredient', { id: mayo.id })).ingredient;
  if (shelf.avgCostMilli !== 28_800) {
    throw new Error(`the shelf was repriced to ${shelf.avgCostMilli}`);
  }
});

/* ----------------------- 6. one level, not two ------------------------- */

await runner.check('a house-made ingredient cannot go inside another house-made one', async () => {
  const marinade = await call('stock:ingredient-save', {
    name: 'House marinade',
    category: 'Sauces',
    baseUnit: 'ml',
    purchaseUnit: 'litre',
    unitsPerPurchase: 1000,
    reorderLevel: 100,
    supplierId: null,
    active: true,
  });

  const refused = await harness.call('stock:sub-recipe-save', {
    ingredientId: marinade.id,
    batchYieldBase: 500,
    lines: [{ componentId: mayo.id, qtyBase: 100, wastePercentX100: 0 }],
  });

  if (refused.ok) throw new Error('a nested sub-recipe was accepted');

  // The reason must be usable by the owner, not just accurate.
  if (!/made in-house/i.test(refused.error.message)) {
    throw new Error(`unhelpful message: ${refused.error.message}`);
  }
});

/* --------------------------- 7. the refusals --------------------------- */

await runner.check('nonsense is refused: no components, self-reference, zero batches', async () => {
  const noLines = await harness.call('stock:sub-recipe-save', {
    ingredientId: mayo.id,
    batchYieldBase: 500,
    lines: [],
  });
  if (noLines.ok) throw new Error('a recipe with no components was accepted');

  const self = await harness.call('stock:sub-recipe-save', {
    ingredientId: mayo.id,
    batchYieldBase: 500,
    lines: [{ componentId: mayo.id, qtyBase: 10, wastePercentX100: 0 }],
  });
  if (self.ok) throw new Error('an ingredient was accepted as its own component');

  const noYield = await harness.call('stock:sub-recipe-make', {
    ingredientId: mayo.id,
    batches: 0,
  });
  if (noYield.ok) throw new Error('a zero-batch was accepted');

  // Making a bought ingredient has no recipe to cost from.
  const bought = await harness.call('stock:sub-recipe-make', {
    ingredientId: egg.id,
    batches: 1,
  });
  if (bought.ok) throw new Error('a bought ingredient was "made"');

  // A component that does not exist.
  const ghost = await harness.call('stock:sub-recipe-save', {
    ingredientId: mayo.id,
    batchYieldBase: 500,
    lines: [{ componentId: 999_999, qtyBase: 10, wastePercentX100: 0 }],
  });
  if (ghost.ok) throw new Error('a non-existent component was accepted');
});

/* ------------------------ 8. costs are for the owner ------------------- */

await runner.check('a manager without costs:read cannot read a made cost', async () => {
  await call('users:save', {
    username: 'floor',
    fullName: 'Floor Manager',
    role: 'manager',
    password: 'FloorPass123',
    active: true,
  });

  await harness.loginAs('floor', 'FloorPass123');

  const refused = await harness.call('stock:sub-recipes');
  if (refused.ok) throw new Error('a manager without costs:read read the made costs');

  // He can still see the shelf itself — hiding a margined number is not the same
  // as hiding the stock.
  const ingredients = await harness.call('stock:ingredients');
  if (!ingredients.ok) throw new Error('a manager cannot see the ingredient list');

  await harness.loginAs('admin', 'OwnerPass123');
});

/* ------------------- 9. turning it back into a bought item ------------- */

await runner.check('clearing the yield returns the ingredient to being bought', async () => {
  const cleared = await call('stock:sub-recipe-save', {
    ingredientId: mayo.id,
    batchYieldBase: 0,
    lines: [],
  });

  if (cleared.isMade) throw new Error('the ingredient is still flagged as made');
  if (cleared.lines.length !== 0) throw new Error('the components were kept');

  const shelf = (await call('stock:ingredient', { id: mayo.id })).ingredient;
  // Its stock and its price are untouched — only the intention changed.
  if (shelf.qtyOnHand !== 2000) throw new Error(`stock changed to ${shelf.qtyOnHand}`);
  if (shelf.avgCostMilli !== 28_800) throw new Error(`cost changed to ${shelf.avgCostMilli}`);
  if (shelf.batchYieldBase !== 0) throw new Error('the yield column was not cleared');

  const overview = await call('stock:sub-recipes');
  if (overview.rows.some((row) => row.ingredientId === mayo.id)) {
    throw new Error('the ingredient is still listed as made');
  }
});

/* ---------------- 10. migration 023 did not lose the ledger ------------ */

await runner.check('the ledger rebuild kept every movement, and nothing dangles', async () => {
  const violations = harness.db.pragma('foreign_key_check');
  if (violations.length > 0) {
    throw new Error(`${violations.length} foreign key violation(s) after migration 023`);
  }

  // Both sub-recipe kinds are legal now, and the old kinds still are.
  const kinds = await harness.db
    .prepare('SELECT DISTINCT kind FROM stock_movements ORDER BY kind')
    .all();
  if (!kinds.some((row) => row.kind === 'sub_recipe_make')) {
    throw new Error('no sub_recipe_make movement was written');
  }
  // The rebuild had to keep the OLD kinds legal and their rows in place; this
  // fixture never sells anything, so it asserts on the kinds it did write rather
  // than on a sale that never happened.
  if (!kinds.some((row) => row.kind === 'purchase')) {
    throw new Error('the purchase movements were lost in the rebuild');
  }
  if (!kinds.some((row) => row.kind === 'sub_recipe_make')) {
    throw new Error('the new movement kind is not accepted');
  }

  // Every movement still names a real ingredient, which is what the rebuild had
  // to preserve while its foreign keys were being re-pointed.
  const orphans = await harness.db
    .prepare(
      `SELECT COUNT(*) AS total FROM stock_movements m
        LEFT JOIN ingredients i ON i.id = m.ingredient_id
        WHERE i.id IS NULL`,
    )
    .get();
  if (orphans.total !== 0) throw new Error(`${orphans.total} movements lost their ingredient`);
});

harness.cleanup();
runner.finish();
