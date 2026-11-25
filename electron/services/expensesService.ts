import type {
  Expense,
  ExpenseCategory,
  ExpenseInput,
  ExpenseOverview,
  ExpensePaidFrom,
  RecurringBill,
  RecurringBillInput,
  RecurringBillsOverview,
  RecurringBillStatus,
} from '../../src/types/api';
import type { ExpensesRepository } from '../db/repositories/expensesRepository';
import type { RecurringBillsRepository } from '../db/repositories/recurringBillsRepository';
import type { ShiftsRepository } from '../db/repositories/shiftsRepository';
import { AppError } from '../utils/errors';
import { toSqlDate } from '../utils/datetime';
import { logInfo } from './logger';

/**
 * Shop expenses (Roadmap 4.F).
 *
 * The client: "shop k kharchy bhi add kron" — so the hisab is complete and the
 * profit figure in 4.G is real money, not an estimate that ignores rent.
 *
 * The one rule that matters here is where the money came from:
 *
 *   * **cash** — paid out of the till. The expense writes a `cash_out` row on the
 *     open shift, so the drawer count at close is right. With no shift open the
 *     entry is refused rather than silently losing the drawer link.
 *   * **bank / other** — paid from outside the shop's cash box (a cheque, the
 *     owner's own pocket). No drawer row, because no notes left the counter.
 *
 * Voiding never deletes anything: the row stays with `status = 'void'`, who and
 * why, and the drawer row it wrote is reversed with a `cash_in` so the till goes
 * back to where it was. The void is a separate, auditable event.
 */
