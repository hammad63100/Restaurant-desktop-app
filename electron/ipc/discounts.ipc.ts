import { z } from 'zod';
import { CHANNELS } from '../../src/types/api';
import type { DiscountRule, PromoCode } from '../../src/types/api';
import {
  discountApproveSchema,
  discountRuleSchema,
  discountValidateSchema,
  promoSchema,
} from '../../src/types/schemas';
import type { DiscountsService } from '../services/discountsService';
import type { HandlerContext, HandlerRegistry } from './registry';

/**
 * Discount rules and approvals.
 * Reading rules is open to anyone who can take an order; editing them and
 * approving an over-limit discount need 'discount:write' / 'discount:approve'
 * (see permissions.ts — a cashier has neither).
 */
export function discountsHandlers(discounts: DiscountsService): HandlerRegistry {
  return {
    [CHANNELS.discountRules]: {
      capability: 'orders:write',
      handler: () => discounts.rules(),
    },

    [CHANNELS.discountSaveRule]: {
      // Admin only: `roles` is the tighter gate here, so the capability is omitted
      // rather than widened. Managers keep 'discount:approve' for individual bills.
      capability: 'discount:approve',
      roles: ['admin'],
      schema: discountRuleSchema,
      handler: (input: DiscountRule) => discounts.saveRule(input),
    },

    [CHANNELS.discountValidate]: {
      capability: 'orders:write',
      schema: discountValidateSchema,
      handler: (
        input: { subtotal: number; percentX100: number; amount: number; promoCode: string },
        context: HandlerContext,
      ) =>
        discounts.resolve({
          role: context.user.role,
          subtotal: input.subtotal,
          percentX100: input.percentX100,
          amount: input.amount,
          promoCode: input.promoCode,
          today: new Date().toISOString().slice(0, 10),
        }),
    },

    [CHANNELS.discountApprove]: {
      // Deliberately gated on 'orders:write', not 'discount:approve': the manager
      // walks to the till and types their own password into the cashier's session.
      // Requiring 'discount:approve' here would make approval impossible without
      // logging the cashier out. discountsService.approve() is the real gate: it
      // verifies the approver's password, requires roleHasCapability(role,
      // 'discount:approve') from permissions.ts, and refuses self-approval.
      capability: 'orders:write',
      schema: discountApproveSchema,
      handler: (
        input: {
          orderId: number | null;
          percentX100: number;
          amount: number;
          reason: string;
          username: string;
          password: string;
        },
        context: HandlerContext,
      ) => discounts.approve(input, context.user.id),
    },

    [CHANNELS.promoList]: {
      capability: 'orders:write',
      handler: () => discounts.promos(),
    },

    [CHANNELS.promoSave]: {
      capability: 'discount:write',
      schema: promoSchema,
      handler: (input: Omit<PromoCode, 'id' | 'uses'> & { id?: number }) =>
        discounts.savePromo(input),
    },

    [CHANNELS.promoDelete]: {
      capability: 'discount:write',
      schema: z.object({ id: z.number().int().positive() }),
      handler: (input: { id: number }) => {
        discounts.deletePromo(input.id);
        return null;
      },
    },
  };
}
