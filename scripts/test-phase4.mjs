/**
 * Phase 4 checks: waiters, delivery boys, attendance, advances, salary maths,
 * salary payment and the waiter/rider links on orders.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 4 — Staff, attendance and salaries');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const MONTH = '2026-11';
let waiterId;
let boyId;

await runner.check('a waiter can be added and listed', async () => {
  const waiter = await harness.callOk('staff:waiter-save', {
    name: 'Test Waiter',
    phone: '03001112233',
    cnic: '61101-9999999-9',
    address: 'Islamabad',
    joinDate: '2026-11-01',
    salary: 3_000_000,
    active: true,
  });

  waiterId = waiter.id;
  if (waiter.salary !== 3_000_000) throw new Error('salary must be stored in paisa');

  const list = await harness.callOk('staff:waiters');
  if (!list.some((row) => row.id === waiterId)) throw new Error('waiter missing from the list');
});

await runner.check('a delivery boy can be added with commission', async () => {
  const boy = await harness.callOk('staff:delivery-boy-save', {
    name: 'Test Rider',
    phone: '03004445566',
    cnic: '61101-8888888-8',
    address: 'Islamabad',
    joinDate: '2026-11-01',
    salary: 2_800_000,
    active: true,
    commission: 5,
    vehicleId: null,
  });

  boyId = boy.id;
  if (boy.commission !== 5) throw new Error('commission not saved');
});

await runner.check('attendance can be marked and updated for a day', async () => {
  await harness.callOk('staff:attendance-set', {
    personType: 'waiter',
    personId: waiterId,
    date: '2026-11-02',
    status: 'present',
  });

  const updated = await harness.callOk('staff:attendance-set', {
    personType: 'waiter',
    personId: waiterId,
    date: '2026-11-02',
    status: 'half_day',
  });

  if (updated.status !== 'half_day') throw new Error('attendance was not updated in place');

  const rows = await harness.callOk('staff:attendance', {
    personType: 'waiter',
    personId: waiterId,
    month: MONTH,
  });

  if (rows.length !== 1) throw new Error('one day should produce one row');
});

await runner.check('advances are recorded and cannot be dated in the future', async () => {
  await harness.callOk('staff:advance-add', {
    personType: 'waiter',
    personId: waiterId,
    amount: 500_000,
    date: '2026-11-05',
    note: 'Bike repair',
  });

  const advances = await harness.callOk('staff:advances', {
    personType: 'waiter',
    personId: waiterId,
    month: MONTH,
  });

  if (advances.length !== 1 || advances[0].amount !== 500_000) {
    throw new Error('advance not stored correctly');
  }

  await harness.callFail(
    'staff:advance-add',
    {
      personType: 'waiter',
      personId: waiterId,
      amount: 1000,
      date: '2999-01-01',
      note: 'future',
    },
    'VALIDATION_ERROR',
  );
});

await runner.check('salary slip maths: per day, half days, advances and net pay', async () => {
  // 10 present days and 1 half day in a 30 day month, salary 30,000.00
  await harness.callOk('staff:attendance-set', {
    personType: 'waiter',
    personId: waiterId,
    date: '2026-11-02',
    status: 'leave',
  });

  for (let day = 3; day <= 12; day += 1) {
    await harness.callOk('staff:attendance-set', {
      personType: 'waiter',
      personId: waiterId,
      date: `2026-11-${String(day).padStart(2, '0')}`,
      status: 'present',
    });
  }
  await harness.callOk('staff:attendance-set', {
    personType: 'waiter',
    personId: waiterId,
    date: '2026-11-13',
    status: 'half_day',
  });

  const slip = await harness.callOk('staff:salary-slip', {
    personType: 'waiter',
    personId: waiterId,
    month: MONTH,
  });

  const perDay = Math.round(3_000_000 / slip.workingDays);
  const earned = 10 * perDay + Math.round(perDay / 2);

  if (slip.workingDays !== 30)
    throw new Error(`November should have 30 days, got ${slip.workingDays}`);
  if (slip.daysPresent !== 10) throw new Error(`expected 10 present days, got ${slip.daysPresent}`);
  if (slip.leaves !== 1) throw new Error('leave day not counted');
  if (slip.halfDays !== 1) throw new Error('half day not counted');
  if (slip.perDay !== perDay) throw new Error('per day amount wrong');
  if (slip.earnedSalary !== earned) throw new Error(`earned ${slip.earnedSalary} != ${earned}`);
  if (slip.advances !== 500_000) throw new Error('advances not subtracted');
  if (slip.netPay !== earned - 500_000) throw new Error(`net pay ${slip.netPay} wrong`);
});

await runner.check('salary cannot be paid before attendance is marked', async () => {
  await harness.callFail(
    'staff:salary-pay',
    { personType: 'waiter', personId: waiterId, month: '2026-10', deductions: 0 },
    'VALIDATION_ERROR',
  );
});

await runner.check('paying salary stores the payment and blocks a double payment', async () => {
  const payment = await harness.callOk('staff:salary-pay', {
    personType: 'waiter',
    personId: waiterId,
    month: MONTH,
    deductions: 100_000,
  });

  if (payment.net <= 0) throw new Error('net pay must be positive');
  if (!payment.paidOn) throw new Error('paid date missing');

  const slip = await harness.callOk('staff:salary-slip', {
    personType: 'waiter',
    personId: waiterId,
    month: MONTH,
  });

  if (!slip.paidOn) throw new Error('slip should show the payment');

  await harness.callFail(
    'staff:salary-pay',
    { personType: 'waiter', personId: waiterId, month: MONTH, deductions: 0 },
    'CONFLICT',
  );
});

await runner.check('delivery commission is included in the rider salary', async () => {
  const boy = await harness
    .callOk('staff:delivery-boys')
    .then((rows) => rows.find((row) => row.id === boyId));

  if (!boy) throw new Error('rider missing');

  // One delivered delivery order worth the rider's commission.
  const order = await harness.callOk('orders:create', {
    type: 'delivery',
    status: 'delivered',
    customerName: 'Rider Customer',
    customerPhone: '03007778888',
    customerAddress: 'Sector G-11',
    waiterId: null,
    deliveryBoyId: boyId,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: 1, qty: 1, notes: '' }],
  });

  if (order.deliveryBoyName !== boy.name) throw new Error('rider not linked to the order');

  for (let day = 3; day <= 7; day += 1) {
    await harness.callOk('staff:attendance-set', {
      personType: 'delivery_boy',
      personId: boyId,
      date: `2026-11-${String(day).padStart(2, '0')}`,
      status: 'present',
    });
  }

  const slip = await harness.callOk('staff:salary-slip', {
    personType: 'delivery_boy',
    personId: boyId,
    month: MONTH,
  });

  if (slip.commission <= 0) throw new Error('commission should be included for riders');
  if (slip.netPay !== slip.earnedSalary + slip.commission - slip.advances) {
    throw new Error('rider net pay maths is wrong');
  }
});

await runner.check('a waiter is linked to dine-in orders', async () => {
  const order = await harness.callOk('orders:create', {
    type: 'dine_in',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: 1, qty: 1, notes: '' }],
  });

  if (order.waiterName !== 'Test Waiter') throw new Error('waiter not linked to the order');
});

await runner.check('removing staff keeps history and hides them from the active list', async () => {
  await harness.callOk('staff:waiter-delete', { id: waiterId });

  const list = await harness.callOk('staff:waiters');
  if (list.some((row) => row.id === waiterId)) throw new Error('waiter still on the active list');

  const slip = await harness.callOk('staff:salary-slip', {
    personType: 'waiter',
    personId: waiterId,
    month: MONTH,
  });

  if (slip.name !== 'Test Waiter') throw new Error('salary history lost after removal');
});

await runner.check('cashiers cannot write staff records or pay salaries', async () => {
  await harness.loginAs('cashier', 'cashier123');

  // Reading the staff list is allowed: order entry needs the waiter/rider names.
  const waiters = await harness.callOk('staff:waiters');
  if (!Array.isArray(waiters)) throw new Error('staff list should be readable for order entry');

  await harness.callFail(
    'staff:waiter-save',
    {
      name: 'Hacker',
      phone: '',
      cnic: '',
      address: '',
      joinDate: '2026-11-01',
      salary: 1,
      active: true,
    },
    'FORBIDDEN',
  );
  await harness.callFail(
    'staff:salary-pay',
    { personType: 'waiter', personId: 1, month: MONTH, deductions: 0 },
    'FORBIDDEN',
  );
});

harness.cleanup();
runner.finish();
