/**
 * Phase 10 — discount rules, promo codes and manager approval (feature 3.C).
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 10 — Discount rules and approval');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

function orderRow(id) {
  return harness.db
    .prepare(
      'SELECT discount, discount_reason, promo_code, approved_by, total FROM orders WHERE id = ?',
    )
    .get(id);
}

await runner.check('the seeded rules exist for every role', async () => {
  const rules = await harness.callOk('discount:rules');
  const roles = rules.map((rule) => rule.role).sort();

  if (JSON.stringify(roles) !== JSON.stringify(['admin', 'cashier', 'manager'])) {
    throw new Error(`expected three role rules, got ${roles.join(', ')}`);
  }

  const cashier = rules.find((rule) => rule.role === 'cashier');
  if (cashier.maxPercentX100 !== 1000) throw new Error('cashier max should start at 10%');
  if (cashier.requiresApprovalAbovePercentX100 !== 500) {
    throw new Error('cashier approval threshold should start at 5%');
  }
});

await runner.check('a small cashier discount passes without approval', async () => {
  await harness.loginAs('cashier', 'cashier123');

  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;
  const fivePercent = Math.round((subtotal * 500) / 10_000);

  const decision = await harness.callOk('discount:validate', {
    subtotal,
    percentX100: 0,
    amount: fivePercent,
    promoCode: '',
  });

  if (!decision.allowed) throw new Error(`a 5% discount should be allowed: ${decision.errors}`);
  if (decision.needsApproval) throw new Error('5% should be at the threshold, not above it');
});

await runner.check('a cashier discount over the threshold needs approval', async () => {
  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;
  // The cashier band that needs approval is above the 5% threshold but inside
  // the 10% maximum. 20% is deliberately NOT used here: it is a hard error.
  const eightPercent = Math.round((subtotal * 800) / 10_000);

  const decision = await harness.callOk('discount:validate', {
    subtotal,
    percentX100: 0,
    amount: eightPercent,
    promoCode: '',
  });

  if (decision.allowed) throw new Error('8% should not be allowed outright');
  if (!decision.needsApproval) throw new Error('8% should need approval');
  if (decision.errors.length > 0) throw new Error('8% is inside the limit, so it is not an error');
});

await runner.check('a discount above the role limit is a hard error', async () => {
  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;
  const fiftyPercent = Math.round((subtotal * 5000) / 10_000);

  const decision = await harness.callOk('discount:validate', {
    subtotal,
    percentX100: 0,
    amount: fiftyPercent,
    promoCode: '',
  });

  if (decision.allowed) throw new Error('50% should exceed the cashier limit');
  if (decision.errors.length === 0) throw new Error('expected an error message');
});

await runner.check('a discount above the subtotal is never clamped', async () => {
  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;

  const decision = await harness.callOk('discount:validate', {
    subtotal,
    percentX100: 0,
    amount: subtotal + 1,
    promoCode: '',
  });

  if (decision.errors.length === 0) throw new Error('over-subtotal must be an error');
  if (!/subtotal se zyada/i.test(decision.errors[0])) {
    throw new Error(`expected the shop-language message, got: ${decision.errors[0]}`);
  }

  // And the order itself must be refused, not silently reduced.
  const result = await harness.call('orders:create', {
    type: 'takeaway',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: subtotal + 1,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: menu[0].id, qty: 1, notes: '' }],
  });

  if (result.ok) throw new Error('the order must be refused');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check(
  'a cashier cannot save an over-threshold discount without approval',
  async () => {
    const menu = await harness.callOk('menu:items');
    const subtotal = menu[0].price;
    const eightPercent = Math.round((subtotal * 800) / 10_000);

    const result = await harness.call('orders:create', {
      type: 'takeaway',
      status: 'pending',
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      waiterId: null,
      deliveryBoyId: null,
      discount: eightPercent,
      taxPercent: 0,
      notes: '',
      items: [{ itemId: menu[0].id, qty: 1, notes: '' }],
    });

    if (result.ok) throw new Error('an unapproved 8% discount must fail');
    if (result.error.code !== 'FORBIDDEN') throw new Error(`got ${result.error.code}`);
  },
);

await runner.check('a manager can approve with their own password', async () => {
  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;
  const twentyPercent = Math.round((subtotal * 2000) / 10_000);

  const approval = await harness.callOk('discount:approve', {
    orderId: null,
    percentX100: 2000,
    amount: twentyPercent,
    reason: 'Regular customer, owner said yes',
    username: 'manager',
    password: 'manager123',
  });

  if (!approval.approvedBy) throw new Error('the approval should record the approver');
  if (approval.amount !== twentyPercent) throw new Error('the approval amount is wrong');
});

await runner.check('approval is refused with a wrong password', async () => {
  const result = await harness.call('discount:approve', {
    orderId: null,
    percentX100: 2000,
    amount: 1000,
    reason: 'Test reason',
    username: 'manager',
    password: 'wrong-password',
  });

  if (result.ok) throw new Error('a wrong password must not approve anything');
  if (result.error.code !== 'UNAUTHENTICATED') throw new Error(`got ${result.error.code}`);
});

await runner.check('a cashier cannot approve with their own credentials', async () => {
  await harness.loginAs('cashier', 'cashier123');

  // The till session is the cashier's; entering their own password must not work.
  const asCashier = await harness.call('discount:approve', {
    orderId: null,
    percentX100: 2000,
    amount: 1000,
    reason: 'Trying it',
    username: 'cashier',
    password: 'cashier123',
  });
  if (asCashier.ok) throw new Error('a cashier must not approve discounts');
  if (asCashier.error.code !== 'FORBIDDEN') throw new Error(`got ${asCashier.error.code}`);
});

await runner.check('a manager can approve from the cashier till session', async () => {
  await harness.loginAs('cashier', 'cashier123');

  // This is the real flow: the manager walks over and types their password.
  const approval = await harness.callOk('discount:approve', {
    orderId: null,
    percentX100: 2000,
    amount: 1000,
    reason: 'Manager walked to the till',
    username: 'manager',
    password: 'manager123',
  });

  if (!approval.approvedBy) throw new Error('the approver should be recorded');
});

await runner.check('a manager cannot approve their own discount', async () => {
  await harness.loginAs('manager', 'manager123');

  const result = await harness.call('discount:approve', {
    orderId: null,
    percentX100: 2000,
    amount: 1000,
    reason: 'Self approval attempt',
    username: 'manager',
    password: 'manager123',
  });

  if (result.ok) throw new Error('self-approval must be refused');
  if (result.error.code !== 'FORBIDDEN') throw new Error(`got ${result.error.code}`);
});

await runner.check('an approval reason is mandatory', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  const result = await harness.call('discount:approve', {
    orderId: null,
    percentX100: 2000,
    amount: 1000,
    reason: 'x',
    username: 'manager',
    password: 'manager123',
  });

  if (result.ok) throw new Error('a one-character reason must be rejected');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('an approved order stores the approver and reason', async () => {
  // The cashier asks; the manager approves; the cashier saves with that approval id.
  await harness.loginAs('cashier', 'cashier123');

  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;
  const eightPercent = Math.round((subtotal * 800) / 10_000);

  const approval = await harness.callOk('discount:approve', {
    orderId: null,
    percentX100: 800,
    amount: eightPercent,
    reason: 'Owner approved a regular customer',
    username: 'manager',
    password: 'manager123',
  });

  const order = await harness.callOk('orders:create', {
    type: 'takeaway',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: eightPercent,
    approvedBy: approval.id,
    discountReason: 'Owner approved a regular customer',
    taxPercent: 0,
    notes: '',
    items: [{ itemId: menu[0].id, qty: 1, notes: '' }],
  });

  const row = orderRow(order.id);
  if (row.approved_by === null) throw new Error('the approver was not stored on the order');
  if (row.discount !== eightPercent) throw new Error('the discount was not stored');
  if (row.total !== subtotal - eightPercent) throw new Error('the total is wrong');
});

await runner.check('a mismatched approval is refused', async () => {
  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;
  const eightPercent = Math.round((subtotal * 800) / 10_000);

  // Approval for a different amount must not unlock this order.
  const approval = await harness.callOk('discount:approve', {
    orderId: null,
    percentX100: 1000,
    amount: 123,
    reason: 'Approved for something else',
    username: 'manager',
    password: 'manager123',
  });

  const result = await harness.call('orders:create', {
    type: 'takeaway',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: eightPercent,
    approvedBy: approval.id,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: menu[0].id, qty: 1, notes: '' }],
  });

  if (result.ok) throw new Error('a mismatched approval must not be accepted');
  if (result.error.code !== 'FORBIDDEN') throw new Error(`got ${result.error.code}`);
});

await runner.check('an approval cannot be reused for a second order', async () => {
  // An approval is spent by the order it paid for. Without this, one manager
  // approval could be applied to every order of the shift.
  await harness.loginAs('cashier', 'cashier123');

  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;
  const eightPercent = Math.round((subtotal * 800) / 10_000);

  const approval = await harness.callOk('discount:approve', {
    orderId: null,
    percentX100: 800,
    amount: eightPercent,
    reason: 'Regular customer',
    username: 'manager',
    password: 'manager123',
  });

  const order = (approvedBy) => ({
    type: 'takeaway',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: eightPercent,
    approvedBy,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: menu[0].id, qty: 1, notes: '' }],
  });

  await harness.callOk('orders:create', order(approval.id));

  const replay = await harness.call('orders:create', order(approval.id));
  if (replay.ok) throw new Error('a used approval must not be accepted again');
  if (replay.error.code !== 'FORBIDDEN' && replay.error.code !== 'CONFLICT') {
    throw new Error(`got ${replay.error.code}`);
  }
});

/* ------------------------------ promo codes ------------------------------ */

