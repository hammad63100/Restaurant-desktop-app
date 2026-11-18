/**
 * Phase 14 — hardening (Phase 3 close-out).
 *
 * Five things that were fine in a demo and wrong in a shop:
 *   1. the login lockout vanished when the app was restarted,
 *   2. every receipt opened the system print dialog,
 *   3. the renderer was not sandboxed,
 *   4. the shop logo was megabytes of base64 inside one settings value,
 *   5. the orders list paginated by growing OFFSET.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 14 — Hardening');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const build = path.resolve(import.meta.dirname, '..', 'dist-electron', 'electron');

/* --------------------------- 1. login lockout --------------------------- */

await runner.check('the lockout columns exist on users', async () => {
  const columns = harness.db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((column) => column.name);

  for (const column of ['failed_attempts', 'locked_until']) {
    if (!columns.includes(column)) throw new Error(`users.${column} is missing`);
  }
});

await runner.check('five wrong passwords lock the account on disk', async () => {
  await harness.callOk('auth:logout', {});

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await harness.call('auth:login', {
      username: 'cashier',
      password: 'wrong-password',
    });
    if (result.error.code !== 'INVALID_CREDENTIALS') {
      throw new Error(`attempt ${attempt + 1} returned ${result.error.code}`);
    }
  }

  const row = harness.db
    .prepare('SELECT failed_attempts, locked_until FROM users WHERE username = ?')
    .get('cashier');

  if (row.failed_attempts !== 5) throw new Error(`counter is ${row.failed_attempts}`);
  if (!row.locked_until) throw new Error('the account was not stamped as locked');

  // The right password must now be refused.
  const blocked = await harness.call('auth:login', {
    username: 'cashier',
    password: 'cashier123',
  });
  if (blocked.ok) throw new Error('a locked account accepted the right password');
  if (blocked.error.code !== 'TOO_MANY_ATTEMPTS') throw new Error(`got ${blocked.error.code}`);
});

await runner.check('the lock survives a restart of the app', async () => {
  // The whole point of migration 014. A new harness opens the same database file
  // again, exactly as relaunching the app would, and the lock must still be there.
  const fresh = createHarness({
    withDemoData: false,
    seed: false,
    databaseFile: harness.dbFile,
  });
  await fresh.setup();

  const result = await fresh.call('auth:login', { username: 'cashier', password: 'cashier123' });
  fresh.cleanup();

  if (result.ok) throw new Error('restarting the app cleared the lockout');
  if (result.error.code !== 'TOO_MANY_ATTEMPTS') throw new Error(`got ${result.error.code}`);
});

await runner.check('an expired lock lets the owner back in and resets the count', async () => {
  harness.db
    .prepare(
      "UPDATE users SET locked_until = datetime('now','localtime','-1 minute') WHERE username = 'cashier'",
    )
    .run();

  const login = await harness.callOk('auth:login', { username: 'cashier', password: 'cashier123' });

  if (login.username !== 'cashier') throw new Error('the wrong user came back');

  const row = harness.db
    .prepare('SELECT failed_attempts, locked_until FROM users WHERE username = ?')
    .get('cashier');

  if (row.failed_attempts !== 0) throw new Error('a good password did not clear the counter');
  if (row.locked_until !== null) throw new Error('the expired lock was left behind');
});

await runner.check('a wrong username is not counted against a real account', async () => {
  await harness.callOk('auth:logout', {});

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await harness.call('auth:login', { username: 'no-such-person', password: 'x' });
  }

  // The real admin account must be untouched by attempts on a name that isn't there.
  const row = harness.db
    .prepare('SELECT failed_attempts FROM users WHERE username = ?')
    .get('admin');
  if (row.failed_attempts !== 0) throw new Error('an unknown username locked a real account');

  await harness.callOk('auth:login', { username: 'admin', password: 'OwnerPass123' });
});

/* --------------------------- 2. silent printing --------------------------- */

await runner.check('silent printing is on by default', async () => {
  const settings = await harness.callOk('settings:get');
  if (settings.printerSilent !== true) throw new Error('silent printing should default to on');
});

