import type { AppDatabase } from '../connection';
import type { Expense, ExpenseCategory, ExpenseSummaryRow } from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';
import { AppError } from '../../utils/errors';

/**
 * Shop expenses (Roadmap 4.F).
 *
 * The client: "shop k kharchy bhi add kron" — rent, bills, salaries, repairs. A
 * purchase puts value on the shelf; an expense does not. They are separate tables
 * for exactly that reason, and this one is a plain, auditable list of money that
 * left the shop.
 *
 * Nothing is ever deleted: a mistake is voided with a reason and a name, so the
 * P&L can show "spent and then reversed" instead of a gap in the records.
 */

interface CategoryRow {
  id: number;
  name: string;
  sort_order: number;
  is_system: number;
  active: number;
  expense_count: number;
  total_amount: number;
}

interface ExpenseRow {
  id: number;
  expense_no: string;
  category_id: number;
  category_name: string;
  spent_on: string;
  amount: number;
  paid_from: 'cash' | 'bank' | 'other';
  payee: string;
  notes: string;
  shift_id: number | null;
  status: 'active' | 'void';
  void_reason: string;
  voided_at: string | null;
  voided_by_name: string | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

function toCategory(row: CategoryRow): ExpenseCategory {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    isSystem: row.is_system === 1,
    active: row.active === 1,
    expenseCount: row.expense_count,
    totalAmount: row.total_amount,
  };
}

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    expenseNo: row.expense_no,
    categoryId: row.category_id,
    categoryName: row.category_name,
    spentOn: row.spent_on,
    amount: row.amount,
    paidFrom: row.paid_from,
    payee: row.payee,
    notes: row.notes,
    shiftId: row.shift_id,
    status: row.status,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedByName: row.voided_by_name,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

/** The repository is used only when migration 020 has run; guard the old case. */
function tableExists(db: AppDatabase, name: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { total: number };
  return row.total > 0;
}

