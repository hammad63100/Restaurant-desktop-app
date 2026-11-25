import { z } from 'zod';
import { CHANNELS, type RecurringBillInput } from '../../src/types/api';
import {
  expenseCategorySchema,
  expenseIdSchema,
  expenseListSchema,
  expenseSchema,
  expenseVoidSchema,
  recurringBillSchema,
  recurringBillSettleSchema,
  recurringBillsQuerySchema,
} from '../../src/types/schemas';
import type { ExpensesService } from '../services/expensesService';
import type { HandlerContext, HandlerRegistry } from './registry';

/**
 * Shop expenses (Roadmap 4.F).
 *
 * `expenses:read` sees the list and the totals, `expenses:write` records one,
 * `expenses:void` reverses a mistake. A cashier gets none of the three: the shop's
 * running costs are not till business.
 */
export function expensesHandlers(expenses: ExpensesService): HandlerRegistry {
  return {
    [CHANNELS.expensesOverview]: {
      capability: 'expenses:read',
      schema: expenseListSchema,
      handler: (input: { from: string; to: string; status: 'active' | 'void' | 'all' }) =>
        expenses.overview(input),
    },

    [CHANNELS.expenseSave]: {
      capability: 'expenses:write',
      schema: expenseSchema,
      handler: (input: Parameters<ExpensesService['save']>[0], context) =>
        expenses.save(input, context.user.id),
    },

    [CHANNELS.expenseVoid]: {
      capability: 'expenses:void',
      schema: expenseVoidSchema,
      handler: (input: { id: number; reason: string }, context) =>
        expenses.void(input, context.user.id),
    },

    [CHANNELS.expenseCategorySave]: {
      capability: 'expenses:write',
      schema: expenseCategorySchema,
      handler: (input: Parameters<ExpensesService['saveCategory']>[0]) =>
        expenses.saveCategory(input),
    },

    /* ---------------------- recurring bills (4.E2) ---------------------- */

    [CHANNELS.recurringBills]: {
      capability: 'expenses:read',
      schema: recurringBillsQuerySchema,
      handler: (input: { period?: string }) => expenses.recurringBills(input.period),
    },

    [CHANNELS.recurringBillSave]: {
      capability: 'expenses:write',
      schema: recurringBillSchema,
      handler: (input: RecurringBillInput) => expenses.saveRecurringBill(input),
    },

    [CHANNELS.recurringBillDelete]: {
      capability: 'expenses:write',
      schema: z.object({ id: z.number().int().positive() }),
      handler: (input: { id: number }) => expenses.deleteRecurringBill(input.id),
    },

    [CHANNELS.recurringBillSettle]: {
      capability: 'expenses:write',
      schema: recurringBillSettleSchema,
      handler: (input: Parameters<ExpensesService['settleRecurringBill']>[0], context: HandlerContext) =>
        expenses.settleRecurringBill(input, context.user.id),
    },

    [CHANNELS.recurringBillUnsettle]: {
      // Undoing a settlement voids the expense it created, so it needs the void
      // capability as well as write — it changes money that was already booked.
      capability: 'expenses:void',
      schema: z.object({
        templateId: z.number().int().positive(),
        period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      }),
      handler: (
        input: { templateId: number; period: string },
        context: HandlerContext,
      ) => expenses.unsettleRecurringBill(input, context.user.id),
    },

    [CHANNELS.expenseCategoryDelete]: {
      capability: 'expenses:write',
      schema: expenseIdSchema,
      handler: (input: { id: number }) => {
        expenses.deleteCategory(input.id);
        return null;
      },
    },
  };
}