await runner.check('the setting round-trips through the repository', async () => {
  const settings = await harness.callOk('settings:get');

  await harness.callOk('settings:save', { ...settings, printerSilent: false });
  const off = await harness.callOk('settings:get');
  if (off.printerSilent !== false) throw new Error('turning it off did not stick');

  await harness.callOk('settings:save', { ...off, printerSilent: true });
  const on = await harness.callOk('settings:get');
  if (on.printerSilent !== true) throw new Error('turning it back on did not stick');
});

await runner.check('every print path reads the setting instead of a literal', async () => {
  const source = readFileSync(path.join(build, 'services', 'printService.js'), 'utf8');

  // One shared option builder, and no hard-coded `silent: false` anywhere.
  if ((source.match(/silent: deps\.silentPrinting\(\)/g) ?? []).length !== 1) {
    throw new Error('the shared print options builder is missing or duplicated');
  }
  if (/silent:\s*false/.test(source)) {
    throw new Error('a print path still hard-codes silent: false');
  }
  if (/silent:\s*true/.test(source)) {
    throw new Error('a print path hard-codes silent: true, ignoring the setting');
  }
});

/* --------------------------- 3. renderer sandbox --------------------------- */

await runner.check('the window is sandboxed with context isolation on', async () => {
  const source = readFileSync(path.join(build, 'main.js'), 'utf8');
  const block = /webPreferences:\s*\{([\s\S]*?)\}/.exec(source);

  if (!block) throw new Error('could not find the webPreferences block');
  const text = block[1] ?? '';

  if (!/contextIsolation:\s*true/.test(text)) throw new Error('contextIsolation must stay on');
  if (!/nodeIntegration:\s*false/.test(text)) throw new Error('nodeIntegration must stay off');
  if (!/sandbox:\s*true/.test(text)) throw new Error('sandbox must be on');
});

