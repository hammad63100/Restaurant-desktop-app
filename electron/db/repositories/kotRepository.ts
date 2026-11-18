import type { AppDatabase } from '../connection';
import { toSqlDate } from '../../utils/datetime';
import type { KOT } from '../../../src/types/api';
import { AppError } from '../../utils/errors';

interface KotRow {
  id: number;
  order_no: string;
  token_no: number | null;
  type: 'dine_in' | 'takeaway' | 'delivery';
  status: string;
  customer_name: string;
  notes: string;
  created_at: string;
  waiter_name: string | null;
}

interface KotItemRow {
  id: number;
  name: string;
  qty: number;
  notes: string;
}

/**
 * Kitchen tickets and daily tokens (feature 3.D).
 *
 * The kitchen never sees money, so the queries here deliberately select only what
 * a cook needs: what to make, how many, and for which token.
 */
export function createKotRepository(db: AppDatabase) {
  const selectTokenCounter = db.prepare<[string], { last: number }>(
    'SELECT last FROM token_counters WHERE day = ?',
  );
  const ensureTokenCounter = db.prepare(
    'INSERT OR IGNORE INTO token_counters (day, last) VALUES (?, 0)',
  );
  const bumpTokenCounter = db.prepare('UPDATE token_counters SET last = ? WHERE day = ?');

  const selectKotHeader = db.prepare<[number], KotRow>(`
    SELECT o.id, o.order_no, o.token_no, o.type, o.status, o.customer_name, o.notes,
           o.created_at, w.name AS waiter_name
      FROM orders o
      LEFT JOIN waiters w ON w.id = o.waiter_id
     WHERE o.id = ?
  `);

  const selectKotItems = db.prepare<[number], KotItemRow>(`
    SELECT id, name, qty, notes
      FROM order_items
     WHERE order_id = ?
     ORDER BY id
  `);

  const insertKotPrint = db.prepare(`
    INSERT INTO kot_prints (order_id, printed_by, item_ids, created_at)
    VALUES (@orderId, @printedBy, @itemIds, @createdAt)
  `);

  const selectPrintCount = db.prepare<[number], { total: number }>(
    'SELECT COUNT(*) AS total FROM kot_prints WHERE order_id = ?',
  );

  return {
    /**
     * Reserves the next token for today. Must run inside the order transaction so
     * a rolled-back order does not burn a number — but note the counter is *not*
     * decremented when an order is later cancelled on purpose.
     */
    nextToken(day = toSqlDate()): number {
      ensureTokenCounter.run(day);
      const row = selectTokenCounter.get(day);
      const next = (row?.last ?? 0) + 1;
      bumpTokenCounter.run(next, day);
      return next;
    },

    /** Builds the kitchen ticket for an order, or null if the order is gone. */
    ticketFor(orderId: number): KOT | null {
      const header = selectKotHeader.get(orderId);
      if (!header) return null;

      return {
        orderId: header.id,
        orderNo: header.order_no,
        tokenNo: header.token_no,
        type: header.type,
        status: header.status as KOT['status'],
        customerName: header.customer_name,
        waiterName: header.waiter_name,
        notes: header.notes,
        createdAt: header.created_at,
        items: selectKotItems.all(orderId).map((item) => ({
          id: item.id,
          name: item.name,
          qty: item.qty,
          notes: item.notes,
        })),
        printCount: selectPrintCount.get(orderId)?.total ?? 0,
      };
    },

    recordPrint(input: {
      orderId: number;
      printedBy: number;
      itemIds: number[];
      createdAt: string;
    }): void {
      if (!selectKotHeader.get(input.orderId)) {
        throw new AppError('NOT_FOUND', 'That order does not exist');
      }
      insertKotPrint.run({ ...input, itemIds: JSON.stringify(input.itemIds) });
    },
  };
}

export type KotRepository = ReturnType<typeof createKotRepository>;
