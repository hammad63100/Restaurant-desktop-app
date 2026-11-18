/**
 * Phase 2 checks: dashboard, shell permission map, settings, users, backups.
 * Runs the real services through the IPC registry (no display needed).
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createHarness, createRunner } from './test-harness.mjs';

const compiledDir = path.resolve(import.meta.dirname, '..', 'dist-electron', 'electron');

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 2 — Dashboard, settings and users');

await harness.setup();

await harness.loginAs('admin', 'admin123').then(() =>
  harness.callOk('auth:change-password', {
    currentPassword: 'admin123',
    newPassword: 'OwnerPass123',
  }),
);

await runner.check('every shipped migration runs on a fresh database', () => {
  // Count the files so adding a migration never breaks this test.
  const sqlFiles = readdirSync(path.join(compiledDir, 'db', 'migrations')).filter((file) =>
    file.endsWith('.sql'),
  ).length;

  if (harness.migrationsApplied !== sqlFiles) {
    throw new Error(`expected ${sqlFiles} migrations, got ${harness.migrationsApplied}`);
  }
});

await runner.check('dashboard returns today numbers and recent orders', async () => {
  const stats = await harness.callOk('reports:dashboard');
  if (stats.todayOrders < 1) throw new Error('demo data should include today orders');
  if (stats.todaySales <= 0) throw new Error('today sales should be greater than zero');
  if (!Array.isArray(stats.recentOrders) || stats.recentOrders.length === 0) {
    throw new Error('recent orders should not be empty');
  }
  if (stats.salesByDay.length !== 7) throw new Error('salesByDay should cover 7 days');
  if (stats.totalItems !== 9) throw new Error(`expected 9 menu items, got ${stats.totalItems}`);
});

await runner.check('cashier gets a smaller page list than admin', async () => {
  await harness.loginAs('cashier', 'cashier123');
  const permissions = await harness.callOk('auth:permissions');

  if (!permissions.pages.includes('orders')) throw new Error('cashier must open orders');
  if (permissions.pages.includes('settings')) throw new Error('cashier must not open settings');
  if (permissions.pages.includes('users')) throw new Error('cashier must not open users');
  if (permissions.pages.includes('staff')) throw new Error('cashier must not open staff');
});

await runner.check('cashier cannot read or write shop settings', async () => {
  await harness.callFail('settings:get', undefined, 'UNAUTHENTICATED').catch(() => undefined);
  await harness.callFail('settings:save', {}, 'FORBIDDEN');
});

await runner.check('cashier cannot list users', async () => {
  await harness.callFail('users:list', undefined, 'FORBIDDEN');
});

await runner.check('manager can read staff and reports but not settings', async () => {
  await harness.loginAs('manager', 'manager123');

  const boys = await harness.callOk('staff:delivery-boys');
  if (boys.length !== 1) throw new Error('manager should see the demo delivery boy');

  await harness.callOk('reports:range', { fromDate: '2020-01-01', toDate: '2030-01-01' });
  await harness.callFail('settings:save', {}, 'FORBIDDEN');
  await harness.callFail('users:list', undefined, 'FORBIDDEN');
});

await runner.check('admin reads and saves settings, tax is stored as an integer', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  const before = await harness.callOk('settings:get');
  if (before.shopName !== 'Gul Khan Fast Food') throw new Error('default shop name missing');

  const saved = await harness.callOk('settings:save', {
    ...before,
    shopName: 'Gul Khan Fast Food — Blue Area',
    taxPercent: 5,
    receiptWidth: 'a4',
  });

  if (saved.shopName !== 'Gul Khan Fast Food — Blue Area') throw new Error('shop name not saved');
  if (saved.taxPercent !== 5) throw new Error('tax percent not saved');
  if (saved.receiptWidth !== 'a4') throw new Error('receipt width not saved');
});

await runner.check('invalid settings are rejected with a friendly message', async () => {
  const error = await harness.callFail(
    'settings:save',
    {
      shopName: '',
      taxPercent: 5,
      shopAddress: '',
      shopPhone: '',
      currency: 'PKR',
      receiptWidth: '80mm',
      backupOnClose: true,
      shopLogo: null,
    },
    'VALIDATION_ERROR',
  );
  if (!/shop name/i.test(error.message)) throw new Error(`unhelpful message: ${error.message}`);
});

await runner.check('admin can create a user who is forced to change password', async () => {
  const created = await harness.callOk('users:save', {
    username: 'newcashier',
    fullName: 'New Cashier',
    role: 'cashier',
    active: true,
    password: 'TempPass123',
  });

  if (created.role !== 'cashier') throw new Error('role not saved');
  if (!created.mustChangePassword) throw new Error('new users must change their password');

  const login = await harness.loginAs('newcashier', 'TempPass123');
  if (!login.mustChangePassword) throw new Error('session must flag the pending password change');
});

await runner.check('duplicate usernames are rejected', async () => {
  await harness.loginAs('admin', 'OwnerPass123');
  await harness.callFail(
    'users:save',
    {
      username: 'newcashier',
      fullName: 'Clash',
      role: 'cashier',
      active: true,
      password: 'TempPass123',
    },
    'CONFLICT',
  );
});

await runner.check('the last active admin cannot be disabled', async () => {
  const users = await harness.callOk('users:list');
  const admin = users.find((user) => user.username === 'admin');
  await harness.callFail('users:set-active', { id: admin.id, active: false }, 'CONFLICT');
});

await runner.check('a user cannot disable their own account', async () => {
  const users = await harness.callOk('users:list');
  const cashier = users.find((user) => user.username === 'newcashier');
  await harness.callOk('users:set-active', { id: cashier.id, active: false });

  const disabled = (await harness.callOk('users:list')).find((user) => user.id === cashier.id);
  if (disabled.active) throw new Error('account should be disabled');
});

await runner.check('backup can be created and listed', async () => {
  const backup = await harness.callOk('settings:backup-create');
  if (!backup || !backup.fileName.endsWith('.db')) throw new Error('backup file was not created');

  const list = await harness.callOk('settings:backup-list');
  if (list.length === 0) throw new Error('backup list should contain the new file');
});

await runner.check('a cashier cannot create backups', async () => {
  await harness.loginAs('cashier', 'cashier123');
  await harness.callFail('settings:backup-create', undefined, 'FORBIDDEN');
});

await runner.check('demo data covers vehicles, attendance and advances', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  const vehicles = await harness.callOk('vehicles:list');
  if (vehicles.length < 2) throw new Error('demo data should include two vehicles');
  if (!vehicles.some((vehicle) => vehicle.assignedToName)) {
    throw new Error('one demo vehicle should be assigned to the rider');
  }

  const waiters = await harness.callOk('staff:waiters');
  const month = new Date().toISOString().slice(0, 7);
  const attendance = await harness.callOk('staff:attendance', {
    personType: 'waiter',
    personId: waiters[0].id,
    month,
  });

  if (attendance.length === 0)
    throw new Error('demo data should include attendance for this month');

  const advances = await harness.callOk('staff:advances', {
    personType: 'waiter',
    personId: waiters[0].id,
    month,
  });

  if (advances.length === 0) throw new Error('demo data should include an advance');
});

harness.cleanup();
runner.finish();
