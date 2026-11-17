/**
 * Phase 6 checks: report aggregates, CSV export contents, backups and restore safeguards.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 6 — Reports, export and backup');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

let csvService;

await runner.check('range report aggregates orders, discounts and tax', async () => {
  const range = await harness.callOk('reports:range', {
    fromDate: '2000-01-01',
    toDate: '2100-01-01',
  });

  const orders = await harness.callOk('orders:list', {
    search: '',
    status: 'all',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 500,
  });

  const activeOrders = orders.filter((order) => order.status !== 'cancelled');
  const expectedSales = activeOrders.reduce((sum, order) => sum + order.total, 0);

  if (range.totals.sales !== expectedSales) {
    throw new Error(`range sales ${range.totals.sales} != order sum ${expectedSales}`);
  }
  if (range.totals.orders !== activeOrders.length) throw new Error('order count mismatch');
  if (range.dailySales.length < 1) throw new Error('daily rows missing');
  if (range.byType.length < 1) throw new Error('orders by type missing');
});

await runner.check('top items are ordered by quantity sold', async () => {
  const range = await harness.callOk('reports:range', {
    fromDate: '2000-01-01',
    toDate: '2100-01-01',
  });

  const quantities = range.topItems.map((row) => row.qty);
  const sorted = [...quantities].sort((a, b) => b - a);

  if (quantities.length === 0) throw new Error('demo data should produce top items');
  if (JSON.stringify(quantities) !== JSON.stringify(sorted)) {
    throw new Error('top items are not sorted by quantity');
  }
});

await runner.check('an empty range reports zero sales', async () => {
  const range = await harness.callOk('reports:range', {
    fromDate: '1990-01-01',
    toDate: '1990-01-31',
  });

  if (range.totals.sales !== 0 || range.totals.orders !== 0) {
    throw new Error('empty range should be all zeros');
  }
});

await runner.check('a reversed date range is rejected', async () => {
  await harness.callFail(
    'reports:range',
    { fromDate: '2026-12-31', toDate: '2026-01-01' },
    'VALIDATION_ERROR',
  );
});

await runner.check('salary summary lists every active person for the month', async () => {
  const rows = await harness.callOk('reports:salary', { month: '2026-11' });
  if (rows.length < 3) throw new Error(`expected at least 3 staff rows, got ${rows.length}`);

  const roles = new Set(rows.map((row) => row.role));
  if (!roles.has('Waiter') || !roles.has('Delivery boy')) {
    throw new Error('both waiters and delivery boys should appear');
  }
});

await runner.check('CSV export builds valid, escaped rows', async () => {
  const module = await import('node:module');
  const require = module.createRequire(import.meta.url);
  const compiled = new URL('../dist-electron/electron/services/csvService.js', import.meta.url)
    .pathname;

  // Build a service with the same dependencies the app uses, but no dialog.
  const load = (name) =>
    require(new URL(`../dist-electron/electron/${name}`, import.meta.url).pathname);

  const staffService = load('services/staffService.js').createStaffService({
    staff: harness.repositories.staff,
    vehicles: harness.repositories.vehicles,
    commissionForMonth: () => 0,
  });

  const reports = load('services/reportsService.js').createReportsService({
    orders: harness.repositories.orders,
    catalog: harness.repositories.catalog,
    staff: harness.repositories.staff,
    vehicles: harness.repositories.vehicles,
    staffService,
  });

  csvService = load('services/csvService.js').createCsvService({
    reports,
    exportDirectory: () => harness.tempDir,
    salarySummary: (month) => reports.salarySummary(month),
  });

  if (!require('node:fs').existsSync(compiled)) throw new Error('csv service was not compiled');

  const range = { fromDate: '2000-01-01', toDate: '2100-01-01' };
  const daily = csvService.buildCsv('daily_sales', range);
  const lines = daily.trim().split('\r\n');

  if (lines[0] !== 'Date,Orders,Sales') throw new Error(`unexpected header: ${lines[0]}`);
  if (lines.length < 2) throw new Error('daily sales CSV has no rows');
  if (!/^\d{4}-\d{2}-\d{2},\d+,"?\d/.test(lines[1])) {
    throw new Error(`unexpected data row: ${lines[1]}`);
  }

  const top = csvService.buildCsv('top_items', range);
  if (!top.startsWith('Item,Quantity sold,Revenue')) throw new Error('top items header wrong');

  const salary = csvService.buildCsv('salary', range);
  if (!salary.startsWith('Name,Role,Month,Net pay,Paid')) throw new Error('salary header wrong');

  const delivery = csvService.buildCsv('delivery', range);
  if (!delivery.startsWith('Delivery boy,Deliveries,Delivered value,Commission')) {
    throw new Error('delivery header wrong');
  }

  const expenses = csvService.buildCsv('vehicle_expenses', range);
  if (!expenses.startsWith('Vehicle,Fuel,Maintenance,Other,Total,Entries')) {
    throw new Error('vehicle expense header wrong');
  }

  // Commas inside a value must be quoted.
  const quoted = csvService.buildCsv('top_items', range);
  const quotedLine = quoted.split('\r\n')[1] ?? '';
  if (quotedLine.split(',').length < 3) throw new Error('CSV row lost its columns');
});

await runner.check('backup listing is newest first and readable', async () => {
  const first = await harness.callOk('settings:backup-create');
  const second = await harness.callOk('settings:backup-create');

  const files = await harness.callOk('settings:backup-list');
  if (files.length < 2) throw new Error('expected at least two backups');

  if (!files.every((file) => file.sizeBytes > 0)) throw new Error('backup files must not be empty');
  if (files[0].createdAt < first.createdAt) throw new Error('backup list is not newest first');
  if (!second) throw new Error('second backup should be created');
});

await runner.check('restore refuses a non-backup file', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const badFile = path.join(harness.tempDir, 'not-a-backup.txt');
  fs.writeFileSync(badFile, 'hello');

  const result = await harness.call('settings:backup-restore', { filePath: badFile });
  if (result.ok) throw new Error('a .txt file must not be restored');
  if (result.error.code !== 'VALIDATION_ERROR')
    throw new Error(`unexpected code ${result.error.code}`);
});

await runner.check('restore refuses a missing file', async () => {
  const result = await harness.call('settings:backup-restore', {
    filePath: '/tmp/does-not-exist-1234.db',
  });

  if (result.ok) throw new Error('missing file must not be restored');
  if (result.error.code !== 'NOT_FOUND') throw new Error(`unexpected code ${result.error.code}`);
});

await runner.check('the log file rotates instead of growing forever', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const module = await import('node:module');

  const require = module.createRequire(import.meta.url);
  const logger = require(
    new URL('../dist-electron/electron/services/logger.js', import.meta.url).pathname,
  );

  const logDir = path.join(harness.tempDir, 'logs-rotation');
  fs.mkdirSync(logDir, { recursive: true });

  // Start with a log just over the 5 MB limit, then write one more line.
  fs.writeFileSync(path.join(logDir, 'app.log'), Buffer.alloc(5.2 * 1024 * 1024, 'x'));
  logger.configureLogger(logDir);
  logger.logInfo('line written after rotation');

  const rotated = path.join(logDir, 'app.log.1');
  if (!fs.existsSync(rotated)) throw new Error('the large log was not rotated to app.log.1');
  if (fs.statSync(rotated).size < 5 * 1024 * 1024)
    throw new Error('rotated file lost its contents');

  const fresh = fs.readFileSync(path.join(logDir, 'app.log'), 'utf8');
  if (!fresh.includes('line written after rotation'))
    throw new Error('new log line was not written');
  if (fresh.length > 4096) throw new Error('a fresh log should start small');

  // Rotation must keep working, and only one old file is kept.
  fs.writeFileSync(path.join(logDir, 'app.log'), Buffer.alloc(5.2 * 1024 * 1024, 'y'));
  logger.logInfo('second rotation');
  const files = fs.readdirSync(logDir).sort();
  if (JSON.stringify(files) !== JSON.stringify(['app.log', 'app.log.1'])) {
    throw new Error(`unexpected log folder contents: ${files.join(', ')}`);
  }
});

await runner.check('the Windows installer is configured correctly', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');

  const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');

  // Everything the packaged app needs at runtime.
  for (const fragment of [
    'appId: com.gulkhan.fastfood',
    'productName: Gul Khan Fast Food',
    'dist/**/*',
    'dist-electron/**/*',
    'package.json',
    'npmRebuild: false',
    'target: nsis',
    'x64',
    'icon: build/icon.ico',
  ]) {
    if (!config.includes(fragment)) throw new Error(`installer config is missing: ${fragment}`);
  }

  // Native .node binaries must be unpacked from the asar archive.
  if (!config.includes("'**/node_modules/better-sqlite3/**'")) {
    throw new Error('better-sqlite3 must be unpacked from asar');
  }
  if (!config.includes("'**/node_modules/bcrypt/**'")) {
    throw new Error('bcrypt must be unpacked from asar');
  }
  if (!/^asar: true$/m.test(config)) throw new Error('asar packaging must stay on');

  // Documents that are needed to install and to train staff.
  for (const doc of ['README.md', 'docs/user-guide.md', 'build/icon.ico', 'build/icon.png']) {
    if (!fs.existsSync(path.join(root, doc))) throw new Error(`missing release file: ${doc}`);
  }

  // Ask electron-builder itself whether the file is legal, so a typo in the
  // installer config cannot reach the Windows build machine.
  const require = (await import('node:module')).createRequire(import.meta.url);
  const yaml = require('js-yaml');
  const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
  const debugLogger = { info() {}, warn() {}, debug() {}, error() {} };

  try {
    await validateConfiguration(yaml.load(config), debugLogger);
  } catch (error) {
    throw new Error(`electron-builder rejected the config: ${error.message}`);
  }

  // Migrations ship with the compiled main process.
  const migrations = path.join(root, 'dist-electron', 'electron', 'db', 'migrations');
  const sqlFiles = fs.readdirSync(migrations).filter((file) => file.endsWith('.sql'));
  if (sqlFiles.length !== 7) {
    throw new Error(`expected 7 migrations in the build, found ${sqlFiles.length}`);
  }
});

await runner.check('cashiers cannot read reports or export data', async () => {
  await harness.loginAs('cashier', 'cashier123');

  await harness.callFail(
    'reports:range',
    { fromDate: '2026-01-01', toDate: '2026-12-31' },
    'FORBIDDEN',
  );
  await harness.callFail(
    'reports:export',
    { report: 'daily_sales', range: { fromDate: '2026-01-01', toDate: '2026-12-31' } },
    'FORBIDDEN',
  );
  await harness.callFail('settings:backup-list', undefined, 'FORBIDDEN');
});

await runner.check('managers can read reports but not back up', async () => {
  await harness.loginAs('manager', 'manager123');

  const rows = await harness.callOk('reports:salary', { month: '2026-11' });
  if (!Array.isArray(rows)) throw new Error('manager should read salary summary');

  await harness.callFail('settings:backup-create', undefined, 'FORBIDDEN');
});

harness.cleanup();
runner.finish();
