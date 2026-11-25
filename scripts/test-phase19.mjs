/**
 * Phase 19 — Roadmap 4.E: the shop's running costs.
 *
 * The client: "shop k kharchy bhi add kron" — rent, the electricity bill, salaries.
 * This is the half of the hisab that stock purchases never covered, and getting it
 * wrong would make the profit figure in 4.G a lie.
 *
 * What is proven here:
 *   1. a real list of categories exists on day one, and can be renamed or removed,
 *   2. an expense filed against the drawer takes the money out of the open shift,
 *   3. an expense paid from outside (bank, owner's pocket) never touches the till,
 *   4. a cash expense with no open drawer is refused, not silently lost,
 *   5. voiding gives the drawer its money back and keeps the entry for the record,
 *   6. voiding after the shift was closed puts the money in today's drawer,
 *   7. the day-close expected cash includes the cash expenses,
 *   8. the month total and the per-category summary agree,
 *   9. a cashier cannot read or write the shop's expenses at all.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 19 — Shop expenses (4.E)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);

const TODAY = '2026-11-22';

function overview(extra = {}) {
  return call('expenses:overview', { from: '2026-11-01', to: '2026-11-30', ...extra });
}

const cat = async (name) => {
  const result = await overview();
  const found = result.categories.find((category) => category.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`no "${name}" category`);
  return found;
};

/* --------------------------- 1. the categories --------------------------- */

await runner.check('a useful list of categories ships with the app', async () => {
  const result = await overview();
  const names = result.categories.map((category) => category.name);

  for (const expected of ['Rent', 'Electricity', 'Salaries', 'Repairs & maintenance', 'Other']) {
    if (!names.includes(expected)) throw new Error(`missing the ${expected} category`);
  }

  if (result.categories.length < 8) {
    throw new Error(`only ${result.categories.length} categories; the list should be useful`);
  }

  const other = result.categories.find((category) => category.name === 'Other');
  if (!other?.isSystem) throw new Error('"Other" should be a built-in category');
});

await runner.check('a category can be added, renamed, and refused once it has expenses', async () => {
  const added = await call('expenses:category-save', { name: 'Chai for the staff', sortOrder: 12 });
  if (!added.name) throw new Error('the category was not created');

  const renamed = await call('expenses:category-save', {
    id: added.id,
    name: 'Staff tea',
    sortOrder: 12,
  });
  if (renamed.name !== 'Staff tea') throw new Error('the rename did not stick');

  // A duplicate name, in any case, is refused.
  const duplicate = await harness.call('expenses:category-save', { name: 'staff tea', sortOrder: 1 });
  if (duplicate.ok) throw new Error('two categories with the same name were allowed');

  // The built-in one cannot be removed.
  const other = await cat('Other');
  const removeBuiltIn = await harness.call('expenses:category-delete', { id: other.id });
  if (removeBuiltIn.ok) throw new Error('the built-in category was removed');

  // An unused one can.
  unwrapOk(await call('expenses:category-delete', { id: added.id }));

  const after = await overview();
  if (after.categories.some((category) => category.id === added.id)) {
    throw new Error('the removed category is still offered');
  }
});

function unwrapOk(value) {
  if (value !== null && value !== undefined) return value;
  return null;
}

/* ------------------------- 2. cash from the drawer ----------------------- */

let shift;

await runner.check('a cash expense needs an open drawer', async () => {
  const rent = await cat('Rent');

  const refused = await harness.call('expenses:save', {
    categoryId: rent.id,
    spentOn: TODAY,
    amount: 50_000_00,
    paidFrom: 'cash',
    payee: 'Landlord',
    notes: '',
  });

  if (refused.ok) throw new Error('cash was recorded with no drawer open');
  if (!/drawer/i.test(refused.error.message)) {
    throw new Error(`unhelpful message: ${refused.error.message}`);
  }

  // Opening the day is what makes the next attempt possible.
  // A float big enough for the day the test is about to have: Rs 80,000.
  shift = await call('shift:open', { openingCash: 8_000_000, notes: '' });
  if (!shift.id) throw new Error('the shift did not open');
});

