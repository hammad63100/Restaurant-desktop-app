/**
 * Browser preview helper (development only).
 *
 * The real app is Electron: React talks to the main process over IPC. This server
 * serves the built UI and exposes the SAME registry the Electron main process uses
 * over HTTP, backed by a throw-away SQLite database in the temp folder.
 *
 * Differences from the packaged app, on purpose:
 *  - throw-away database with demo data, wiped on exit
 *  - no native dialogs (logo picker, PDF, CSV export return a stub)
 *  - printing is disabled
 * It is never shipped, and `npm run dev` / the Windows build do not use it.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const distDir = path.join(root, 'dist');
const compiledDir = path.join(root, 'dist-electron', 'electron');
const port = Number(process.env.PREVIEW_PORT ?? 4173);

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('[preview] dist/index.html is missing. Run `npm run build:renderer` first.');
  process.exit(1);
}

if (!existsSync(compiledDir)) {
  console.error('[preview] dist-electron is missing. Run `npm run build:electron` first.');
  process.exit(1);
}

const load = (relative) => require(path.join(compiledDir, relative));

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'gulkhan-preview-'));
const { openDatabase, closeDatabase, getDatabase } = load('db/connection.js');
const { runMigrations } = load('db/migrate.js');
const { configureLogger } = load('services/logger.js');
const { buildRegistry, dispatch } = load('ipc/index.js');

configureLogger(path.join(tempDir, 'logs'));
const db = openDatabase(path.join(tempDir, 'preview.db'));
runMigrations(db, path.join(compiledDir, 'db', 'migrations'));

const repos = {
  users: load('db/repositories/userRepository.js').createUserRepository(db),
  settings: load('db/repositories/settingsRepository.js').createSettingsRepository(db),
  catalog: load('db/repositories/catalogRepository.js').createCatalogRepository(db),
  orders: load('db/repositories/ordersRepository.js').createOrdersRepository(db),
  staff: load('db/repositories/staffRepository.js').createStaffRepository(db),
  vehicles: load('db/repositories/vehiclesRepository.js').createVehiclesRepository(db),
  sequences: load('db/repositories/sequenceRepository.js').createSequenceRepository(db),
};

const auth = load('services/authService.js').createAuthService(repos.users);
const staffService = load('services/staffService.js').createStaffService({
  staff: repos.staff,
  vehicles: repos.vehicles,
  commissionForMonth: (deliveryBoyId, month) =>
    repos.orders
      .deliveriesByBoy(`${month}-01`, `${month}-31`)
      .find((row) => row.deliveryBoyId === deliveryBoyId)?.commission ?? 0,
});
const reportsService = load('services/reportsService.js').createReportsService({
  orders: repos.orders,
  catalog: repos.catalog,
  staff: repos.staff,
  vehicles: repos.vehicles,
  staffService,
});

const registry = buildRegistry({
  auth,
  catalog: load('services/catalogService.js').createCatalogService(repos.catalog),
  orders: load('services/ordersService.js').createOrdersService({
    orders: repos.orders,
    catalog: repos.catalog,
    sequences: repos.sequences,
    settings: repos.settings,
    staff: repos.staff,
    users: repos.users,
  }),
  staff: staffService,
  vehicles: load('services/vehiclesService.js').createVehiclesService({
    vehicles: repos.vehicles,
    staff: repos.staff,
  }),
  reports: reportsService,
  settings: load('services/settingsService.js').createSettingsService(repos.settings),
  users: load('services/userService.js').createUserService(repos.users),
  backups: load('services/backupService.js').createBackupService(
    path.join(tempDir, 'preview.db'),
    path.join(tempDir, 'backups'),
    {
      checkpoint: () => getDatabase().pragma('wal_checkpoint(TRUNCATE)'),
      replaceWith: () => undefined,
    },
  ),
  print: {
    printInvoice: async () => {
      throw new Error('Printing is not available in the browser preview');
    },
    savePdf: async () => null,
    renderHtml: load('services/printService.js').renderInvoiceHtml,
  },
  csv: load('services/csvService.js').createCsvService({
    reports: reportsService,
    exportDirectory: () => tempDir,
    salarySummary: (month) => reportsService.salarySummary(month),
  }),
});

const { seedDefaultAdmin } = load('db/seed.js');
await seedDefaultAdmin(repos.users);
await load('db/seedDemo.js').seedDemoData({
  users: repos.users,
  catalog: repos.catalog,
  orders: repos.orders,
  staff: repos.staff,
  vehicles: repos.vehicles,
  sequences: repos.sequences,
});

// The preview is a browser, so a forced password change would block every screen.
// Only this throw-away database is affected.
db.prepare('UPDATE users SET must_change_password = 0').run();

// Logo picking needs a native dialog; the preview returns nothing instead.
registry['settings:pick-logo'] = {
  roles: ['admin'],
  handler: () => null,
};

const BRIDGE_TAG = '<script src="/__preview/bridge.js"></script>';

function previewHtml() {
  return readFileSync(path.join(distDir, 'index.html'), 'utf8')
    .replace(
      /<meta[\s\S]*?Content-Security-Policy[\s\S]*?>/i,
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'\">",
    )
    .replace('<div id="root"></div>', `${BRIDGE_TAG}<div id="root"></div>`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveStatic(requestUrl, response) {
  const url = new URL(requestUrl, `http://localhost:${port}`);
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const filePath = path.join(distDir, relative);
  const safePath = filePath.startsWith(distDir) ? filePath : path.join(distDir, 'index.html');

  if (!existsSync(safePath) || statSync(safePath).isDirectory()) {
    response.writeHead(200, { 'Content-Type': MIME['.html'] });
    response.end(previewHtml());
    return;
  }

  response.writeHead(200, {
    'Content-Type': MIME[path.extname(safePath)] ?? 'application/octet-stream',
  });
  response.end(readFileSync(safePath));
}

const server = createServer((request, response) => {
  if (request.url === '/__preview/bridge.js') {
    response.writeHead(200, { 'Content-Type': MIME['.js'] });
    response.end(readFileSync(path.join(root, 'scripts', 'preview-bridge.js')));
    return;
  }

  if (request.method === 'POST' && request.url === '/__preview/ipc') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', async () => {
      const started = Date.now();
      let message;
      try {
        message = JSON.parse(body || '{}');
      } catch {
        response.writeHead(400, { 'Content-Type': MIME['.json'] });
        response.end(
          JSON.stringify({
            ok: false,
            error: { code: 'VALIDATION_ERROR', message: 'Malformed request' },
          }),
        );
        return;
      }

      const result = await dispatch(
        message.channel,
        registry,
        message.args,
        () => auth.getCurrentUser(),
        auth.getCurrentUser() !== null,
      );

      if (Date.now() - started > 400) {
        console.log(`[preview] slow channel ${message.channel} (${Date.now() - started}ms)`);
      }

      response.writeHead(200, { 'Content-Type': MIME['.json'] });
      response.end(JSON.stringify(result));
    });
    return;
  }

  serveStatic(request.url ?? '/', response);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[preview] UI preview on http://0.0.0.0:${port} (throw-away database, demo data)`);
  console.log('[preview] admin/admin123 · manager/manager123 · cashier/cashier123');
});

function shutdown() {
  server.close();
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
