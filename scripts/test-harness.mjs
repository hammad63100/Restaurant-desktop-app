/**
 * Test harness: boots the real database, migrations, services and IPC registry
 * without a display. Used by the phase test scripts so every phase is verified
 * against the same code the packaged app runs.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const compiled = path.join(root, 'dist-electron', 'electron');
const load = (relative) => require(path.join(compiled, relative));

export function createHarness({ withDemoData = true } = {}) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gulkhan-test-'));
  const dbFile = path.join(tempDir, 'test.db');

  const { openDatabase, closeDatabase, getDatabase } = load('db/connection.js');
  const { runMigrations } = load('db/migrate.js');
  const { configureLogger } = load('services/logger.js');

  configureLogger(path.join(tempDir, 'logs'));

  const db = openDatabase(dbFile);
  const migrationsApplied = runMigrations(db, path.join(compiled, 'db', 'migrations'));

  const repositories = {
    users: load('db/repositories/userRepository.js').createUserRepository(db),
    settings: load('db/repositories/settingsRepository.js').createSettingsRepository(db),
    catalog: load('db/repositories/catalogRepository.js').createCatalogRepository(db),
    orders: load('db/repositories/ordersRepository.js').createOrdersRepository(db),
    staff: load('db/repositories/staffRepository.js').createStaffRepository(db),
    vehicles: load('db/repositories/vehiclesRepository.js').createVehiclesRepository(db),
    sequences: load('db/repositories/sequenceRepository.js').createSequenceRepository(db),
  };

  const { createAuthService } = load('services/authService.js');
  const { createCatalogService } = load('services/catalogService.js');
  const { createOrdersService } = load('services/ordersService.js');
  const { createStaffService } = load('services/staffService.js');
  const { createVehiclesService } = load('services/vehiclesService.js');
  const { createReportsService } = load('services/reportsService.js');
  const { createCsvService } = load('services/csvService.js');
  const { createSettingsService } = load('services/settingsService.js');
  const { createUserService } = load('services/userService.js');
  const { createBackupService } = load('services/backupService.js');
  const { buildRegistry, dispatch } = load('ipc/index.js');
  const { seedDefaultAdmin } = load('db/seed.js');
  const { seedDemoData } = load('db/seedDemo.js');

  const auth = createAuthService(repositories.users);

  const staffService = createStaffService({
    staff: repositories.staff,
    vehicles: repositories.vehicles,
    commissionForMonth: (deliveryBoyId, month) =>
      repositories.orders
        .deliveriesByBoy(`${month}-01`, `${month}-31`)
        .find((row) => row.deliveryBoyId === deliveryBoyId)?.commission ?? 0,
  });

  const reportsService = createReportsService({
    orders: repositories.orders,
    catalog: repositories.catalog,
    staff: repositories.staff,
    vehicles: repositories.vehicles,
    staffService,
  });

  const csvService = createCsvService({
    reports: reportsService,
    exportDirectory: () => tempDir,
    salarySummary: (month) => reportsService.salarySummary(month),
  });

  const backups = createBackupService(dbFile, path.join(tempDir, 'backups'), {
    checkpoint: () => getDatabase().pragma('wal_checkpoint(TRUNCATE)'),
    replaceWith: () => undefined,
  });

  const { renderInvoiceHtml } = load('services/printService.js');

  // Printing needs a real window, so the harness stubs it the way Electron would call it.
  const printStub = {
    printInvoice: async () => true,
    savePdf: async () => null,
    renderHtml: renderInvoiceHtml,
  };

  const registry = buildRegistry({
    auth,
    catalog: createCatalogService(repositories.catalog),
    orders: createOrdersService({
      orders: repositories.orders,
      catalog: repositories.catalog,
      sequences: repositories.sequences,
      settings: repositories.settings,
      staff: repositories.staff,
      users: repositories.users,
    }),
    staff: staffService,
    vehicles: createVehiclesService({ vehicles: repositories.vehicles, staff: repositories.staff }),
    reports: reportsService,
    settings: createSettingsService(repositories.settings),
    users: createUserService(repositories.users),
    backups,
    print: printStub,
    csv: csvService,
  });

  /** Calls a channel exactly like the Electron main process does. */
  async function call(channel, payload) {
    return dispatch(
      channel,
      registry,
      payload,
      () => auth.getCurrentUser(),
      auth.getCurrentUser() !== null,
    );
  }

  /** Asserts a call succeeded and returns its data. */
  async function callOk(channel, payload) {
    const result = await call(channel, payload);
    assert.equal(
      result.ok,
      true,
      `${channel} should succeed but returned: ${JSON.stringify(result)}`,
    );
    return result.data;
  }

  /** Asserts a call failed with a specific error code. */
  async function callFail(channel, payload, expectedCode) {
    const result = await call(channel, payload);
    assert.equal(result.ok, false, `${channel} should fail but succeeded`);
    if (expectedCode) {
      assert.equal(
        result.error.code,
        expectedCode,
        `${channel} expected ${expectedCode} but got ${result.error.code} (${result.error.message})`,
      );
    }
    return result.error;
  }

  async function loginAs(username, password) {
    auth.logout();
    return callOk('auth:login', { username, password });
  }

  async function setup() {
    await seedDefaultAdmin(repositories.users);
    if (withDemoData) {
      await seedDemoData({
        users: repositories.users,
        catalog: repositories.catalog,
        orders: repositories.orders,
        staff: repositories.staff,
        vehicles: repositories.vehicles,
        sequences: repositories.sequences,
      });
    }
  }

  function cleanup() {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    tempDir,
    dbFile,
    db,
    repositories,
    auth,
    registry,
    migrationsApplied,
    call,
    callOk,
    callFail,
    loginAs,
    setup,
    cleanup,
    renderInvoiceHtml,
  };
}

/** Tiny test runner: prints PASS/FAIL and sets a non-zero exit code on failure. */
export function createRunner(title) {
  let passed = 0;
  const failures = [];

  console.log(`\n${title}\n${'-'.repeat(title.length)}`);

  return {
    async check(name, fn) {
      try {
        await fn();
        passed += 1;
        console.log(`  PASS  ${name}`);
      } catch (error) {
        failures.push({ name, error });
        console.error(`  FAIL  ${name}\n        ${error.message.split('\n')[0]}`);
      }
    },
    finish() {
      console.log('-'.repeat(title.length));
      if (failures.length > 0) {
        console.error(`${passed} passed, ${failures.length} FAILED\n`);
        for (const failure of failures) console.error(`${failure.name}: ${failure.error.stack}\n`);
        process.exitCode = 1;
        return;
      }
      console.log(`${passed} checks passed\n`);
    },
  };
}
