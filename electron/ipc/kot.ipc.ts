import { CHANNELS } from '../../src/types/api';
import { kotPrintSchema } from '../../src/types/schemas';
import type { KotService } from '../services/kotService';
import type { HandlerContext, HandlerRegistry } from './registry';

/**
 * Kitchen tickets (feature 3.D).
 *
 * Reading a ticket needs only 'orders:write' — anybody taking an order may look at
 * what the kitchen will cook. *Printing* needs 'kot:print', because a printed slip
 * sends real work to the kitchen and costs paper.
 */
export function kotHandlers(kot: KotService): HandlerRegistry {
  return {
    [CHANNELS.kotTicket]: {
      capability: 'orders:write',
      schema: kotPrintSchema,
      handler: (input: { orderId: number }) => kot.ticket(input.orderId),
    },

    [CHANNELS.kotPrint]: {
      capability: 'kot:print',
      schema: kotPrintSchema,
      handler: (input: { orderId: number }, context: HandlerContext) =>
        kot.printTicket(input.orderId, context.user.id),
    },
  };
}
