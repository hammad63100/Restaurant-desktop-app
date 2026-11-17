import type {
  InvoiceData,
  NewOrderInput,
  OrderDetail,
  OrderFilter,
  OrderStatus,
  OrderSummary,
} from '../../src/types/api';
import type { OrdersRepository } from '../db/repositories/ordersRepository';
import type { CatalogRepository } from '../db/repositories/catalogRepository';
import type { SequenceRepository } from '../db/repositories/sequenceRepository';
import type { SettingsRepository } from '../db/repositories/settingsRepository';
import type { StaffRepository } from '../db/repositories/staffRepository';
import type { UserRepository } from '../db/repositories/userRepository';
import { percentOf } from '../utils/money';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

/** Allowed status moves. A cancelled order is final, a delivered one cannot go back. */
const STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  pending: ['pending', 'preparing', 'ready', 'delivered', 'cancelled'],
  preparing: ['preparing', 'ready', 'delivered', 'cancelled'],
  ready: ['ready', 'delivered', 'cancelled'],
  delivered: ['delivered'],
  cancelled: ['cancelled'],
};

export function createOrdersService(deps: {
  orders: OrdersRepository;
  catalog: CatalogRepository;
  sequences: SequenceRepository;
  settings: SettingsRepository;
  staff: StaffRepository;
  users: UserRepository;
}) {
  // `users` is kept in the dependency list because invoices record the cashier name
  // through the orders query; it is available for later phases (audit fields).
  const { orders, catalog, sequences, settings, staff } = deps;

  function findOrFail(id: number): OrderDetail {
    const order = orders.find(id);
    if (!order) throw new AppError('NOT_FOUND', 'That order does not exist');
    return order;
  }

  return {
    /**
     * Prices are read from the database (never trusted from the renderer),
     * totals are computed in integer paisa, and the order + items + invoice
     * are written in one transaction.
     */
    create(input: NewOrderInput, createdBy: number): OrderDetail {
      const lines = input.items.map((line) => {
        const item = catalog.findItem(line.itemId);
        if (!item) throw new AppError('NOT_FOUND', `Item ${line.itemId} no longer exists`);
        if (!item.available) {
          throw new AppError('CONFLICT', `${item.name} is marked sold out`);
        }

        return {
          itemId: item.id,
          name: item.name,
          price: item.price,
          qty: line.qty,
          lineTotal: item.price * line.qty,
          notes: line.notes,
        };
      });

      const subtotal = lines.reduce((total, line) => total + line.lineTotal, 0);
      const discount = Math.min(input.discount, subtotal);
      const taxable = subtotal - discount;
      const tax = percentOf(taxable, input.taxPercent);
      const total = taxable + tax;

      if (total < 0) {
        throw new AppError('VALIDATION_ERROR', 'The order total cannot be negative');
      }

      if (input.waiterId !== null && !staff.findWaiter(input.waiterId)) {
        throw new AppError('NOT_FOUND', 'The selected waiter does not exist');
      }
      if (input.deliveryBoyId !== null && !staff.findDeliveryBoy(input.deliveryBoyId)) {
        throw new AppError('NOT_FOUND', 'The selected delivery boy does not exist');
      }

      const orderNumber = sequences.next('order');
      const invoiceNumber = sequences.next('invoice');
      const orderPrefix = settings.get('order_prefix') ?? 'ORD';
      const invoicePrefix = settings.get('invoice_prefix') ?? 'INV';

      const orderId = orders.create({
        orderNo: `${orderPrefix}-${String(orderNumber).padStart(5, '0')}`,
        invoiceNo: `${invoicePrefix}-${String(invoiceNumber).padStart(5, '0')}`,
        type: input.type,
        status: input.status,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerAddress: input.customerAddress,
        waiterId: input.type === 'dine_in' ? input.waiterId : null,
        deliveryBoyId: input.type === 'delivery' ? input.deliveryBoyId : null,
        subtotal,
        discount,
        taxPercent: input.taxPercent,
        tax,
        total,
        notes: input.notes,
        createdBy,
        items: lines,
      });

      logInfo(`Order created: ${orderId} (total ${total} paisa, ${lines.length} items)`);
      return findOrFail(orderId);
    },

    list(filter: OrderFilter): OrderSummary[] {
      return orders.list(filter);
    },

    get(id: number): OrderDetail {
      return findOrFail(id);
    },

    updateStatus(id: number, status: OrderStatus): OrderSummary {
      const order = findOrFail(id);
      const allowed = STATUS_FLOW[order.status];

      if (!allowed.includes(status)) {
        throw new AppError(
          'CONFLICT',
          order.status === 'cancelled'
            ? 'A cancelled order cannot be changed'
            : `A ${order.status} order cannot be moved to ${status}`,
        );
      }

      orders.updateStatus(id, status);
      logInfo(`Order ${order.orderNo} status: ${order.status} -> ${status}`);
      return orders.find(id) as OrderSummary;
    },

    cancel(id: number): OrderSummary {
      const order = findOrFail(id);
      if (order.status === 'cancelled') {
        throw new AppError('CONFLICT', 'This order is already cancelled');
      }
      if (order.status === 'delivered') {
        throw new AppError('CONFLICT', 'A delivered order cannot be cancelled');
      }

      orders.updateStatus(id, 'cancelled');
      logInfo(`Order ${order.orderNo} cancelled`);
      return orders.find(id) as OrderSummary;
    },

    /** Data the invoice template needs: order + items + shop header + cashier name. */
    invoice(id: number): InvoiceData {
      const order = findOrFail(id);
      return {
        order,
        shop: settings.readShopSettings(),
        cashierName: order.createdByName || 'Counter',
      };
    },

    markPrinted(id: number): OrderDetail {
      findOrFail(id);
      orders.markInvoicePrinted(id);
      return findOrFail(id);
    },
  };
}

export type OrdersService = ReturnType<typeof createOrdersService>;
