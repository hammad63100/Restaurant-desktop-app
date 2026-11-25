/**
 * Test harness: boots the real database, migrations, services and IPC registry
 * without a display. Used by the phase test scripts so every phase is verified
 * against the same code the packaged app runs.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const compiled = path.join(root, 'dist-electron', 'electron');
const load = (relative) => require(path.join(compiled, relative));

/** Mirrors electron/main.ts: the month end comes from the shared date helper. */
const { monthEnd } = load('utils/datetime.js');

/** Highest shipped migration number, read from the compiled migrations folder. */
function highestMigrationVersion() {
  const directory = path.join(compiled, 'db', 'migrations');
  return readdirSync(directory)
    .filter((file) => /^\d{3,}_.+\.sql$/.test(file))
    .map((file) => Number(file.slice(0, file.indexOf('_'))))
    .reduce((highest, version) => Math.max(highest, version), 0);
}

/**
 * @param {object} [options]
 * @param {boolean} [options.withDemoData] Seed the demo menu/users/orders.
 * @param {string} [options.databaseFile] Reopen an existing database instead of a fresh
 *   one. Used to prove that state survives a restart — the same thing relaunching the
 *   app does, since the harness holds the only handle on the file.
 * @param {boolean} [options.seed] Seed the default admin. False when reopening an
 *   existing database, which already has one.
 */
