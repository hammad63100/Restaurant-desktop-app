import type { AppDatabase } from '../connection';
import type { DiscountApproval, DiscountRule, PromoCode, UserRole } from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';
import { AppError } from '../../utils/errors';

interface RuleRow {
  id: number;
  role: UserRole;
  max_percent_x100: number;
  max_amount: number | null;
  requires_approval_above_percent_x100: number;
  active: number;
}

interface PromoRow {
  id: number;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  min_order: number;
  valid_from: string | null;
  valid_to: string | null;
  max_uses: number | null;
  uses: number;
  active: number;
}

interface ApprovalRow {
  id: number;
  order_id: number | null;
  requested_by: number;
  approved_by: number | null;
  percent_x100: number;
  amount: number;
  reason: string;
  created_at: string;
}

const toRule = (row: RuleRow): DiscountRule => ({
  id: row.id,
  role: row.role,
  maxPercentX100: row.max_percent_x100,
  maxAmount: row.max_amount,
  requiresApprovalAbovePercentX100: row.requires_approval_above_percent_x100,
  active: row.active === 1,
});

const toPromo = (row: PromoRow): PromoCode => ({
  id: row.id,
  code: row.code,
  kind: row.kind,
  value: row.value,
  minOrder: row.min_order,
  validFrom: row.valid_from,
  validTo: row.valid_to,
  maxUses: row.max_uses,
  uses: row.uses,
  active: row.active === 1,
});

const toApproval = (row: ApprovalRow): DiscountApproval => ({
  id: row.id,
  orderId: row.order_id,
  requestedBy: row.requested_by,
  approvedBy: row.approved_by,
  percentX100: row.percent_x100,
  amount: row.amount,
  reason: row.reason,
  createdAt: row.created_at,
});

