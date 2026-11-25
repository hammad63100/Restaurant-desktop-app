/**
 * Phase 15 — Roadmap 4.A: ingredients, suppliers and the starter catalogue.
 *
 * What is proven here:
 *   1. the migration lands (015) and a fresh database starts with no stock,
 *   2. an ingredient can be created, edited and soft-deleted,
 *   3. the owner's unit rules are enforced (conversions, base units),
 *   4. the starter list loads the usual fast-food stock, once, without duplicates,
 *   5. suppliers exist and cannot be deleted while ingredients still point at them,
 *   6. a cashier can read stock but cannot write it, and only the owner sees costs,
 *   7. the stock page's numbers (value, low stock) agree with the rows.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 15 — Stock foundation (4.A)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const stock = (channel, payload) => harness.callOk(channel, payload);

/* ------------------------------ 1. migration ------------------------------ */

await runner.check('migration 015 is applied and the stock tables exist', async () => {
  const applied = harness.db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => row.version);

  if (!applied.includes(15)) throw new Error('migration 015 was not applied');

  const tables = harness.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);

  for (const table of ['suppliers', 'ingredients']) {
    if (!tables.includes(table)) throw new Error(`${table} table is missing`);
  }
});

await runner.check('a fresh shop has no ingredients and no stock value', async () => {
  const overview = await stock('stock:overview', {});

  if (overview.ingredients.length !== 0) {
    throw new Error(`expected an empty list, got ${overview.ingredients.length}`);
  }
  if (overview.totalValue !== 0) throw new Error(`stock value should be 0, got ${overview.totalValue}`);
  if (overview.lowStockCount !== 0) throw new Error('low stock count should be 0');
});

/* --------------------------- 2. ingredient CRUD --------------------------- */

let chickenId = 0;

await runner.check('an ingredient is created with its units and low-stock level', async () => {
  const chicken = await stock('stock:ingredient-save', {
    name: 'Chicken fillet',
    category: 'Chicken & meat',
    baseUnit: 'g',
    purchaseUnit: 'kg',
    unitsPerPurchase: 1000,
    reorderLevel: 3000,
    supplierId: null,
    active: true,
  });

  chickenId = chicken.id;

  if (chicken.baseUnit !== 'g') throw new Error('base unit was not saved');
  if (chicken.unitsPerPurchase !== 1000) throw new Error('the kg conversion was not saved');
  if (chicken.reorderLevel !== 3000) throw new Error('the low-stock level was not saved');
  if (chicken.qtyOnHand !== 0) throw new Error('a new ingredient must start with no stock');
  if (chicken.avgCostMilli !== 0) throw new Error('a new ingredient must start with no cost');
});

await runner.check('a duplicate name is refused (case-insensitive)', async () => {
  const result = await harness.call('stock:ingredient-save', {
    name: 'chicken FILLET',
    category: 'Chicken & meat',
    baseUnit: 'g',
    purchaseUnit: 'kg',
    unitsPerPurchase: 1000,
    reorderLevel: 0,
    supplierId: null,
    active: true,
  });

  if (result.ok) throw new Error('a duplicate ingredient name was accepted');
  if (result.error.code !== 'CONFLICT') throw new Error(`expected CONFLICT, got ${result.error.code}`);
});

await runner.check('an ingredient can be edited (name, category, low stock)', async () => {
  const updated = await stock('stock:ingredient-save', {
    id: chickenId,
    name: 'Chicken fillet (breast)',
    category: 'Chicken & meat',
    baseUnit: 'g',
    purchaseUnit: 'kg',
    unitsPerPurchase: 1000,
    reorderLevel: 5000,
    supplierId: null,
    active: true,
  });

  if (updated.name !== 'Chicken fillet (breast)') throw new Error('the name was not updated');
  if (updated.reorderLevel !== 5000) throw new Error('the low-stock level was not updated');
});

await runner.check('a bad conversion is rejected by the schema', async () => {
  const result = await harness.call('stock:ingredient-save', {
    name: 'Impossible oil',
    category: 'Oil & fuel',
    baseUnit: 'ml',
    purchaseUnit: 'litre',
    unitsPerPurchase: 0,
    reorderLevel: 0,
    supplierId: null,
    active: true,
  });

  if (result.ok) throw new Error('a zero conversion was accepted');
  if (result.error.code !== 'VALIDATION_ERROR') {
    throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
  }
});

