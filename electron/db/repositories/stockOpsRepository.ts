import type { AppDatabase } from '../connection';
import type { StockCount, StockCountLine, WastageRow } from '../../../src/types/api';
import { AppError } from '../../utils/errors';

/**
 * The paperwork behind 4.F: stock counts and the wastage report.
 *
 * The ledger itself lives in `stock_movements` (016) and is written through
 * `inventoryRepository.applyMovement`, exactly like a purchase. This repository
 * only stores what a ledger row cannot say on its own:
 *
 *   * a count is a *set* of lines taken at one moment, with book vs counted and the
 *     value of the difference;
 *   * a wastage report needs a reason code and a total, not free text.
 */

interface CountRow {
  id: number;
  count_no: string;
  counted_on: string;
  variance_value: number;
  line_count: number;
  notes: string;
  created_by_name: string;
  created_at: string;
}

interface CountLineRow {
  id: number;
  ingredient_id: number;
  ingredient_name: string;
  base_unit: 'g' | 'ml' | 'pcs';
  book_qty: number;
  counted_qty: number;
  variance: number;
  unit_cost_milli: number;
  variance_value: number;
}

function toCount(row: CountRow): StockCount {
  return {
    id: row.id,
    countNo: row.count_no,
    countedOn: row.counted_on,
    varianceValue: row.variance_value,
    lineCount: row.line_count,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

function toCountLine(row: CountLineRow): StockCountLine {
  return {
    id: row.id,
    ingredientId: row.ingredient_id,
    ingredientName: row.ingredient_name,
    baseUnit: row.base_unit,
    bookQty: row.book_qty,
    countedQty: row.counted_qty,
    variance: row.variance,
    unitCostMilli: row.unit_cost_milli,
    varianceValue: row.variance_value,
  };
}

/** Migration 021 may not have run on an older database; every query checks this. */
function tableExists(db: AppDatabase, name: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { total: number };
  return row.total > 0;
}

export function createStockOpsRepository(db: AppDatabase) {
  const hasCounts = tableExists(db, 'stock_counts');

  const COUNT_SELECT = `
    SELECT c.id, c.count_no, c.counted_on, c.variance_value, c.line_count, c.notes,
           u.full_name AS created_by_name, c.created_at
      FROM stock_counts c
      JOIN users u ON u.id = c.created_by
  `;

  const selectCounts = hasCounts
    ? db.prepare<[number], CountRow>(`${COUNT_SELECT} ORDER BY c.counted_on DESC, c.id DESC LIMIT ?`)
    : null;
  const selectCount = hasCounts
    ? db.prepare<[number], CountRow>(`${COUNT_SELECT} WHERE c.id = ?`)
    : null;
  const selectCountLines = hasCounts
    ? db.prepare<[number], CountLineRow>(`
        SELECT l.id, l.ingredient_id, i.name AS ingredient_name, i.base_unit,
               l.book_qty, l.counted_qty, l.variance, l.unit_cost_milli, l.variance_value
          FROM stock_count_lines l
          JOIN ingredients i ON i.id = l.ingredient_id
         WHERE l.count_id = ?
         ORDER BY ABS(l.variance_value) DESC, i.name
      `)
    : null;

  const insertCount = hasCounts
    ? db.prepare(`
        INSERT INTO stock_counts
          (count_no, counted_on, variance_value, line_count, notes, created_by, created_at)
        VALUES
          (@countNo, @countedOn, @varianceValue, @lineCount, @notes, @createdBy, @now)
      `)
    : null;
  const insertCountLine = hasCounts
    ? db.prepare(`
        INSERT INTO stock_count_lines
          (count_id, ingredient_id, book_qty, counted_qty, variance, unit_cost_milli,
           variance_value)
        VALUES
          (@countId, @ingredientId, @bookQty, @countedQty, @variance, @unitCostMilli,
           @varianceValue)
      `)
    : null;

  const countRows = db.prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM stock_counts');

  /**
   * Wastage by ingredient and reason for a date range.
   *
   * `value` is the money that walked out of the kitchen. The unit cost is the one
   * recorded on the movement, so an old report does not change when prices move.
   */
  const hasWastageReason = (() => {
    const columns = db.prepare("PRAGMA table_info('stock_movements')").all() as Array<{
      name: string;
    }>;
    return columns.some((column) => column.name === 'wastage_reason');
  })();

  const wastageSql = `
    SELECT m.ingredient_id AS ingredientId, i.name AS ingredientName, i.base_unit AS baseUnit,
           ${hasWastageReason ? "COALESCE(m.wastage_reason, 'other')" : "'other'"} AS reason,
           COUNT(*) AS movements,
           COALESCE(SUM(ABS(m.qty)), 0) AS qty,
           COALESCE(SUM(ABS(ROUND(m.qty * m.unit_cost_milli / 1000))), 0) AS value
      FROM stock_movements m
      JOIN ingredients i ON i.id = m.ingredient_id
     WHERE m.kind = 'wastage' AND date(m.created_at) BETWEEN ? AND ?
     GROUP BY m.ingredient_id, reason
     ORDER BY value DESC
  `;

  const selectWastage = db.prepare<[string, string], WastageRow>(wastageSql);

  const selectWastageTotal = db.prepare<[string, string], { total: number; qty: number }>(`
    SELECT COALESCE(SUM(ABS(ROUND(qty * unit_cost_milli / 1000))), 0) AS total,
           COALESCE(SUM(ABS(qty)), 0) AS qty
      FROM stock_movements
     WHERE kind = 'wastage' AND date(created_at) BETWEEN ? AND ?
  `);

  return {
    isReady: hasCounts,

    listCounts(limit = 50): StockCount[] {
      if (!selectCounts) return [];
      return selectCounts.all(limit).map(toCount);
    },

    findCount(id: number): { count: StockCount; lines: StockCountLine[] } | null {
      if (!selectCount || !selectCountLines) return null;
      const row = selectCount.get(id);
      if (!row) return null;
      return { count: toCount(row), lines: selectCountLines.all(id).map(toCountLine) };
    },

    nextCountNo(): string {
      const row = countRows.get();
      return `CNT-${String((row?.total ?? 0) + 1).padStart(5, '0')}`;
    },

    createCount(input: {
      countNo: string;
      countedOn: string;
      varianceValue: number;
      notes: string;
      createdBy: number;
      lines: Array<{
        ingredientId: number;
        bookQty: number;
        countedQty: number;
        variance: number;
        unitCostMilli: number;
        varianceValue: number;
      }>;
    }): number {
      if (!insertCount || !insertCountLine) {
        throw new AppError(
          'CONFLICT',
          'Stock counts are not available in this database yet. Restart the app to finish the update.',
        );
      }

      return db.transaction(() => {
        const created = insertCount.run({
          countNo: input.countNo,
          countedOn: input.countedOn,
          varianceValue: input.varianceValue,
          lineCount: input.lines.length,
          notes: input.notes,
          createdBy: input.createdBy,
          now: new Date().toISOString().replace('T', ' ').slice(0, 19),
        });

        const countId = Number(created.lastInsertRowid);

        for (const line of input.lines) {
          insertCountLine.run({ countId, ...line });
        }

        return countId;
      })();
    },

    wastageReport(fromDate: string, toDate: string): {
      rows: WastageRow[];
      total: number;
      qty: number;
    } {
      const total = selectWastageTotal.get(fromDate, toDate);
      return {
        rows: selectWastage.all(fromDate, toDate),
        total: total?.total ?? 0,
        qty: total?.qty ?? 0,
      };
    },

    /**
     * Wastage grouped by the day it happened (4.G report trend).
     *
     * `created_at` carries the shop's local time; `happened_on`-style backdating
     * is not stored on a movement, so the trend follows when the row was written.
     * That is the same date the P&L filters on, so the two agree.
     */
    wastageByDay(fromDate: string, toDate: string): Array<{ date: string; qty: number; value: number }> {
      const rows = db
        .prepare(
          `SELECT date(created_at) AS date,
                  COALESCE(SUM(ABS(qty)), 0) AS qty,
                  COALESCE(SUM(ABS(ROUND(qty * unit_cost_milli / 1000))), 0) AS value
             FROM stock_movements
            WHERE kind = 'wastage' AND date(created_at) BETWEEN ? AND ?
            GROUP BY date(created_at)
            ORDER BY date(created_at)`,
        )
        .all(fromDate, toDate) as Array<{ date: string; qty: number; value: number }>;

      return rows;
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
}

export type StockOpsRepository = ReturnType<typeof createStockOpsRepository>;
