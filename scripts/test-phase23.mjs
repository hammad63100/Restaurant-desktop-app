/**
 * Phase 23 — the rest of the P&L: wages and the van.
 *
 * The P&L shipped in phase 20 subtracted shop expenses and nothing else, so it
 * reported a profit the owner never had — by exactly the amount he handed out on
 * salary day and what he put in the tank. This suite proves the fix:
 *
 *   1. a salary paid inside the period reduces net profit, and by how much,
 *   2. a salary paid OUTSIDE the period does not (it is filtered on `paid_on`,
 *      because a July wage handed over in August is August's cost),
 *   3. vehicle fuel and repairs reduce net profit the same way,
 *   4. none of it touches gross profit — wages are not a cost of the food,
 *   5. `operatingExpenses` is exactly the sum of its three parts,
 *   6. the Expenses report lists all three other ledgers but does NOT add them to
 *     its own total, so no rupee is counted twice,
 *   7. a cashier cannot read any of it (`costs:read`).
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: false });
const runner = createRunner('Phase 23 — Salaries and vehicle costs in the P&L (4.G)');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const call = (channel, payload) => harness.callOk(channel, payload);
const range = { fromDate: '2026-11-01', toDate: '2026-11-30' };

/*
 * Salary rows are written straight to the table.
 *
 * `staff:pay-salary` stamps `paid_on` with TODAY and refuses without attendance,
 * which would make every assertion here depend on the calendar day the suite runs.
 * The report's job is to read `salary_payments.paid_on` correctly, so the fixture
 * writes known rows there and the service is exercised as-is. (The pay flow itself
 * is covered by the phase 4 staff suite.)
 */
function paySalary({ personId, month, net, paidOn }) {
  harness.db
    .prepare(
      `INSERT INTO salary_payments
         (person_type, person_id, month, base, deductions, advances, net, paid_on, created_at)
       VALUES ('waiter', ?, ?, ?, 0, 0, ?, ?, ?)`,
    )
    // Column order: person_id, month, base, net, paid_on, created_at.
    .run(personId, month, net, net, paidOn, `${paidOn} 10:00:00`);
}

/* ------------------------- a shop that actually sells ------------------- */

const bun = await call('stock:ingredient-save', {
  name: 'Bun',
  category: 'Bread',
  baseUnit: 'pcs',
  purchaseUnit: 'packet',
  unitsPerPurchase: 100,
  reorderLevel: 0,
  supplierId: null,
  active: true,
});

await call('stock:purchase-create', {
  supplierId: null,
  billNo: '',
  purchasedOn: '2026-11-01',
  extraCharges: 0,
  paidAmount: 0,
  paymentMethod: 'credit',
  notes: '',
  lines: [{ ingredientId: bun.id, qtyPurchaseMilli: 10_000, unitPrice: 25_000 }],
});

const category = await call('menu:category-save', { name: 'Burgers', sortOrder: 1, active: true });
const burger = await call('menu:item-save', {
  categoryId: category.id,
  name: 'Burger',
  price: 30_000, // Rs 300
  available: true,
  image: null,
});

await call('recipes:save', {
  itemId: burger.id,
  lines: [{ ingredientId: bun.id, qtyBase: 1, wastePercentX100: 0 }],
});

async function sell(qty) {
  return call('orders:create', {
    type: 'takeaway',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: burger.id, qty, notes: '' }],
  });
}

let waiterId;
let vehicleId;

/* ----------------------------- 1. the baseline -------------------------- */

await runner.check('a clean period has no wages and no vehicle costs', async () => {
  const report = await call('reports:profit', range);

  if (report.salaries !== 0) throw new Error(`salaries ${report.salaries}`);
  if (report.vehicleCosts !== 0) throw new Error(`vehicle costs ${report.vehicleCosts}`);
  if (report.operatingExpenses !== report.shopExpenses) {
    throw new Error('operating expenses is not just shop expenses on an empty period');
  }
  if (report.netProfit !== report.grossProfit - report.operatingExpenses) {
    throw new Error('net profit does not follow from the running costs');
  }
});

/* ------------------------------ 2. salaries ---------------------------- */