await runner.check('a base unit outside g/ml/pcs is rejected', async () => {
  const result = await harness.call('stock:ingredient-save', {
    name: 'Mystery bag',
    category: 'Other',
    baseUnit: 'kg',
    purchaseUnit: 'kg',
    unitsPerPurchase: 1,
    reorderLevel: 0,
    supplierId: null,
    active: true,
  });

  if (result.ok) throw new Error('an invalid base unit was accepted');
  if (result.error.code !== 'VALIDATION_ERROR') {
    throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
  }
});

/* ---------------------------- 3. suppliers -------------------------------- */

let supplierId = 0;

await runner.check('a supplier is created, then linked to an ingredient', async () => {
  const supplier = await stock('stock:supplier-save', {
    name: 'Metro Cash & Carry',
    phone: '0512345678',
    address: 'Blue Area',
    notes: 'Delivers Tuesdays',
    active: true,
  });

  supplierId = supplier.id;

  const linked = await stock('stock:ingredient-save', {
    id: chickenId,
    name: 'Chicken fillet (breast)',
    category: 'Chicken & meat',
    baseUnit: 'g',
    purchaseUnit: 'kg',
    unitsPerPurchase: 1000,
    reorderLevel: 5000,
    supplierId,
    active: true,
  });

  if (linked.supplierId !== supplierId) throw new Error('the supplier link was not saved');
  if (linked.supplierName !== 'Metro Cash & Carry') throw new Error('the supplier name was not read back');
});

await runner.check('a duplicate supplier is refused', async () => {
  const result = await harness.call('stock:supplier-save', {
    name: 'metro cash & carry',
    phone: '',
    address: '',
    notes: '',
    active: true,
  });

  if (result.ok) throw new Error('a duplicate supplier was accepted');
  if (result.error.code !== 'CONFLICT') throw new Error(`expected CONFLICT, got ${result.error.code}`);
});

await runner.check('a supplier still used by an ingredient cannot be deleted', async () => {
  const result = await harness.call('stock:supplier-delete', { id: supplierId });

  if (result.ok) throw new Error('a supplier in use was deleted');
  if (result.error.code !== 'CONFLICT') throw new Error(`expected CONFLICT, got ${result.error.code}`);
});

/* ------------------------- 4. the starter catalogue ------------------------ */

await runner.check('the starter catalogue covers the usual fast-food categories', async () => {
  const groups = await stock('stock:starter-catalogue', {});
  const categories = groups.map((group) => group.category);

  for (const expected of [
    'Chicken & meat',
    'Bread & dough',
    'Sauces',
    'Dairy',
    'Vegetables',
    'Packaging',
    'Drinks',
  ]) {
    if (!categories.includes(expected)) throw new Error(`${expected} is missing from the starter list`);
  }

  if (categories.length < 10) throw new Error(`only ${categories.length} categories`);
});

await runner.check('every starter item has a usable unit conversion', async () => {
  const groups = await stock('stock:starter-catalogue', {});

  for (const group of groups) {
    for (const item of group.items) {
      if (!['g', 'ml', 'pcs'].includes(item.baseUnit)) {
        throw new Error(`${item.name} has base unit ${item.baseUnit}`);
      }
      if (!Number.isInteger(item.unitsPerPurchase) || item.unitsPerPurchase < 1) {
        throw new Error(`${item.name} has conversion ${item.unitsPerPurchase}`);
      }
      if (!item.purchaseUnit) throw new Error(`${item.name} has no purchase unit`);
    }
  }
});

await runner.check('loading a starter selection creates only the ticked ingredients', async () => {
  const result = await stock('stock:starter-load', {
    names: ['Burger bun', 'Mayonnaise', 'Cheese slice', 'Burger box', 'Cooking oil'],
  });

  if (result.created !== 5) throw new Error(`created ${result.created}, expected 5`);

  const names = (await stock('stock:ingredients', {})).map((ingredient) => ingredient.name);
  for (const name of ['Burger bun', 'Mayonnaise', 'Cheese slice', 'Burger box', 'Cooking oil']) {
    if (!names.includes(name)) throw new Error(`${name} was not created`);
  }

  // Units must have followed the catalogue, not a default.
  const bun = (await stock('stock:ingredients', {})).find(
    (ingredient) => ingredient.name === 'Burger bun',
  );
  if (bun.baseUnit !== 'pcs' || bun.purchaseUnit !== 'packet' || bun.unitsPerPurchase !== 6) {
    throw new Error(`Burger bun got the wrong units: ${JSON.stringify(bun)}`);
  }
});

