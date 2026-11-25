import type { AppDatabase } from '../connection';
import type { BaseUnit } from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';

export interface BatchRecipeLineRow {
  id: number;
  ingredient_id: number;
  component_id: number;
  component_name: string;
  base_unit: BaseUnit;
  qty_base: number;
  waste_percent_x100: number;
  avg_cost_milli: number;
  qty_on_hand: number;
  active: number;
  /** True when the component is itself made, not bought. */
  is_made: number;
}

export interface BatchRow {
  id: number;
  batch_no: string;
  ingredient_id: number;
  ingredient_name: string;
  base_unit: BaseUnit;
  qty_base: number;
  total_cost: number;
  unit_cost_milli: number;
  made_on: string;
  notes: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

export interface BatchLineRow {
  id: number;
  batch_id: number;
  component_id: number;
  component_name: string;
  base_unit: BaseUnit;
  qty_base: number;
  unit_cost_milli: number;
  cost: number;
}

/**
 * Sub-recipes (Roadmap 4.I) — ingredients the kitchen makes from other ingredients.
 *
 * Two things live here: the *batch recipe* (what goes into one batch, and how much
 * one batch yields) and the *batches actually made* (a stock document, like a
 * purchase). The cost of a made ingredient is never typed — it is Σ(component cost)
 * ÷ yield, computed from live average costs when read and frozen onto the batch
 * when made.
 *
 * Guarded like the rest of 4.x: on a database that has not run 023, `isReady` is
 * false and the reads come back empty rather than crashing.
 */
export function createSubRecipeRepository(db: AppDatabase) {
  const hasTable = (name: string): boolean =>
    Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
    );

  const ready =
    hasTable('ingredient_recipe_items') &&
    hasTable('sub_recipe_batches') &&
    hasTable('sub_recipe_batch_lines') &&
    Boolean(
      db
        .prepare("SELECT 1 FROM pragma_table_info('ingredients') WHERE name = 'batch_yield_base'")
        .get(),
    );

  const LINE_SELECT = `
    SELECT r.id, r.ingredient_id, r.component_id, c.name AS component_name,
           c.base_unit, r.qty_base, r.waste_percent_x100, c.avg_cost_milli,
           c.qty_on_hand, c.active,
           CASE WHEN c.batch_yield_base > 0 THEN 1 ELSE 0 END AS is_made
      FROM ingredient_recipe_items r
      JOIN ingredients c ON c.id = r.component_id
  `;

  const selectLines = ready
    ? db.prepare<[number], BatchRecipeLineRow>(
        `${LINE_SELECT} WHERE r.ingredient_id = ? ORDER BY c.name COLLATE NOCASE`,
      )
    : null;
  const selectAllLines = ready
    ? db.prepare<[], BatchRecipeLineRow>(`${LINE_SELECT} ORDER BY r.ingredient_id`)
    : null;
  const insertLine = ready
    ? db.prepare(`
        INSERT INTO ingredient_recipe_items
          (ingredient_id, component_id, qty_base, waste_percent_x100, created_at, updated_at)
        VALUES (@ingredientId, @componentId, @qtyBase, @wastePercentX100, @now, @now)
      `)
    : null;
  const deleteLines = ready
    ? db.prepare<[number]>('DELETE FROM ingredient_recipe_items WHERE ingredient_id = ?')
    : null;
  const countMade = ready
    ? db.prepare<[], { total: number }>(`
        SELECT COUNT(*) AS total FROM ingredients
         WHERE batch_yield_base > 0 AND active = 1
      `)
    : null;

  const BATCH_SELECT = `
    SELECT b.id, b.batch_no, b.ingredient_id, i.name AS ingredient_name, i.base_unit,
           b.qty_base, b.total_cost, b.unit_cost_milli, b.made_on, b.notes,
           b.created_by, u.full_name AS created_by_name, b.created_at
      FROM sub_recipe_batches b
      JOIN ingredients i ON i.id = b.ingredient_id
      JOIN users u ON u.id = b.created_by
  `;
  const selectBatches = ready
    ? db.prepare<[number, number], BatchRow>(
        `${BATCH_SELECT} WHERE b.ingredient_id = ? ORDER BY b.made_on DESC, b.id DESC LIMIT ?`,
      )
    : null;
  const selectRecentBatches = ready
    ? db.prepare<[number], BatchRow>(`${BATCH_SELECT} ORDER BY b.id DESC LIMIT ?`)
    : null;
  const selectBatch = ready
    ? db.prepare<[number], BatchRow>(`${BATCH_SELECT} WHERE b.id = ?`)
    : null;
  const selectBatchLines = ready
    ? db.prepare<[number], BatchLineRow>(`
        SELECT l.id, l.batch_id, l.component_id, c.name AS component_name, c.base_unit,
               l.qty_base, l.unit_cost_milli, l.cost
          FROM sub_recipe_batch_lines l
          JOIN ingredients c ON c.id = l.component_id
         WHERE l.batch_id = ?
         ORDER BY c.name COLLATE NOCASE
      `)
    : null;
  const insertBatch = ready
    ? db.prepare(`
        INSERT INTO sub_recipe_batches
          (batch_no, ingredient_id, qty_base, total_cost, unit_cost_milli, made_on,
           notes, created_by, created_at)
        VALUES
          (@batchNo, @ingredientId, @qtyBase, @totalCost, @unitCostMilli, @madeOn,
           @notes, @createdBy, @now)
      `)
    : null;
  const insertBatchLine = ready
    ? db.prepare(`
        INSERT INTO sub_recipe_batch_lines
          (batch_id, component_id, qty_base, unit_cost_milli, cost)
        VALUES (@batchId, @componentId, @qtyBase, @unitCostMilli, @cost)
      `)
    : null;

