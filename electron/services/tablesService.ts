import type { DiningTable, MergeResult, SplitResult } from '../../src/types/api';
import type { OrdersRepository } from '../db/repositories/ordersRepository';
import type { TablesRepository } from '../db/repositories/tablesRepository';
import type { PaymentsRepository } from '../db/repositories/paymentsRepository';
import type { SequenceRepository } from '../db/repositories/sequenceRepository';
import type { SettingsRepository } from '../db/repositories/settingsRepository';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

/**
 * The floor plan plus merge and split (Phase 3).
 *
 * The one invariant that matters: **money never moves between orders.**
 *
 * Merging two bills is safe because neither has been paid — the paid total is
 * checked before anything is touched, and a bill with any money on it is refused.
 * Splitting carves lines out of an unpaid bill into a brand-new order; the new
 * order gets its own ORD-/INV- numbers from the same sequences as everything else.
 *
 * Doing it the other way round (re-parenting payments, or editing a paid total)
 * would make the day-close cash report a lie, so it is simply not allowed.
 */
export function createTablesService(deps: {
  tables: TablesRepository;
  orders: OrdersRepository;
  payments: PaymentsRepository;
  sequences: SequenceRepository;
  settings: SettingsRepository;
}) {
  const { tables, orders, payments, sequences, settings } = deps;

  function orderOrFail(id: number) {
    const order = orders.find(id);
    if (!order) throw new AppError('NOT_FOUND', 'That order does not exist');
    return order;
  }

  /**
   * A bill is "live" when it can still change shape: dine-in, open, not cancelled,
   * not already absorbed by a merge, and with no money recorded against it.
   */
  function liveBillOrFail(id: number, label: string) {
    const order = orderOrFail(id);

    if (order.type !== 'dine_in') {
      throw new AppError('VALIDATION_ERROR', `${label} must be a dine-in bill`);
    }
    if (order.status === 'cancelled') {
      throw new AppError('CONFLICT', `${label} is cancelled`);
    }
    if (order.status === 'delivered') {
      throw new AppError('CONFLICT', `${label} is already closed`);
    }

    // The heart of it: any money at all, and the bill must not be reshaped.
    const paid = payments.sumByOrder(id);
    if (paid > 0 || order.paidAmount > 0) {
      throw new AppError(
        'CONFLICT',
        `${label} has a payment on it. Void the payment first, then merge or split.`,
      );
    }

    return order;
  }

  return {
    list(): DiningTable[] {
      return tables.list();
    },

    save(input: {
      id?: number;
      name: string;
      seats: number;
      area: string;
      active: boolean;
    }): DiningTable {
      return tables.save(input);
    },

    remove(id: number): void {
      tables.remove(id);
    },

    /**
     * Merges `sourceId` into `targetId`. The target keeps its number and becomes
     * the whole bill; the source is marked as absorbed so its number still leads
     * to the right order when a customer quotes it.
     */
    merge(input: { sourceId: number; targetId: number }, createdBy: number): MergeResult {
      if (input.sourceId === input.targetId) {
        throw new AppError('VALIDATION_ERROR', 'Choose two different bills');
      }

      const source = liveBillOrFail(input.sourceId, 'The bill being merged in');
      const target = liveBillOrFail(input.targetId, 'The bill being kept');

      // Wrapping in a transaction is not optional: a crash between moving the
      // lines and recalculating would leave a bill that is short of its items.
      orders.transaction(() => {
        orders.absorbOrder(source.id, target.id);
        orders.recalculateTotals(target.id);

        // Close the emptied bill. It keeps its totals so the day's paperwork still
        // adds up; merged_into_order_id is what says "look at the other bill".
        orders.markMerged(target.id, source.id);

        // Free the source's table, otherwise it looks occupied forever.
        tables.seatOrder(source.id, null);

        orders.recordCombine({
          kind: 'merge',
          sourceId: source.id,
          targetId: target.id,
          itemIds: [],
          amount: source.total,
          reason: `Merged ${source.orderNo} into ${target.orderNo}`,
          createdBy,
        });
      });

      logInfo(`Order ${source.orderNo} merged into ${target.orderNo}`);

      return {
        order: orderOrFail(target.id),
        mergedOrderNos: [source.orderNo],
      };
    },

    /**
     * Moves the chosen lines onto a brand-new bill.
     *
     * `moveTable` sends the new bill to a free table (a party splitting across two
     * tables). Without it the new bill is created unseated, which is what a
     * "one person pays for their own food" split looks like.
     */
    split(
      input: { orderId: number; itemIds: number[]; moveTable: boolean },
      createdBy: number,
    ): SplitResult {
      const source = liveBillOrFail(input.orderId, 'The bill being split');

      const lines = orders.itemsFor(source.id);
      const moving = input.itemIds.map((itemId) => {
        const line = lines.find((candidate) => candidate.id === itemId);
        if (!line) {
          throw new AppError('VALIDATION_ERROR', 'That line is not on this bill');
        }
        return line;
      });

      // A bill cannot be split into nothing: at least one line has to stay.
      if (moving.length >= lines.length) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Leave at least one line on the original bill. To move the whole bill, use merge.',
        );
      }

      let targetTableId: number | null = null;
      if (input.moveTable) {
        const free = tables.list().filter((table) => table.active && table.orderId === null);
        if (free.length === 0) {
          throw new AppError('CONFLICT', 'There is no free table to move these lines to');
        }
        targetTableId = free[0]?.id ?? null;
      }

      const orderPrefix = settings.get('order_prefix') ?? 'ORD';
      const invoicePrefix = settings.get('invoice_prefix') ?? 'INV';
      const movedTotal = moving.reduce((total, line) => total + line.lineTotal, 0);

      let targetId = 0;

      orders.transaction(() => {
        const orderNumber = sequences.next('order');
        const invoiceNumber = sequences.next('invoice');

        // The new bill starts from the source's shape, but with no discount: a
        // discount belongs to the bill the manager approved it for.
        targetId = orders.create({
          orderNo: `${orderPrefix}-${String(orderNumber).padStart(5, '0')}`,
          invoiceNo: `${invoicePrefix}-${String(invoiceNumber).padStart(5, '0')}`,
          type: 'dine_in',
          status: 'pending',
          tokenNo: null,
          tableId: targetTableId,
          customerName: source.customerName,
          customerPhone: source.customerPhone,
          customerAddress: '',
          waiterId: source.waiterId,
          deliveryBoyId: null,
          subtotal: 0,
          discount: 0,
          discountReason: '',
          promoCode: '',
          approvedBy: null,
          taxPercent: source.taxPercent,
          tax: 0,
          total: 0,
          notes: `Split from ${source.orderNo}`,
          createdBy,
          items: [],
        });

        orders.moveItems(
          moving.map((line) => line.id),
          targetId,
        );
        orders.markSplitFrom(source.id, targetId);

        orders.recalculateTotals(targetId);
        orders.recalculateTotals(source.id);

        if (targetTableId !== null) tables.seatOrder(targetId, targetTableId);

        orders.recordCombine({
          kind: 'split',
          sourceId: source.id,
          targetId,
          itemIds: moving.map((line) => line.id),
          amount: movedTotal,
          reason: `Split ${moving.length} line(s) off ${source.orderNo}`,
          createdBy,
        });
      });

      logInfo(`Order ${source.orderNo} split: ${moving.length} line(s) moved to a new bill`);

      return {
        source: orderOrFail(source.id),
        target: orderOrFail(targetId),
      };
    },
  };
}

export type TablesService = ReturnType<typeof createTablesService>;
