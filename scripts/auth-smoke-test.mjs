/**
 * Phase 1 smoke test: runs the real database, migration, seed and auth code
 * outside Electron (no display needed). Run with `npm run test:auth`.
 *
 * It uses a throw-away database in the OS temp folder, never the shop data.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const compiled = path.join(root, 'dist-electron', 'electron');

const { openDatabase, closeDatabase } = require(path.join(compiled, 'db', 'connection.js'));
const { runMigrations } = require(path.join(compiled, 'db', 'migrate.js'));
const { createUserRepository } = require(
  path.join(compiled, 'db', 'repositories', 'userRepository.js'),
);
const { createSettingsRepository } = require(
  path.join(compiled, 'db', 'repositories', 'settingsRepository.js'),
);
const { seedDefaultAdmin } = require(path.join(compiled, 'db', 'seed.js'));
const { createAuthService } = require(path.join(compiled, 'services', 'authService.js'));
const { configureLogger } = require(path.join(compiled, 'services', 'logger.js'));
const { hashPassword } = require(path.join(compiled, 'utils', 'password.js'));
const { getRolePermissions, roleHasPage } = require(
  path.join(compiled, 'services', 'permissions.js'),
);

const migrationsDir = path.join(compiled, 'db', 'migrations');
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gulkhan-test-'));
const dbFile = path.join(tempDir, 'test.db');

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS  ${name}`);
    })
    .catch((error) => {
      console.error(`  FAIL  ${name}\n        ${error.message}`);
      process.exitCode = 1;
    });
}

async function main() {
  configureLogger(path.join(tempDir, 'logs'));

  console.log('\nPhase 1 smoke test\n------------------');

  const db = openDatabase(dbFile);

  await check('first run applies every migration', () => {
    // Count the files instead of hardcoding a number, so adding a migration never
    // breaks this test.
    const expected = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).length;
    assert.ok(expected > 0, 'the migrations directory should not be empty');
    assert.equal(runMigrations(db, migrationsDir), expected);
  });

  await check('second run applies nothing (migrations are idempotent)', () => {
    assert.equal(runMigrations(db, migrationsDir), 0);
  });

  // Repositories prepare their statements on creation, so migrations run first (same order as main.ts).
  const users = createUserRepository(db);
  const settings = createSettingsRepository(db);

  await check('all documented tables exist', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    // docs/architecture.md section 4
    const expected = [
      'users',
      'settings',
      'categories',
      'items',
      'customers',
      'orders',
      'order_items',
      'invoices',
      'waiters',
      'delivery_boys',
      'attendance',
      'advances',
      'salary_payments',
      'vehicles',
      'vehicle_assignments',
      'vehicle_expenses',
      'schema_migrations',
    ];

    for (const table of expected) {
      assert.ok(tables.includes(table), `missing table: ${table}`);
    }
  });

  await check('default settings are seeded', () => {
    assert.equal(settings.get('shop_name'), 'Gul Khan Fast Food');
    assert.equal(settings.get('tax_percent'), '0');
  });

  await check('settings upsert works', () => {
    settings.set('tax_percent', '5');
    assert.equal(settings.get('tax_percent'), '5');
  });

  await check('default admin is created once with a bcrypt hash', async () => {
    await seedDefaultAdmin(users);
    await seedDefaultAdmin(users); // must not create a second admin
    assert.equal(users.count(), 1);

    const admin = users.findByUsername('admin');
    assert.ok(admin, 'admin row should exist');
    assert.equal(admin.role, 'admin');
    assert.equal(admin.active, 1);
    assert.equal(admin.must_change_password, 1, 'admin must be forced to change password');
    assert.match(admin.password_hash, /^\$2[aby]\$/, 'password must be a bcrypt hash');
    assert.ok(!admin.password_hash.includes('admin123'));
  });

  const auth = createAuthService(users);

  await check('login with a wrong password is rejected', async () => {
    await assert.rejects(
      () => auth.login('admin', 'wrong-password'),
      (error) => {
        assert.equal(error.code, 'INVALID_CREDENTIALS');
        assert.equal(error.message, 'Wrong username or password');
        return true;
      },
    );
  });

  await check('login with unknown username is rejected', async () => {
    await assert.rejects(
      () => auth.login('nobody', 'admin123'),
      (error) => {
        assert.equal(error.code, 'INVALID_CREDENTIALS');
        return true;
      },
    );
  });

  await check('no session exists before login', () => {
    assert.equal(auth.getCurrentUser(), null);
    assert.throws(
      () => auth.requireUser(),
      (error) => error.code === 'UNAUTHENTICATED',
    );
  });

  await check('login with admin/admin123 succeeds and opens a session', async () => {
    const user = await auth.login('admin', 'admin123');
    assert.equal(user.username, 'admin');
    assert.equal(user.role, 'admin');
    assert.equal(user.mustChangePassword, true);
    assert.equal(auth.getCurrentUser()?.id, user.id);
    assert.equal(users.findByUsername('admin').last_login_at !== null, true);
  });

  await check('username is case-insensitive on login', async () => {
    auth.logout();
    const user = await auth.login('ADMIN', 'admin123');
    assert.equal(user.username, 'admin');
  });

  await check('forced password change clears must_change_password', async () => {
    const updated = await auth.changePassword('admin123', 'OwnerPass123');
    assert.equal(updated.mustChangePassword, false);
    assert.equal(users.findByUsername('admin').must_change_password, 0);

    auth.logout();
    const user = await auth.login('admin', 'OwnerPass123');
    assert.equal(user.mustChangePassword, false);
  });

  await check('old password stops working after the change', async () => {
    auth.logout();
    await assert.rejects(
      () => auth.login('admin', 'admin123'),
      (error) => {
        assert.equal(error.code, 'INVALID_CREDENTIALS');
        return true;
      },
    );
  });

  await check('changePassword rejects a wrong current password', async () => {
    await auth.login('admin', 'OwnerPass123');
    await assert.rejects(
      () => auth.changePassword('nope', 'Another123'),
      (error) => {
        assert.equal(error.code, 'INVALID_CREDENTIALS');
        return true;
      },
    );
  });

  await check('cashier is forbidden from admin-only actions', async () => {
    const cashierId = users.create({
      username: 'cashier1',
      passwordHash: await hashPassword('Cashier123'),
      fullName: 'Counter Staff',
      role: 'cashier',
      active: true,
    });

    auth.logout();
    const cashier = await auth.login('cashier1', 'Cashier123');
    assert.equal(cashier.role, 'cashier');
    assert.equal(cashierId, users.findByUsername('cashier1').id);

    // A cashier may act as a signed-in user...
    assert.equal(auth.requireUser().id, cashierId);
    // ...but an admin-only action must be refused.
    assert.throws(
      () => auth.requireUser(['admin']),
      (error) => error.code === 'FORBIDDEN',
    );
  });

  await check('role page permissions come from the main process map', () => {
    // Assert relationships, not a frozen list, so adding a page does not break this.
    const everyPage = getRolePermissions('admin').pages;
    const cashier = getRolePermissions('cashier').pages;
    const manager = getRolePermissions('manager').pages;

    for (const page of ['home', 'orders', 'menu']) {
      assert.ok(cashier.includes(page), `a cashier should open ${page}`);
    }
    assert.ok(manager.includes('staff'), 'a manager should open staff');
    assert.ok(manager.includes('reports'), 'a manager should open reports');

    // Pages only an admin may open.
    for (const page of ['users', 'settings']) {
      assert.ok(everyPage.includes(page), `an admin should open ${page}`);
      assert.equal(cashier.includes(page), false, `a cashier must not open ${page}`);
      assert.equal(manager.includes(page), false, `a manager must not open ${page}`);
    }

    // The admin map is the superset of every other role.
    for (const role of ['cashier', 'manager']) {
      for (const page of getRolePermissions(role).pages) {
        assert.ok(everyPage.includes(page), `admin is missing ${page} which ${role} has`);
      }
    }

    assert.equal(roleHasPage('cashier', 'settings'), false);
    assert.equal(roleHasPage('cashier', 'staff'), false);
    assert.equal(roleHasPage('admin', 'settings'), true);
  });

  await check('role guard throws FORBIDDEN for a cashier on an admin action', () => {
    assert.throws(
      () => auth.requireUser(['admin', 'manager']),
      (error) => {
        assert.equal(error.code, 'FORBIDDEN');
        return true;
      },
    );
  });

  await check('disabled account cannot log in', async () => {
    db.prepare('UPDATE users SET active = 0 WHERE username = ?').run('cashier1');
    await assert.rejects(
      () => auth.login('cashier1', 'Cashier123'),
      (error) => {
        assert.equal(error.code, 'ACCOUNT_DISABLED');
        return true;
      },
    );
  });

  await check('five wrong attempts lock the account for a while', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await auth.login('admin', 'definitely-wrong').catch(() => undefined);
    }
    await assert.rejects(
      () => auth.login('admin', 'OwnerPass123'),
      (error) => {
        assert.equal(error.code, 'TOO_MANY_ATTEMPTS');
        return true;
      },
    );
  });

  await check('logout clears the session', () => {
    auth.logout();
    assert.equal(auth.getCurrentUser(), null);
  });

  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });

  console.log(`------------------\n${passed} checks passed\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
