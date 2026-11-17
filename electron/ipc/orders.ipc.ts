import { z } from 'zod';
import { CHANNELS, type NewOrderInput, type OrderStatus } from '../../src/types/api';
import { newOrderSchema, orderFilterSchema } from '../../src/types/schemas';
import type { OrdersService } from '../services/ordersService';
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
        orders.create(input, context.user.id),
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
      handler: (input: { id: number; status: OrderStatus }) =>
        orders.updateStatus(input.id, input.status),
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
      handler: async (input: { id: number; paper: '80mm' | 'a4' }) => {
        const data = orders.invoice(input.id);
        const printed = await print.printInvoice(input.id, data, input.paper);
        if (printed) orders.markPrinted(input.id);
        return { printed };
      },
    },

    [CHANNELS.orderPdf]: {
      capability: 'orders:write',
      schema: z.object({ id: z.number().int().positive(), paper: paperSchema }),
      handler: async (input: { id: number; paper: '80mm' | 'a4' }) => {
        const data = orders.invoice(input.id);
        const path = await print.savePdf(input.id, data, input.paper);
        if (path) orders.markPrinted(input.id);
        return { path };
      },
    },
  };
}
