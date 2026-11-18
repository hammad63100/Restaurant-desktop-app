import type {
  DiscountApproval,
  DiscountDecision,
  DiscountRule,
  PromoCode,
  UserRole,
} from '../../src/types/api';
import type { DiscountsRepository } from '../db/repositories/discountsRepository';
import type { UserRepository } from '../db/repositories/userRepository';
import { AppError } from '../utils/errors';
import { formatAmount } from '../utils/money';
import { verifyPassword } from '../utils/password';
import { roleHasCapability } from './permissions';
import { logInfo } from './logger';

/**
 * Discount rules and approvals (feature 3.C).
 *
 * The rule that matters: **never clamp silently**. A discount over the limit or
 * over the subtotal is an error the cashier must see, not a quiet adjustment.
 */
export function createDiscountsService(deps: {
  discounts: DiscountsRepository;
  users: UserRepository;
}) {
  const { discounts, users } = deps;

  /** Turns a percent (x100) or a fixed amount into paisa, capped by the subtotal. */
  function amountFrom(subtotal: number, percentX100: number, fixedAmount: number): number {
    if (percentX100 > 0) return Math.round((subtotal * percentX100) / 10_000);
    return fixedAmount;
  }

  return {
    rules(): DiscountRule[] {
      return discounts.rules();
    },

    saveRule(rule: DiscountRule): DiscountRule {
      if (rule.maxPercentX100 > 10_000) {
        throw new AppError('VALIDATION_ERROR', 'The maximum discount cannot exceed 100%');
      }
      if (
        rule.requiresApprovalAbovePercentX100 > rule.maxPercentX100 &&
        rule.requiresApprovalAbovePercentX100 !== 10_000
      ) {
        throw new AppError(
          'VALIDATION_ERROR',
          'The approval threshold cannot be above the maximum discount',
        );
      }

      return discounts.saveRule(rule);
    },

    /** One approval row by its own id, for the order that is about to be written. */
    findApproval(id: number): DiscountApproval | null {
      return discounts.findApproval(id);
    },

    /** Counts one redemption of a promo. Call inside the order's transaction. */
    registerPromoUse(promoId: number): void {
      discounts.registerPromoUse(promoId);
    },

    /** Marks an approval as spent. Must be called inside the order's transaction. */
    consumeApproval(approvalId: number, orderId: number): void {
      discounts.consumeApproval(approvalId, orderId);
    },

    promos(): PromoCode[] {
      return discounts.promos();
    },

    savePromo(input: Omit<PromoCode, 'id' | 'uses'> & { id?: number }): PromoCode {
      if (input.kind === 'percent' && input.value > 10_000) {
        throw new AppError('VALIDATION_ERROR', 'A promo percentage cannot exceed 100%');
      }

      if (input.validFrom && input.validTo && input.validFrom > input.validTo) {
        throw new AppError('VALIDATION_ERROR', 'The promo start date must be before its end date');
      }

      if (typeof input.id === 'number') {
        const existing = discounts.findPromo(input.id);
        if (!existing) throw new AppError('NOT_FOUND', 'That promo code does not exist');

        discounts.updatePromo({ ...existing, ...input, id: input.id });
        const updated = discounts.findPromo(input.id);
        if (!updated) throw new AppError('INTERNAL_ERROR', 'The promo was not saved');
        return updated;
      }

      const id = discounts.createPromo(input);
      const created = discounts.findPromo(id);
      if (!created) throw new AppError('INTERNAL_ERROR', 'The promo was not saved');
      return created;
    },

    deletePromo(id: number): void {
      if (!discounts.findPromo(id)) {
        throw new AppError('NOT_FOUND', 'That promo code does not exist');
      }
      discounts.deletePromo(id);
    },

    /**
     * Works out what a requested discount would mean for this role, without
     * touching the database. `allowed` means "can be used right now, no approval".
     */
    resolve(input: {
      role: UserRole;
      subtotal: number;
      percentX100: number;
      amount: number;
      promoCode: string;
      today: string;
    }): DiscountDecision {
      const errors: string[] = [];
      const rule = discounts.ruleForRole(input.role);

      let percentX100 = Math.max(input.percentX100, 0);
      let amount = amountFrom(input.subtotal, percentX100, Math.max(input.amount, 0));
      let promoCode = '';
      let promoId: number | null = null;
      let promo: PromoCode | null = null;

      // A promo code and a manual discount are alternatives, not a stack.
      if (input.promoCode.trim()) {
        promo = discounts.promoByCode(input.promoCode);

        if (!promo) {
          errors.push('That promo code does not exist');
        } else if (!promo.active) {
          errors.push('That promo code is switched off');
        } else if (promo.validFrom && input.today < promo.validFrom) {
          errors.push('That promo code is not valid yet');
        } else if (promo.validTo && input.today > promo.validTo) {
          errors.push('That promo code has expired');
        } else if (promo.maxUses !== null && promo.uses >= promo.maxUses) {
          errors.push('That promo code has been used up');
        } else if (input.subtotal < promo.minOrder) {
          errors.push('The order is below the minimum for this promo code');
        } else {
          promoCode = promo.code;
          promoId = promo.id;
          percentX100 = promo.kind === 'percent' ? promo.value : 0;
          amount =
            promo.kind === 'percent'
              ? Math.round((input.subtotal * promo.value) / 10_000)
              : promo.value;
        }
      }

      if (amount > input.subtotal) {
        errors.push('Discount subtotal se zyada nahi ho sakta.');
      }

      if (amount < 0) errors.push('Discount cannot be negative');

      let needsApproval = false;

      // A switched-off rule means this role may not discount at all today. Saying
      // so is clearer than silently applying the old limits.
      if (!rule.active && (amount > 0 || promoCode !== '')) {
        errors.push('Discounts are switched off for this role');
      }

      // A promo code is a shop-wide offer the owner created and switched on, so it
      // is not subject to the cashier's discretionary ceiling. Without this a 15%
      // EID promo could never be used at the till. It still cannot exceed the
      // subtotal, which is checked above.
      if (errors.length === 0 && amount > 0 && promo === null) {
        const percentOfBill = input.subtotal > 0 ? (amount / input.subtotal) * 100 : 0;

        if (percentOfBill > rule.maxPercentX100 / 100) {
          errors.push(
            `A ${rule.role} cannot give more than ${(rule.maxPercentX100 / 100).toFixed(2)}%`,
          );
        } else if (rule.maxAmount !== null && amount > rule.maxAmount) {
          errors.push(`The maximum discount is ${formatAmount(rule.maxAmount)}`);
        }

        // 100% means "every discount needs approval" for cashiers and managers;
        // for the owner the seeded threshold is 0, i.e. never.
        if (
          rule.requiresApprovalAbovePercentX100 > 0 &&
          percentOfBill > rule.requiresApprovalAbovePercentX100 / 100
        ) {
          needsApproval = true;
        }
      }

      return {
        allowed: errors.length === 0 && !needsApproval,
        needsApproval: errors.length === 0 && needsApproval,
        amount,
        percentX100,
        errors,
        promoCode,
        promoId: errors.length === 0 ? promoId : null,
      };
    },

    /**
     * A manager approves an over-limit discount by typing their own password.
     * The approver must hold 'discount:approve' and be a different person from the
     * cashier asking (a cashier cannot approve their own discount).
     */
    async approve(
      input: {
        orderId: number | null;
        percentX100: number;
        amount: number;
        reason: string;
        username: string;
        password: string;
      },
      requestedBy: number,
    ): Promise<DiscountApproval> {
      const approver = users.findByUsername(input.username.trim().toLowerCase());

      if (!approver) {
        throw new AppError('UNAUTHENTICATED', 'Wrong username or password');
      }
      if (!approver.active) {
        throw new AppError('FORBIDDEN', 'That account is disabled');
      }
      // permissions.ts decides who may approve — not a hardcoded role list here.
      if (!roleHasCapability(approver.role, 'discount:approve')) {
        throw new AppError('FORBIDDEN', 'Only a manager or the owner can approve a discount');
      }
      if (approver.id === requestedBy) {
        throw new AppError('FORBIDDEN', 'A discount cannot be approved by the same person');
      }

      const passwordMatches = await verifyPassword(input.password, approver.password_hash);
      if (!passwordMatches) {
        throw new AppError('UNAUTHENTICATED', 'Wrong username or password');
      }

      if (input.reason.trim().length < 3) {
        throw new AppError('VALIDATION_ERROR', 'Give a reason for this discount');
      }

      const approval = discounts.recordApproval({
        orderId: input.orderId,
        requestedBy,
        approvedBy: approver.id,
        percentX100: input.percentX100,
        amount: input.amount,
        reason: input.reason,
      });

      logInfo(
        `Discount approved by ${approver.username} for ${input.amount} paisa (order ${
          input.orderId ?? 'not saved yet'
        })`,
      );

      return approval;
    },

    approvalsForOrder(orderId: number): DiscountApproval[] {
      return discounts.approvalsForOrder(orderId);
    },
  };
}

export type DiscountsService = ReturnType<typeof createDiscountsService>;