export function createExpensesRepository(db: AppDatabase) {
  const hasExpenses = tableExists(db, 'expenses');

  const EXPENSE_SELECT = `
    SELECT e.id, e.expense_no, e.category_id, c.name AS category_name, e.spent_on,
           e.amount, e.paid_from, e.payee, e.notes, e.shift_id, e.status,
           e.void_reason, e.voided_at, uv.full_name AS voided_by_name,
           e.created_by, u.full_name AS created_by_name, e.created_at
      FROM expenses e
      JOIN expense_categories c ON c.id = e.category_id
      JOIN users u ON u.id = e.created_by
      LEFT JOIN users uv ON uv.id = e.voided_by
  `;

  const selectCategories = db.prepare<[], CategoryRow>(`
    SELECT c.id, c.name, c.sort_order, c.is_system, c.active,
           (SELECT COUNT(*) FROM expenses e
             WHERE e.category_id = c.id AND e.status = 'active') AS expense_count,
           (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
             WHERE e.category_id = c.id AND e.status = 'active') AS total_amount
      FROM expense_categories c
     WHERE c.active = 1
     ORDER BY c.sort_order, c.name
  `);

  const selectCategory = db.prepare<[number], CategoryRow>(`
    SELECT c.id, c.name, c.sort_order, c.is_system, c.active,
           (SELECT COUNT(*) FROM expenses e
             WHERE e.category_id = c.id AND e.status = 'active') AS expense_count,
           (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
             WHERE e.category_id = c.id AND e.status = 'active') AS total_amount
      FROM expense_categories c
     WHERE c.id = ?
  `);

  const selectCategoryByName = db.prepare<[string], { id: number }>(
    'SELECT id FROM expense_categories WHERE name = ?',
  );

  const insertCategory = db.prepare(`
    INSERT INTO expense_categories (name, sort_order, is_system, active, created_at)
    VALUES (@name, @sortOrder, 0, 1, @now)
  `);

  const updateCategory = db.prepare(`
    UPDATE expense_categories SET name = @name, sort_order = @sortOrder WHERE id = @id
  `);

  const deactivateCategory = db.prepare(
    'UPDATE expense_categories SET active = 0 WHERE id = ?',
  );

  const selectExpense = hasExpenses
    ? db.prepare<[number], ExpenseRow>(`${EXPENSE_SELECT} WHERE e.id = ?`)
    : null;

  const selectExpenses = hasExpenses
    ? db.prepare<{ from: string; to: string; status: string; limit: number }, ExpenseRow>(`
        ${EXPENSE_SELECT}
        WHERE e.spent_on BETWEEN @from AND @to
          AND (@status = 'all' OR e.status = @status)
        ORDER BY e.spent_on DESC, e.id DESC
        LIMIT @limit
      `)
    : null;

  const selectSummary = hasExpenses
    ? db.prepare<[string, string], { category_name: string; count: number; total: number }>(`
        SELECT c.name AS category_name, COUNT(*) AS count, SUM(e.amount) AS total
          FROM expenses e
          JOIN expense_categories c ON c.id = e.category_id
         WHERE e.status = 'active' AND e.spent_on BETWEEN ? AND ?
         GROUP BY c.id
         ORDER BY total DESC
      `)
    : null;

  const selectTotal = hasExpenses
    ? db.prepare<[string, string], { total: number }>(`
        SELECT COALESCE(SUM(amount), 0) AS total
          FROM expenses
         WHERE status = 'active' AND spent_on BETWEEN ? AND ?
      `)
    : null;

  const insertExpense = hasExpenses
    ? db.prepare(`
        INSERT INTO expenses
          (expense_no, category_id, spent_on, amount, paid_from, payee, notes,
           shift_id, created_by, created_at)
        VALUES
          (@expenseNo, @categoryId, @spentOn, @amount, @paidFrom, @payee, @notes,
           @shiftId, @createdBy, @now)
      `)
    : null;

  const voidExpenseRow = hasExpenses
    ? db.prepare(`
        UPDATE expenses
           SET status = 'void', void_reason = @reason, voided_at = @now, voided_by = @by
         WHERE id = @id
      `)
    : null;

  const nextExpenseNumber = db.prepare<[], { total: number }>(
    'SELECT COUNT(*) AS total FROM expenses',
  );

  /**
   * The drawer row this expense wrote, if it paid in cash.
   *
   * Voiding needs to know which shift took the money and how much, so it can put
   * exactly that back and nothing else. `ref_expense_id` exists only after 020,
   * so older databases simply have no rows to find.
   */
  const selectDrawerRow = hasExpenses
    ? db.prepare<[number], { id: number; shift_id: number; amount: number }>(`
        SELECT id, shift_id, amount
          FROM cash_movements
         WHERE ref_expense_id = ? AND kind = 'expense'
         ORDER BY id DESC
         LIMIT 1
      `)
    : null;

  return {
    /** False on a database older than 020, so the IPC layer can say so politely. */
    isReady: hasExpenses,

    listCategories(): ExpenseCategory[] {
      return selectCategories.all().map(toCategory);
    },

    findCategory(id: number): ExpenseCategory | null {
      const row = selectCategory.get(id);
      return row ? toCategory(row) : null;
    },

    categoryNameTaken(name: string, exceptId: number | null): boolean {
      const row = selectCategoryByName.get(name);
      return row !== undefined && row.id !== exceptId;
    },

    createCategory(input: { name: string; sortOrder: number }): ExpenseCategory {
      const result = insertCategory.run({
        name: input.name,
        sortOrder: input.sortOrder,
        now: toSqlDateTime(),
      });
      const created = selectCategory.get(Number(result.lastInsertRowid));
      if (!created) throw new AppError('INTERNAL_ERROR', 'The category could not be saved');
      return toCategory(created);
    },

    updateCategory(input: { id: number; name: string; sortOrder: number }): ExpenseCategory {
      const existing = selectCategory.get(input.id);
      if (!existing) throw new AppError('NOT_FOUND', 'That category does not exist');
      updateCategoryRow(input);

      const updated = selectCategory.get(input.id);
      if (!updated) throw new AppError('INTERNAL_ERROR', 'The category could not be saved');
      return toCategory(updated);
    },

    /** Soft delete: history keeps the name it was filed under. */
    deactivateCategory(id: number): void {
      deactivateCategory.run(id);
    },

    nextExpenseNo(): string {
      const row = nextExpenseNumber.get();
      return `EXP-${String((row?.total ?? 0) + 1).padStart(5, '0')}`;
    },

    create(input: {
      expenseNo: string;
      categoryId: number;
      spentOn: string;
      amount: number;
      paidFrom: 'cash' | 'bank' | 'other';
      payee: string;
      notes: string;
      shiftId: number | null;
      createdBy: number;
    }): number {
      if (!insertExpense) throw new AppError('CONFLICT', 'Expenses are not available yet');
      const result = insertExpense.run({ ...input, now: toSqlDateTime() });
      return Number(result.lastInsertRowid);
    },

    find(id: number): Expense | null {
      if (!selectExpense) return null;
      const row = selectExpense.get(id);
      return row ? toExpense(row) : null;
    },

    list(filter: {
      from: string;
      to: string;
      status?: 'active' | 'void' | 'all';
      limit?: number;
    }): Expense[] {
      if (!selectExpenses) return [];
      const status = filter.status ?? 'active';
      return selectExpenses
        .all({
          from: filter.from,
          to: filter.to,
          status,
          limit: filter.limit ?? 500,
        })
        .map(toExpense);
    },

    summary(from: string, to: string): {
      rows: ExpenseSummaryRow[];
      total: number;
    } {
      if (!selectSummary || !selectTotal) return { rows: [], total: 0 };
      return {
        // Mapped here so the renderer never sees a database column name.
        rows: selectSummary.all(from, to).map((row) => ({
          categoryName: row.category_name,
          count: row.count,
          total: row.total,
        })),
        total: selectTotal.get(from, to)?.total ?? 0,
      };
    },

    /** The cash_out row written for this expense, or null. */
    drawerMovement(expenseId: number): { id: number; shiftId: number; amount: number } | null {
      if (!selectDrawerRow) return null;
      const row = selectDrawerRow.get(expenseId);
      return row ? { id: row.id, shiftId: row.shift_id, amount: row.amount } : null;
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    void(id: number, reason: string, by: number): void {
      if (!voidExpenseRow) return;
      voidExpenseRow.run({ id, reason, by, now: toSqlDateTime() });
    },
  };

  /**
   * Kept apart from the object literal so `updateCategory` (the prepared
   * statement) and the method of the same name cannot shadow each other.
   */
  function updateCategoryRow(input: { id: number; name: string; sortOrder: number }): void {
    updateCategory.run(input);
  }
}

export type ExpensesRepository = ReturnType<typeof createExpensesRepository>;