export function createHarness({ withDemoData = true, databaseFile = null, seed = true } = {}) {
  const ownedTempDir = databaseFile ? null : mkdtempSync(path.join(os.tmpdir(), 'gulkhan-test-'));
  const tempDir = databaseFile ? path.dirname(databaseFile) : ownedTempDir;
  const dbFile = databaseFile ?? path.join(tempDir, 'test.db');

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
    payments: load('db/repositories/paymentsRepository.js').createPaymentsRepository(db),
    shifts: load('db/repositories/shiftsRepository.js').createShiftsRepository(db),
    discounts: load('db/repositories/discountsRepository.js').createDiscountsRepository(db),
    kot: load('db/repositories/kotRepository.js').createKotRepository(db),
    tables: load('db/repositories/tablesRepository.js').createTablesRepository(db),
    inventory: load('db/repositories/inventoryRepository.js').createInventoryRepository(db),
    recipes: load('db/repositories/recipeRepository.js').createRecipeRepository(db),
    expenses: load('db/repositories/expensesRepository.js').createExpensesRepository(db),
    recurringBills: load('db/repositories/recurringBillsRepository.js').createRecurringBillsRepository(db),
    subRecipes: load('db/repositories/subRecipeRepository.js').createSubRecipeRepository(db),
    stockOps: load('db/repositories/stockOpsRepository.js').createStockOpsRepository(db),
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

  const stockDeduction = load('services/stockDeductionService.js').createStockDeductionService({
    inventory: repositories.inventory,
    orders: repositories.orders,
    recipes: repositories.recipes,
    catalog: repositories.catalog,
  });

  const auth = createAuthService(repositories.users);

  const discountsService = load('services/discountsService.js').createDiscountsService({
    discounts: repositories.discounts,
    users: repositories.users,
  });

  const staffService = createStaffService({
    staff: repositories.staff,
    vehicles: repositories.vehicles,
    commissionForMonth: (deliveryBoyId, month) =>
      repositories.orders
        .deliveriesByBoy(`${month}-01`, `${monthEnd(month)}`)
        .find((row) => row.deliveryBoyId === deliveryBoyId)?.commission ?? 0,
  });

  const subRecipeService = load('services/subRecipeService.js').createSubRecipeService({
    subRecipes: repositories.subRecipes,
    inventory: repositories.inventory,
  });

  const reportsService = createReportsService({
    expenses: repositories.expenses,
    orders: repositories.orders,
    catalog: repositories.catalog,
    staff: repositories.staff,
    vehicles: repositories.vehicles,
    staffService,
    inventory: repositories.inventory,
    stockOps: repositories.stockOps,
    missingRecipes: () => repositories.catalog.countPricedItemsWithoutRecipe(),
    recurring: repositories.recurringBills,
  });


  const csvService = createCsvService({
    reports: reportsService,
    exportDirectory: () => tempDir,
    salarySummary: (month) => reportsService.salarySummary(month),
  });

  // Records instead of relaunching: the harness has no Electron app to restart.
  const restoreCalls = [];

  const backups = createBackupService(
    dbFile,
    path.join(tempDir, 'backups'),
    {
      checkpoint: () => getDatabase().pragma('wal_checkpoint(TRUNCATE)'),
      replaceWith: (sourcePath) => {
        restoreCalls.push(sourcePath);
      },
    },
    // The harness applies every shipped migration, so it supports the highest one.
    { supportedSchemaVersion: highestMigrationVersion() },
  );

  const { renderInvoiceHtml } = load('services/printService.js');

  // Printing needs a real window, so the harness stubs it the way Electron would call it.
  // Mirrors createPrintService: the service marks the invoice itself after a
  // successful print, which is why the IPC print handlers must NOT mark it again.
  const printStub = {
    printInvoice: async (orderId) => {
      repositories.orders.markInvoicePrinted(orderId);
      return true;
    },
    savePdf: async () => null,
    printShiftReport: async () => true,
    printKot: async () => true,
    silentPrinting: () => false,
    renderHtml: renderInvoiceHtml,
    renderKotHtml: load('services/printService.js').renderKotHtml,
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
      discounts: discountsService,
      kot: repositories.kot,
      tables: repositories.tables,
      payments: repositories.payments,
      stock: stockDeduction,
    }),
    staff: staffService,
    vehicles: createVehiclesService({ vehicles: repositories.vehicles, staff: repositories.staff }),
    reports: reportsService,
    settings: createSettingsService(repositories.settings),
    users: createUserService(repositories.users),
    backups,
    print: printStub,
    csv: csvService,
    payments: load('services/paymentsService.js').createPaymentsService({
      payments: repositories.payments,
      orders: repositories.orders,
    }),
    shifts: load('services/shiftsService.js').createShiftsService({
      shifts: repositories.shifts,
      orders: repositories.orders,
    }),
    discounts: discountsService,
    kot: load('services/kotService.js').createKotService({
      kot: repositories.kot,
      print: printStub,
      settings: repositories.settings,
    }),
    tables: load('services/tablesService.js').createTablesService({
      tables: repositories.tables,
      orders: repositories.orders,
      payments: repositories.payments,
      sequences: repositories.sequences,
      settings: repositories.settings,
    }),
    inventory: load('services/inventoryService.js').createInventoryService({
      inventory: repositories.inventory,
      shifts: repositories.shifts,
      stockOps: repositories.stockOps,
    }),
    recipes: load('services/recipeService.js').createRecipeService({
      recipes: repositories.recipes,
      catalog: repositories.catalog,
      inventory: repositories.inventory,
      settings: repositories.settings,
    }),
    expenses: load('services/expensesService.js').createExpensesService({
      expenses: repositories.expenses,
      shifts: repositories.shifts,
      recurring: repositories.recurringBills,
    }),
    subRecipes: subRecipeService,
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
    if (seed) await seedDefaultAdmin(repositories.users);
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
    // A harness that opened someone else's file must not delete it.
    if (ownedTempDir) rmSync(ownedTempDir, { recursive: true, force: true });
  }

  return {
    tempDir,
    dbFile,
    db,
    repositories,
    auth,
    registry,
    /** The CSV service, so a report test can prove the file, not just the screen. */
    csv: csvService,
    migrationsApplied,
    call,
    callOk,
    callFail,
    loginAs,
    setup,
    cleanup,
    renderInvoiceHtml,
    /** Backup files created by a restore attempt (the harness cannot relaunch). */
    restoreCalls,
    backups,
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
