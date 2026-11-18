import type { AddPaymentInput, Payment, PaymentMethod } from '../../src/types/api';
import type { PaymentsRepository } from '../db/repositories/paymentsRepository';
import type { OrdersRepository } from '../db/repositories/ordersRepository';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

/**
 * Payments and udhaar. No Electron imports: the print/dialog layer is injected
 * elsewhere, which keeps the test harness and preview server working (R10).
 */
export function createPaymentsService(deps: {
  payments: PaymentsRepository;
  orders: OrdersRepository;
}) {
  const { payments, orders } = deps;

  function orderOrFail(orderId: number) {
    const order = orders.find(orderId);
    if (!order) throw new AppError('NOT_FOUND', 'That order does not exist');
    return order;
  }

  return {
    /** Takes a payment for an order and keeps paid_amount/payment_status in step. */
    addPayment(input: AddPaymentInput, createdBy: number): Payment {
      const order = orderOrFail(input.orderId);

      if (order.status === 'cancelled') {
        throw new AppError('CONFLICT', 'A cancelled order cannot take a payment');
      }

      const alreadyPaid = payments.sumByOrder(input.orderId);

      // Overpayment is a cashier mistake; refunds are a separate, deliberate action.
      const outstanding = Math.max(order.total - alreadyPaid, 0);
      if (input.amount > outstanding) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Payment is more than the outstanding amount (${outstanding} paisa)`,
        );
      }

      const payment = payments.addPayment({ ...input, createdBy });
      logInfo(`Payment recorded: order ${input.orderId}, ${input.method}, ${input.amount} paisa`);
      return payment;
    },

    voidPayment(paymentId: number, reason: string): Payment {
      const payment = payments.findPayment(paymentId);
      if (!payment) throw new AppError('NOT_FOUND', 'That payment does not exist');

      const voided = payments.voidPayment(paymentId, reason);
      logInfo(`Payment voided: ${paymentId} (${reason})`);
      return voided;
    },

    listByOrder(orderId: number): Payment[] {
      orderOrFail(orderId);
      return payments.listByOrder(orderId);
    },

    /** Outstanding udhaar per customer, biggest first. */
    udhaarList() {
      return payments.udhaarAccounts();
    },

    ledger(customerId: number) {
      return payments.ledgerFor(customerId);
    },

    /** Settles part or all of a customer's udhaar. */
    settle(
      input: {
        customerId: number;
        method: PaymentMethod;
        amount: number;
        reference: string;
        orderId: number | null;
      },
      createdBy: number,
    ) {
      const balance = payments.ledgerBalance(input.customerId);

      if (balance <= 0) {
        throw new AppError('CONFLICT', 'This customer has no udhaar to settle');
      }
      if (input.amount > balance) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Only ${balance} paisa is outstanding for this customer`,
        );
      }

      const entry = payments.settle({ ...input, createdBy });
      logInfo(`Udhaar settled: customer ${input.customerId}, ${input.amount} paisa`);
      return entry;
    },

    /** Cash/card/… collected in a window, straight from the payments table. */
    collections(fromDate: string, toDate: string) {
      return payments.collectionsByMethod(fromDate, toDate);
    },

    /** Sum of live payments per order, used by reports and the invoice. */
    sumByOrder(orderId: number): number {
      return payments.sumByOrder(orderId);
    },
  };
}

export type PaymentsService = ReturnType<typeof createPaymentsService>;
