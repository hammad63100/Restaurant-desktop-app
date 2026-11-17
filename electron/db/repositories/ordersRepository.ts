import type { AppDatabase } from '../connection';
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
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  waiter_id: number | null;
  delivery_boy_id: number | null;
  waiter_name: string | null;
  delivery_boy_name: string | null;
  subtotal: number;
  discount: number;
  tax_percent: number;
  tax: number;
  total: number;
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
  SELECT o.id, o.order_no, i.invoice_no, o.type, o.status,
         o.customer_name, o.customer_phone, o.customer_address,
         o.waiter_id, o.delivery_boy_id,
         w.name AS waiter_name,
         d.name AS delivery_boy_name,
         o.subtotal, o.discount, o.tax_percent, o.tax, o.total, o.notes,
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
  customerName: row.customer_name,
  customerPhone: row.customer_phone,
  subtotal: row.subtotal,
  discount: row.discount,
  tax: row.tax,
  total: row.total,
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
      notes, created_by, created_at, updated_at
    ) VALUES (
      @orderNo, @type, @customerId, @customerName, @customerPhone, @customerAddress,
      @waiterId, @deliveryBoyId, @status, @subtotal, @discount, @taxPercent, @tax, @total,
      @notes, @createdBy, @now, @now
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
    /** Creates the order, its items and its invoice inside one transaction. */
    create(input: {
      orderNo: string;
      invoiceNo: string;
      type: OrderType;
      status: OrderStatus;
      customerName: string;
      customerPhone: string;
      customerAddress: string;
      waiterId: number | null;
      deliveryBoyId: number | null;
      subtotal: number;
      discount: number;
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

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `${ORDER_SELECT} ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`;
      params.push(filter.limit);

      const rows = db.prepare(sql).all(...params) as OrderRow[];
      return rows.map(toSummary);
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