await runner.check('loading the same starter list again never duplicates', async () => {
  const before = (await stock('stock:ingredients', {})).length;

  const result = await stock('stock:starter-load', {
    names: ['Burger bun', 'Mayonnaise', 'Zinger coating mix'],
  });

  const after = (await stock('stock:ingredients', {})).length;

  if (result.created !== 1) throw new Error(`created ${result.created}, expected 1 new item`);
  if (result.skipped !== 2) throw new Error(`skipped ${result.skipped}, expected 2`);
  if (after !== before + 1) throw new Error('the list grew by more than the new item');
});

/* ---------------------------- 5. low-stock view --------------------------- */

await runner.check('the overview agrees with its own rows', async () => {
  const overview = await stock('stock:overview', {});

  const expectedLow = overview.ingredients.filter(
    (ingredient) => ingredient.qtyOnHand <= ingredient.reorderLevel,
  ).length;

  if (overview.lowStockCount !== expectedLow) {
    throw new Error(`lowStockCount ${overview.lowStockCount} but ${expectedLow} rows qualify`);
  }
  if (overview.ingredientCount !== overview.ingredients.length) {
    throw new Error('the ingredient count does not match the list');
  }
});

/* ------------------------- 6. permissions boundary ------------------------ */

await runner.check('a cashier may read stock but may not change it', async () => {
  await harness.loginAs('cashier', 'cashier123');

  const list = await stock('stock:ingredients', {});
  if (list.length === 0) throw new Error('a cashier should be able to see the stock list');

  const attempts = [
    [
      'stock:ingredient-save',
      {
        name: 'Cashier sneaky item',
        category: 'Other',
        baseUnit: 'g',
        purchaseUnit: 'kg',
        unitsPerPurchase: 1000,
        reorderLevel: 0,
        supplierId: null,
        active: true,
      },
    ],
    ['stock:ingredient-delete', { id: chickenId }],
    [
      'stock:supplier-save',
      { name: 'Cashier supplier', phone: '', address: '', notes: '', active: true },
    ],
    ['stock:starter-load', { names: ['Salt'] }],
  ];

  for (const [channel, payload] of attempts) {
    const result = await harness.call(channel, payload);
    if (result.ok) throw new Error(`a cashier was allowed to call ${channel}`);
    if (result.error.code !== 'FORBIDDEN') {
      throw new Error(`${channel} returned ${result.error.code}, expected FORBIDDEN`);
    }
  }
});

await runner.check('a cashier cannot read costs and margins', async () => {
  await harness.loginAs('cashier', 'cashier123');

  // The cost view arrives in 4.C; this pins the capability now so a later phase
  // cannot quietly widen it.
  const permissions = await harness.callOk('auth:permissions', {});
  if (permissions.capabilities.includes('costs:read')) {
    throw new Error('a cashier must never hold costs:read');
  }
  if (permissions.capabilities.includes('purchases:write')) {
    throw new Error('a cashier must never hold purchases:write');
  }
});

await runner.check('a manager may work the stock but not see costs', async () => {
  await harness.loginAs('manager', 'manager123');
  const permissions = await harness.callOk('auth:permissions', {});

  for (const capability of ['inventory:read', 'inventory:write', 'purchases:write', 'stock:adjust']) {
    if (!permissions.capabilities.includes(capability)) {
      throw new Error(`a manager should hold ${capability}`);
    }
  }

  if (permissions.capabilities.includes('costs:read')) {
    throw new Error('a manager must not hold costs:read by default');
  }

  const overview = await stock('stock:overview', {});
  if (overview.ingredients.length === 0) throw new Error('a manager cannot read stock');
});

/* ---------------------------- 7. soft delete ------------------------------ */

await runner.check('an unused ingredient can be removed and disappears from the list', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  const spare = await stock('stock:ingredient-save', {
    name: 'Test garnish',
    category: 'Vegetables',
    baseUnit: 'g',
    purchaseUnit: 'kg',
    unitsPerPurchase: 1000,
    reorderLevel: 0,
    supplierId: null,
    active: true,
  });

  await stock('stock:ingredient-delete', { id: spare.id });

  const list = await stock('stock:ingredients', {});
  if (list.some((ingredient) => ingredient.id === spare.id)) {
    throw new Error('the removed ingredient is still listed');
  }

  // Soft delete: the row itself survives, so old stock history stays readable.
  const row = harness.db.prepare('SELECT active FROM ingredients WHERE id = ?').get(spare.id);
  if (!row) throw new Error('the row was hard-deleted');
  if (row.active !== 0) throw new Error('the row was not marked inactive');
});

harness.cleanup();
runner.finish();