await runner.check('a percent promo code applies its discount', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  await harness.callOk('promo:save', {
    code: 'EID15',
    kind: 'percent',
    value: 1500,
    minOrder: 0,
    validFrom: null,
    validTo: null,
    maxUses: null,
    active: true,
  });

  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;

  const decision = await harness.callOk('discount:validate', {
    subtotal,
    percentX100: 0,
    amount: 0,
    promoCode: 'EID15',
  });

  const expected = Math.round((subtotal * 1500) / 10_000);
  if (decision.amount !== expected) {
    throw new Error(`promo should give ${expected}, got ${decision.amount}`);
  }
  if (decision.promoCode !== 'EID15') throw new Error('the promo code was not echoed back');
});

await runner.check('a fixed promo code applies its amount', async () => {
  await harness.callOk('promo:save', {
    code: 'FLAT100',
    kind: 'fixed',
    value: 10_000,
    minOrder: 0,
    validFrom: null,
    validTo: null,
    maxUses: null,
    active: true,
  });

  const menu = await harness.callOk('menu:items');
  const decision = await harness.callOk('discount:validate', {
    subtotal: menu[0].price,
    percentX100: 0,
    amount: 0,
    promoCode: 'FLAT100',
  });

  if (decision.amount !== 10_000) throw new Error(`expected 10000 paisa, got ${decision.amount}`);
});

