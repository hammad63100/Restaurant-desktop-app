import { z } from 'zod';
import { CHANNELS, type NewOrderInput, type OrderStatus } from '../../src/types/api';
import { amendOrderSchema, newOrderSchema, orderFilterSchema } from '../../src/types/schemas';
import type { AmendOrderInput } from '../../src/types/api';
import type { OrdersService } from '../services/ordersService';
import { roleHasCapability } from '../services/permissions';
import { AppError } from '../utils/errors';
import type { PrintService } from '../services/printService';
import type { HandlerContext, HandlerRegistry } from './registry';

const idSchema = z.object({ id: z.number().int().positive() });
const paperSchema = z.enum(['80mm', 'a4']);

export function ordersHandlers(orders: OrdersService, print: PrintService): HandlerRegistry {
  return {
    [CHANNELS.orderCreate]: {
      capability: 'orders:write',
      schema: newOrderSchema,
      handler: (input: NewOrderInput, context: HandlerContext) =>
        orders.create(input, context.user.id, context.user.role),
    },

    [CHANNELS.orderAmend]: {
      // Editing a saved bill is a manager-level act in most shops, but a cashier
      // adds "one more naan" constantly. The service enforces what actually
      // protects the money: the paid total cannot be broken, and the discount is
      // re-checked against the role of the person doing the editing.
      capability: 'orders:write',
      schema: amendOrderSchema,
      handler: (input: AmendOrderInput, context: HandlerContext) =>
        orders.amend(input, context.user.id, context.user.role),
    },

    [CHANNELS.orderAmendments]: {
      schema: idSchema,
      handler: (input: { id: number }) => orders.amendments(input.id),
    },

    [CHANNELS.orderList]: {
      schema: orderFilterSchema,
      handler: (input: Parameters<OrdersService['list']>[0]) => orders.list(input),
    },

    [CHANNELS.orderGet]: {
      schema: idSchema,
      handler: (input: { id: number }) => orders.get(input.id),
    },

    [CHANNELS.orderStatus]: {
      capability: 'orders:write',
      schema: z.object({
        id: z.number().int().positive(),
        status: z.enum(['pending', 'preparing', 'ready', 'delivered', 'cancelled']),
      }),
      handler: (input: { id: number; status: OrderStatus }, context: HandlerContext) => {
        // 'orders:write' also lets a cashier move an order along, but cancelling is a
        // separate capability (electron/services/permissions.ts). Without this check a
        // cashier could cancel through the status channel by bypassing the hidden button.
        if (
          input.status === 'cancelled' &&
          !roleHasCapability(context.user.role, 'orders:cancel')
        ) {
          throw new AppError('FORBIDDEN', 'Your role does not allow this action');
        }

        return orders.updateStatus(input.id, input.status);
      },
    },

    [CHANNELS.orderCancel]: {
      capability: 'orders:cancel',
      schema: idSchema,
      handler: (input: { id: number }) => orders.cancel(input.id),
    },

    [CHANNELS.orderInvoice]: {
      schema: idSchema,
      handler: (input: { id: number }) => orders.invoice(input.id),
    },

    [CHANNELS.orderMarkPrinted]: {
      capability: 'orders:write',
      schema: idSchema,
      handler: (input: { id: number }) => orders.markPrinted(input.id),
    },

    [CHANNELS.orderPrint]: {
      capability: 'orders:write',
      schema: z.object({ id: z.number().int().positive(), paper: paperSchema }),
      // printService marks the invoice as printed itself; marking here as well would
      // write the timestamp twice for one action.
      handler: async (input: { id: number; paper: '80mm' | 'a4' }) => {
        const data = orders.invoice(input.id);
        const printed = await print.printInvoice(input.id, data, input.paper);
        return { printed };
      },
    },

    [CHANNELS.orderPdf]: {
      capability: 'orders:write',
      schema: z.object({ id: z.number().int().positive(), paper: paperSchema }),
      handler: async (input: { id: number; paper: '80mm' | 'a4' }) => {
        const data = orders.invoice(input.id);
        const path = await print.savePdf(input.id, data, input.paper);
        return { path };
      },
    },
  };
}
