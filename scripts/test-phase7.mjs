/**
 * Phase 7 — release blockers.
 *
 * 1.A  Restore replaces the file safely and asks for a relaunch instead of
 *      leaving the app holding a closed database handle.
 * 1.B  Restore refuses junk, damaged and future-schema files BEFORE touching the
 *      live database.
 * 1.C  A cashier cannot cancel an order through the status channel.
 * 1.D  A failed insert does not burn an order or invoice number.
 * 1.E  Discount over the subtotal is a hard error, not a silent clamp.
 */
import { createHarness, createRunner } from './test-harness.mjs';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 7 — Release blockers');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const workDir = mkdtempSync(path.join(tmpdir(), 'phase7-'));

/** Small helper: the number_sequences value for a name, or 1 (the default). */
function sequenceValue(name) {
  const row = harness.db
    .prepare('SELECT next_value FROM number_sequences WHERE name = ?')
    .get(name);
  return row?.next_value ?? 1;
}

/** Builds a valid, empty restaurant database at the given path. */
function makeDatabase(filePath, { migrations = 7 } = {}) {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, total INTEGER);
  `);
  for (let version = 1; version <= migrations; version += 1) {
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      version,
      `${String(version).padStart(3, '0')}_test.sql`,
      new Date().toISOString(),
    );
  }
  db.close();
}

/* ---------------------------------- 1.B ---------------------------------- */

await runner.check('1.B a real backup file is accepted', async () => {
  const backup = await harness.callOk('settings:backup-create');
  const valid = path.join(workDir, 'valid.db');
  writeFileSync(valid, readFileSync(backup.path));

  // Must not throw.
  harness.backups.validateBackupFile(valid);
});

await runner.check('1.B a text file renamed to .db is refused', async () => {
  const fake = path.join(workDir, 'notes.db');
  writeFileSync(fake, 'this is not a database');

  const result = await harness.call('settings:backup-restore', { filePath: fake });
  if (result.ok) throw new Error('a text file must not be restored');
  if (result.error.code !== 'VALIDATION_ERROR')
    throw new Error(`unexpected code ${result.error.code}`);
  if (harness.restoreCalls.length !== 0) throw new Error('the live database must not be touched');
});

await runner.check('1.B a truncated database is refused', async () => {
  const backup = await harness.callOk('settings:backup-create');
  const truncated = path.join(workDir, 'truncated.db');

  // Keep the first 200 bytes only: a real page size but no usable schema.
  writeFileSync(truncated, readFileSync(backup.path).subarray(0, 200));

  const result = await harness.call('settings:backup-restore', { filePath: truncated });
  if (result.ok) throw new Error('a truncated file must not be restored');
  if (result.error.code !== 'VALIDATION_ERROR')
    throw new Error(`unexpected code ${result.error.code}`);
  if (harness.restoreCalls.length !== 0) throw new Error('the live database must not be touched');
});

await runner.check('1.B a database with no restaurant tables is refused', async () => {
  const foreign = path.join(workDir, 'foreign.db');
  const db = new Database(foreign);
  db.exec(
    'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)',
  );
  db.exec(`INSERT INTO schema_migrations VALUES (1, 'x', '2026-01-01')`);
  db.close();

  const result = await harness.call('settings:backup-restore', { filePath: foreign });
  if (result.ok) throw new Error('a foreign database must not be restored');
  if (!/not a Gul Khan/i.test(result.error.message)) {
    throw new Error(`expected a helpful message, got: ${result.error.message}`);
  }
});

await runner.check('1.B a backup from a newer schema version is refused', async () => {
  const future = path.join(workDir, 'future.db');
  makeDatabase(future, { migrations: 99 });

  const result = await harness.call('settings:backup-restore', { filePath: future });
  if (result.ok) throw new Error('a future-schema backup must not be restored');
  if (!/newer version/i.test(result.error.message)) {
    throw new Error(`expected a newer-version message, got: ${result.error.message}`);
  }
  if (harness.restoreCalls.length !== 0) throw new Error('the live database must not be touched');
});

await runner.check('1.B a missing file and a non-.db file are refused', async () => {
  const missing = await harness.call('settings:backup-restore', {
    filePath: path.join(workDir, 'nope.db'),
  });
  if (missing.ok || missing.error.code !== 'NOT_FOUND') {
    throw new Error(`missing file should be NOT_FOUND, got ${JSON.stringify(missing)}`);
  }

  const txt = path.join(workDir, 'file.txt');
  writeFileSync(txt, 'hello');
  const wrongExtension = await harness.call('settings:backup-restore', { filePath: txt });
  if (wrongExtension.ok || wrongExtension.error.code !== 'VALIDATION_ERROR') {
    throw new Error('a non-.db file should be VALIDATION_ERROR');
  }
});

/* ---------------------------------- 1.A ---------------------------------- */

await runner.check('1.A a valid restore copies the file and asks for a relaunch', async () => {
  const backup = await harness.callOk('settings:backup-create');
  const before = harness.restoreCalls.length;

  await harness.callOk('settings:backup-restore', { filePath: backup.path });

  if (harness.restoreCalls.length !== before + 1) {
    throw new Error('replaceWith should have been called exactly once');
  }
  if (harness.restoreCalls.at(-1) !== backup.path) {
    throw new Error('replaceWith was given the wrong file');
  }
});

await runner.check('1.A the main-process restore relaunches instead of hot-swapping', async () => {
  // The relaunch itself needs Electron; assert the source does the right sequence.
  const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');

  for (const fragment of [
    'app.relaunch()',
    'app.exit(0)',
    "for (const suffix of ['-wal', '-shm'])",
  ]) {
    if (!mainSource.includes(fragment)) {
      throw new Error(`main.ts restore path is missing: ${fragment}`);
    }
  }

  // Repositories must not be rebuilt on the old handle after a restore.
  if (
    /replaceWith[\s\S]{0,600}openDatabase\(databaseFile\(\)\);\s*\/\/\s*rebuild/.test(mainSource)
  ) {
    throw new Error('restore should relaunch, not rebuild repositories');
  }
});

/* ---------------------------------- 1.C ---------------------------------- */

await runner.check('1.C a cashier cannot cancel through the status channel', async () => {
  const order = await harness.callOk('orders:create', {
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
    items: [{ itemId: 1, qty: 1, notes: '' }],
  });

  await harness.loginAs('cashier', 'cashier123');

  const result = await harness.call('orders:status', { id: order.id, status: 'cancelled' });
  if (result.ok) throw new Error('a cashier must not cancel an order');
  if (result.error.code !== 'FORBIDDEN') {
    throw new Error(`expected FORBIDDEN, got ${result.error.code}`);
  }

  // The order is untouched.
  const after = await harness.callOk('orders:get', { id: order.id });
  if (after.status !== 'pending') throw new Error('the order status changed anyway');

  // A cashier may still move it forward.
  const advanced = await harness.callOk('orders:status', { id: order.id, status: 'preparing' });
  if (advanced.status !== 'preparing') throw new Error('a cashier should still advance orders');
});

await runner.check('1.C a manager can cancel through the status channel', async () => {
  const order = await harness.callOk('orders:create', {
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
    items: [{ itemId: 1, qty: 1, notes: '' }],
  });

  await harness.loginAs('manager', 'manager123');

  const cancelled = await harness.callOk('orders:status', { id: order.id, status: 'cancelled' });
  if (cancelled.status !== 'cancelled') throw new Error('a manager should be able to cancel');
});

/* ---------------------------------- 1.D ---------------------------------- */

await runner.check('1.D a failed insert does not burn an order or invoice number', async () => {
  await harness.loginAs('admin', 'OwnerPass123');

  const orderBefore = sequenceValue('order');
  const invoiceBefore = sequenceValue('invoice');

  // Force the insert to fail: a duplicate order_no hits the UNIQUE index.
  const taken = await harness.callOk('orders:list', {
    search: '',
    status: 'all',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 1,
  });

  let failed = false;
  try {
    harness.repositories.orders.transaction(() => {
      harness.repositories.sequences.next('order');
      harness.repositories.sequences.next('invoice');
      harness.repositories.orders.create({
        orderNo: taken[0].orderNo, // duplicate
        invoiceNo: 'INV-DUPLICATE-TEST',
        type: 'takeaway',
        status: 'pending',
        customerName: '',
        customerPhone: '',
        customerAddress: '',
        waiterId: null,
        deliveryBoyId: null,
        subtotal: 100,
        discount: 0,
        taxPercent: 0,
        tax: 0,
        total: 100,
        notes: '',
        createdBy: 1,
        items: [{ itemId: 1, name: 'x', price: 100, qty: 1, lineTotal: 100, notes: '' }],
      });
    });
  } catch {
    failed = true;
  }

  if (!failed) throw new Error('the forced insert should have thrown');

  if (sequenceValue('order') !== orderBefore) {
    throw new Error(`order sequence moved from ${orderBefore} to ${sequenceValue('order')}`);
  }
  if (sequenceValue('invoice') !== invoiceBefore) {
    throw new Error(`invoice sequence moved from ${invoiceBefore} to ${sequenceValue('invoice')}`);
  }
});

await runner.check('1.D a successful save still increments both numbers by one', async () => {
  const orderBefore = sequenceValue('order');
  const invoiceBefore = sequenceValue('invoice');

  const order = await harness.callOk('orders:create', {
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
    items: [{ itemId: 1, qty: 1, notes: '' }],
  });

  if (sequenceValue('order') !== orderBefore + 1)
    throw new Error('order sequence did not advance once');
  if (sequenceValue('invoice') !== invoiceBefore + 1) {
    throw new Error('invoice sequence did not advance once');
  }
  if (!order.orderNo.startsWith('ORD-')) throw new Error('order number format changed');
});

/* ---------------------------------- 1.E ---------------------------------- */

await runner.check('1.E a discount above the subtotal is rejected, not clamped', async () => {
  const subtotal = 200_000;

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
    items: [{ itemId: 1, qty: 1, notes: '' }],
  });

  if (result.ok) throw new Error('an over-subtotal discount must fail');
  if (result.error.code !== 'VALIDATION_ERROR') {
    throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
  }
});

await runner.check('1.E a discount equal to the subtotal is allowed', async () => {
  const items = await harness.callOk('menu:items');
  const first = items[0];

  const order = await harness.callOk('orders:create', {
    type: 'takeaway',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: first.price,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: first.id, qty: 1, notes: '' }],
  });

  if (order.total !== 0)
    throw new Error(`a fully discounted order should total 0, got ${order.total}`);
});

await runner.check('1.E printing marks the invoice once, not twice', async () => {
  const order = await harness.callOk('orders:create', {
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
    items: [{ itemId: 1, qty: 1, notes: '' }],
  });

  // The harness print stub reports success but does not mark; the handler must not
  // add a second write of its own (printService owns markPrinted).
  const printed = await harness.callOk('orders:print', { id: order.id, paper: '80mm' });
  if (printed.printed !== true) throw new Error('the stub should report a successful print');

  const ipcSource = readFileSync(new URL('../electron/ipc/orders.ipc.ts', import.meta.url), 'utf8');
  const printHandler = ipcSource.slice(ipcSource.indexOf('CHANNELS.orderPrint]'));
  const body = printHandler.slice(0, printHandler.indexOf('},'));

  if (/markPrinted/.test(body)) {
    throw new Error('the print handler must not call markPrinted; the service already does');
  }
});

await runner.check('1.E no source file assumes a month ends on the 31st', async () => {
  const root = new URL('..', import.meta.url);
  const { readdirSync, statSync } = await import('node:fs');

  // Scan the real app code, so a new copy-paste cannot slip in unnoticed.
  const offenders = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', 'dist', 'dist-electron', 'release', '.git'].includes(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|mjs)$/.test(entry)) {
        const text = readFileSync(full, 'utf8');
        // A literal '...-31' end date, excluding this test's own pattern text.
        if (/`\$\{(month|salaryMonth)[^}]*\}-31`/.test(text)) {
          offenders.push(path.relative(path.resolve(root.pathname), full));
        }
      }
    }
  };

  walk(path.resolve(root.pathname, 'electron'));
  walk(path.resolve(root.pathname, 'src'));
  walk(path.resolve(root.pathname, 'scripts'));

  if (offenders.length > 0) {
    throw new Error(`hardcoded month-end in: ${offenders.join(', ')}`);
  }
});

await runner.check('1.F the CI workflow runs the four gates', async () => {
  const workflowPath = new URL('../.github/workflows/ci.yml', import.meta.url);
  if (!existsSync(workflowPath)) throw new Error('.github/workflows/ci.yml is missing');

  const workflow = readFileSync(workflowPath, 'utf8');
  for (const step of [
    'npm ci',
    'npm run typecheck',
    'npm run lint',
    'npm run build:electron',
    'npm run test:all',
  ]) {
    if (!workflow.includes(step)) throw new Error(`CI is missing the step: ${step}`);
  }
  if (!/node-version:\s*22/.test(workflow)) throw new Error('CI must pin Node 22');

  // The Phase 7 suite must actually run in the aggregate runner.
  const allTests = readFileSync(new URL('./test-all.mjs', import.meta.url), 'utf8');
  if (!allTests.includes('test-phase7.mjs')) {
    throw new Error('scripts/test-all.mjs does not run the Phase 7 suite');
  }
});

rmSync(workDir, { recursive: true, force: true });
harness.cleanup();
runner.finish();