await runner.check(
  'a promo above the cashier ceiling still works, since the owner set it',
  async () => {
    // EID15 is 15%, well above the cashier's 10% ceiling. The owner created the
    // promo, so the cashier may apply it without asking for approval.
    const menu = await harness.callOk('menu:items');
    const subtotal = menu[0].price;

    const decision = await harness.callOk('discount:validate', {
      subtotal,
      percentX100: 0,
      amount: 0,
      promoCode: 'EID15',
    });

    if (!decision.allowed) throw new Error(`the promo should apply: ${decision.errors}`);
    if (decision.needsApproval) throw new Error('a promo must not need approval');
    if (decision.amount !== Math.round((subtotal * 1500) / 10_000)) {
      throw new Error(`wrong promo amount ${decision.amount}`);
    }
  },
);

await runner.check('using a promo code counts one redemption', async () => {
  // max_uses is only meaningful if the order actually bumps the counter.
  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;

  const before = (await harness.callOk('promo:list')).find((row) => row.code === 'EID15');

  await harness.callOk('orders:create', {
    type: 'takeaway',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: Math.round((subtotal * 1500) / 10_000),
    promoCode: 'EID15',
    taxPercent: 0,
    notes: '',
    items: [{ itemId: menu[0].id, qty: 1, notes: '' }],
  });

  const after = (await harness.callOk('promo:list')).find((row) => row.code === 'EID15');
  if (after.uses !== before.uses + 1) {
    throw new Error(`uses went from ${before.uses} to ${after.uses}`);
  }
});

