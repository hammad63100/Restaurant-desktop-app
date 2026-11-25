/**
 * Phase 5 checks: vehicles, assignment rules and history, expenses, expiry alerts.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 5 — Vehicles, assignments and expenses');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
const expired = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);

let bikeId;
let carId;
let riderOneId;
let riderTwoId;

await runner.check('a vehicle can be added with document dates', async () => {
  const bike = await harness.callOk('vehicles:save', {
    type: 'bike',
    plateNo: 'ICT-9999',
    model: 'Honda CG 125',
    color: 'Red',
    registrationExpiry: soon,
    insuranceExpiry: expired,
    active: true,
  });

  bikeId = bike.id;
  if (bike.registrationExpiry !== soon) throw new Error('registration date not saved');
  if (bike.assignedToId !== null) throw new Error('new vehicle should be unassigned');
});

await runner.check('duplicate number plates are rejected', async () => {
  await harness.callFail(
    'vehicles:save',
    {
      type: 'bike',
      plateNo: 'ict-9999',
      model: '',
      color: '',
      registrationExpiry: null,
      insuranceExpiry: null,
      active: true,
    },
    'CONFLICT',
  );
});

await runner.check('two riders can be created for assignment tests', async () => {
  const one = await harness.callOk('staff:delivery-boy-save', {
    name: 'Rider One',
    phone: '03001110000',
    cnic: '',
    address: '',
    joinDate: '2026-01-01',
    salary: 2_500_000,
    active: true,
    commission: 5,
    vehicleId: null,
  });

  const two = await harness.callOk('staff:delivery-boy-save', {
    name: 'Rider Two',
    phone: '03002220000',
    cnic: '',
    address: '',
    joinDate: '2026-01-01',
    salary: 2_500_000,
    active: true,
    commission: 5,
    vehicleId: null,
  });

  riderOneId = one.id;
  riderTwoId = two.id;
});

await runner.check('assigning a vehicle moves the rider pointer on both sides', async () => {
  const vehicle = await harness.callOk('vehicles:assign', {
    vehicleId: bikeId,
    deliveryBoyId: riderOneId,
    fromDate: '2026-11-01',
  });

  if (vehicle.assignedToId !== riderOneId) throw new Error('vehicle does not show the rider');

  const riders = await harness.callOk('staff:delivery-boys');
  const rider = riders.find((row) => row.id === riderOneId);
  if (rider.vehiclePlate !== 'ICT-9999') throw new Error('rider does not show the vehicle');
});

await runner.check('reassigning closes the old assignment and keeps the history', async () => {
  await harness.callOk('vehicles:assign', {
    vehicleId: bikeId,
    deliveryBoyId: riderTwoId,
    fromDate: '2026-11-10',
  });

  const history = await harness.callOk('vehicles:assignments', { id: bikeId });
  if (history.length !== 2) throw new Error(`expected 2 assignments, got ${history.length}`);

  const open = history.filter((row) => row.toDate === null);
  if (open.length !== 1 || open[0].deliveryBoyId !== riderTwoId) {
    throw new Error('exactly one open assignment for the new rider expected');
  }

  const riders = await harness.callOk('staff:delivery-boys');
  const firstRider = riders.find((row) => row.id === riderOneId);
  if (firstRider.vehicleId !== null) throw new Error('previous rider still points at the vehicle');
});

await runner.check('a rider cannot hold two vehicles at once', async () => {
  const car = await harness.callOk('vehicles:save', {
    type: 'car',
    plateNo: 'ICT-5555',
    model: 'Suzuki Alto',
    color: 'White',
    registrationExpiry: null,
    insuranceExpiry: null,
    active: true,
  });
  carId = car.id;

  await harness.callOk('vehicles:assign', {
    vehicleId: carId,
    deliveryBoyId: riderTwoId,
    fromDate: '2026-11-12',
  });

  const bikeHistory = await harness.callOk('vehicles:assignments', { id: bikeId });
  if (bikeHistory.some((row) => row.toDate === null)) {
    throw new Error('bike should have been released when the rider took the car');
  }
});

await runner.check('releasing a vehicle clears both sides', async () => {
  const released = await harness.callOk('vehicles:assign', {
    vehicleId: carId,
    deliveryBoyId: null,
    fromDate: '2026-11-15',
  });

  if (released.assignedToId !== null) throw new Error('vehicle should be free');

  const riders = await harness.callOk('staff:delivery-boys');
  if (riders.find((row) => row.id === riderTwoId).vehicleId !== null) {
    throw new Error('rider should be released');
  }
});

await runner.check('a vehicle with an open assignment cannot be removed', async () => {
  await harness.callOk('vehicles:assign', {
    vehicleId: bikeId,
    deliveryBoyId: riderOneId,
    fromDate: '2026-11-16',
  });

  await harness.callFail('vehicles:delete', { id: bikeId }, 'CONFLICT');

  await harness.callOk('vehicles:assign', {
    vehicleId: bikeId,
    deliveryBoyId: null,
    fromDate: '2026-11-16',
  });
});

await runner.check('expenses are recorded and cannot be in the future', async () => {
  await harness.callOk('vehicles:expense-add', {
    vehicleId: bikeId,
    type: 'fuel',
    amount: 150_000,
    date: '2026-11-10',
    note: 'Petrol',
  });

  await harness.callOk('vehicles:expense-add', {
    vehicleId: bikeId,
    type: 'maintenance',
    amount: 400_000,
    date: '2026-11-11',
    note: 'Chain and oil',
  });

  await harness.callFail(
    'vehicles:expense-add',
    { vehicleId: bikeId, type: 'fuel', amount: 1000, date: '2999-01-01', note: '' },
    'VALIDATION_ERROR',
  );
});

await runner.check('expenses are filtered by date and summed per vehicle', async () => {
  const rows = await harness.callOk('vehicles:expenses', {
    vehicleId: bikeId,
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
  });

  if (rows.length !== 2) throw new Error(`expected 2 expenses, got ${rows.length}`);

  const summary = await harness.callOk('reports:vehicle-expenses', {
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
  });

  const bikeSummary = summary.find((row) => row.vehicleId === bikeId);
  if (!bikeSummary) throw new Error('bike missing from the expense report');
  if (bikeSummary.fuel !== 150_000) throw new Error('fuel total wrong');
  if (bikeSummary.maintenance !== 400_000) throw new Error('maintenance total wrong');
  if (bikeSummary.total !== 550_000) throw new Error('total expense wrong');
});

await runner.check('the dashboard lists expiring and expired documents', async () => {
  const stats = await harness.callOk('reports:dashboard');

  const bikeAlerts = stats.expiringVehicles.filter((alert) => alert.vehicleId === bikeId);
  if (bikeAlerts.length !== 2) throw new Error(`expected 2 alerts, got ${bikeAlerts.length}`);

  const registration = bikeAlerts.find((alert) => alert.document === 'registration');
  const insurance = bikeAlerts.find((alert) => alert.document === 'insurance');

  if (!registration || registration.daysLeft <= 0)
    throw new Error('registration should be expiring soon');
  if (!insurance || insurance.daysLeft >= 0)
    throw new Error('insurance should be shown as expired');
});

await runner.check('an expense can be deleted', async () => {
  const rows = await harness.callOk('vehicles:expenses', {
    vehicleId: bikeId,
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
  });

  await harness.callOk('vehicles:expense-delete', { id: rows[0].id });

  const after = await harness.callOk('vehicles:expenses', {
    vehicleId: bikeId,
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
  });

  if (after.length !== rows.length - 1) throw new Error('expense was not deleted');
});

await runner.check('cashiers cannot write vehicles', async () => {
  await harness.loginAs('cashier', 'cashier123');

  await harness.callFail(
    'vehicles:save',
    {
      type: 'bike',
      plateNo: 'XXX-1',
      model: '',
      color: '',
      registrationExpiry: null,
      insuranceExpiry: null,
      active: true,
    },
    'FORBIDDEN',
  );
  await harness.callFail(
    'vehicles:assign',
    { vehicleId: bikeId, deliveryBoyId: riderOneId, fromDate: '2026-11-16' },
    'FORBIDDEN',
  );
});

harness.cleanup();
runner.finish();