  const selectIngredientRow = db.prepare<[number], {
    id: number;
    qty_on_hand: number;
    avg_cost_milli: number;
    last_cost_milli: number;
    batch_yield_base: number;
  }>(
    ready
      ? 'SELECT id, qty_on_hand, avg_cost_milli, last_cost_milli, batch_yield_base FROM ingredients WHERE id = ?'
      : 'SELECT id, qty_on_hand, avg_cost_milli, last_cost_milli, 0 AS batch_yield_base FROM ingredients WHERE id = ?',
  );

  const setYield = ready
    ? db.prepare(`
        UPDATE ingredients SET batch_yield_base = @yield, updated_at = @now WHERE id = @id
      `)
    : null;

  return {
    isReady: ready,

    linesFor(ingredientId: number): BatchRecipeLineRow[] {
      return selectLines?.all(ingredientId) ?? [];
    },

    allLines(): BatchRecipeLineRow[] {
      return selectAllLines?.all() ?? [];
    },

    /** Replaces the batch recipe in one go, like 4.C does for a menu item. */
    replaceLines(
      ingredientId: number,
      lines: Array<{ componentId: number; qtyBase: number; wastePercentX100: number }>,
    ): void {
      if (!insertLine || !deleteLines) throw new Error('Sub-recipes are not available');
      const now = toSqlDateTime();
      deleteLines.run(ingredientId);
      for (const line of lines) {
        insertLine.run({
          ingredientId,
          componentId: line.componentId,
          qtyBase: line.qtyBase,
          wastePercentX100: line.wastePercentX100,
          now,
        });
      }
    },

    setYield(ingredientId: number, yieldBase: number): void {
      setYield?.run({ id: ingredientId, yield: yieldBase, now: toSqlDateTime() });
    },

    madeIngredientCount(): number {
      return countMade?.get()?.total ?? 0;
    },

    ingredientTotals(ingredientId: number): {
      qtyOnHand: number;
      avgCostMilli: number;
      lastCostMilli: number;
      batchYieldBase: number;
    } | null {
      const row = selectIngredientRow.get(ingredientId);
      return row
        ? {
            qtyOnHand: row.qty_on_hand,
            avgCostMilli: row.avg_cost_milli,
            lastCostMilli: row.last_cost_milli,
            batchYieldBase: row.batch_yield_base,
          }
        : null;
    },

    nextBatchNo(): string {
      const row = db
        .prepare<[], { last: string | null }>(
          "SELECT batch_no AS last FROM sub_recipe_batches ORDER BY id DESC LIMIT 1",
        )
        .get();
      const lastNumber = row?.last ? Number(row.last.split('-')[1] ?? 0) : 0;
      return `BAT-${String(lastNumber + 1).padStart(5, '0')}`;
    },

    createBatch(input: {
      batchNo: string;
      ingredientId: number;
      qtyBase: number;
      totalCost: number;
      unitCostMilli: number;
      madeOn: string;
      notes: string;
      createdBy: number;
    }): number {
      if (!insertBatch || !insertBatchLine) throw new Error('Sub-recipes are not available');
      const result = insertBatch.run({ ...input, now: toSqlDateTime() });
      return Number(result.lastInsertRowid);
    },

    addBatchLine(input: {
      batchId: number;
      componentId: number;
      qtyBase: number;
      unitCostMilli: number;
      cost: number;
    }): void {
      insertBatchLine?.run(input);
    },

    batchesFor(ingredientId: number, limit = 20): BatchRow[] {
      return selectBatches?.all(ingredientId, limit) ?? [];
    },

    recentBatches(limit = 20): BatchRow[] {
      return selectRecentBatches?.all(limit) ?? [];
    },

    findBatch(id: number): BatchRow | null {
      return selectBatch?.get(id) ?? null;
    },

    linesOfBatch(batchId: number): BatchLineRow[] {
      return selectBatchLines?.all(batchId) ?? [];
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
}

export type SubRecipeRepository = ReturnType<typeof createSubRecipeRepository>;
