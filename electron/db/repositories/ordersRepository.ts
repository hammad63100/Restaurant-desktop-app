import type { AppDatabase } from '../connection';
import { AppError } from '../../utils/errors';
import type {
  OrderDetail,
  OrderFilter,
  OrderItemRecord,
  OrderStatus,
  OrderSummary,
  OrderType,
} from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';

interface OrderRow {
  id: number;
  order_no: string;
  invoice_no: string | null;
  type: OrderType;
  status: OrderStatus;
  token_no: number | null;
  amendment_count: number;
  merged_into_order_id: number | null;
  split_from_order_id: number | null;
  table_id: number | null;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  waiter_id: number | null;
  delivery_boy_id: number | null;
  approved_by: number | null;
  waiter_name: string | null;
  delivery_boy_name: string | null;
  subtotal: number;
  discount: number;
  tax_percent: number;
  tax: number;
  total: number;
  paid_amount: number;
  payment_status: OrderSummary['paymentStatus'];
  notes: string;
  created_at: string;
  created_by_name: string;
  printed_at: string | null;
}

interface OrderItemRow {
  id: number;
  item_id: number;
  name: string;
  price: number;
  qty: number;
  line_total: number;
  notes: string;
}

const ORDER_SELECT = `
  SELECT o.id, o.order_no, i.invoice_no, o.type, o.status, o.token_no, o.amendment_count,
         o.merged_into_order_id, o.split_from_order_id, o.table_id, o.approved_by,
         o.customer_name, o.customer_phone, o.customer_address,
         o.waiter_id, o.delivery_boy_id,
         w.name AS waiter_name,
         d.name AS delivery_boy_name,
         o.subtotal, o.discount, o.tax_percent, o.tax, o.total, o.notes,
         o.paid_amount, o.payment_status,
         o.created_at, u.full_name AS created_by_name, i.printed_at
    FROM orders o
    LEFT JOIN invoices i ON i.order_id = o.id
    LEFT JOIN waiters w ON w.id = o.waiter_id
    LEFT JOIN delivery_boys d ON d.id = o.delivery_boy_id
    JOIN users u ON u.id = o.created_by
`;

const toSummary = (row: OrderRow): OrderSummary => ({
  id: row.id,
  orderNo: row.order_no,
  invoiceNo: row.invoice_no,
  type: row.type,
  status: row.status,
  tokenNo: row.token_no,
  amendmentCount: row.amendment_count,
  mergedIntoOrderId: row.merged_into_order_id,
  splitFromOrderId: row.split_from_order_id,
  tableId: row.table_id,
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  subtotal: row.subtotal,
  discount: row.discount,
  tax: row.tax,
  total: row.total,
  paidAmount: row.paid_amount,
  paymentStatus: row.payment_status,
  createdAt: row.created_at,
  createdByName: row.created_by_name,
  waiterName: row.waiter_name,
  deliveryBoyName: row.delivery_boy_name,
});

const toItem = (row: OrderItemRow): OrderItemRecord => ({
  id: row.id,
  itemId: row.item_id,
  name: row.name,
  price: row.price,
  qty: row.qty,
  lineTotal: row.line_total,
  notes: row.notes,
});

const toDetail = (row: OrderRow, items: OrderItemRecord[]): OrderDetail => ({
  ...toSummary(row),
  customerAddress: row.customer_address,
  waiterId: row.waiter_id,
  deliveryBoyId: row.delivery_boy_id,
  approvedBy: row.approved_by,
  taxPercent: row.tax_percent,
  notes: row.notes,
  printedAt: row.printed_at,
  items,
});

