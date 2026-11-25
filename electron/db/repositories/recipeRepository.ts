import type { AppDatabase } from '../connection';
import type { BaseUnit } from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';

interface RecipeRow {
  id: number;
  item_id: number;
  ingredient_id: number;
  ingredient_name: string;
  base_unit: BaseUnit;
  qty_base: number;
  waste_percent_x100: number;
  avg_cost_milli: number;
  active: number;
}

/**
 * Recipes (Roadmap 4.C).
 *
 * The cost of a line is computed with the ingredient's CURRENT average cost every
 * time it is read, because a recipe's price tag is a live question ("what does it
 * cost me to make this today?"). Orders do not use this: a sale stores its own
 * cost snapshot (4.D) so old bills never change.
 */
export function createRecipeRepository(db: AppDatabase) {
  const selectLines = db.prepare<[number], RecipeRow>(`
    SELECT r.id, r.item_id, r.ingredient_id, i.name AS ingredient_name, i.base_unit,
           r.qty_base, r.waste_percent_x100, i.avg_cost_milli, i.active
      FROM recipe_items r
      JOIN ingredients i ON i.id = r.ingredient_id
     WHERE r.item_id = ?
     ORDER BY i.name COLLATE NOCASE
  `);

  const selectAllLines = db.prepare<[], RecipeRow>(`
    SELECT r.id, r.item_id, r.ingredient_id, i.name AS ingredient_name, i.base_unit,
           r.qty_base, r.waste_percent_x100, i.avg_cost_milli, i.active
      FROM recipe_items r
      JOIN ingredients i ON i.id = r.ingredient_id
     ORDER BY r.item_id, i.name COLLATE NOCASE
  `);

  const insertLine = db.prepare(`
    INSERT INTO recipe_items
      (item_id, ingredient_id, qty_base, waste_percent_x100, created_at, updated_at)
    VALUES (@itemId, @ingredientId, @qtyBase, @wastePercentX100, @now, @now)
  `);

  const deleteLinesForItem = db.prepare('DELETE FROM recipe_items WHERE item_id = ?');

  const countRecipes = db.prepare<[], { total: number }>(
    'SELECT COUNT(DISTINCT item_id) AS total FROM recipe_items',
  );

  const selectSettings = db.prepare<[string], { value: string }>(
    'SELECT value FROM settings WHERE key = ?',
  );

  return {
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    linesFor(itemId: number): RecipeRow[] {
      return selectLines.all(itemId);
    },

    allLines(): RecipeRow[] {
      return selectAllLines.all();
    },

    /** Replaces the whole recipe in one go: what the owner sees is what is saved. */
    replaceForItem(
      itemId: number,
      lines: Array<{ ingredientId: number; qtyBase: number; wastePercentX100: number }>,
    ): void {
      const now = toSqlDateTime();
      deleteLinesForItem.run(itemId);
      for (const line of lines) {
        insertLine.run({
          itemId,
          ingredientId: line.ingredientId,
          qtyBase: line.qtyBase,
          wastePercentX100: line.wastePercentX100,
          now,
        });
      }
    },

    countRecipes(): number {
      return countRecipes.get()?.total ?? 0;
    },

    setting(key: string): string | null {
      return selectSettings.get(key)?.value ?? null;
    },
  };
}

export type RecipeRepository = ReturnType<typeof createRecipeRepository>;

/* ------------------------------------------------------------------ */
/* Pure costing arithmetic — exported so the tests can pin the maths.  */
/* ------------------------------------------------------------------ */

/**
 * Cost of one recipe line in paisa.
 *
 * qty × milli-paisa ÷ 1000, rounded ONCE at the end. The waste allowance is NOT
 * part of the cost: it scales what the kitchen takes off the shelf, not what the
 * customer's burger is worth. (Charging trim to the burger would double-count the
 * waste, which 4.E books separately when it happens.)
 */
export function lineCostPaisa(qtyBase: number, unitCostMilli: number): number {
  return Math.round((qtyBase * unitCostMilli) / 1000);
}

/** Stock actually taken off the shelf for one serving, including trim loss. */
export function deductQty(qtyBase: number, wastePercentX100: number): number {
  if (wastePercentX100 <= 0) return qtyBase;
  return Math.ceil((qtyBase * (10_000 + wastePercentX100)) / 10_000);
}

/**
 * Margin as a percentage ×100 of the selling price.
 * 26400 profit on 45000 price = 58.67% → 5867. Null when the price is zero.
 */
export function marginPercentX100(profit: number, price: number): number | null {
  if (price <= 0) return null;
  return Math.round((profit * 10_000) / price);
}

/**
 * Suggested selling price for a target margin: cost ÷ (1 − margin).
 * Rounded UP to the nearest rupee so the shop never lands a paisa under target.
 */
export function suggestedPrice(costTotal: number, targetMarginPercentX100: number): number {
  const margin = Math.min(Math.max(targetMarginPercentX100, 0), 9_900) / 10_000;
  if (margin >= 1) return costTotal;
  const raw = costTotal / (1 - margin);
  return Math.ceil(raw / 100) * 100;
}