await runner.check('a salary paid in the period cuts net profit, not gross', async () => {
  await sell(10);

  const before = await call('reports:profit', range);

  waiterId = await call('staff:waiter-save', {
    name: 'Ali Raza',
    phone: '0300-0000001',
    cnic: '',
    address: '',
    joinDate: '2026-01-01',
    salary: 3_000_000, // Rs 30,000 a month
    active: true,
  });

  // A July salary handed over in November: the cost belongs to November.
  paySalary({
    personId: waiterId.id,
    month: '2026-07',
    net: 3_000_000,
    paidOn: '2026-11-15',
  });

  const after = await call('reports:profit', range);

  if (after.salaries !== 3_000_000) throw new Error(`salaries ${after.salaries}`);

  // Gross profit is about food; a wage never enters it.
  if (after.grossProfit !== before.grossProfit) {
    throw new Error(`gross profit moved from ${before.grossProfit} to ${after.grossProfit}`);
  }

  // Net profit falls by exactly the wage.
  if (after.netProfit !== before.netProfit - 3_000_000) {
    throw new Error(`net profit ${before.netProfit} → ${after.netProfit}`);
  }

  if (after.operatingExpenses !== after.shopExpenses + 3_000_000 + after.vehicleCosts) {
    throw new Error('running costs is not the sum of its parts');
  }

  // And the named payout is available for the screen.
  const person = after.salariesByPerson.find((row) => row.name === 'Ali Raza');
  if (!person) throw new Error('the payout is not attributed to the waiter');
  if (person.total !== 3_000_000) throw new Error(`named total ${person.total}`);
});

await runner.check('a salary paid OUTSIDE the period does not count', async () => {
  const before = await call('reports:profit', range);

  // Same waiter, same amount, but paid in December — and for August, to prove the
  // filter uses `paid_on` and not the month the salary is for.
  paySalary({
    personId: waiterId.id,
    month: '2026-08',
    net: 3_000_000,
    paidOn: '2026-12-02',
  });

  const after = await call('reports:profit', range);
  if (after.salaries !== before.salaries) {
    throw new Error(`a December payout changed November (${before.salaries} → ${after.salaries})`);
  }

  // It must appear in December instead.
  const december = await call('reports:profit', { fromDate: '2026-12-01', toDate: '2026-12-31' });
  if (december.salaries !== 3_000_000) {
    throw new Error(`the December window reports ${december.salaries}`);
  }
});

/* --------------------------- 3. vehicle costs -------------------------- */

await runner.check('fuel and repairs reduce net profit', async () => {
  const before = await call('reports:profit', range);

  vehicleId = await call('vehicles:save', {
    type: 'bike',
    plateNo: 'LEA-1234',
    model: 'Suzuki Bolan',
    registrationExpiry: null,
    insuranceExpiry: null,
    active: true,
  });

  await call('vehicles:expense-add', {
    vehicleId: vehicleId.id,
    type: 'fuel',
    amount: 500_000, // Rs 5,000 of petrol
    date: '2026-11-12',
    note: 'Delivery runs',
  });

  await call('vehicles:expense-add', {
    vehicleId: vehicleId.id,
    type: 'repair',
    amount: 250_000, // Rs 2,500 repair
    date: '2026-11-18',
    note: 'Brake pads',
  });

  const after = await call('reports:profit', range);

  if (after.vehicleCosts !== 750_000) throw new Error(`vehicle costs ${after.vehicleCosts}`);
  if (after.netProfit !== before.netProfit - 750_000) {
    throw new Error(`net profit ${before.netProfit} → ${after.netProfit}`);
  }
  if (after.grossProfit !== before.grossProfit) throw new Error('gross profit moved');

  const fuel = after.vehicleByType.find((row) => row.type === 'fuel');
  const repair = after.vehicleByType.find((row) => row.type === 'repair');
  if (fuel?.total !== 500_000) throw new Error(`fuel total ${fuel?.total}`);
  if (repair?.total !== 250_000) throw new Error(`repair total ${repair?.total}`);
});

/* ------------------- 4. nothing is counted twice ----------------------- */

