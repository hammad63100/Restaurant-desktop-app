import { CHANNELS } from '../../src/types/api';
import { mergeSchema, splitSchema, tableDeleteSchema, tableSchema } from '../../src/types/schemas';
import type { TablesService } from '../services/tablesService';
import type { HandlerContext, HandlerRegistry } from './registry';

/**
 * The floor plan, merge and split (Phase 3).
 *
 * Reading the floor is open to anyone who can take an order — a cashier has to
 * know which tables are free. Changing the plan, merging and splitting need
 * 'tables:write', because both of those reshape a bill.
 */
export function tablesHandlers(tables: TablesService): HandlerRegistry {
  return {
    [CHANNELS.tablesList]: {
      capability: 'orders:write',
      handler: () => tables.list(),
    },

    [CHANNELS.tableSave]: {
      capability: 'tables:write',
      schema: tableSchema,
      handler: (input: {
        id?: number;
        name: string;
        seats: number;
        area: string;
        active: boolean;
      }) => tables.save(input),
    },

    [CHANNELS.tableDelete]: {
      capability: 'tables:write',
      schema: tableDeleteSchema,
      handler: (input: { id: number }) => {
        tables.remove(input.id);
        return null;
      },
    },

    [CHANNELS.orderMerge]: {
      // Merging is a till operation a cashier performs with the customer present;
      // 'tables:write' is for editing the floor plan itself.
      capability: 'orders:write',
      schema: mergeSchema,
      handler: (input: { sourceId: number; targetId: number }, context: HandlerContext) =>
        tables.merge(input, context.user.id),
    },

    [CHANNELS.orderSplit]: {
      capability: 'orders:write',
      schema: splitSchema,
      handler: (
        input: { orderId: number; itemIds: number[]; moveTable: boolean },
        context: HandlerContext,
      ) => tables.split(input, context.user.id),
    },
  };
}