await runner.check('a cash expense leaves the drawer exactly once', async () => {
  const rent = await cat('Rent');

  const before = await call('shift:x-report', { shiftId: shift.id });
  const expense = await call('expenses:save', {
    categoryId: rent.id,
    spentOn: TODAY,
    amount: 50_000_00, // Rs 50,000
    paidFrom: 'cash',
    payee: 'Landlord',
    notes: 'November rent',
  });

  if (expense.amount !== 50_000_00) throw new Error(`amount ${expense.amount}`);
  if (expense.status !== 'active') throw new Error('a new expense must be active');
  if (!expense.expenseNo.startsWith('EXP-')) throw new Error(`bad number ${expense.expenseNo}`);
  if (expense.shiftId !== shift.id) throw new Error('the expense is not linked to the shift');

  const after = await call('shift:x-report', { shiftId: shift.id });
  if (after.expenses - before.expenses !== 50_000_00) {
    throw new Error(`the drawer report moved by ${after.expenses - before.expenses}`);
  }
  if (before.expectedCash - after.expectedCash !== 50_000_00) {
    throw new Error('expected cash did not drop by the expense');
  }
});

/* -------------------------- 3. money from outside ------------------------ */

await runner.check('an expense from the bank never touches the drawer', async () => {
  const electricity = await cat('Electricity');

  const before = await call('shift:x-report', { shiftId: shift.id });

  const expense = await call('expenses:save', {
    categoryId: electricity.id,
    spentOn: TODAY,
    amount: 12_500_00,
    paidFrom: 'bank',
    payee: 'K-Electric',
    notes: 'October bill',
  });

  if (expense.shiftId !== null) throw new Error('a bank expense was stamped on the drawer');

  const after = await call('shift:x-report', { shiftId: shift.id });
  if (after.expenses !== before.expenses) throw new Error('a bank expense moved the drawer report');
  if (after.expectedCash !== before.expectedCash) throw new Error('expected cash changed');
});

/* ------------------------------ 4. voiding ------------------------------ */

await runner.check('voiding a drawer expense puts the money back and keeps the record', async () => {
  const salaries = await cat('Salaries');

  const expense = await call('expenses:save', {
    categoryId: salaries.id,
    spentOn: TODAY,
    amount: 5_000_00,
    paidFrom: 'cash',
    payee: 'Bilal (waiter)',
    notes: 'Advance',
  });

  const withExpense = await call('shift:x-report', { shiftId: shift.id });

  const voided = await call('expenses:void', {
    id: expense.id,
    reason: 'Wrong amount, will re-enter',
  });

  if (voided.status !== 'void') throw new Error('the expense is not marked void');
  if (voided.voidReason.length === 0) throw new Error('the reason was not kept');

  const afterVoid = await call('shift:x-report', { shiftId: shift.id });
  if (afterVoid.expectedCash - withExpense.expectedCash !== 5_000_00) {
    throw new Error('the money did not come back to the drawer');
  }

  // A second void is refused, and the entry is still visible when asked for.
  const twice = await harness.call('expenses:void', { id: expense.id, reason: 'again' });
  if (twice.ok) throw new Error('the same expense was voided twice');

  const withVoided = await overview({ status: 'all' });
  if (!withVoided.expenses.some((row) => row.id === expense.id)) {
    throw new Error('the voided expense disappeared from the records');
  }

  const activeOnly = await overview();
  if (activeOnly.expenses.some((row) => row.id === expense.id)) {
    throw new Error('a voided expense is still counted as active');
  }
});

await runner.check('a void needs a real reason', async () => {
  const repairs = await cat('Repairs & maintenance');

  const expense = await call('expenses:save', {
    categoryId: repairs.id,
    spentOn: TODAY,
    amount: 800_00,
    paidFrom: 'other',
    payee: 'Plumber',
    notes: 'Leaking tap',
  });

  const noReason = await harness.call('expenses:void', { id: expense.id, reason: 'x' });
  if (noReason.ok) throw new Error('a one-letter reason was accepted');
});

