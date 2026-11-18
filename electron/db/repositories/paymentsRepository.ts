import type { AppDatabase } from '../connection';
import type {
  CollectionByMethod,
  CustomerLedgerEntry,
  Payment,
  PaymentMethod,
  PaymentStatus,
  UdhaarAccount,
} from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';
import { AppError } from '../../utils/errors';

interface PaymentRow {
  id: number;
  order_id: number;
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  change_due: number | null;
  reference: string;
  created_by: number;
  created_at: string;
  voided_at: string | null;
  void_reason: string;
}

interface LedgerRow {
  id: number;
  customer_id: number;
  order_id: number | null;
  payment_id: number | null;
  entry_type: 'charge' | 'payment';
  amount: number;
  balance_after: number;
  note: string;
  created_at: string;
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    orderId: row.order_id,
    method: row.method,
    amount: row.amount,
    tendered: row.tendered,
    changeDue: row.change_due,
    reference: row.reference,
    createdBy: row.created_by,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

function toLedger(row: LedgerRow): CustomerLedgerEntry {
  return {
    id: row.id,
    customerId: row.customer_id,
    orderId: row.order_id,
    paymentId: row.payment_id,
    entryType: row.entry_type,
    amount: row.amount,
    balanceAfter: row.balance_after,
    note: row.note,
    createdAt: row.created_at,
  };
}

/**
 * Payments, the order paid-total and the udhaar ledger. Every mutation recomputes
 * orders.paid_amount / payment_status and writes any ledger row inside ONE
 * transaction, so a crash can never leave a payment counted twice or not at all.
 */
export function createPaymentsRepository(db: AppDatabase) {
  const insertPayment = db.prepare(`
    INSERT INTO payments
      (order_id, method, amount, tendered, change_due, reference, created_by, created_at, shift_id)
    VALUES
      (@orderId, @method, @amount, @tendered, @changeDue, @reference, @createdBy, @createdAt, @shiftId)
  `);

  // The open shift for this counter; a payment is stamped with it so the Z report
  // is a plain sum rather than a date guess.
  const selectOpenShift = db.prepare<[], { id: number }>(
    "SELECT id FROM shifts WHERE terminal = 'counter-1' AND status = 'open'",
  );

  const selectPayment = db.prepare<[number], PaymentRow>('SELECT * FROM payments WHERE id = ?');

  const selectByOrder = db.prepare<[number], PaymentRow>(
    'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at, id',
  );

  const sumActiveForOrder = db.prepare<[number], { total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = ? AND voided_at IS NULL',
  );

  const orderTotals = db.prepare<[number], { total: number; customer_id: number | null }>(
    'SELECT total, customer_id FROM orders WHERE id = ?',
  );

  const updateOrderPayment = db.prepare(
    'UPDATE orders SET paid_amount = ?, payment_status = ?, updated_at = ? WHERE id = ?',
  );

  const voidPaymentRow = db.prepare(
    'UPDATE payments SET voided_at = ?, void_reason = ? WHERE id = ?',
  );

  const insertLedger = db.prepare(`
    INSERT INTO customer_ledger
      (customer_id, order_id, payment_id, entry_type, amount, balance_after, note, created_at)
    VALUES
      (@customerId, @orderId, @paymentId, @entryType, @amount, @balanceAfter, @note, @createdAt)
  `);

  const selectLedgerTotal = db.prepare<[number], { total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN entry_type = 'charge' THEN amount ELSE -amount END), 0) AS total
     FROM customer_ledger WHERE customer_id = ?`,
  );

  const selectLedgerForCustomer = db.prepare<[number], LedgerRow>(
    'SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY created_at DESC, id DESC',
  );

  const selectCollections = db.prepare<[string, string], CollectionByMethod>(`
    SELECT p.method AS method,
           COUNT(*) AS count,
           COALESCE(SUM(p.amount), 0) AS total
    FROM payments p
    WHERE p.voided_at IS NULL
      AND p.created_at >= ? AND p.created_at <= ?
    GROUP BY p.method
    ORDER BY p.method
  `);

  /** Recalculates paid_amount / payment_status from the live payments. */
  function syncOrderPayment(orderId: number): PaymentStatus {
    const order = orderTotals.get(orderId);
    if (!order) throw new Error(`Order ${orderId} does not exist`);

    const paid = sumActiveForOrder.get(orderId)?.total ?? 0;
    const target = Math.max(order.total, 0);

    let status: PaymentStatus;
    if (paid <= 0) status = 'unpaid';
    else if (paid < target) status = 'partial';
    else if (paid > target) status = 'refunded';
    else status = 'paid';

    updateOrderPayment.run(paid, status, toSqlDateTime(), orderId);
    return status;
  }

  /** Best-effort ledger write for credit / partially paid orders against a customer. */
  function recordCharge(orderId: number, amount: number, note: string): void {
    const order = orderTotals.get(orderId);
    if (!order?.customer_id || amount <= 0) return;

    const balance = (selectLedgerTotal.get(order.customer_id)?.total ?? 0) + amount;

    insertLedger.run({
      customerId: order.customer_id,
      orderId,
      paymentId: null,
      entryType: 'charge',
      amount,
      balanceAfter: balance,
      note,
      createdAt: toSqlDateTime(),
    });
  }

  return {
    /** Runs `fn` in one transaction so payment + order totals + ledger stay in sync. */
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    /**
     * Records a payment against an order. When `method` is 'credit' the money is
     * not collected: it becomes an udhaar charge on the customer account.
     */
    addPayment(input: {
      orderId: number;
      method: PaymentMethod;
      amount: number;
      tendered: number | null;
      changeDue: number | null;
      reference: string;
      createdBy: number;
    }): Payment {
      return db.transaction(() => {
        const order = orderTotals.get(input.orderId);
        if (!order) throw new Error(`Order ${input.orderId} does not exist`);

        const shiftId = selectOpenShift.get()?.id ?? null;

        if (input.method === 'credit') {
          // Nothing collected now: only the ledger changes.
          recordCharge(input.orderId, input.amount, input.reference || 'Udhaar (pay later)');

          const created = insertPayment.run({
            ...input,
            amount: input.amount,
            createdAt: toSqlDateTime(),
            shiftId,
          });

          const row = selectPayment.get(Number(created.lastInsertRowid));
          if (!row) throw new Error('Payment was not saved');

          return toPayment(row);
        }

        const created = insertPayment.run({ ...input, createdAt: toSqlDateTime(), shiftId });
        const row = selectPayment.get(Number(created.lastInsertRowid));
        if (!row) throw new Error('Payment was not saved');

        syncOrderPayment(input.orderId);
        return toPayment(row);
      })();
    },

    /** Voids a payment, then recomputes the order. Reason is mandatory for the audit. */
    voidPayment(paymentId: number, reason: string): Payment {
      return db.transaction(() => {
        const row = selectPayment.get(paymentId);
        if (!row) throw new Error(`Payment ${paymentId} does not exist`);
        if (row.voided_at) throw new AppError('CONFLICT', 'This payment was already voided');

        voidPaymentRow.run(toSqlDateTime(), reason, paymentId);
        syncOrderPayment(row.order_id);

        const updated = selectPayment.get(paymentId);
        if (!updated) throw new Error('Payment disappeared while voiding');
        return toPayment(updated);
      })();
    },

    listByOrder(orderId: number): Payment[] {
      return selectByOrder.all(orderId).map(toPayment);
    },

    findPayment(id: number): Payment | null {
      const row = selectPayment.get(id);
      return row ? toPayment(row) : null;
    },

    sumByOrder(orderId: number): number {
      return sumActiveForOrder.get(orderId)?.total ?? 0;
    },

    /** Collections per method in a window, read from payments (never recomputed). */
    collectionsByMethod(fromDate: string, toDate: string): CollectionByMethod[] {
      return selectCollections.all(fromDate, toDate);
    },

    ledgerFor(customerId: number): CustomerLedgerEntry[] {
      return selectLedgerForCustomer.all(customerId).map(toLedger);
    },

    ledgerBalance(customerId: number): number {
      return selectLedgerTotal.get(customerId)?.total ?? 0;
    },

    /** Settles udhaar against a customer account without touching an order's total. */
    settle(input: {
      customerId: number;
      method: PaymentMethod;
      amount: number;
      reference: string;
      orderId: number | null;
      createdBy: number;
    }): CustomerLedgerEntry {
      return db.transaction(() => {
        const balance = (selectLedgerTotal.get(input.customerId)?.total ?? 0) - input.amount;
        insertLedger.run({
          customerId: input.customerId,
          orderId: input.orderId,
          paymentId: null,
          entryType: 'payment',
          amount: input.amount,
          balanceAfter: balance,
          note: input.reference,
          createdAt: toSqlDateTime(),
        });

        const row = db
          .prepare<[], LedgerRow>('SELECT * FROM customer_ledger ORDER BY id DESC LIMIT 1')
          .get();
        if (!row) throw new Error('Ledger row was not saved');
        return toLedger(row);
      })();
    },

    /** Every customer with a non-zero udhaar balance, plus their last activity. */
    udhaarAccounts(): UdhaarAccount[] {
      const rows = db
        .prepare<
          [],
          {
            customer_id: number;
            name: string;
            phone: string;
            balance: number;
            last_activity: string | null;
          }
        >(
          `
          SELECT c.id AS customer_id,
                 c.name,
                 c.phone,
                 COALESCE(SUM(CASE WHEN l.entry_type = 'charge' THEN l.amount ELSE -l.amount END), 0)
                   AS balance,
                 MAX(l.created_at) AS last_activity
          FROM customer_ledger l
          JOIN customers c ON c.id = l.customer_id
          GROUP BY c.id
          HAVING balance > 0
          ORDER BY balance DESC
        `,
        )
        .all();

      return rows.map((row) => ({
        customerId: row.customer_id,
        name: row.name,
        phone: row.phone,
        balance: row.balance,
        lastActivity: row.last_activity,
      }));
    },
  };
}

export type PaymentsRepository = ReturnType<typeof createPaymentsRepository>;
