import type {
  AmendOrderInput,
  AmendmentSnapshot,
  InvoiceData,
  OrderAmendment,
  NewOrderInput,
  OrderDetail,
  OrderFilter,
  OrderStatus,
  OrderSummary,
  UserRole,
} from '../../src/types/api';
import type { OrdersRepository } from '../db/repositories/ordersRepository';
import type { CatalogRepository } from '../db/repositories/catalogRepository';
import type { SequenceRepository } from '../db/repositories/sequenceRepository';
import type { SettingsRepository } from '../db/repositories/settingsRepository';
import type { StaffRepository } from '../db/repositories/staffRepository';
import type { UserRepository } from '../db/repositories/userRepository';
import { formatAmount, percentOf } from '../utils/money';
import { toSqlDate } from '../utils/datetime';
import type { DiscountsService } from './discountsService';
import type { KotRepository } from '../db/repositories/kotRepository';
import type { TablesRepository } from '../db/repositories/tablesRepository';
import type { PaymentsRepository } from '../db/repositories/paymentsRepository';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';
import type { StockDeductionService } from './stockDeductionService';

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
  /** Optional so the service still works in isolation; see createOrder's discount check. */
  discounts?: DiscountsService;
  /** Optional so the service still boots without the kitchen module. */
  kot?: KotRepository;
  /** Optional: the floor plan. Without it, dine-in orders are simply unseated. */
  tables?: TablesRepository;
  /** Optional: needed to know how much has been collected before an amendment. */
  payments?: PaymentsRepository;
  /**
   * Optional: takes ingredients off the shelf when a bill is saved (Roadmap 4.D).
   * Optional so the service still works in isolation and in older tests.
   */
  stock?: StockDeductionService;
}) {
  // `users` is kept in the dependency list because invoices record the cashier name
  // through the orders query; it is available for later phases (audit fields).
  const { orders, catalog, sequences, settings, staff, discounts, kot, tables, payments, stock } =
    deps;

  /** Money actually collected on a bill (voided payments excluded). */
  const paymentsSum = (orderId: number): number => payments?.sumByOrder(orderId) ?? 0;

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
    create(input: NewOrderInput, createdBy: number, role: UserRole = 'admin'): OrderDetail {
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
      // Never clamp silently: a discount larger than the bill is a data-entry mistake
      // and the cashier must see it (Rules.md: no silent money changes).
      if (input.discount > subtotal) {
        throw new AppError('VALIDATION_ERROR', 'Discount subtotal se zyada nahi ho sakta.');
      }

      // The role's discount rule is enforced HERE, in the main process, so a
      // cashier cannot bypass the limit by calling the channel directly.
      let approvedBy: number | null = null;
      let promoCode = '';
      let promoId: number | null = null;

      if (discounts && (input.discount > 0 || (input.promoCode ?? '').trim() !== '')) {
        const decision = discounts.resolve({
          role,
          subtotal,
          percentX100: 0,
          amount: input.discount,
          promoCode: input.promoCode ?? '',
          today: toSqlDate(),
        });

        if (decision.errors.length > 0) {
          throw new AppError('VALIDATION_ERROR', decision.errors[0] ?? 'Discount is not allowed');
        }

        promoCode = decision.promoCode;
        promoId = decision.promoId;

        if (decision.needsApproval) {
          // The approval row must already exist (discount:approve) and match this
          // cashier, otherwise the cashier could simply claim it was approved.
          if (typeof input.approvedBy !== 'number') {
            throw new AppError(
              'FORBIDDEN',
              'This discount needs a manager approval before the order can be saved',
            );
          }

          // `input.approvedBy` is the id of the discount_approvals row the manager
          // created moments ago — the order does not exist yet, so it cannot be
          // looked up by order id. The approval must match this exact amount and
          // this cashier, and must not already be spent on another order.
          const approval = discounts.findApproval(input.approvedBy);

          if (!approval) {
            throw new AppError('FORBIDDEN', 'That discount approval does not exist');
          }
          if (approval.amount !== input.discount) {
            throw new AppError('FORBIDDEN', 'That discount approval does not match this order');
          }
          if (approval.requestedBy !== createdBy) {
            throw new AppError('FORBIDDEN', 'That approval was given to a different cashier');
          }
          if (approval.orderId !== null) {
            throw new AppError('FORBIDDEN', 'That approval has already been used');
          }

          approvedBy = approval.approvedBy;
        }
      }

      const discount = input.discount;
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

      // A table holds one open bill at a time. This is checked in the main process
      // so a second till cannot seat two bills at T4 by calling the channel.
      const tableId = input.type === 'dine_in' ? (input.tableId ?? null) : null;
      if (tableId !== null) {
        if (!tables) throw new AppError('VALIDATION_ERROR', 'Tables are not available');
        if (!tables.isTableFree(tableId, null)) {
          throw new AppError('CONFLICT', 'That table already has a bill open');
        }
      }

      const orderPrefix = settings.get('order_prefix') ?? 'ORD';
      const invoicePrefix = settings.get('invoice_prefix') ?? 'INV';

      // Number allocation and the insert share ONE transaction: if the insert throws,
      // the counters roll back too and no ORD-/INV- number is burned (Rules.md: money
      // and sequences must be atomic).
      const orderId = orders.transaction(() => {
        const orderNumber = sequences.next('order');
        const invoiceNumber = sequences.next('invoice');

        // A token is the number called out to the customer. Delivery orders get
        // none: the rider knows the address, and a token would only confuse the
        // queue of people waiting at the counter.
        const tokenNo = input.type === 'delivery' ? null : (kot?.nextToken() ?? null);

        const newOrderId = orders.create({
          orderNo: `${orderPrefix}-${String(orderNumber).padStart(5, '0')}`,
          invoiceNo: `${invoicePrefix}-${String(invoiceNumber).padStart(5, '0')}`,
          type: input.type,
          status: input.status,
          tokenNo,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress,
          waiterId: input.type === 'dine_in' ? input.waiterId : null,
          deliveryBoyId: input.type === 'delivery' ? input.deliveryBoyId : null,
          subtotal,
          discount,
          discountReason: input.discountReason ?? '',
          promoCode,
          approvedBy,
          tableId,
          taxPercent: input.taxPercent,
          tax,
          total,
          notes: input.notes,
          createdBy,
          items: lines,
        });

        // Seat the order at its table in the same transaction, so the floor plan can
        // never show a bill that does not exist.
        if (tableId !== null) tables?.seatOrder(newOrderId, tableId);

        // Count the promo redemption in the same transaction, so a promo with a
        // use limit cannot be oversold by two tills at once (Rules.md R3).
        if (promoId !== null) {
          discounts?.registerPromoUse(promoId);
        }

        // Single-use approval, inside the same transaction (Rules.md R3).
        if (approvedBy !== null && typeof input.approvedBy === 'number') {
          discounts?.consumeApproval(input.approvedBy, newOrderId);
        }

        /*
         * Stock deduction (Roadmap 4.D) happens HERE, inside the same transaction
         * as the bill itself. If any ingredient check throws — a blocked sale on
         * an empty shelf — the order, its invoice, its token and the stock all
         * roll back together. A bill can never exist whose ingredients were not
         * taken off the shelf, and the shelf can never move for a bill that failed.
         */
        if (stock) {
          const saved = orders.find(newOrderId);
          if (saved) stock.deductOrder({ order: saved, createdBy });
        }

        return newOrderId;
      });

      logInfo(`Order created: ${orderId} (total ${total} paisa, ${lines.length} items)`);

      // Availability flags are cosmetic and must never fail an order that is
      // already saved and paid for, so they run after the commit, best effort.
      if (stock) {
        try {
          stock.refreshAvailability();
        } catch (error) {
          logInfo(`Could not refresh sold-out flags: ${String(error)}`);
        }
      }

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

    /**
     * Replaces the lines of a saved bill (Phase 3 amendments).
     *
     * Three rules make this safe to expose to a till:
     *
     *  1. **What is already paid is untouchable.** The new total must not drop
     *     below the money already collected — there is no refund screen that could
     *     put the difference back, so the amendment is refused instead.
     *  2. **The discount is re-checked for the role of the person editing.** A
     *     cashier cannot amend their way around the ceiling they could not pass at
     *     the till.
     *  3. **Both versions are snapshotted.** The bill before and after is written to
     *     order_amendments in the same transaction as the change.
     */
    amend(input: AmendOrderInput, editedBy: number, role: UserRole): OrderDetail {
      const order = findOrFail(input.id);

      if (order.status === 'cancelled') {
        throw new AppError('CONFLICT', 'A cancelled bill cannot be changed');
      }
      if (order.mergedIntoOrderId !== null) {
        throw new AppError('CONFLICT', 'This bill was merged into another one. Edit that bill.');
      }

      // Prices come from the menu, never from the renderer.
      const lines = input.items.map((line) => {
        const item = catalog.findItem(line.itemId);
        if (!item) throw new AppError('NOT_FOUND', `Item ${line.itemId} no longer exists`);

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

      if (input.discount > subtotal) {
        throw new AppError('VALIDATION_ERROR', 'Discount subtotal se zyada nahi ho sakta.');
      }

      // ---- the money already taken cannot be undone here ----
      const paid = paymentsSum(order.id);
      if (paid > 0 && subtotal - input.discount < paid) {
        throw new AppError(
          'CONFLICT',
          `This bill already has ${formatAmount(paid)} paid on it. The new total cannot be lower than that.`,
        );
      }

      // ---- the discount rule, for the role of the person editing ----
      let approvedBy: number | null = order.approvedBy;
      if (discounts && input.discount > 0) {
        const decision = discounts.resolve({
          role,
          subtotal,
          percentX100: 0,
          amount: input.discount,
          promoCode: '',
          today: toSqlDate(),
        });

        if (decision.errors.length > 0) {
          throw new AppError('VALIDATION_ERROR', decision.errors[0] ?? 'Discount is not allowed');
        }

        if (decision.needsApproval) {
          const approvalId = input.approvedBy;
          if (typeof approvalId !== 'number') {
            throw new AppError(
              'FORBIDDEN',
              'This discount needs a manager approval before the bill can be changed',
            );
          }

          const approval = discounts.findApproval(approvalId);
          if (!approval || approval.amount !== input.discount || approval.orderId !== null) {
            throw new AppError('FORBIDDEN', 'That discount approval does not match this change');
          }
          approvedBy = approval.approvedBy;
        }
      }

      const taxable = subtotal - input.discount;
      const tax = percentOf(taxable, order.taxPercent);
      const total = taxable + tax;

      const before: AmendmentSnapshot = {
        subtotal: order.subtotal,
        discount: order.discount,
        tax: order.tax,
        total: order.total,
        items: order.items.map((line) => ({
          itemId: line.itemId,
          name: line.name,
          qty: line.qty,
          price: line.price,
          lineTotal: line.lineTotal,
        })),
      };

      const after: AmendmentSnapshot = {
        subtotal,
        discount: input.discount,
        tax,
        total,
        items: lines.map((line) => ({
          itemId: line.itemId,
          name: line.name,
          qty: line.qty,
          price: line.price,
          lineTotal: line.lineTotal,
        })),
      };

      orders.transaction(() => {
        /*
         * Stock first (Roadmap 4.D): the old deductions are returned and the new
         * lines are costed at today's recipe and average price.
         *
         * This has to happen BEFORE the lines are deleted. `order_item_stock`
         * remembers which ingredients each line consumed, and its foreign key
         * points at `order_items.id`, so the snapshot must be released while the
         * lines still exist. It is also inside the transaction, so the shelf, the
         * snapshots and the bill can never disagree.
         */
        if (stock) stock.releaseOrder({ order, createdBy: editedBy });

        // Lines are replaced wholesale: an amendment states the full new bill, which
        // is far easier to reason about than a stream of add/remove deltas.
        for (const line of order.items) orders.removeItem(line.id);
        orders.insertItems(order.id, lines);

        orders.updateDetails(order.id, {
          customerName: input.customerName ?? order.customerName,
          customerPhone: input.customerPhone ?? order.customerPhone,
          customerAddress: input.customerAddress ?? order.customerAddress,
          waiterId: input.waiterId ?? order.waiterId,
          notes: input.notes ?? order.notes,
        });

        orders.setTotals(order.id, { subtotal, discount: input.discount, tax, total, approvedBy });

        orders.recordAmendment({
          orderId: order.id,
          reason: input.reason,
          beforeJson: JSON.stringify(before),
          afterJson: JSON.stringify(after),
          changedBy: editedBy,
        });

        if (typeof input.approvedBy === 'number' && approvedBy !== null) {
          discounts?.consumeApproval(input.approvedBy, order.id);
        }

        // Now that the new lines have ids, take their ingredients out. The cost of
        // an amended bill is today's cost: the amendment states what is being eaten
        // now. Old, untouched bills keep the snapshot they were saved with.
        if (stock) {
          const amended = orders.find(order.id);
          if (amended) stock.deductOrder({ order: amended, createdBy: editedBy });
        }
      });

      if (stock) {
        try {
          stock.refreshAvailability();
        } catch {
          // Cosmetic only.
        }
      }

      logInfo(
        `Order ${order.orderNo} amended: ${before.total} -> ${total} paisa (${input.reason})`,
      );

      return findOrFail(order.id);
    },

    amendments(id: number): OrderAmendment[] {
      findOrFail(id);
      return orders.amendmentsFor(id) as OrderAmendment[];
    },

    /**
     * Cancels a bill and decides what happens to its ingredients.
     *
     * `prepared` means the kitchen already cooked it. The default depends on the
     * status: nothing has been cooked while a bill is pending, and by the time it
     * is preparing or ready the food is on the pass. The cashier can override,
     * because only the person at the counter knows what really happened.
     */
    cancel(input: { id: number; prepared?: boolean }, cancelledBy: number): OrderSummary {
      const order = findOrFail(input.id);
      if (order.status === 'cancelled') {
        throw new AppError('CONFLICT', 'This order is already cancelled');
      }
      if (order.status === 'delivered') {
        throw new AppError('CONFLICT', 'A delivered order cannot be cancelled');
      }

      const prepared =
        input.prepared ?? (order.status === 'preparing' || order.status === 'ready');

      orders.transaction(() => {
        if (stock) stock.reverseOrder({ order, prepared, createdBy: cancelledBy });
        orders.updateStatus(order.id, 'cancelled');
      });

      if (stock) {
        try {
          stock.refreshAvailability();
        } catch {
          // Cosmetic only; the cancellation itself is already saved.
        }
      }

      logInfo(
        `Order ${order.orderNo} cancelled (${prepared ? 'already cooked' : 'not cooked'})`,
      );
      return orders.find(order.id) as OrderSummary;
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