await runner.check('the Expenses report lists the other ledgers but excludes them from its total', async () => {
  await call('shift:open', { openingCash: 1_000_000 });

  const overview = await call('expenses:overview', {
    from: range.fromDate,
    to: range.toDate,
  });
  const rent = overview.categories.find((row) => row.name === 'Rent');

  await call('expenses:save', {
    categoryId: rent.id,
    spentOn: '2026-11-05',
    amount: 2_000_000, // Rs 20,000 rent
    paidFrom: 'bank',
    payee: 'Landlord',
    notes: '',
  });

  const report = await call('reports:expenses', range);

  // The typed expenses are the total, exactly.
  if (report.total !== 2_000_000) throw new Error(`expense total ${report.total}`);

  // The other ledgers are present...
  const salaries = report.otherCosts.find((line) => line.key === 'salaries');
  const vehiclesLine = report.otherCosts.find((line) => line.key === 'vehicles');
  const wastage = report.otherCosts.find((line) => line.key === 'wastage');

  if (!salaries || !vehiclesLine || !wastage) {
    throw new Error('one of the other cost lines is missing');
  }
  // Only the November payout counts (the December one is outside the window).
  if (salaries.total !== 3_000_000) throw new Error(`salaries line ${salaries.total}`);
  if (vehiclesLine.total !== 750_000) throw new Error(`vehicles line ${vehiclesLine.total}`);
  if (wastage.total !== 0) throw new Error(`wastage line ${wastage.total}`);

  // ...and NOT added into `total`, which is what stops double counting.
  if (report.total === 2_000_000 + 3_000_000 + 750_000) {
    throw new Error('the other ledgers were folded into the expense total');
  }
});

await runner.check('the P&L running costs equal the three sources, not the expense total alone', async () => {
  const pnl = await call('reports:profit', range);
  const expenseReport = await call('reports:expenses', range);

  const expected =
    expenseReport.total +
    (expenseReport.otherCosts.find((line) => line.key === 'salaries')?.total ?? 0) +
    (expenseReport.otherCosts.find((line) => line.key === 'vehicles')?.total ?? 0);

  if (pnl.operatingExpenses !== expected) {
    throw new Error(`running costs ${pnl.operatingExpenses} vs sources ${expected}`);
  }

  /*
   * Wastage is deliberately NOT in running costs: it is already inside the cost of
   * food (those ingredients were bought and never sold), so subtracting it here
   * would charge the shop twice for the same loss. Prove it by wasting something
   * and checking that running costs did not move.
   */
  const bunId = (
    await call('stock:ingredients', {})
  ).find((row) => row.name === 'Bun').id;

  await call('stock:wastage', {
    ingredientId: bunId,
    qtyBase: 50,
    reason: 'spoiled',
    notes: 'Test loss',
    happenedOn: '2026-11-20',
  });

  const afterWaste = await call('reports:profit', range);
  if (afterWaste.operatingExpenses !== pnl.operatingExpenses) {
    throw new Error('wastage was added to the running costs as well as the food cost');
  }
  if (afterWaste.wastageValue <= 0) throw new Error('the wastage was not recorded at all');
});

/* ---------------------------- 5. the dashboard ------------------------- */

await runner.check('the dashboard spend card includes today’s wages', async () => {
  const today = new Date().toISOString().slice(0, 10);

  // Pay a wage today, for whichever month, so `paid_on` is today.
  paySalary({ personId: waiterId.id, month: '2026-09', net: 1_000_000, paidOn: today });

  const stats = await call('reports:dashboard');
  if (stats.todayExpenses < 1_000_000) {
    throw new Error(`today's spend is ${stats.todayExpenses}, the wage is missing`);
  }
});

/* ---------------------------- 6. permissions --------------------------- */

await runner.check('a manager still cannot see the P&L or these costs', async () => {
  await call('users:save', {
    fullName: 'Shop Manager',
    username: 'manager',
    password: 'manager123',
    role: 'manager',
    active: true,
  });
  await harness.loginAs('manager', 'manager123');

  const pnl = await harness.call('reports:profit', range);
  if (pnl.ok) throw new Error('a manager read the P&L');

  const expenses = await harness.call('reports:expenses', range);
  if (expenses.ok) throw new Error('a manager read the expense report');
});

harness.cleanup();
runner.finish();