await runner.check('an expired promo code is refused', async () => {
  await harness.callOk('promo:save', {
    code: 'OLD10',
    kind: 'percent',
    value: 1000,
    minOrder: 0,
    validFrom: '2020-01-01',
    validTo: '2020-12-31',
    maxUses: null,
    active: true,
  });

  const menu = await harness.callOk('menu:items');
  const decision = await harness.callOk('discount:validate', {
    subtotal: menu[0].price,
    percentX100: 0,
    amount: 0,
    promoCode: 'OLD10',
  });

  if (decision.allowed) throw new Error('an expired promo must not be allowed');
  if (!/expired/i.test(decision.errors.join(' '))) throw new Error('expected an expiry message');
});

await runner.check('a promo below its minimum order is refused', async () => {
  await harness.callOk('promo:save', {
    code: 'BIGORDER',
    kind: 'fixed',
    value: 50_000,
    minOrder: 10_000_000,
    validFrom: null,
    validTo: null,
    maxUses: null,
    active: true,
  });

  const menu = await harness.callOk('menu:items');
  const decision = await harness.callOk('discount:validate', {
    subtotal: menu[0].price,
    percentX100: 0,
    amount: 0,
    promoCode: 'BIGORDER',
  });

  if (decision.allowed) throw new Error('the minimum order was not enforced');
  if (!/minimum/i.test(decision.errors.join(' '))) throw new Error('expected a minimum message');
});

await runner.check('a used-up promo code is refused', async () => {
  const promo = await harness.callOk('promo:save', {
    code: 'ONCEONLY',
    kind: 'fixed',
    value: 5000,
    minOrder: 0,
    validFrom: null,
    validTo: null,
    maxUses: 1,
    active: true,
  });

  // Burn the single use.
  harness.repositories.discounts.registerPromoUse(promo.id);

  const menu = await harness.callOk('menu:items');
  const decision = await harness.callOk('discount:validate', {
    subtotal: menu[0].price,
    percentX100: 0,
    amount: 0,
    promoCode: 'ONCEONLY',
  });

  if (decision.allowed) throw new Error('a used-up promo must be refused');
  if (!/used up/i.test(decision.errors.join(' '))) throw new Error('expected a used-up message');
});

await runner.check('an unknown promo code is refused', async () => {
  const menu = await harness.callOk('menu:items');
  const decision = await harness.callOk('discount:validate', {
    subtotal: menu[0].price,
    percentX100: 0,
    amount: 0,
    promoCode: 'NOPE123',
  });

  if (decision.allowed) throw new Error('an unknown code must not be allowed');
});

