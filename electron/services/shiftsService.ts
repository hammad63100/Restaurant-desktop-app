import type { CashMovement, CashMovementKind, Shift, ShiftReport } from '../../src/types/api';
import type { ShiftsRepository } from '../db/repositories/shiftsRepository';
import type { OrdersRepository } from '../db/repositories/ordersRepository';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

/**
 * Day close: opening a shift, moving cash, the X report (read only) and the Z
 * report produced when the shift is closed. No Electron imports, so the print
 * window is injected separately (see printService.renderShiftReportHtml).
 */
export function createShiftsService(deps: { shifts: ShiftsRepository; orders: OrdersRepository }) {
  const { shifts, orders } = deps;

  function reportFor(shift: Shift): ShiftReport {
    // The report covers the shift's own window, so an X report mid-day and the
    // final Z report use exactly the same arithmetic.
    const from = shift.openedAt;
    const to = shift.closedAt ?? new Date().toISOString().replace('T', ' ').slice(0, 19);

    const stats = shifts.orderStats(from, to);
    const movements = shifts.movements(shift.id);
    const salesByMethod = shifts.salesByMethod(shift.id);

    const sumOf = (kind: CashMovementKind) =>
      movements.filter((row) => row.kind === kind).reduce((total, row) => total + row.amount, 0);

    // An X report still needs the expected drawer figure, computed live; a closed
    // shift uses the number stored at close time.
    const expectedCash = shift.expectedCash ?? shifts.expectedCash(shift.id, shift.openingCash);

    return {
      shift,
      expectedCash,
      movements,
      salesByMethod,
      totalSales: salesByMethod.reduce((total, row) => total + row.total, 0),
      orderCount: stats.active.count,
      cashSales: salesByMethod.find((row) => row.method === 'cash')?.total ?? 0,
      cashIn: sumOf('cash_in'),
      cashOut: sumOf('cash_out'),
      refunds: sumOf('refund'),
      expenses: sumOf('expense'),
      discountTotal: stats.active.discount,
      cancelledCount: stats.cancelled.count,
      cancelledValue: stats.cancelled.value,
      topItems: orders.topItems(from, to, 5),
      variance: shift.difference,
    };
  }

  function openShiftOrFail(terminal = 'counter-1'): Shift {
    const shift = shifts.current(terminal);
    if (!shift) throw new AppError('CONFLICT', 'Open the shift before changing the cash drawer');
    return shift;
  }

  return {
    current(terminal?: string): Shift | null {
      return shifts.current(terminal);
    },

    list(limit?: number): Shift[] {
      return shifts.list(limit);
    },

    open(openingCash: number, openedBy: number): Shift {
      const shift = shifts.openShift({ openedBy, openingCash });
      logInfo(`Shift ${shift.id} opened with ${openingCash} paisa`);
      return shift;
    },

    /** X report: read-only, works whether the shift is open or closed. */
    report(shiftId?: number): ShiftReport {
      if (typeof shiftId === 'number') {
        const shift = shifts.find(shiftId);
        if (!shift) throw new AppError('NOT_FOUND', 'That shift does not exist');
        return reportFor(shift);
      }

      const current = shifts.current();
      if (!current) throw new AppError('CONFLICT', 'There is no open shift to report on');
      return reportFor(current);
    },

    /** Z report: computes expected cash, records the count and closes the shift. */
    close(input: { countedCash: number; notes: string }, closedBy: number): ShiftReport {
      const current = shifts.current();
      if (!current) throw new AppError('CONFLICT', 'There is no open shift to close');

      const expected = shifts.expectedCash(current.id, current.openingCash);

      const closed = shifts.closeShift({
        id: current.id,
        closedBy,
        expectedCash: expected,
        countedCash: input.countedCash,
        notes: input.notes,
      });

      logInfo(
        `Shift ${closed.id} closed: expected ${expected}, counted ${input.countedCash}, difference ${
          input.countedCash - expected
        }`,
      );

      return reportFor(closed);
    },

    addMovement(
      input: { kind: CashMovementKind; amount: number; reason: string },
      createdBy: number,
    ): CashMovement {
      // 'sale' and 'refund' rows are produced by payments, not typed by hand.
      if (input.kind === 'sale') {
        throw new AppError('VALIDATION_ERROR', 'Sales are recorded by taking a payment');
      }

      const shift = openShiftOrFail();

      return shifts.addMovement({
        shiftId: shift.id,
        kind: input.kind,
        amount: input.amount,
        reason: input.reason,
        refOrderId: null,
        createdBy,
      });
    },

    movements(shiftId: number): CashMovement[] {
      return shifts.movements(shiftId);
    },
  };
}

export type ShiftsService = ReturnType<typeof createShiftsService>;