/* ---------------------- 5. voiding after the day closed ------------------ */

await runner.check('a void after the shift closed goes into today’s drawer', async () => {
  const rent = await cat('Rent');

  const expense = await call('expenses:save', {
    categoryId: rent.id,
    spentOn: TODAY,
    amount: 1_000_00,
    paidFrom: 'cash',
    payee: 'Landlord',
    notes: 'Parking space',
  });

  // Close the day (this is history from here on).
  const report = await call('shift:x-report', { shiftId: shift.id });
  await call('shift:close', {
    id: shift.id,
    countedCash: report.expectedCash,
    notes: 'Test close',
  });

  // The shop opens again, with less float than the void will return.
  const newShift = await call('shift:open', { openingCash: 100_000, notes: '' });
  const beforeVoid = await call('shift:x-report', { shiftId: newShift.id });

  await call('expenses:void', { id: expense.id, reason: 'Owner paid it himself' });

  const closedShift = await call('shift:x-report', { shiftId: shift.id });
  if (closedShift.expenses !== report.expenses) {
    throw new Error('the closed shift was rewritten by a later void');
  }

  const reopened = await call('shift:x-report', { shiftId: newShift.id });
  if (reopened.cashIn - beforeVoid.cashIn !== 1_000_00) {
    throw new Error('the refund did not land in the new drawer');
  }

  const row = reopened.movements.find(
    (movement) => movement.kind === 'cash_in' && movement.amount === 1_000_00,
  );
  if (!row || !/earlier shift/i.test(row.reason)) {
    throw new Error('the cross-shift refund is not labelled');
  }

  shift = newShift;
});

/* -------------------------- 6. totals and filters ----------------------- */

await runner.check('the month total and the category summary agree with the list', async () => {
  const result = await overview();

  const fromList = result.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  if (result.total !== fromList) {
    throw new Error(`total ${result.total} but the rows add up to ${fromList}`);
  }

  const fromSummary = result.summary.reduce((sum, row) => sum + row.total, 0);
  if (fromSummary !== result.total) {
    throw new Error(`summary ${fromSummary} vs total ${result.total}`);
  }
});

await runner.check('a month with no expenses reports zero, not an error', async () => {
  const empty = await call('expenses:overview', { from: '2025-01-01', to: '2025-01-31' });

  if (empty.total !== 0) throw new Error(`expected 0, got ${empty.total}`);
  if (empty.expenses.length !== 0) throw new Error('rows appeared from nowhere');
});

await runner.check('a future-dated expense is refused', async () => {
  const misc = await cat('Other');

  const future = await harness.call('expenses:save', {
    categoryId: misc.id,
    spentOn: '2099-01-01',
    amount: 100_00,
    paidFrom: 'bank',
    payee: '',
    notes: '',
  });

  if (future.ok) throw new Error('an expense was dated in the future');
});

/* --------------------------- 7. the cashier ---------------------------- */

await runner.check('a cashier cannot see or record the shop’s expenses', async () => {
  await harness.loginAs('cashier', 'cashier123');

  const read = await harness.call('expenses:overview', {
    from: '2026-11-01',
    to: '2026-11-30',
  });
  if (read.ok) throw new Error('a cashier could read the shop expenses');

  const write = await harness.call('expenses:save', {
    categoryId: 1,
    spentOn: TODAY,
    amount: 100_00,
    paidFrom: 'other',
    payee: '',
    notes: '',
  });
  if (write.ok) throw new Error('a cashier could record an expense');

  // A manager runs the shop, so the expenses are their business too.
  await harness.loginAs('manager', 'manager123');
  const managerRead = await harness.call('expenses:overview', {
    from: '2026-11-01',
    to: '2026-11-30',
  });
  if (!managerRead.ok) throw new Error('a manager could not read the expenses');
});

/*keep*/
runner.finish();
