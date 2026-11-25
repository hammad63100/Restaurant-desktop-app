import { z } from 'zod';
import { CHANNELS, type AddPaymentInput, type PaymentMethod } from '../../src/types/api';
import { paymentSchema, paymentVoidSchema, udhaarSettleSchema } from '../../src/types/schemas';
import type { PaymentsService } from '../services/paymentsService';
import type { HandlerContext, HandlerRegistry } from './registry';

/**
 * Payments + udhaar. Capabilities come from permissions.ts:
 * a cashier may take a payment and read udhaar, but only a manager/admin may
 * void money or settle a customer account.
 */
export function paymentsHandlers(payments: PaymentsService): HandlerRegistry {
  return {
    [CHANNELS.paymentAdd]: {
      capability: 'payments:write',
      schema: paymentSchema,
      handler: (input: AddPaymentInput, context: HandlerContext) =>
        payments.addPayment(input, context.user.id),
    },

    [CHANNELS.paymentVoid]: {
      capability: 'payments:void',
      schema: paymentVoidSchema,
      handler: (input: { id: number; reason: string }) =>
        payments.voidPayment(input.id, input.reason),
    },

    [CHANNELS.paymentListByOrder]: {
      capability: 'payments:write',
      schema: z.object({ orderId: z.number().int().positive() }),
      handler: (input: { orderId: number }) => payments.listByOrder(input.orderId),
    },

    [CHANNELS.udhaarList]: {
      capability: 'udhaar:read',
      handler: () => payments.udhaarList(),
    },

    [CHANNELS.udhaarLedger]: {
      capability: 'udhaar:read',
      schema: z.object({ customerId: z.number().int().positive() }),
      handler: (input: { customerId: number }) => payments.ledger(input.customerId),
    },

    [CHANNELS.udhaarSettle]: {
      capability: 'udhaar:settle',
      schema: udhaarSettleSchema,
      handler: (
        input: {
          customerId: number;
          method: PaymentMethod;
          amount: number;
          reference: string;
          orderId: number | null;
        },
        context: HandlerContext,
      ) => payments.settle(input, context.user.id),
    },
  };
}