export function createOrdersRepository(db: AppDatabase) {
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      order_no, type, customer_id, customer_name, customer_phone, customer_address,
      waiter_id, delivery_boy_id, status, subtotal, discount, tax_percent, tax, total,
      notes, created_by, created_at, updated_at,
      discount_reason, promo_code, approved_by, token_no, table_id
    ) VALUES (
      @orderNo, @type, @customerId, @customerName, @customerPhone, @customerAddress,
      @waiterId, @deliveryBoyId, @status, @subtotal, @discount, @taxPercent, @tax, @total,
      @notes, @createdBy, @now, @now,
      @discountReason, @promoCode, @approvedBy, @tokenNo, @tableId
    )
  `);
  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (order_id, item_id, name, price, qty, line_total, notes)
    VALUES (@orderId, @itemId, @name, @price, @qty, @lineTotal, @notes)
  `);
  const insertInvoice = db.prepare(`
    INSERT INTO invoices (invoice_no, order_id, printed_at, created_at) VALUES (?, ?, NULL, ?)
  `);
  const selectOrderById = db.prepare<[number], OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`);
  const selectItemsForOrder = db.prepare<[number], OrderItemRow>(
    'SELECT id, item_id, name, price, qty, line_total, notes FROM order_items WHERE order_id = ? ORDER BY id',
  );
  const updateStatus = db.prepare(
    'UPDATE orders SET status = ?, updated_at = ?, cancelled_at = ? WHERE id = ?',
  );
  const markPrinted = db.prepare('UPDATE invoices SET printed_at = ? WHERE order_id = ?');

  /* ------------------------- merge / split (Phase 3) ------------------------- */

  const selectItemRows = db.prepare<[number], OrderItemRow>(
    'SELECT id, item_id, name, price, qty, line_total, notes FROM order_items WHERE order_id = ? ORDER BY id',
  );
  const selectItemById = db.prepare<[number], OrderItemRow>(
    'SELECT id, item_id, name, price, qty, line_total, notes FROM order_items WHERE id = ?',
  );
  const deleteItem = db.prepare('DELETE FROM order_items WHERE id = ?');
  const reparentItem = db.prepare('UPDATE order_items SET order_id = ? WHERE id = ?');
  const countItems = db.prepare<[number], { total: number }>(
    'SELECT COUNT(*) AS total FROM order_items WHERE order_id = ?',
  );
  const setMergedInto = db.prepare(
    'UPDATE orders SET merged_into_order_id = ?, status = ?, updated_at = ? WHERE id = ?',
  );
  const setSplitFrom = db.prepare('UPDATE orders SET split_from_order_id = ? WHERE id = ?');
  const setOrderTotals = db.prepare(
    'UPDATE orders SET subtotal = ?, discount = ?, tax = ?, total = ?, updated_at = ? WHERE id = ?',
  );
  /* ------------------------- amendments (migration 013) ------------------------- */

  const updateDetailsRow = db.prepare(`
    UPDATE orders
       SET customer_name = @customerName, customer_phone = @customerPhone,
           customer_address = @customerAddress, waiter_id = @waiterId,
           notes = @notes, updated_at = @updatedAt
     WHERE id = @id
  `);
  const setTotalsWithApproval = db.prepare(`
    UPDATE orders
       SET subtotal = @subtotal, discount = @discount, tax = @tax, total = @total,
           approved_by = @approvedBy, updated_at = @updatedAt
     WHERE id = @id
  `);

  const insertAmendment = db.prepare(`
    INSERT INTO order_amendments
      (order_id, version, reason, before_json, after_json, changed_by, created_at)
    VALUES (@orderId, @version, @reason, @beforeJson, @afterJson, @changedBy, @createdAt)
  `);
  const selectAmendments = db.prepare<
    [number],
    {
      version: number;
      reason: string;
      before_json: string;
      after_json: string;
      changed_by_name: string;
      created_at: string;
    }
  >(`
    SELECT a.version, a.reason, a.before_json, a.after_json,
           u.full_name AS changed_by_name, a.created_at
      FROM order_amendments a
      JOIN users u ON u.id = a.changed_by
     WHERE a.order_id = ?
     ORDER BY a.version
  `);
  const nextVersion = db.prepare<[number], { next: number }>(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM order_amendments WHERE order_id = ?',
  );
  const bumpAmendmentCount = db.prepare(
    'UPDATE orders SET amendment_count = amendment_count + 1 WHERE id = ?',
  );
  const insertCombine = db.prepare(`
    INSERT INTO order_combines (kind, source_id, target_id, item_ids, amount, reason, created_by, created_at)
    VALUES (@kind, @sourceId, @targetId, @itemIds, @amount, @reason, @createdBy, @createdAt)
  `);
  const findInvoiceNo = db.prepare<[number], { invoice_no: string }>(
    'SELECT invoice_no FROM invoices WHERE order_id = ?',
  );

  const upsertCustomer = db.prepare(`
    INSERT INTO customers (name, phone, address, created_at, updated_at)
    VALUES (@name, @phone, @address, @now, @now)
    ON CONFLICT (phone) WHERE phone <> ''
    DO UPDATE SET name = excluded.name, address = excluded.address,
                  updated_at = excluded.updated_at
  `);
  const findCustomerByPhone = db.prepare<[string], { id: number }>(
    'SELECT id FROM customers WHERE phone = ?',
  );

  const sumToday = db.prepare<[string], { orders: number; sales: number }>(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS sales
      FROM orders
     WHERE status <> 'cancelled' AND date(created_at) = ?
  `);
  const sumRange = db.prepare<
    [string, string],
    { orders: number; sales: number; discount: number; tax: number }
  >(`
    SELECT COUNT(*) AS orders,
           COALESCE(SUM(total), 0) AS sales,
           COALESCE(SUM(discount), 0) AS discount,
           COALESCE(SUM(tax), 0) AS tax
      FROM orders
     WHERE status <> 'cancelled' AND date(created_at) BETWEEN ? AND ?
  `);
  const countCancelled = db.prepare<[string, string], { total: number }>(
    "SELECT COUNT(*) AS total FROM orders WHERE status = 'cancelled' AND date(created_at) BETWEEN ? AND ?",
  );
  const countPendingDeliveries = db.prepare<[], { total: number }>(
    "SELECT COUNT(*) AS total FROM orders WHERE type = 'delivery' AND status IN ('pending', 'preparing', 'ready')",
  );

  return {
    /**
     * Runs `fn` inside one SQLite transaction. Exposed so a caller can group work
     * that spans repositories (allocating an order number and inserting the order)
     * into a single atomic unit. If `fn` throws, everything rolls back — including
     * the sequence rows — so a failed save never burns an ORD-/INV- number.
     */
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    /** Creates the order, its items and its invoice inside one transaction. */
    create(input: {
      orderNo: string;
      invoiceNo: string;
      type: OrderType;
      status: OrderStatus;
      /** Customer-facing token, allocated by kotRepository inside this transaction. */
      tokenNo: number | null;
      /** Dine-in table, or null for takeaway/delivery. */
      tableId: number | null;
      customerName: string;
      customerPhone: string;
      customerAddress: string;
      waiterId: number | null;
      deliveryBoyId: number | null;
      subtotal: number;
      discount: number;
      discountReason: string;
      promoCode: string;
      approvedBy: number | null;
      taxPercent: number;
      tax: number;
      total: number;
      notes: string;
      createdBy: number;
      items: Array<{
        itemId: number;
        name: string;
        price: number;
        qty: number;
        lineTotal: number;
        notes: string;
      }>;
    }): number {
      const run = db.transaction((payload: typeof input) => {
        const now = toSqlDateTime();
        let customerId: number | null = null;

        if (payload.customerPhone) {
          upsertCustomer.run({
            name: payload.customerName || 'Walk-in',
            phone: payload.customerPhone,
            address: payload.customerAddress,
            now,
          });
          customerId = findCustomerByPhone.get(payload.customerPhone)?.id ?? null;
        }

        const result = insertOrder.run({
          // Discount audit fields (migration 010). Always present, even when empty.
          discountReason: payload.discountReason ?? '',
          promoCode: payload.promoCode ?? '',
          approvedBy: payload.approvedBy ?? null,
          tokenNo: payload.tokenNo ?? null,
          tableId: payload.tableId ?? null,
          orderNo: payload.orderNo,
          type: payload.type,
          customerId,
          customerName: payload.customerName,
          customerPhone: payload.customerPhone,
          customerAddress: payload.customerAddress,
          waiterId: payload.waiterId,
          deliveryBoyId: payload.deliveryBoyId,
          status: payload.status,
          subtotal: payload.subtotal,
          discount: payload.discount,
          taxPercent: payload.taxPercent,
          tax: payload.tax,
          total: payload.total,
          notes: payload.notes,
          createdBy: payload.createdBy,
          now,
        });

        const orderId = Number(result.lastInsertRowid);

        for (const item of payload.items) {
          insertOrderItem.run({ orderId, ...item });
        }

        insertInvoice.run(payload.invoiceNo, orderId, now);
        return orderId;
      });

      return run(input);
    },

    find(id: number): OrderDetail | null {
      const row = selectOrderById.get(id);
      if (!row) return null;
      const items = selectItemsForOrder.all(id).map(toItem);
      return toDetail(row, items);
    },

    list(filter: OrderFilter): OrderSummary[] {
      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (filter.status !== 'all') {
        conditions.push('o.status = ?');
        params.push(filter.status);
      }
      if (filter.type !== 'all') {
        conditions.push('o.type = ?');
        params.push(filter.type);
      }
      if (filter.search) {
        conditions.push(
          '(o.order_no LIKE ? OR i.invoice_no LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)',
        );
        const like = `%${filter.search}%`;
        params.push(like, like, like, like);
      }
      if (filter.fromDate) {
        conditions.push('date(o.created_at) >= ?');
        params.push(filter.fromDate);
      }
      if (filter.toDate) {
        conditions.push('date(o.created_at) <= ?');
        params.push(filter.toDate);
      }

      // Keyset paging. The tuple comparison is spelled out because SQLite does not
      // support `(a, b) < (?, ?)` before 3.15 — and spelling it out also makes the
      // "same timestamp, lower id" tie-break obvious.
      if (filter.after) {
        conditions.push('(o.created_at < ? OR (o.created_at = ? AND o.id < ?))');
        params.push(filter.after.createdAt, filter.after.createdAt, filter.after.id);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `${ORDER_SELECT} ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`;
      params.push(filter.limit);

      const rows = db.prepare(sql).all(...params) as OrderRow[];
      return rows.map(toSummary);
    },

    itemsFor(orderId: number) {
      return selectItemsForOrder.all(orderId).map(toItem);
    },

    /**
     * Recalculates subtotal / discount / tax / total from the lines that are
     * actually on the order. Merge and split both need this, and both must do it
     * inside their transaction so a half-moved bill is never visible.
     *
     * The discount is recomputed from the same percentage it represented before,
     * capped at the new subtotal — the alternative is silently keeping a discount
     * that no longer relates to what the customer is buying.
     */
    recalculateTotals(orderId: number): void {
      const row = selectOrderById.get(orderId);
      if (!row) throw new AppError('NOT_FOUND', 'That order does not exist');

      const subtotal = selectItemRows
        .all(orderId)
        .reduce((total, item) => total + item.line_total, 0);

      const previousSubtotal = row.subtotal > 0 ? row.subtotal : 0;
      const discountPercent =
        previousSubtotal > 0 ? Math.round((row.discount / previousSubtotal) * 10_000) : 0;
      const discount =
        discountPercent > 0
          ? Math.min(Math.round((subtotal * discountPercent) / 10_000), subtotal)
          : 0;

      const taxable = subtotal - discount;
      const tax = Math.round((taxable * row.tax_percent) / 100);

      setOrderTotals.run(subtotal, discount, tax, taxable + tax, toSqlDateTime(), orderId);
    },

    /** Inserts lines onto an existing order. Call inside the order's transaction. */
    insertItems(
      orderId: number,
      items: Array<{
        itemId: number;
        name: string;
        price: number;
        qty: number;
        lineTotal: number;
        notes: string;
      }>,
    ): void {
      for (const item of items) insertOrderItem.run({ orderId, ...item });
    },

    /** Customer / waiter / notes on an order, leaving money alone. */
    updateDetails(
      orderId: number,
      input: {
        customerName: string;
        customerPhone: string;
        customerAddress: string;
        waiterId: number | null;
        notes: string;
      },
    ): void {
      updateDetailsRow.run({ ...input, updatedAt: toSqlDateTime(), id: orderId });
    },

    /** Writes a recalculated total, and who approved the discount on it. */
    setTotals(
      orderId: number,
      input: {
        subtotal: number;
        discount: number;
        tax: number;
        total: number;
        approvedBy: number | null;
      },
    ): void {
      setTotalsWithApproval.run({ ...input, updatedAt: toSqlDateTime(), id: orderId });
    },

    /** Moves every line and the discount policy of `sourceId` onto `targetId`. */
    absorbOrder(sourceId: number, targetId: number): void {
      for (const item of selectItemRows.all(sourceId)) {
        reparentItem.run(targetId, item.id);
      }
    },

    moveItems(itemIds: number[], targetId: number): void {
      for (const itemId of itemIds) {
        reparentItem.run(targetId, itemId);
      }
    },

    findItem(id: number) {
      const row = selectItemById.get(id);
      return row ? toItem(row) : null;
    },

    removeItem(id: number): void {
      deleteItem.run(id);
    },

    itemCount(orderId: number): number {
      return countItems.get(orderId)?.total ?? 0;
    },

    /** Marks an order as absorbed by another one. Its money stays where it is. */
    markMerged(mergedInto: number, sourceId: number): void {
      const now = toSqlDateTime();
      setMergedInto.run(mergedInto, 'delivered', now, sourceId);
    },

    markSplitFrom(sourceId: number, targetId: number): void {
      setSplitFrom.run(sourceId, targetId);
    },

    recordCombine(input: {
      kind: 'merge' | 'split';
      sourceId: number;
      targetId: number;
      itemIds: number[];
      amount: number;
      reason: string;
      createdBy: number;
    }): void {
      insertCombine.run({
        ...input,
        itemIds: JSON.stringify(input.itemIds),
        createdAt: toSqlDateTime(),
      });
    },

    /**
     * Writes one amendment with full before/after snapshots. Call inside the same
     * transaction as the line changes, so history can never disagree with the data.
     */
    recordAmendment(input: {
      orderId: number;
      reason: string;
      beforeJson: string;
      afterJson: string;
      changedBy: number;
    }): number {
      const version = nextVersion.get(input.orderId)?.next ?? 1;

      insertAmendment.run({ ...input, version, createdAt: toSqlDateTime() });
      bumpAmendmentCount.run(input.orderId);

      return version;
    },

    amendmentsFor(orderId: number) {
      return selectAmendments.all(orderId).map((row) => ({
        version: row.version,
        reason: row.reason,
        before: JSON.parse(row.before_json) as unknown,
        after: JSON.parse(row.after_json) as unknown,
        changedByName: row.changed_by_name,
        createdAt: row.created_at,
      }));
    },

    updateStatus(id: number, status: OrderStatus): void {
      const now = toSqlDateTime();
      updateStatus.run(status, now, status === 'cancelled' ? now : null, id);
    },

    invoiceNoFor(orderId: number): string | null {
      return findInvoiceNo.get(orderId)?.invoice_no ?? null;
    },

    markInvoicePrinted(orderId: number): void {
      markPrinted.run(toSqlDateTime(), orderId);
    },

    todayTotals(today: string): { orders: number; sales: number } {
      return sumToday.get(today) ?? { orders: 0, sales: 0 };
    },

    rangeTotals(fromDate: string, toDate: string) {
      const row = sumRange.get(fromDate, toDate);
      return {
        orders: row?.orders ?? 0,
        sales: row?.sales ?? 0,
        discount: row?.discount ?? 0,
        tax: row?.tax ?? 0,
        cancelled: countCancelled.get(fromDate, toDate)?.total ?? 0,
      };
    },

    salesByDay(
      fromDate: string,
      toDate: string,
    ): Array<{ date: string; orders: number; sales: number }> {
      return db
        .prepare(
          `SELECT date(created_at) AS date,
                  COUNT(*) AS orders,
                  COALESCE(SUM(total), 0) AS sales
             FROM orders
            WHERE status <> 'cancelled' AND date(created_at) BETWEEN ? AND ?
            GROUP BY date(created_at)
            ORDER BY date(created_at)`,
        )
        .all(fromDate, toDate) as Array<{ date: string; orders: number; sales: number }>;
    },

    salesByType(fromDate: string, toDate: string) {
      return db
        .prepare(
          `SELECT type, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS sales
             FROM orders
            WHERE status <> 'cancelled' AND date(created_at) BETWEEN ? AND ?
            GROUP BY type
            ORDER BY type`,
        )
        .all(fromDate, toDate) as Array<{ type: OrderType; orders: number; sales: number }>;
    },

    topItems(fromDate: string, toDate: string, limit = 10) {
      return db
        .prepare(
          `SELECT oi.item_id AS itemId, oi.name AS name,
                  SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE o.status <> 'cancelled' AND date(o.created_at) BETWEEN ? AND ?
            GROUP BY oi.item_id, oi.name
            ORDER BY qty DESC
            LIMIT ?`,
        )
        .all(fromDate, toDate, limit) as Array<{
        itemId: number;
        name: string;
        qty: number;
        revenue: number;
      }>;
    },

    deliveriesByBoy(fromDate: string, toDate: string) {
      return db
        .prepare(
          `SELECT o.delivery_boy_id AS deliveryBoyId,
                  d.name AS name,
                  COUNT(*) AS deliveries,
                  COALESCE(SUM(o.total), 0) AS deliveredValue,
                  COALESCE(SUM(ROUND(o.total * d.commission / 100.0)), 0) AS commission
             FROM orders o
             JOIN delivery_boys d ON d.id = o.delivery_boy_id
            WHERE o.type = 'delivery' AND o.status = 'delivered'
              AND date(o.created_at) BETWEEN ? AND ?
            GROUP BY o.delivery_boy_id, d.name
            ORDER BY deliveries DESC`,
        )
        .all(fromDate, toDate) as Array<{
        deliveryBoyId: number;
        name: string;
        deliveries: number;
        deliveredValue: number;
        commission: number;
      }>;
    },

    pendingDeliveries(): number {
      return countPendingDeliveries.get()?.total ?? 0;
    },

    recent(limit = 8): OrderSummary[] {
      const rows = db
        .prepare(`${ORDER_SELECT} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`)
        .all(limit) as OrderRow[];
      return rows.map(toSummary);
    },

    rangeSales(fromDate: string, toDate: string): number {
      return sumRange.get(fromDate, toDate)?.sales ?? 0;
    },
  };
}

export type OrdersRepository = ReturnType<typeof createOrdersRepository>;
