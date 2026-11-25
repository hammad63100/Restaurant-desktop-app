import type { AppDatabase } from '../connection';
import type {
  BaseUnit,
  WastageReason,
  Ingredient,
  IngredientDetail,
  IngredientInput,
  Purchase,
  PurchaseLine,
  StockMovement,
  StockMovementKind,
  Supplier,
  SupplierInput,
} from '../../../src/types/api';
import { toSqlDate, toSqlDateTime } from '../../utils/datetime';

/* ------------------------------------------------------------------ */
/* Row shapes (SQLite snake_case)                                      */
/* ------------------------------------------------------------------ */

interface SupplierRow {
  id: number;
  name: string;
  phone: string;
  address: string;
  notes: string;
  active: number;
}

interface IngredientRow {
  id: number;
  name: string;
  category: string;
  base_unit: BaseUnit;
  purchase_unit: string;
  units_per_purchase: number;
  reorder_level: number;
  qty_on_hand: number;
  avg_cost_milli: number;
  last_cost_milli: number;
  supplier_id: number | null;
  supplier_name: string | null;
  active: number;
  used_in_recipes: number;
  batch_yield_base: number;
}

interface PurchaseRow {
  id: number;
  purchase_no: string;
  supplier_id: number | null;
  supplier_name: string | null;
  bill_no: string;
  purchased_on: string;
  subtotal: number;
  extra_charges: number;
  total: number;
  paid_amount: number;
  payment_method: Purchase['paymentMethod'];
  status: Purchase['status'];
  void_reason: string;
  voided_at: string | null;
  notes: string;
  created_by_name: string;
  created_at: string;
}

interface PurchaseLineRow {
  id: number;
  purchase_id: number;
  ingredient_id: number;
  ingredient_name: string;
  base_unit: BaseUnit;
  qty_purchase_milli: number;
  qty_base: number;
  unit_price: number;
  landed_cost_milli: number;
  line_total: number;
}

interface MovementRow {
  id: number;
  ingredient_id: number;
  kind: StockMovementKind;
  qty: number;
  unit_cost_milli: number;
  reason: string;
  ref_purchase_id: number | null;
  wastage_reason?: string | null;
  ref_order_id: number | null;
  created_by_name: string;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Value of stock in paisa: qty (base units) × milli-paisa per unit ÷ 1000.
 * Rounded once, here, so no caller can forget the milli step.
 */
export function stockValuePaisa(qtyBase: number, unitCostMilli: number): number {
  return Math.round((qtyBase * unitCostMilli) / 1000);
}

/**
 * Moving weighted average after adding `inQty` at `inCost`.
 *
 * The standard formula, with one guard: when the resulting denominator is not
 * positive (negative stock is allowed in this app), the old average is kept
 * rather than dividing by zero or flipping the sign of the cost.
 */
export function nextAverageCost(input: {
  oldQty: number;
  oldAvgMilli: number;
  inQty: number;
  inCostMilli: number;
}): number {
  const denominator = input.oldQty + input.inQty;
  if (denominator <= 0) return input.oldAvgMilli;
  return Math.round(
    (input.oldQty * input.oldAvgMilli + input.inQty * input.inCostMilli) / denominator,
  );
}

const toSupplier = (row: SupplierRow & { balance: number }): Supplier => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  address: row.address,
  notes: row.notes,
  active: row.active === 1,
  balance: row.balance,
});

const toIngredient = (row: IngredientRow): Ingredient => ({
  id: row.id,
  name: row.name,
  category: row.category,
  baseUnit: row.base_unit,
  purchaseUnit: row.purchase_unit,
  unitsPerPurchase: row.units_per_purchase,
  reorderLevel: row.reorder_level,
  qtyOnHand: row.qty_on_hand,
  avgCostMilli: row.avg_cost_milli,
  lastCostMilli: row.last_cost_milli,
  supplierId: row.supplier_id,
  supplierName: row.supplier_name,
  active: row.active === 1,
  stockValue: stockValuePaisa(row.qty_on_hand, row.avg_cost_milli),
  lowStock: row.qty_on_hand <= row.reorder_level,
  usedInRecipes: row.used_in_recipes,
  batchYieldBase: row.batch_yield_base,
});

