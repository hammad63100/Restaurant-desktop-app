import type Database from 'better-sqlite3';
import type { RecurringBill, RecurringBillPayment } from '../../../src/types/api';
import { toSqlDate, toSqlDateTime } from '../../utils/datetime';

interface BillRow {
  id: number;
  category_id: number;
  category_name: string | null;
  name: string;
  typical_amount: number;
  due_day: number;
  remind_days: number;
  payee: string;
  paid_from: RecurringBill['paidFrom'];
  notes: string;
  active: number;
  created_at: string;
  updated_at: string;
}

interface PaymentRow {
  id: number;
  template_id: number;
  period: string;
  expense_id: number | null;
  amount: number;
  status: RecurringBillPayment['status'];
  note: string;
  created_at: string;
}

function toBill(row: BillRow): RecurringBill {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name ?? '',
    name: row.name,
    typicalAmount: row.typical_amount,
    dueDay: row.due_day,
    remindDays: row.remind_days,
    payee: row.payee,
    paidFrom: row.paid_from,
    notes: row.notes,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPayment(row: PaymentRow): RecurringBillPayment {
  return {
    id: row.id,
    templateId: row.template_id,
    period: row.period,
    expenseId: row.expense_id,
    amount: row.amount,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
  };
}

/**
 * Recurring bills (4.E2).
 *
 * A template says "rent, Rs 50,000, due on the 5th". A payment says "rent for
 * November 2026: paid, Rs 50,000, expense #41" or "skipped". The two are separate
 * tables because a template outlives every month it produces, and because a
 * reminder must never be able to post money on its own.
 *
 * Guarded the way the other 4.x repositories are: if migration 022 has not run, the
 * methods degrade to empty/`false` rather than crashing the app on startup.
 */
export function createRecurringBillsRepository(db: Database.Database) {
  const tableExists = (name: string): boolean =>
    Boolean(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
    );

  const ready = tableExists('recurring_bills') && tableExists('recurring_bill_payments');

  const selectAll = ready
    ? db.prepare<[], BillRow>(`
        SELECT b.*, c.name AS category_name
          FROM recurring_bills b
          LEFT JOIN expense_categories c ON c.id = b.category_id
         ORDER BY b.active DESC, b.due_day ASC, b.name ASC
      `)
    : null;
  const selectBill = ready
    ? db.prepare<[number], BillRow>(`
        SELECT b.*, c.name AS category_name
          FROM recurring_bills b
          LEFT JOIN expense_categories c ON c.id = b.category_id
         WHERE b.id = ?
      `)
    : null;
  const insertBill = ready
    ? db.prepare(`
        INSERT INTO recurring_bills
          (category_id, name, typical_amount, due_day, remind_days, payee, paid_from,
           notes, active, created_at, updated_at)
        VALUES
          (@categoryId, @name, @typicalAmount, @dueDay, @remindDays, @payee, @paidFrom,
           @notes, @active, @now, @now)
      `)
    : null;
  const updateBill = ready
    ? db.prepare(`
        UPDATE recurring_bills
           SET category_id = @categoryId, name = @name, typical_amount = @typicalAmount,
               due_day = @dueDay, remind_days = @remindDays, payee = @payee,
               paid_from = @paidFrom, notes = @notes, active = @active,
               updated_at = @now
         WHERE id = @id
      `)
    : null;
  const deleteBill = ready ? db.prepare<[number]>('DELETE FROM recurring_bills WHERE id = ?') : null;

  const selectPaymentsPeriod = ready
    ? db.prepare<[string], PaymentRow>(
        'SELECT * FROM recurring_bill_payments WHERE period = ? ORDER BY template_id',
      )
    : null;
  const selectPayment = ready
    ? db.prepare<[number, string], PaymentRow>(
        'SELECT * FROM recurring_bill_payments WHERE template_id = ? AND period = ?',
      )
    : null;
  const insertPayment = ready
    ? db.prepare(`
        INSERT INTO recurring_bill_payments
          (template_id, period, expense_id, amount, status, note, created_by, created_at)
        VALUES
          (@templateId, @period, @expenseId, @amount, @status, @note, @createdBy, @now)
      `)
    : null;
  const deletePayment = ready
    ? db.prepare<[number]>('DELETE FROM recurring_bill_payments WHERE id = ?')
    : null;

  return {
    isReady: ready,

    list(): RecurringBill[] {
      if (!selectAll) return [];
      return selectAll.all().map(toBill);
    },

    find(id: number): RecurringBill | null {
      if (!selectBill) return null;
      const row = selectBill.get(id);
      return row ? toBill(row) : null;
    },

    save(input: {
      id?: number;
      categoryId: number;
      name: string;
      typicalAmount: number;
      dueDay: number;
      remindDays: number;
      payee: string;
      paidFrom: RecurringBill['paidFrom'];
      notes: string;
      active: boolean;
    }): number {
      if (!insertBill || !updateBill) throw new Error('Recurring bills are not available');

      const now = toSqlDateTime();
      const payload = {
        ...input,
        active: input.active ? 1 : 0,
        now,
      };

      if (input.id) {
        updateBill.run(payload);
        return input.id;
      }

      const result = insertBill.run(payload);
      return Number(result.lastInsertRowid);
    },

    remove(id: number): void {
      // The payments cascade with it. Deleting a template is for "we stopped paying
      // this", not for fixing a wrong amount — that is what editing is for.
      deleteBill?.run(id);
    },

    paymentsFor(period: string): RecurringBillPayment[] {
      if (!selectPaymentsPeriod) return [];
      return selectPaymentsPeriod.all(period).map(toPayment);
    },

    findPayment(templateId: number, period: string): RecurringBillPayment | null {
      if (!selectPayment) return null;
      const row = selectPayment.get(templateId, period);
      return row ? toPayment(row) : null;
    },

    createPayment(input: {
      templateId: number;
      period: string;
      expenseId: number | null;
      amount: number;
      status: RecurringBillPayment['status'];
      note: string;
      createdBy: number;
    }): number {
      if (!insertPayment) throw new Error('Recurring bills are not available');
      const result = insertPayment.run({ ...input, now: toSqlDateTime() });
      return Number(result.lastInsertRowid);
    },

    deletePayment(id: number): void {
      deletePayment?.run(id);
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    /** Exposed for the service's date maths and for tests. */
    today: (): string => toSqlDate(),
  };
}

export type RecurringBillsRepository = ReturnType<typeof createRecurringBillsRepository>;