await runner.check('duplicate promo codes are rejected', async () => {
  const result = await harness.call('promo:save', {
    code: 'EID15',
    kind: 'percent',
    value: 500,
    minOrder: 0,
    validFrom: null,
    validTo: null,
    maxUses: null,
    active: true,
  });

  if (result.ok) throw new Error('a duplicate code must be rejected');
  if (result.error.code !== 'CONFLICT') throw new Error(`got ${result.error.code}`);
});

await runner.check('a promo percentage above 100% is rejected', async () => {
  const result = await harness.call('promo:save', {
    code: 'TOOMUCH',
    kind: 'percent',
    value: 20_000,
    minOrder: 0,
    validFrom: null,
    validTo: null,
    maxUses: null,
    active: true,
  });

  if (result.ok) throw new Error('over 100% must be rejected');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

await runner.check('promo codes can be listed and deleted', async () => {
  const before = await harness.callOk('promo:list');
  if (!before.some((promo) => promo.code === 'EID15')) throw new Error('EID15 should be listed');

  const target = before.find((promo) => promo.code === 'FLAT100');
  await harness.callOk('promo:delete', { id: target.id });

  const after = await harness.callOk('promo:list');
  if (after.some((promo) => promo.code === 'FLAT100')) throw new Error('the promo was not deleted');
});

/* ------------------------------ rule editing ------------------------------ */

await runner.check('only an admin can edit the discount rules', async () => {
  const rules = await harness.callOk('discount:rules');
  const cashierRule = rules.find((rule) => rule.role === 'cashier');

  await harness.loginAs('manager', 'manager123');

  const asManager = await harness.call('discount:save-rule', {
    ...cashierRule,
    maxPercentX100: 2000,
  });
  if (asManager.ok) throw new Error('a manager must not edit the rules');

  await harness.loginAs('admin', 'OwnerPass123');

  const asAdmin = await harness.callOk('discount:save-rule', {
    ...cashierRule,
    maxPercentX100: 2000,
    requiresApprovalAbovePercentX100: 1000,
  });
  if (asAdmin.maxPercentX100 !== 2000) throw new Error('the rule was not saved');
});

await runner.check('the owner never needs approval for their own discount', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  const menu = await harness.callOk('menu:items');
  const subtotal = menu[0].price;
  const twentyPercent = Math.round((subtotal * 2000) / 10_000);

  const decision = await harness.callOk('discount:validate', {
    subtotal,
    percentX100: 0,
    amount: twentyPercent,
    promoCode: '',
  });

  if (!decision.allowed) throw new Error(`the owner should be allowed: ${decision.errors}`);
  if (decision.needsApproval) throw new Error('the owner must not need approval for themselves');
});

await runner.check(
  'a switched-off rule blocks discounts instead of ignoring the limit',
  async () => {
    const rules = await harness.callOk('discount:rules');
    const cashierRule = rules.find((rule) => rule.role === 'cashier');

    // Admin switches the cashier rule off.
    await harness.callOk('discount:save-rule', { ...cashierRule, active: false });

    await harness.loginAs('cashier', 'cashier123');

    const decision = await harness.callOk('discount:validate', {
      subtotal: 100_000,
      percentX100: 0,
      amount: 1_000,
      promoCode: '',
    });

    if (decision.allowed) throw new Error('a switched-off rule must not allow a discount');
    if (decision.errors.length === 0) throw new Error('the cashier must be told why');

    // Put the rule back for anything that follows.
    await harness.loginAs('admin', 'OwnerPass123');
    await harness.callOk('discount:save-rule', { ...cashierRule, active: true });
  },
);

await runner.check('an impossible rule is rejected', async () => {
  const rules = await harness.callOk('discount:rules');
  const cashierRule = rules.find((rule) => rule.role === 'cashier');

  const result = await harness.call('discount:save-rule', {
    ...cashierRule,
    maxPercentX100: 20_000,
  });

  if (result.ok) throw new Error('a 200% maximum must be rejected');
});

harness.cleanup();
runner.finish();