const toPurchaseLine = (row: PurchaseLineRow): PurchaseLine => ({
  id: row.id,
  purchaseId: row.purchase_id,
  ingredientId: row.ingredient_id,
  ingredientName: row.ingredient_name,
  baseUnit: row.base_unit,
  qtyPurchaseMilli: row.qty_purchase_milli,
  qtyBase: row.qty_base,
  unitPrice: row.unit_price,
  landedCostMilli: row.landed_cost_milli,
  lineTotal: row.line_total,
});

const toMovement = (row: MovementRow): StockMovement => ({
  id: row.id,
  ingredientId: row.ingredient_id,
  kind: row.kind,
  qty: row.qty,
  unitCostMilli: row.unit_cost_milli,
  value: stockValuePaisa(row.qty, row.unit_cost_milli),
  reason: row.reason,
  refPurchaseId: row.ref_purchase_id,
  refOrderId: row.ref_order_id,
  wastageReason: (row.wastage_reason as WastageReason | null | undefined) ?? null,
  createdByName: row.created_by_name,
  createdAt: row.created_at,
});

const toPurchase = (row: PurchaseRow): Omit<Purchase, 'lines'> => ({
  id: row.id,
  purchaseNo: row.purchase_no,
  supplierId: row.supplier_id,
  supplierName: row.supplier_name,
  billNo: row.bill_no,
  purchasedOn: row.purchased_on,
  subtotal: row.subtotal,
  extraCharges: row.extra_charges,
  total: row.total,
  paidAmount: row.paid_amount,
  paymentMethod: row.payment_method,
  status: row.status,
  voidReason: row.void_reason,
  voidedAt: row.voided_at,
  notes: row.notes,
  createdByName: row.created_by_name,
  createdAt: row.created_at,
});

/**
 * The repository is built once at boot, but later migrations add the purchases
 * and recipes tables. Each build is paired with its own migration anyway; the
 * guards exist so a database at 015 still opens and works (the Stock page must
 * not crash because a later phase has not shipped yet).
 */