await runner.check('the preload requires nothing but electron, so sandbox can work', async () => {
  // Under `sandbox: true` a preload gets a stub require(). Any relative require would
  // throw and `window.api` would never be created — a blank, unclickable app.
  const preload = readFileSync(path.join(build, 'preload.js'), 'utf8');
  const requires = [...preload.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map(
    (match) => match[1],
  );

  const relative = requires.filter((name) => name.startsWith('.'));
  if (relative.length > 0) {
    throw new Error(`the preload still requires ${relative.join(', ')}`);
  }

  if (!preload.includes('contextBridge.exposeInMainWorld')) {
    throw new Error('the preload does not expose the bridge');
  }
});

/* ----------------------------- 4. shop logo ----------------------------- */

await runner.check('the logo lives in a file, not in the settings row', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gk-logo-'));
  try {
    const { createLogoService } = await import(path.join(build, 'services', 'logoService.js'));
    const logo = createLogoService(() => directory);

    // A 1×1 PNG, small enough to pass the size check.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const source = path.join(directory, 'chosen.png');
    writeFileSync(source, png);

    const stored = logo.save(source);

    if (stored.startsWith('data:')) throw new Error('the stored value is still a data URL');
    if (!existsSync(path.join(directory, stored))) throw new Error('the file was not written');

    const resolved = logo.resolve(stored);
    if (!resolved?.startsWith('data:image/png;base64,')) {
      throw new Error('reading the logo back did not produce an image');
    }

    // A missing file must degrade to "no logo", never to a crash on print.
    if (logo.resolve('gone.png') !== null) throw new Error('a missing file should resolve to null');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await runner.check('an oversized logo is refused with a readable message', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gk-logo-'));
  try {
    const { createLogoService } = await import(path.join(build, 'services', 'logoService.js'));
    const logo = createLogoService(() => directory);

    const big = path.join(directory, 'huge.png');
    writeFileSync(big, Buffer.alloc(600 * 1024));

    let refused = false;
    try {
      logo.save(big);
    } catch (error) {
      refused = true;
      if (!String(error.message).includes('KB')) {
        throw new Error(`unhelpful message: ${error.message}`);
      }
    }

    if (!refused) throw new Error('a 600 KB logo must be refused');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await runner.check('saving the resolved logo keeps the settings row small', async () => {
  // The settings page reads a data URL and writes back what it was given. That must
  // not put the image back into the row, or the whole change is cosmetic.
  const directory = mkdtempSync(path.join(tmpdir(), 'gk-logo-'));
  try {
    const { createLogoService } = await import(path.join(build, 'services', 'logoService.js'));
    const { createSettingsRepository } = await import(
      path.join(build, 'db', 'repositories', 'settingsRepository.js')
    );

    const logo = createLogoService(() => directory);
    const repository = createSettingsRepository(
      harness.db,
      (stored) => logo.resolve(stored),
      (dataUrl) => logo.adoptLegacyDataUrl(dataUrl),
    );

    const source = path.join(directory, 'chosen.png');
    writeFileSync(
      source,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );

    const fileName = logo.save(source);
    repository.writeShopSettings({
      ...repository.readShopSettings(),
      shopLogo: logo.resolve(fileName),
    });

    const row = harness.db.prepare("SELECT value FROM settings WHERE key = 'shop_logo'").get();

    if (row.value.startsWith('data:')) throw new Error('the image went back into the row');
    if (row.value.length > 100) throw new Error(`the row is ${row.value.length} characters`);

    const readBack = repository.readShopSettings().shopLogo;
    if (!readBack?.startsWith('data:image/png;base64,')) {
      throw new Error('the logo did not come back as an image');
    }

    // Leave the shop as it was for the checks that follow.
    repository.writeShopSettings({ ...repository.readShopSettings(), shopLogo: null });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await runner.check('an old inline logo is migrated to a file on save', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gk-logo-'));
  try {
    const { createLogoService } = await import(path.join(build, 'services', 'logoService.js'));
    const logo = createLogoService(() => directory);

    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const stored = logo.adoptLegacyDataUrl(dataUrl);
    if (stored.startsWith('data:')) throw new Error('the legacy logo was not adopted');
    if (!existsSync(path.join(directory, stored))) throw new Error('the file was not written');

    // An unreadable payload is left alone rather than corrupting the image.
    if (!logo.adoptLegacyDataUrl('not-a-data-url').includes('not-a-data-url')) {
      throw new Error('a non-image value should be passed through');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/* --------------------------- 5. keyset paging --------------------------- */

await runner.check('paging with a cursor returns every order exactly once', async () => {
  const menu = await harness.callOk('menu:items');
  const itemId = menu[0].id;

  // Enough rows to page through, all sharing one timestamp so the (created_at, id)
  // tie-break is what has to work.
  for (let index = 0; index < 12; index += 1) {
    await harness.callOk('orders:create', {
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
      items: [{ itemId, qty: 1, notes: '' }],
    });
  }

  harness.db.prepare("UPDATE orders SET created_at = '2026-11-10 12:00:00'").run();

  const all = await harness.callOk('orders:list', {
    search: '',
    status: 'all',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 500,
    after: null,
  });

  const seen = [];
  let cursor = null;

  for (let page = 0; page < 40; page += 1) {
    const rows = await harness.callOk('orders:list', {
      search: '',
      status: 'all',
      type: 'all',
      fromDate: '',
      toDate: '',
      limit: 5,
      after: cursor,
    });

    if (rows.length === 0) break;
    seen.push(...rows.map((row) => row.id));

    const last = rows[rows.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  if (seen.length !== new Set(seen).size) throw new Error('a cursor repeated a row');
  if (seen.length !== all.length) {
    throw new Error(`paged ${seen.length} of ${all.length} orders`);
  }
});

await runner.check('a cursor skips a page without repeating it', async () => {
  const first = await harness.callOk('orders:list', {
    search: '',
    status: 'all',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 3,
    after: null,
  });

  const last = first[first.length - 1];
  const second = await harness.callOk('orders:list', {
    search: '',
    status: 'all',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 3,
    after: { createdAt: last.createdAt, id: last.id },
  });

  const overlap = second.filter((row) => first.some((kept) => kept.id === row.id));
  if (overlap.length > 0) throw new Error(`page two repeated ${overlap.length} row(s)`);

  // Newest first: the cursor page must be strictly older or lower id.
  for (const row of second) {
    const isOlder =
      row.createdAt < last.createdAt || (row.createdAt === last.createdAt && row.id < last.id);
    if (!isOlder) throw new Error('the cursor let a newer row through');
  }
});

await runner.check('a nonsensical cursor is rejected by the schema', async () => {
  const result = await harness.call('orders:list', {
    search: '',
    status: 'all',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 10,
    after: { createdAt: '', id: 0 },
  });

  if (result.ok) throw new Error('an empty cursor must be rejected');
  if (result.error.code !== 'VALIDATION_ERROR') throw new Error(`got ${result.error.code}`);
});

harness.cleanup();
runner.finish();
