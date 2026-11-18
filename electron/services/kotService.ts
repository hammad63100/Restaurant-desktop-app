import type { KOT } from '../../src/types/api';
import type { KotRepository } from '../db/repositories/kotRepository';
import type { PrintService } from './printService';
import type { SettingsRepository } from '../db/repositories/settingsRepository';
import { AppError } from '../utils/errors';
import { toSqlDateTime } from '../utils/datetime';
import { logInfo } from './logger';

/**
 * Kitchen order tickets (feature 3.D).
 *
 * Kept deliberately small: the ticket is data the repository assembles, and this
 * service decides *when* it may be printed and records that it happened.
 */
export function createKotService(deps: {
  kot: KotRepository;
  print: PrintService;
  settings: SettingsRepository;
}) {
  const { kot, print, settings } = deps;

  return {
    ticket(orderId: number): KOT {
      const ticket = kot.ticketFor(orderId);
      if (!ticket) throw new AppError('NOT_FOUND', 'That order does not exist');
      return ticket;
    },

    /**
     * Prints the kitchen ticket. A cancelled order is refused: sending it to the
     * kitchen would have someone cook food nobody is paying for.
     */
    async printTicket(orderId: number, printedBy: number): Promise<boolean> {
      const ticket = kot.ticketFor(orderId);
      if (!ticket) throw new AppError('NOT_FOUND', 'That order does not exist');

      if (ticket.status === 'cancelled') {
        throw new AppError('CONFLICT', 'This order was cancelled, so it has no kitchen ticket');
      }

      if (ticket.items.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'This order has no items to cook');
      }

      const shopName = settings.get('shop_name') ?? 'Kitchen';
      const printed = await print.printKot(ticket, shopName);

      // Only record a print that actually reached the printer, so the "reprint"
      // marker stays honest.
      if (printed) {
        kot.recordPrint({
          orderId,
          printedBy,
          itemIds: ticket.items.map((item) => item.id),
          createdAt: toSqlDateTime(),
        });
        logInfo(`Kitchen ticket printed for ${ticket.orderNo} (token ${ticket.tokenNo ?? '-'})`);
      }

      return printed;
    },
  };
}

export type KotService = ReturnType<typeof createKotService>;