function tableExists(db: AppDatabase, name: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { total: number };
  return row.total > 0;
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export function createInventoryRepository(db: AppDatabase) {
  const hasRecipes = tableExists(db, 'recipe_items');
  // 023 adds the column. A database that has not run it yet reads 0 (bought).
  const hasBatchYield = Boolean(
    db.prepare("SELECT 1 FROM pragma_table_info('ingredients') WHERE name = 'batch_yield_base'").get(),
  );
  const hasPurchases = tableExists(db, 'purchases');

  /** Credit balance per supplier, or 0 while the purchases table does not exist. */
  const balanceSql = hasPurchases
    ? `COALESCE((
         SELECT SUM(p.total - p.paid_amount)
           FROM purchases p
          WHERE p.supplier_id = s.id AND p.status = 'posted'
       ), 0)`
    : '0';

  const INGREDIENT_SELECT = `
    SELECT i.id, i.name, i.category, i.base_unit, i.purchase_unit, i.units_per_purchase,
           i.reorder_level, i.qty_on_hand, i.avg_cost_milli, i.last_cost_milli,
           i.supplier_id, s.name AS supplier_name, i.active,
           ${hasBatchYield ? 'i.batch_yield_base' : '0'} AS batch_yield_base,
           ${
             hasRecipes
               ? '(SELECT COUNT(DISTINCT r.item_id) FROM recipe_items r WHERE r.ingredient_id = i.id)'
               : '0'
           } AS used_in_recipes
      FROM ingredients i
      LEFT JOIN suppliers s ON s.id = i.supplier_id
  `;

  /* ------------------------------ suppliers ------------------------------ */

  const selectSuppliers = db.prepare<[], SupplierRow & { balance: number }>(`
    SELECT s.id, s.name, s.phone, s.address, s.notes, s.active, ${balanceSql} AS balance
      FROM suppliers s
     ORDER BY s.active DESC, s.name COLLATE NOCASE
  `);
  const selectSupplier = db.prepare<[number], SupplierRow & { balance: number }>(`
    SELECT s.id, s.name, s.phone, s.address, s.notes, s.active, ${balanceSql} AS balance
      FROM suppliers s
     WHERE s.id = ?
  `);
  const insertSupplier = db.prepare(`
    INSERT INTO suppliers (name, phone, address, notes, active, created_at, updated_at)
    VALUES (@name, @phone, @address, @notes, 1, @now, @now)
  `);
  const updateSupplierStmt = db.prepare(`
    UPDATE suppliers
       SET name = @name, phone = @phone, address = @address, notes = @notes,
           active = @active, updated_at = @now
     WHERE id = @id
  `);
  const deactivateSupplierStmt = db.prepare(
    'UPDATE suppliers SET active = 0, updated_at = ? WHERE id = ?',
  );
  const countIngredientsForSupplier = db.prepare<[number], { total: number }>(
    'SELECT COUNT(*) AS total FROM ingredients WHERE supplier_id = ? AND active = 1',
  );

  /* ----------------------------- ingredients ----------------------------- */

  const selectIngredients = db.prepare<[], IngredientRow>(
    `${INGREDIENT_SELECT} WHERE i.active = 1 ORDER BY i.category, i.name COLLATE NOCASE`,
  );
  const selectAllIngredients = db.prepare<[], IngredientRow>(
    `${INGREDIENT_SELECT} ORDER BY i.active DESC, i.category, i.name COLLATE NOCASE`,
  );
  const selectIngredient = db.prepare<[number], IngredientRow>(
    `${INGREDIENT_SELECT} WHERE i.id = ?`,
  );
  const selectIngredientByName = db.prepare<[string], IngredientRow>(
    `${INGREDIENT_SELECT} WHERE i.name = ? COLLATE NOCASE LIMIT 1`,
  );
  const insertIngredientStmt = db.prepare(`
    INSERT INTO ingredients
      (name, category, base_unit, purchase_unit, units_per_purchase, reorder_level,
       supplier_id, active, created_at, updated_at)
    VALUES
      (@name, @category, @baseUnit, @purchaseUnit, @unitsPerPurchase, @reorderLevel,
       @supplierId, 1, @now, @now)
  `);
  const updateIngredientStmt = db.prepare(`
    UPDATE ingredients
       SET name = @name, category = @category, base_unit = @baseUnit,
           purchase_unit = @purchaseUnit, units_per_purchase = @unitsPerPurchase,
           reorder_level = @reorderLevel, supplier_id = @supplierId,
           updated_at = @now
     WHERE id = @id
  `);
  const deactivateIngredientStmt = db.prepare(
    'UPDATE ingredients SET active = 0, updated_at = ? WHERE id = ?',
  );
  const applyMovementTotals = db.prepare(`
    UPDATE ingredients
       SET qty_on_hand = qty_on_hand + @qty,
           avg_cost_milli = @avgCostMilli,
           last_cost_milli = @lastCostMilli,
           updated_at = @now
     WHERE id = @id
  `);
  const setIngredientTotalsStmt = db.prepare(`
    UPDATE ingredients
       SET qty_on_hand = @qtyOnHand, avg_cost_milli = @avgCostMilli,
           last_cost_milli = @lastCostMilli, updated_at = @now
     WHERE id = @id
  `);

  /* ------------------------------ purchases ------------------------------ */

  const PURCHASE_SELECT = `
    SELECT p.id, p.purchase_no, p.supplier_id, s.name AS supplier_name, p.bill_no,
           p.purchased_on, p.subtotal, p.extra_charges, p.total, p.paid_amount,
           p.payment_method, p.status, p.void_reason, p.voided_at, p.notes,
           u.full_name AS created_by_name, p.created_at
      FROM purchases p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      JOIN users u ON u.id = p.created_by
  `;

  const selectPurchases = hasPurchases
    ? db.prepare<[string, string, number], PurchaseRow>(`
        ${PURCHASE_SELECT}
        WHERE date(p.purchased_on) BETWEEN ? AND ?
        ORDER BY p.purchased_on DESC, p.id DESC
        LIMIT ?
      `)
    : null;
  const selectPurchase = hasPurchases
    ? db.prepare<[number], PurchaseRow>(`${PURCHASE_SELECT} WHERE p.id = ?`)
    : null;
  const selectPurchaseLines = hasPurchases
    ? db.prepare<[number], PurchaseLineRow>(`
        SELECT pl.id, pl.purchase_id, pl.ingredient_id, i.name AS ingredient_name,
               i.base_unit, pl.qty_purchase_milli, pl.qty_base, pl.unit_price,
               pl.landed_cost_milli, pl.line_total
          FROM purchase_items pl
          JOIN ingredients i ON i.id = pl.ingredient_id
         WHERE pl.purchase_id = ?
         ORDER BY pl.id
      `)
    : null;
  const insertPurchaseStmt = hasPurchases
    ? db.prepare(`
        INSERT INTO purchases
          (purchase_no, supplier_id, bill_no, purchased_on, subtotal, extra_charges, total,
           paid_amount, payment_method, status, notes, created_by, created_at)
        VALUES
          (@purchaseNo, @supplierId, @billNo, @purchasedOn, @subtotal, @extraCharges, @total,
           @paidAmount, @paymentMethod, 'posted', @notes, @createdBy, @now)
      `)
    : null;
  const insertPurchaseItem = hasPurchases
    ? db.prepare(`
        INSERT INTO purchase_items
          (purchase_id, ingredient_id, qty_purchase_milli, qty_base, unit_price,
           landed_cost_milli, line_total)
        VALUES
          (@purchaseId, @ingredientId, @qtyPurchaseMilli, @qtyBase, @unitPrice,
           @landedCostMilli, @lineTotal)
      `)
    : null;
  const markPurchaseVoidStmt = hasPurchases
    ? db.prepare(`
        UPDATE purchases
           SET status = 'void', void_reason = @reason, voided_at = @now, voided_by = @userId
         WHERE id = @id
      `)
    : null;
  const nextPurchaseNumber = hasPurchases
    ? db.prepare<[], { next: number }>(
        "SELECT COALESCE(MAX(CAST(SUBSTR(purchase_no, 5) AS INTEGER)), 0) + 1 AS next FROM purchases WHERE purchase_no LIKE 'PUR-%'",
      )
    : null;
  const selectPriceHistory = hasPurchases
    ? db.prepare<
        [number],
        {
          purchased_on: string;
          supplier_name: string | null;
          purchase_no: string;
          qty_purchase_milli: number;
          purchase_unit: string;
          unit_price: number;
          landed_cost_milli: number;
        }
      >(`
        SELECT p.purchased_on, s.name AS supplier_name, p.purchase_no,
               pl.qty_purchase_milli, i.purchase_unit, pl.unit_price, pl.landed_cost_milli
          FROM purchase_items pl
          JOIN purchases p ON p.id = pl.purchase_id
          JOIN ingredients i ON i.id = pl.ingredient_id
          LEFT JOIN suppliers s ON s.id = p.supplier_id
         WHERE pl.ingredient_id = ? AND p.status = 'posted'
         ORDER BY p.purchased_on DESC, p.id DESC
         LIMIT 30
      `)
    : null;

  /* --------------------------- stock movements --------------------------- */

  /**
   * `ref_batch_id` only exists after 023. On an older database the column is left
   * out rather than prepared against a table that does not have it — the sub-recipe
   * kinds are unreachable there anyway.
   */
  const hasBatchRef = Boolean(
    db
      .prepare("SELECT 1 FROM pragma_table_info('stock_movements') WHERE name = 'ref_batch_id'")
      .get(),
  );
  const insertMovement = db.prepare(
    hasBatchRef
      ? `INSERT INTO stock_movements
           (ingredient_id, kind, qty, unit_cost_milli, reason, ref_purchase_id,
            ref_order_id, ref_order_item_id, ref_batch_id, wastage_reason, created_by,
            created_at)
         VALUES
           (@ingredientId, @kind, @qty, @unitCostMilli, @reason, @refPurchaseId,
            @refOrderId, @refOrderItemId, @refBatchId, @wastageReason, @createdBy, @now)`
      : `INSERT INTO stock_movements
           (ingredient_id, kind, qty, unit_cost_milli, reason, ref_purchase_id,
            ref_order_id, ref_order_item_id, wastage_reason, created_by, created_at)
         VALUES
           (@ingredientId, @kind, @qty, @unitCostMilli, @reason, @refPurchaseId,
            @refOrderId, @refOrderItemId, @wastageReason, @createdBy, @now)`,
  );
  const selectMovements = db.prepare<[number, number], MovementRow>(`
    SELECT m.id, m.ingredient_id, m.kind, m.qty, m.unit_cost_milli, m.reason,
           m.ref_purchase_id, m.ref_order_id, m.wastage_reason,
           u.full_name AS created_by_name, m.created_at
      FROM stock_movements m
      JOIN users u ON u.id = m.created_by
     WHERE m.ingredient_id = ?
     ORDER BY m.id DESC
     LIMIT ?
  `);

  const sumStockValue = db.prepare<[], { value: number }>(`
    SELECT COALESCE(SUM(CAST(ROUND(qty_on_hand * avg_cost_milli / 1000.0) AS INTEGER)), 0) AS value
      FROM ingredients
     WHERE active = 1 AND qty_on_hand > 0
  `);
  const countLowStock = db.prepare<[], { total: number }>(
    'SELECT COUNT(*) AS total FROM ingredients WHERE active = 1 AND qty_on_hand <= reorder_level',
  );
  const countOutOfStock = db.prepare<[], { total: number }>(
    'SELECT COUNT(*) AS total FROM ingredients WHERE active = 1 AND qty_on_hand <= 0',
  );

  const selectUsedInItems = hasRecipes
    ? db.prepare<[number], { item_id: number; item_name: string; qty_base: number }>(`
        SELECT r.item_id, it.name AS item_name, r.qty_base
          FROM recipe_items r
          JOIN items it ON it.id = r.item_id
         WHERE r.ingredient_id = ?
         ORDER BY it.name COLLATE NOCASE
      `)
    : null;

  function requirePurchases(): void {
    if (!hasPurchases) {
      throw new Error('The purchases tables are not installed (migration 016 is missing).');
    }
  }

  return {
    /** One transaction for multi-step writes (purchase + movements, void). */
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    /* ----------------------------- suppliers ----------------------------- */

    listSuppliers(): Supplier[] {
      return selectSuppliers.all().map(toSupplier);
    },

    findSupplier(id: number): Supplier | null {
      const row = selectSupplier.get(id);
      return row ? toSupplier(row) : null;
    },

    createSupplier(input: SupplierInput): number {
      const result = insertSupplier.run({
        name: input.name.trim(),
        phone: input.phone,
        address: input.address,
        notes: input.notes,
        now: toSqlDateTime(),
      });
      return Number(result.lastInsertRowid);
    },

    updateSupplier(input: SupplierInput & { id: number }): void {
      updateSupplierStmt.run({
        id: input.id,
        name: input.name.trim(),
        phone: input.phone,
        address: input.address,
        notes: input.notes,
        active: input.active ? 1 : 0,
        now: toSqlDateTime(),
      });
    },

    deactivateSupplier(id: number): void {
      deactivateSupplierStmt.run(toSqlDateTime(), id);
    },

    countIngredientsForSupplier(supplierId: number): number {
      return countIngredientsForSupplier.get(supplierId)?.total ?? 0;
    },

    /* ---------------------------- ingredients ---------------------------- */

    listIngredients(includeInactive = false): Ingredient[] {
      return (includeInactive ? selectAllIngredients : selectIngredients)
        .all()
        .map(toIngredient);
    },

    findIngredient(id: number): Ingredient | null {
      const row = selectIngredient.get(id);
      return row ? toIngredient(row) : null;
    },

    findIngredientByName(name: string): Ingredient | null {
      const row = selectIngredientByName.get(name.trim());
      return row ? toIngredient(row) : null;
    },

    createIngredient(input: IngredientInput): number {
      const result = insertIngredientStmt.run({
        name: input.name.trim(),
        category: input.category.trim() || 'Other',
        baseUnit: input.baseUnit,
        purchaseUnit: input.purchaseUnit.trim() || input.baseUnit,
        unitsPerPurchase: input.unitsPerPurchase,
        reorderLevel: input.reorderLevel,
        supplierId: input.supplierId,
        now: toSqlDateTime(),
      });
      return Number(result.lastInsertRowid);
    },

    updateIngredient(input: IngredientInput & { id: number }): void {
      updateIngredientStmt.run({
        id: input.id,
        name: input.name.trim(),
        category: input.category.trim() || 'Other',
        baseUnit: input.baseUnit,
        purchaseUnit: input.purchaseUnit.trim() || input.baseUnit,
        unitsPerPurchase: input.unitsPerPurchase,
        reorderLevel: input.reorderLevel,
        supplierId: input.supplierId,
        now: toSqlDateTime(),
      });
    },

    deactivateIngredient(id: number): void {
      deactivateIngredientStmt.run(toSqlDateTime(), id);
    },

    /**
     * Writes one ledger row and updates the cached totals, in the caller's
     * transaction.
     *
     * `opening` and `purchase` add value, so the weighted average moves.
     * Every other kind changes quantity only: stock leaves (or returns) at the
     * current average, which is standard moving-average behaviour and means a
     * wastage or a sale never rewrites the cost of what is still on the shelf.
     */
    applyMovement(input: {
      ingredientId: number;
      kind: StockMovementKind;
      /** Signed: positive adds stock, negative removes it. */
      qty: number;
      unitCostMilli: number;
      reason: string;
      refPurchaseId?: number | null;
      refOrderId?: number | null;
      refOrderItemId?: number | null;
      /** Only for the sub-recipe kinds: which batch consumed or produced it (4.I). */
      refBatchId?: number | null;
      /** Only for kind 'wastage': why the stock was lost (4.F). */
      wastageReason?: string | null;
      createdBy: number;
    }): void {
      const row = selectIngredient.get(input.ingredientId);
      if (!row) throw new Error(`Ingredient ${input.ingredientId} does not exist`);

      /*
       * Which movements change the AVERAGE cost, not just the quantity.
       *
       * A made batch is a purchase by another name: value genuinely arrives on the
       * shelf at a cost the kitchen computed (4.I). Without it here, house-made mayo
       * would sit at a zero average and every burger using it would look free.
       * Everything else — a sale, wastage, an adjustment — leaves the average alone,
       * because it moves quantity at a price the shelf already carries.
       */
      const addsValue =
        input.kind === 'opening' ||
        input.kind === 'purchase' ||
        input.kind === 'sub_recipe_make';
      const newAvg = addsValue
        ? nextAverageCost({
            oldQty: row.qty_on_hand,
            oldAvgMilli: row.avg_cost_milli,
            inQty: input.qty,
            inCostMilli: input.unitCostMilli,
          })
        : row.avg_cost_milli;
      const newLast =
        input.kind === 'purchase' ? input.unitCostMilli : row.last_cost_milli;

      // Reversing an opening entry (a stock count correction) must not leave a
      // last price behind that was never bought.
      const now = toSqlDateTime();

      insertMovement.run({
        ingredientId: input.ingredientId,
        kind: input.kind,
        qty: input.qty,
        unitCostMilli: input.unitCostMilli,
        reason: input.reason,
        refPurchaseId: input.refPurchaseId ?? null,
        refOrderId: input.refOrderId ?? null,
        refOrderItemId: input.refOrderItemId ?? null,
        refBatchId: input.refBatchId ?? null,
        wastageReason: input.wastageReason ?? null,
        createdBy: input.createdBy,
        now,
      });

      applyMovementTotals.run({
        id: input.ingredientId,
        qty: input.qty,
        avgCostMilli: newAvg,
        lastCostMilli: newLast,
        now,
      });
    },

    /** Sets qty/cost directly. Only for a service that has already written movements. */
    setIngredientTotals(input: {
      id: number;
      qtyOnHand: number;
      avgCostMilli: number;
      lastCostMilli?: number;
    }): void {
      const row = selectIngredient.get(input.id);
      if (!row) throw new Error(`Ingredient ${input.id} does not exist`);
      setIngredientTotalsStmt.run({
        id: input.id,
        qtyOnHand: input.qtyOnHand,
        avgCostMilli: input.avgCostMilli,
        lastCostMilli: input.lastCostMilli ?? row.last_cost_milli,
        now: toSqlDateTime(),
      });
    },

    /* ----------------------------- purchases ----------------------------- */

    nextPurchaseNo(): string {
      requirePurchases();
      const next = nextPurchaseNumber?.get()?.next ?? 1;
      return `PUR-${String(next).padStart(5, '0')}`;
    },

    listPurchases(fromDate: string, toDate: string, limit = 100): Purchase[] {
      if (!selectPurchases || !selectPurchaseLines) return [];
      return selectPurchases.all(fromDate, toDate, limit).map((row) => ({
        ...toPurchase(row),
        lines: selectPurchaseLines.all(row.id).map(toPurchaseLine),
      }));
    },

    findPurchase(id: number): Purchase | null {
      if (!selectPurchase || !selectPurchaseLines) return null;
      const row = selectPurchase.get(id);
      if (!row) return null;
      return { ...toPurchase(row), lines: selectPurchaseLines.all(row.id).map(toPurchaseLine) };
    },

    createPurchase(input: {
      purchaseNo: string;
      supplierId: number | null;
      billNo: string;
      purchasedOn: string;
      subtotal: number;
      extraCharges: number;
      total: number;
      paidAmount: number;
      paymentMethod: Purchase['paymentMethod'];
      notes: string;
      createdBy: number;
      lines: Array<{
        ingredientId: number;
        qtyPurchaseMilli: number;
        qtyBase: number;
        unitPrice: number;
        landedCostMilli: number;
        lineTotal: number;
      }>;
    }): number {
      requirePurchases();
      if (!insertPurchaseStmt || !insertPurchaseItem) {
        throw new Error('Purchases are not available in this build.');
      }

      const result = insertPurchaseStmt.run({
        purchaseNo: input.purchaseNo,
        supplierId: input.supplierId,
        billNo: input.billNo,
        purchasedOn: input.purchasedOn || toSqlDate(),
        subtotal: input.subtotal,
        extraCharges: input.extraCharges,
        total: input.total,
        paidAmount: input.paidAmount,
        paymentMethod: input.paymentMethod,
        notes: input.notes,
        createdBy: input.createdBy,
        now: toSqlDateTime(),
      });

      const purchaseId = Number(result.lastInsertRowid);
      for (const line of input.lines) insertPurchaseItem.run({ purchaseId, ...line });
      return purchaseId;
    },

    markPurchaseVoid(id: number, reason: string, userId: number): void {
      requirePurchases();
      markPurchaseVoidStmt?.run({ id, reason, now: toSqlDateTime(), userId });
    },

    /* --------------------------- movements/report ------------------------ */

    movementsFor(ingredientId: number, limit = 100): StockMovement[] {
      return selectMovements.all(ingredientId, limit).map(toMovement);
    },

    stockValueTotal(): number {
      return sumStockValue.get()?.value ?? 0;
    },

    lowStockCount(): number {
      return countLowStock.get()?.total ?? 0;
    },

    outOfStockCount(): number {
      return countOutOfStock.get()?.total ?? 0;
    },

    priceHistory(ingredientId: number): IngredientDetail['priceHistory'] {
      if (!selectPriceHistory) return [];
      return selectPriceHistory.all(ingredientId).map((row) => ({
        purchasedOn: row.purchased_on,
        supplierName: row.supplier_name,
        purchaseNo: row.purchase_no,
        qtyPurchaseMilli: row.qty_purchase_milli,
        purchaseUnit: row.purchase_unit,
        unitPrice: row.unit_price,
        landedCostMilli: row.landed_cost_milli,
      }));
    },

    /**
     * Purchases in a period for the report tab (4.G).
     *
     * Voided bills are counted but excluded from the money, so a cancelled delivery
     * never shows as stock the shop paid for. `outstanding` is what is still owed,
     * which the owner needs before paying a supplier.
     */
    purchaseReportRows(fromDate: string, toDate: string) {
      if (!selectPurchases) return { rows: [], voidedCount: 0, voidedValue: 0 };

      const rows = db
        .prepare(
          `SELECT p.id, p.purchase_no, p.purchased_on, s.name AS supplier_name,
                  p.bill_no, p.subtotal, p.extra_charges, p.total, p.paid_amount,
                  p.payment_method, p.status,
                  (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id)
                    AS line_count
             FROM purchases p
             LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE date(p.purchased_on) BETWEEN ? AND ?
            ORDER BY p.purchased_on DESC, p.id DESC
            LIMIT 500`,
        )
        .all(fromDate, toDate) as Array<{
        id: number;
        purchase_no: string;
        purchased_on: string;
        supplier_name: string | null;
        bill_no: string;
        subtotal: number;
        extra_charges: number;
        total: number;
        paid_amount: number;
        payment_method: Purchase['paymentMethod'];
        status: Purchase['status'];
        line_count: number;
      }>;

      const voided = rows.filter((row) => row.status === 'void');

      return {
        rows: rows.map((row) => ({
          purchaseId: row.id,
          purchaseNo: row.purchase_no,
          purchasedOn: row.purchased_on,
          supplierName: row.supplier_name,
          billNo: row.bill_no,
          subtotal: row.subtotal,
          extraCharges: row.extra_charges,
          total: row.total,
          paidAmount: row.paid_amount,
          // A cash bill is settled at the counter; only credit can be owed.
          outstanding:
            row.status === 'void' || row.payment_method !== 'credit'
              ? 0
              : Math.max(0, row.total - row.paid_amount),
          paymentMethod: row.payment_method,
          status: row.status,
          lineCount: row.line_count,
        })),
        voidedCount: voided.length,
        voidedValue: voided.reduce((total, row) => total + row.total, 0),
      };
    },

    /**
     * Purchases grouped by ingredient, with the first and last price paid (4.G).
     *
     * `firstCost`/`lastCost` are what makes a price trend readable: a supplier who
     * has crept from Rs 690 to Rs 750 a kilo over three months shows up as a
     * percentage, which is the figure that actually prompts a phone call.
     * Voided bills are excluded — a delivery that was sent back did not set a price.
     */
    purchasesByIngredient(fromDate: string, toDate: string) {
      return db
        .prepare(
          `SELECT i.id AS ingredientId,
                  i.name AS name,
                  i.base_unit AS baseUnit,
                  COUNT(DISTINCT p.id) AS purchaseCount,
                  COALESCE(SUM(pi.qty_base), 0) AS qtyBase,
                  COALESCE(SUM(pi.line_total), 0) AS spend,
                  MIN(pi.landed_cost_milli) AS minCostMilli,
                  MAX(pi.landed_cost_milli) AS maxCostMilli,
                  (
                    SELECT first_price.landed_cost_milli
                      FROM purchase_items first_price
                      JOIN purchases first_bill ON first_bill.id = first_price.purchase_id
                     WHERE first_price.ingredient_id = i.id
                       AND first_bill.status = 'posted'
                       AND date(first_bill.purchased_on) BETWEEN ? AND ?
                     ORDER BY first_bill.purchased_on ASC, first_price.id ASC
                     LIMIT 1
                  ) AS firstCostMilli,
                  (
                    SELECT last_price.landed_cost_milli
                      FROM purchase_items last_price
                      JOIN purchases last_bill ON last_bill.id = last_price.purchase_id
                     WHERE last_price.ingredient_id = i.id
                       AND last_bill.status = 'posted'
                       AND date(last_bill.purchased_on) BETWEEN ? AND ?
                     ORDER BY last_bill.purchased_on DESC, last_price.id DESC
                     LIMIT 1
                  ) AS lastCostMilli
             FROM purchase_items pi
             JOIN purchases p ON p.id = pi.purchase_id
             JOIN ingredients i ON i.id = pi.ingredient_id
            WHERE p.status = 'posted' AND date(p.purchased_on) BETWEEN ? AND ?
            GROUP BY i.id
            ORDER BY spend DESC`,
        )
        .all(fromDate, toDate, fromDate, toDate, fromDate, toDate) as Array<{
        ingredientId: number;
        name: string;
        baseUnit: Ingredient['baseUnit'];
        purchaseCount: number;
        qtyBase: number;
        spend: number;
        minCostMilli: number;
        maxCostMilli: number;
        firstCostMilli: number | null;
        lastCostMilli: number | null;
      }>;
    },

    /**
     * Ingredients whose average cost rose over the last 30 days (4.G).
     *
     * Compares the newest landed cost of a posted purchase with the average the
     * shelf is carrying. A price rise is the warning the owner asked for: it means
     * every recipe using that ingredient is quietly earning less.
     */
    priceRises(sinceDate: string, limit = 10) {
      return db
        .prepare(
          `SELECT i.id AS ingredientId, i.name AS name, i.base_unit AS baseUnit,
                  i.avg_cost_milli AS oldCostMilli,
                  MAX(pi.landed_cost_milli) AS newCostMilli
             FROM ingredients i
             JOIN purchase_items pi ON pi.ingredient_id = i.id
             JOIN purchases p ON p.id = pi.purchase_id
            WHERE p.status = 'posted' AND i.active = 1
              AND date(p.purchased_on) >= ?
              AND pi.landed_cost_milli > i.avg_cost_milli
            GROUP BY i.id
            ORDER BY (MAX(pi.landed_cost_milli) - i.avg_cost_milli) * 1.0
                     / MAX(i.avg_cost_milli, 1) DESC
            LIMIT ?`,
        )
        .all(sinceDate, limit) as Array<{
        ingredientId: number;
        name: string;
        baseUnit: Ingredient['baseUnit'];
        oldCostMilli: number;
        newCostMilli: number;
      }>;
    },

    usedInItems(ingredientId: number): IngredientDetail['usedInItems'] {
      if (!selectUsedInItems) return [];
      return selectUsedInItems.all(ingredientId).map((row) => ({
        itemId: row.item_id,
        itemName: row.item_name,
        qtyBase: row.qty_base,
      }));
    },
  };
}

export type InventoryRepository = ReturnType<typeof createInventoryRepository>;
