import type { CashMovementKind, ShiftReport } from '../../src/types/api';
import { CHANNELS } from '../../src/types/api';
import {
  cashMovementSchema,
  shiftCloseSchema,
  shiftListSchema,
  shiftOpenSchema,
  shiftPrintSchema,
  shiftReportSchema,
} from '../../src/types/schemas';
import type { ShiftsService } from '../services/shiftsService';
import type { PrintService } from '../services/printService';
import type { HandlerContext, HandlerRegistry } from './registry';

/**
 * Day close. A cashier may open and close their own shift; managers can read every
 * shift. All of it goes through the 'shifts:read' / 'shifts:write' capabilities so
 * the renderer never decides (permissions.ts).
 */
export function shiftsHandlers(shifts: ShiftsService, print: PrintService): HandlerRegistry {
  return {
    [CHANNELS.shiftCurrent]: {
      capability: 'shifts:read',
      handler: () => shifts.current(),
    },

    [CHANNELS.shiftList]: {
      capability: 'shifts:read',
      schema: shiftListSchema,
      handler: (input: { limit: number }) => shifts.list(input.limit),
    },

    [CHANNELS.shiftOpen]: {
      capability: 'shifts:write',
      schema: shiftOpenSchema,
      handler: (input: { openingCash: number }, context: HandlerContext) =>
        shifts.open(input.openingCash, context.user.id),
    },

    [CHANNELS.shiftReport]: {
      capability: 'shifts:read',
      schema: shiftReportSchema,
      handler: (input: { shiftId?: number }) => shifts.report(input.shiftId),
    },

    [CHANNELS.shiftClose]: {
      capability: 'shifts:write',
      schema: shiftCloseSchema,
      handler: (input: { countedCash: number; notes: string }, context: HandlerContext) =>
        shifts.close(input, context.user.id),
    },

    [CHANNELS.shiftCashMovement]: {
      capability: 'shifts:write',
      schema: cashMovementSchema,
      handler: (
        input: { kind: CashMovementKind; amount: number; reason: string },
        context: HandlerContext,
      ) => shifts.addMovement(input, context.user.id),
    },

    [CHANNELS.shiftPrint]: {
      capability: 'shifts:read',
      schema: shiftPrintSchema,
      handler: async (input: { shiftId: number; paper: '80mm' | 'a4' }) => {
        const report: ShiftReport = shifts.report(input.shiftId);
        const printed = await print.printShiftReport(report, input.paper);
        return { printed };
      },
    },
  };
}