export function createExpensesService(deps: {
  expenses: ExpensesRepository;
  shifts: ShiftsRepository;
  /** Recurring bills (4.E2). Null on a database that predates migration 022. */
  recurring?: RecurringBillsRepository;
}) {
  const { expenses, shifts, recurring } = deps;

  /** Refuses politely on a database that predates migration 020. */
  function ensureReady(): void {
    if (!expenses.isReady) {
      throw new AppError(
        'CONFLICT',
        'Expenses are not available in this database yet. Restart the app to finish the update.',
      );
    }
  }

  function categoryOrFail(id: number): ExpenseCategory {
    const category = expenses.findCategory(id);
    if (!category) throw new AppError('NOT_FOUND', 'That expense category does not exist');
    if (!category.active) {
      throw new AppError('CONFLICT', 'That expense category has been removed');
    }
    return category;
  }

  function expenseOrFail(id: number): Expense {
    const expense = expenses.find(id);
    if (!expense) throw new AppError('NOT_FOUND', 'That expense does not exist');
    return expense;
  }

  /** The drawer row an expense wrote, if any. */
  function drawerRow(expenseId: number): { id: number; shiftId: number; amount: number } | null {
    return expenses.drawerMovement(expenseId);
  }

  return {
    overview(input: { from: string; to: string; status?: 'active' | 'void' | 'all' }): ExpenseOverview {
      ensureReady();

      const summary = expenses.summary(input.from, input.to);

      return {
        from: input.from,
        to: input.to,
        expenses: expenses.list({
          from: input.from,
          to: input.to,
          status: input.status ?? 'active',
        }),
        categories: expenses.listCategories(),
        summary: summary.rows,
        total: summary.total,
        drawerOpen: shifts.current() !== null,
      };
    },

    categories(): ExpenseCategory[] {
      ensureReady();
      return expenses.listCategories();
    },

    saveCategory(input: { id?: number; name: string; sortOrder: number }): ExpenseCategory {
      ensureReady();

      const name = input.name.trim();
      if (name.length === 0) throw new AppError('VALIDATION_ERROR', 'Give the category a name');

      if (expenses.categoryNameTaken(name, input.id ?? null)) {
        throw new AppError('CONFLICT', `${name} already exists`);
      }

      if (typeof input.id === 'number') {
        const existing = expenses.findCategory(input.id);
        if (!existing) throw new AppError('NOT_FOUND', 'That category does not exist');
        return expenses.updateCategory({ id: input.id, name, sortOrder: input.sortOrder });
      }

      return expenses.createCategory({ name, sortOrder: input.sortOrder });
    },

    /** Soft delete. Refused while active expenses still use it, on purpose. */
    deleteCategory(id: number): void {
      ensureReady();

      const category = expenses.findCategory(id);
      if (!category) throw new AppError('NOT_FOUND', 'That category does not exist');
      if (category.isSystem) {
        throw new AppError('CONFLICT', 'This category ships with the app and cannot be removed');
      }
      if (category.expenseCount > 0) {
        throw new AppError(
          'CONFLICT',
          `${category.expenseCount} expense${category.expenseCount === 1 ? '' : 's'} use this category. ` +
            'Rename it, or void those expenses first.',
        );
      }

      expenses.deactivateCategory(id);
      logInfo(`Expense category removed: ${category.name}`);
    },

    /**
     * Records one expense and, when it was paid in cash, takes the money out of
     * the open drawer in the same transaction.
     */
    save(input: ExpenseInput, createdBy: number): Expense {
      ensureReady();
      categoryOrFail(input.categoryId);

      if (input.amount <= 0) {
        throw new AppError('VALIDATION_ERROR', 'The amount must be more than zero');
      }

      const spentOn = input.spentOn || toSqlDate();
      if (spentOn > toSqlDate()) {
        throw new AppError('VALIDATION_ERROR', 'An expense cannot be dated in the future');
      }

      const paidFrom: ExpensePaidFrom = input.paidFrom;
      const shift = paidFrom === 'cash' ? shifts.current() : null;

      if (paidFrom === 'cash' && !shift) {
        throw new AppError(
          'CONFLICT',
          'No drawer is open. Open the day first, or record this as paid from the bank.',
        );
      }

      const expenseId = expenses.transaction(() => {
        const id = expenses.create({
          expenseNo: expenses.nextExpenseNo(),
          categoryId: input.categoryId,
          spentOn,
          amount: Math.round(input.amount),
          paidFrom,
          payee: input.payee.trim(),
          notes: input.notes.trim(),
          shiftId: shift?.id ?? null,
          createdBy,
        });

        if (shift) {
          shifts.addMovement({
            shiftId: shift.id,
            // 'expense' is the kind the day-close report and expectedCash both
            // subtract. Using cash_out here would take the money out of the
            // drawer but leave the "expenses" line on the Z report at zero.
            kind: 'expense',
            amount: Math.round(input.amount),
            reason: `Expense ${expenses.find(id)?.expenseNo ?? ''}: ${
              input.payee.trim() || 'shop expense'
            }`,
            refOrderId: null,
            refExpenseId: id,
            createdBy,
          });
        }

        return id;
      });

      const saved = expenseOrFail(expenseId);
      logInfo(`Expense recorded: ${saved.expenseNo} ${saved.amount} paisa (${saved.paidFrom})`);
      return saved;
    },

    /**
     * Voids an expense. The money goes back into the drawer if it left the drawer,
     * and the entry itself stays with the reason it was reversed.
     */
    void(input: { id: number; reason: string }, voidedBy: number): Expense {
      ensureReady();

      const expense = expenseOrFail(input.id);
      if (expense.status === 'void') {
        throw new AppError('CONFLICT', 'This expense is already void');
      }

      const reason = input.reason.trim();
      if (reason.length < 3) {
        throw new AppError('VALIDATION_ERROR', 'Give a short reason for voiding this expense');
      }

      expenses.transaction(() => {
        expenses.void(expense.id, reason, voidedBy);

        /*
         * Put the drawer back. The cash_in goes on the shift that originally paid
         * when it is still open; if that day was already closed the money is in
         * the current drawer instead, because the closed shift's count is history
         * and must never be rewritten (the same rule the purchase void follows).
         */
        const row = drawerRow(expense.id);
        if (!row) return;

        const payingShift = shifts.find(row.shiftId);
        const target = payingShift?.status === 'open' ? payingShift : shifts.current();
        if (!target) return;

        const earlier = target.id !== row.shiftId;

        shifts.addMovement({
          shiftId: target.id,
          kind: 'cash_in',
          amount: row.amount,
          reason: `Void expense ${expense.expenseNo}: ${reason}${
            earlier ? ' (paid in an earlier shift)' : ''
          }`,
          refOrderId: null,
          refExpenseId: expense.id,
          createdBy: voidedBy,
        });
      });

      const saved = expenseOrFail(expense.id);
      logInfo(`Expense voided: ${saved.expenseNo} (${reason})`);
      return saved;
    },

    /* ----------------------- recurring bills (4.E2) ----------------------- */

    /**
     * The month's bills resolved against today.
     *
     * The due date within a month is computed here, not stored, because "the 31st"
     * has to mean the 28th in February and calendars change more often than bills do.
     * Nothing is written while reading — a reminder that books money on its own is
     * not a reminder, it is a bug.
     */
    recurringBills(period?: string): RecurringBillsOverview {
      ensureRecurring();

      const month = period ?? toSqlDate().slice(0, 7);
      const today = toSqlDate();
      const rows = recurring!.list().map((bill) =>
        describeBill(bill, month, today, recurring!.findPayment(bill.id, month)),
      );

      const needsAttention = rows.filter(
        (row) => row.state === 'due' || row.state === 'overdue',
      );

      return {
        period: month,
        rows,
        needsAttention: needsAttention.length,
        outstandingTypical: needsAttention.reduce(
          (total, row) => total + row.bill.typicalAmount,
          0,
        ),
      };
    },

    saveRecurringBill(input: RecurringBillInput): RecurringBill {
      ensureRecurring();
      if (!expenses.findCategory(input.categoryId)) {
        throw new AppError('NOT_FOUND', 'That expense category does not exist');
      }
      if (input.typicalAmount < 0) {
        throw new AppError('VALIDATION_ERROR', 'The amount cannot be negative');
      }

      const id = recurring!.save({
        ...input,
        name: input.name.trim(),
        payee: input.payee.trim(),
        notes: input.notes.trim(),
      });

      const saved = recurring!.find(id);
      if (!saved) throw new AppError('INTERNAL_ERROR', 'The bill could not be read back');
      logInfo(`Recurring bill saved: ${saved.name} on day ${saved.dueDay}`);
      return saved;
    },

    deleteRecurringBill(id: number): void {
      ensureRecurring();
      if (!recurring!.find(id)) throw new AppError('NOT_FOUND', 'That bill does not exist');
      recurring!.remove(id);
      logInfo(`Recurring bill removed: ${id}`);
    },

    /**
     * Mark one month's bill as paid or skipped.
     *
     * Paying creates a REAL expense through the normal save path, so the drawer
     * link, the void rules and the P&L all behave exactly as they would if the owner
     * had typed it by hand — the reminder is a shortcut to the form, not a second
     * way of writing the books. Skipping records the decision and books nothing.
     */
    settleRecurringBill(
      input: {
        templateId: number;
        period: string;
        status: 'paid' | 'skipped';
        amount: number;
        note: string;
      },
      createdBy: number,
    ): RecurringBillStatus {
      ensureRecurring();

      const bill = recurring!.find(input.templateId);
      if (!bill) throw new AppError('NOT_FOUND', 'That recurring bill does not exist');
      if (recurring!.findPayment(input.templateId, input.period)) {
        throw new AppError('CONFLICT', `${bill.name} is already settled for ${input.period}`);
      }

      let expenseId: number | null = null;

      if (input.status === 'paid') {
        if (input.amount <= 0) {
          throw new AppError('VALIDATION_ERROR', 'The amount must be more than zero');
        }

        /*
         * The expense is dated the due date of that month, not today. Rent for
         * November belongs to November even if it is confirmed on 3 December, and the
         * report filters on spent_on — dating it today would move a month's cost into
         * the wrong month's profit.
         */
        const dueDate = dueDateFor(bill.dueDay, input.period);
        const spentOn = dueDate > toSqlDate() ? toSqlDate() : dueDate;

        const expense = this.save(
          {
            categoryId: bill.categoryId,
            spentOn,
            amount: input.amount,
            paidFrom: bill.paidFrom,
            payee: bill.payee || bill.name,
            notes: input.note.trim() || `${bill.name} for ${input.period}`,
          },
          createdBy,
        );
        expenseId = expense.id;
      }

      recurring!.createPayment({
        templateId: input.templateId,
        period: input.period,
        expenseId,
        amount: input.status === 'paid' ? input.amount : 0,
        status: input.status,
        note: input.note.trim(),
        createdBy,
      });

      logInfo(
        `Recurring bill ${bill.name} ${input.period}: ${input.status}` +
          (expenseId ? ` (expense ${expenseId})` : ''),
      );

      return describeBill(
        bill,
        input.period,
        toSqlDate(),
        recurring!.findPayment(input.templateId, input.period),
      );
    },

    /**
     * Undo a settlement.
     *
     * The expense is VOIDED, not deleted — the same rule as every other correction in
     * the app. That keeps the audit trail and, if the money left the drawer, refunds
     * the shift. Then the payment row is removed so the month is open again.
     */
    unsettleRecurringBill(
      input: { templateId: number; period: string },
      voidedBy: number,
    ): void {
      ensureRecurring();

      const payment = recurring!.findPayment(input.templateId, input.period);
      if (!payment) {
        throw new AppError('NOT_FOUND', 'That bill is not settled for this month');
      }

      if (payment.expenseId) {
        const expense = expenseOrFail(payment.expenseId);
        if (expense.status === 'active') {
          this.void(
            { id: expense.id, reason: 'Recurring bill un-settled' },
            voidedBy,
          );
        }
      }

      recurring!.deletePayment(payment.id);
      logInfo(`Recurring bill un-settled: template ${input.templateId} ${input.period}`);
    },
  };

  /** Refuses politely on a database that predates migration 022. */
  function ensureRecurring(): void {
    if (!recurring || !recurring.isReady) {
      throw new AppError(
        'CONFLICT',
        'Recurring bills are not available in this database yet. Restart the app to finish the update.',
      );
    }
  }
}