export function createDiscountsRepository(db: AppDatabase) {
  const selectRules = db.prepare<[], RuleRow>('SELECT * FROM discount_rules ORDER BY role');

  const selectRuleForRole = db.prepare<[UserRole], RuleRow>(
    'SELECT * FROM discount_rules WHERE role = ?',
  );

  const updateRule = db.prepare(`
    UPDATE discount_rules
       SET max_percent_x100 = @maxPercentX100,
           max_amount = @maxAmount,
           requires_approval_above_percent_x100 = @requiresApproval,
           active = @active
     WHERE role = @role
  `);

  const selectPromos = db.prepare<[], PromoRow>(
    'SELECT * FROM promo_codes ORDER BY active DESC, code',
  );

  const selectPromoByCode = db.prepare<[string], PromoRow>(
    'SELECT * FROM promo_codes WHERE code = ?',
  );

  const selectPromoById = db.prepare<[number], PromoRow>('SELECT * FROM promo_codes WHERE id = ?');

  const insertPromo = db.prepare(`
    INSERT INTO promo_codes
      (code, kind, value, min_order, valid_from, valid_to, max_uses, uses, active)
    VALUES
      (@code, @kind, @value, @minOrder, @validFrom, @validTo, @maxUses, 0, @active)
  `);

  const updatePromo = db.prepare(`
    UPDATE promo_codes
       SET code = @code, kind = @kind, value = @value, min_order = @minOrder,
           valid_from = @validFrom, valid_to = @validTo, max_uses = @maxUses,
           active = @active
     WHERE id = @id
  `);

  const bumpPromoUses = db.prepare('UPDATE promo_codes SET uses = uses + 1 WHERE id = ?');
  const deletePromoRow = db.prepare('DELETE FROM promo_codes WHERE id = ?');

  const insertApproval = db.prepare(`
    INSERT INTO discount_approvals
      (order_id, requested_by, approved_by, percent_x100, amount, reason, created_at)
    VALUES
      (@orderId, @requestedBy, @approvedBy, @percentX100, @amount, @reason, @createdAt)
  `);

  const selectApproval = db.prepare<[number], ApprovalRow>(
    'SELECT * FROM discount_approvals WHERE id = ?',
  );

  const consumeApprovalRow = db.prepare(`
    UPDATE discount_approvals
       SET order_id = ?
     WHERE id = ? AND order_id IS NULL
  `);

  const selectApprovalsForOrder = db.prepare<[number], ApprovalRow>(
    'SELECT * FROM discount_approvals WHERE order_id = ? ORDER BY created_at DESC',
  );

  const setOrderDiscount = db.prepare(`
    UPDATE orders
       SET discount = @discount,
           discount_reason = @reason,
           promo_code = @promoCode,
           approved_by = @approvedBy,
           updated_at = @now
     WHERE id = @orderId
  `);

  return {
    rules(): DiscountRule[] {
      return selectRules.all().map(toRule);
    },

    ruleForRole(role: UserRole): DiscountRule {
      const row = selectRuleForRole.get(role);
      if (!row) throw new AppError('INTERNAL_ERROR', `No discount rule for role ${role}`);
      return toRule(row);
    },

    saveRule(rule: DiscountRule): DiscountRule {
      updateRule.run({
        role: rule.role,
        maxPercentX100: rule.maxPercentX100,
        maxAmount: rule.maxAmount,
        requiresApproval: rule.requiresApprovalAbovePercentX100,
        active: rule.active ? 1 : 0,
      });

      const row = selectRuleForRole.get(rule.role);
      if (!row) throw new AppError('INTERNAL_ERROR', 'The rule was not saved');
      return toRule(row);
    },

    promos(): PromoCode[] {
      return selectPromos.all().map(toPromo);
    },

    promoByCode(code: string): PromoCode | null {
      const row = selectPromoByCode.get(code.trim().toUpperCase());
      return row ? toPromo(row) : null;
    },

    createPromo(input: Omit<PromoCode, 'id' | 'uses'>): number {
      const code = input.code.trim().toUpperCase();

      if (selectPromoByCode.get(code)) {
        throw new AppError('CONFLICT', 'That promo code already exists');
      }

      const result = insertPromo.run({
        code,
        kind: input.kind,
        value: input.value,
        minOrder: input.minOrder,
        validFrom: input.validFrom,
        validTo: input.validTo,
        maxUses: input.maxUses,
        active: input.active ? 1 : 0,
      });

      return Number(result.lastInsertRowid);
    },

    updatePromo(input: PromoCode): void {
      const code = input.code.trim().toUpperCase();
      const existing = selectPromoByCode.get(code);

      // A different row already owns this code.
      if (existing && existing.id !== input.id) {
        throw new AppError('CONFLICT', 'That promo code already exists');
      }

      updatePromo.run({
        id: input.id,
        code,
        kind: input.kind,
        value: input.value,
        minOrder: input.minOrder,
        validFrom: input.validFrom,
        validTo: input.validTo,
        maxUses: input.maxUses,
        active: input.active ? 1 : 0,
      });
    },

    findPromo(id: number): PromoCode | null {
      const row = selectPromoById.get(id);
      return row ? toPromo(row) : null;
    },

    deletePromo(id: number): void {
      deletePromoRow.run(id);
    },

    /** Counts a promo redemption. Call inside the order transaction. */
    registerPromoUse(promoId: number): void {
      bumpPromoUses.run(promoId);
    },

    recordApproval(input: {
      orderId: number | null;
      requestedBy: number;
      approvedBy: number;
      percentX100: number;
      amount: number;
      reason: string;
    }): DiscountApproval {
      const created = insertApproval.run({ ...input, createdAt: toSqlDateTime() });
      const row = selectApproval.get(Number(created.lastInsertRowid));
      if (!row) throw new AppError('INTERNAL_ERROR', 'The approval was not saved');
      return toApproval(row);
    },

    /** Looks up one approval by its own id — what the till holds before the order exists. */
    findApproval(id: number): DiscountApproval | null {
      const row = selectApproval.get(id);
      return row ? toApproval(row) : null;
    },

    /**
     * Stamps the approval with the order it paid for. This is what makes an
     * approval single-use: a replay finds order_id already set and is refused.
     */
    consumeApproval(approvalId: number, orderId: number): void {
      const result = consumeApprovalRow.run(orderId, approvalId);
      if (result.changes !== 1) {
        throw new AppError('CONFLICT', 'That approval has already been used');
      }
    },

    approvalsForOrder(orderId: number): DiscountApproval[] {
      return selectApprovalsForOrder.all(orderId).map(toApproval);
    },

    /**
     * Writes the approved discount onto the order. Kept here so the order row and
     * the approval cannot disagree.
     */
    applyToOrder(input: {
      orderId: number;
      discount: number;
      reason: string;
      promoCode: string;
      approvedBy: number | null;
    }): void {
      setOrderDiscount.run({ ...input, now: toSqlDateTime() });
    },
  };
}

export type DiscountsRepository = ReturnType<typeof createDiscountsRepository>;
