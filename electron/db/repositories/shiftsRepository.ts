import type { AppDatabase } from '../connection';
import type {
  CashMovement,
  CashMovementKind,
  CollectionByMethod,
  PaymentMethod,
  Shift,
  ShiftStatus,
} from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';
import { AppError } from '../../utils/errors';

interface ShiftRow {
  id: number;
  terminal: string;
  opened_by: number;
  opened_by_name: string;
  opened_at: string;
  closed_by: number | null;
  closed_by_name: string | null;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  status: ShiftStatus;
  notes: string;
}

interface MovementRow {
  id: number;
  shift_id: number;
  kind: CashMovementKind;
  method: PaymentMethod;
  amount: number;
  reason: string;
  ref_order_id: number | null;
  ref_purchase_id: number | null;
  ref_expense_id: number | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

function toShift(row: ShiftRow): Shift {
  return {
    id: row.id,
    terminal: row.terminal,
    openedBy: row.opened_by,
    openedByName: row.opened_by_name,
    openedAt: row.opened_at,
    closedBy: row.closed_by,
    closedByName: row.closed_by_name,
    closedAt: row.closed_at,
    openingCash: row.opening_cash,
    expectedCash: row.expected_cash,
    countedCash: row.counted_cash,
    difference: row.difference,
    status: row.status,
    notes: row.notes,
  };
}

function toMovement(row: MovementRow): CashMovement {
  return {
    id: row.id,
    shiftId: row.shift_id,
    kind: row.kind,
    method: row.method,
    amount: row.amount,
    reason: row.reason,
    refOrderId: row.ref_order_id,
    refPurchaseId: row.ref_purchase_id,
    refExpenseId: row.ref_expense_id ?? null,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

const SHIFT_SELECT = `
  SELECT s.*,
         uo.full_name AS opened_by_name,
         uc.full_name AS closed_by_name
    FROM shifts s
    JOIN users uo ON uo.id = s.opened_by
    LEFT JOIN users uc ON uc.id = s.closed_by
`;

/**
 * Shifts (a "day" at the till) and the cash drawer they describe. The unique
 * partial index on shifts(terminal) is the real guard against two open shifts;
 * the checks here exist to give the cashier a friendly message.
 */
export function createShiftsRepository(db: AppDatabase) {
  const selectOpen = db.prepare<[string], ShiftRow>(
    `${SHIFT_SELECT} WHERE s.terminal = ? AND s.status = 'open'`,
  );

  const selectById = db.prepare<[number], ShiftRow>(`${SHIFT_SELECT} WHERE s.id = ?`);

  const selectRecent = db.prepare<[number], ShiftRow>(
    `${SHIFT_SELECT} ORDER BY s.opened_at DESC, s.id DESC LIMIT ?`,
  );

  const insertShift = db.prepare(`
    INSERT INTO shifts (terminal, opened_by, opened_at, opening_cash, status)
    VALUES (@terminal, @openedBy, @openedAt, @openingCash, 'open')
  `);

  const closeShiftRow = db.prepare(`
    UPDATE shifts
       SET closed_by = @closedBy,
           closed_at = @closedAt,
           expected_cash = @expectedCash,
           counted_cash = @countedCash,
           difference = @difference,
           notes = @notes,
           status = 'closed'
     WHERE id = @id
  `);

  const insertMovement = db.prepare(`
    INSERT INTO cash_movements
      (shift_id, kind, method, amount, reason, ref_order_id, ref_purchase_id,
       ref_expense_id, created_by, created_at)
    VALUES
      (@shiftId, @kind, @method, @amount, @reason, @refOrderId, @refPurchaseId,
       @refExpenseId, @createdBy, @createdAt)
  `);

  const selectMovement = db.prepare<[number], MovementRow>(`
    SELECT m.*, u.full_name AS created_by_name
      FROM cash_movements m
      JOIN users u ON u.id = m.created_by
     WHERE m.id = ?
  `);

  const selectMovements = db.prepare<[number], MovementRow>(`
    SELECT m.*, u.full_name AS created_by_name
      FROM cash_movements m
      JOIN users u ON u.id = m.created_by
     WHERE m.shift_id = ?
     ORDER BY m.created_at, m.id
  `);

  /** Cash collected per method, tied to the shift through payments.shift_id. */
  const selectSalesByMethod = db.prepare<[number], CollectionByMethod>(`
    SELECT p.method AS method, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS total
      FROM payments p
     WHERE p.shift_id = ? AND p.voided_at IS NULL
     GROUP BY p.method
     ORDER BY p.method
  `);

  const selectPurchaseMovement = db.prepare<
    [number, string],
    { id: number; shift_id: number; amount: number; kind: CashMovementKind }
  >(`
    SELECT id, shift_id, amount, kind
      FROM cash_movements
     WHERE ref_purchase_id = ? AND kind = ?
     ORDER BY id DESC
     LIMIT 1
  `);

  const sumMovements = db.prepare<[number, string], { total: number }>(`
    SELECT COALESCE(SUM(amount), 0) AS total
      FROM cash_movements
     WHERE shift_id = ? AND kind = ?
  `);

  const countOrders = db.prepare<[string, string], { count: number; discount: number }>(`
    SELECT COUNT(*) AS count, COALESCE(SUM(discount), 0) AS discount
      FROM orders
     WHERE created_at >= ? AND created_at <= ? AND status <> 'cancelled'
  `);

  const countCancelled = db.prepare<[string, string], { count: number; value: number }>(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS value
      FROM orders
     WHERE created_at >= ? AND created_at <= ? AND status = 'cancelled'
  `);

  return {
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    openShift(input: { openedBy: number; openingCash: number; terminal?: string }): Shift {
      const terminal = input.terminal ?? 'counter-1';

      return db.transaction(() => {
        if (selectOpen.get(terminal)) {
          throw new AppError('CONFLICT', 'A shift is already open for this counter');
        }

        const created = insertShift.run({
          terminal,
          openedBy: input.openedBy,
          openedAt: toSqlDateTime(),
          openingCash: input.openingCash,
        });

        const row = selectById.get(Number(created.lastInsertRowid));
        if (!row) throw new AppError('INTERNAL_ERROR', 'The shift could not be opened');
        return toShift(row);
      })();
    },

    current(terminal = 'counter-1'): Shift | null {
      const row = selectOpen.get(terminal);
      return row ? toShift(row) : null;
    },

    find(id: number): Shift | null {
      const row = selectById.get(id);
      return row ? toShift(row) : null;
    },

    list(limit = 20): Shift[] {
      return selectRecent.all(limit).map(toShift);
    },

    closeShift(input: {
      id: number;
      closedBy: number;
      expectedCash: number;
      countedCash: number;
      notes: string;
    }): Shift {
      return db.transaction(() => {
        const row = selectById.get(input.id);
        if (!row) throw new AppError('NOT_FOUND', 'That shift does not exist');
        if (row.status === 'closed') throw new AppError('CONFLICT', 'This shift is already closed');

        closeShiftRow.run({
          id: input.id,
          closedBy: input.closedBy,
          closedAt: toSqlDateTime(),
          expectedCash: input.expectedCash,
          countedCash: input.countedCash,
          difference: input.countedCash - input.expectedCash,
          notes: input.notes,
        });

        const updated = selectById.get(input.id);
        if (!updated) throw new AppError('INTERNAL_ERROR', 'The shift could not be closed');
        return toShift(updated);
      })();
    },

    addMovement(input: {
      shiftId: number;
      kind: CashMovementKind;
      category?: PaymentMethod;
      amount: number;
      reason: string;
      refOrderId: number | null;
      /** Set when a purchase moved the cash, so a void can reverse exactly this row. */
      refPurchaseId?: number | null;
      /** Set when a shop expense moved the cash, so a void can reverse exactly this row. */
      refExpenseId?: number | null;
      createdBy: number;
    }): CashMovement {
      return db.transaction(() => {
        const shift = selectById.get(input.shiftId);
        if (!shift) throw new AppError('NOT_FOUND', 'That shift does not exist');
        if (shift.status === 'closed') {
          throw new AppError('CONFLICT', 'Cash cannot move on a closed shift');
        }

        const created = insertMovement.run({
          shiftId: input.shiftId,
          kind: input.kind,
          method: input.category ?? 'cash',
          amount: input.amount,
          reason: input.reason,
          refOrderId: input.refOrderId,
          refPurchaseId: input.refPurchaseId ?? null,
          refExpenseId: input.refExpenseId ?? null,
          createdBy: input.createdBy,
          createdAt: toSqlDateTime(),
        });

        const row = selectMovement.get(Number(created.lastInsertRowid));
        if (!row) throw new AppError('INTERNAL_ERROR', 'The cash movement was not saved');
        return toMovement(row);
      })();
    },

    movements(shiftId: number): CashMovement[] {
      return selectMovements.all(shiftId).map(toMovement);
    },

    /**
     * The drawer row a purchase wrote, if any.
     * `expense` for the money that left the till when it was bought, `cash_in` for
     * the reversed row written by a void.
     */
    purchaseMovement(purchaseId: number, kind: 'expense' | 'cash_in'): {
      id: number;
      shiftId: number;
      amount: number;
    } | null {
      const row = selectPurchaseMovement.get(purchaseId, kind);
      return row ? { id: row.id, shiftId: row.shift_id, amount: row.amount } : null;
    },

    salesByMethod(shiftId: number): CollectionByMethod[] {
      return selectSalesByMethod.all(shiftId);
    },

    /**
     * Expected cash in the drawer: opening float + cash sales + cash in
     * − cash out − refunds − expenses paid from the drawer.
     */
    expectedCash(shiftId: number, openingCash: number): number {
      const sales = selectSalesByMethod.all(shiftId);
      const cashSales = sales.find((row) => row.method === 'cash')?.total ?? 0;

      const cashIn = sumMovements.get(shiftId, 'cash_in')?.total ?? 0;
      const cashOut = sumMovements.get(shiftId, 'cash_out')?.total ?? 0;
      const refunds = sumMovements.get(shiftId, 'refund')?.total ?? 0;
      const expenses = sumMovements.get(shiftId, 'expense')?.total ?? 0;

      return openingCash + cashSales + cashIn - cashOut - refunds - expenses;
    },

    orderStats(fromIso: string, toIso: string) {
      const active = countOrders.get(fromIso, toIso) ?? { count: 0, discount: 0 };
      const cancelled = countCancelled.get(fromIso, toIso) ?? { count: 0, value: 0 };
      return { active, cancelled };
    },
  };
}

export type ShiftsRepository = ReturnType<typeof createShiftsRepository>;