/**
 * The date a bill is due in a given month.
 *
 * `dueDay` is capped at the month's real length, so "due on the 31st" means 28
 * February in a normal year and 29 in a leap one. Getting this wrong the simple way
 * (string-concatenating `2026-02-31`) produces an invalid date that SQLite would
 * happily store and no report could ever match.
 */
export function dueDateFor(dueDay: number, period: string): string {
  const [yearText, monthText] = period.split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  // Day 0 of the NEXT month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Math.max(dueDay, 1), lastDay);

  return `${period}-${String(day).padStart(2, '0')}`;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is past. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * One bill in one month, resolved against a given day.
 *
 * Pure on purpose: the state is a function of the template, the month, the date and
 * the recorded payment — nothing else — which is what makes it testable and what
 * stops a "due" badge drifting depending on when the dashboard happened to be built.
 */
function describeBill(
  bill: RecurringBill,
  period: string,
  today: string,
  payment: import('../../src/types/api').RecurringBillPayment | null,
): RecurringBillStatus {
  const dueDate = dueDateFor(bill.dueDay, period);
  const daysUntilDue = daysBetween(today, dueDate);

  const state: RecurringBillStatus['state'] = payment
    ? payment.status
    : !bill.active
      ? 'upcoming'
      : daysUntilDue < 0
        ? 'overdue'
        : daysUntilDue <= bill.remindDays
          ? 'due'
          : 'upcoming';

  return { bill, period, dueDate, daysUntilDue, state, payment };
}

export type ExpensesService = ReturnType<typeof createExpensesService>;
