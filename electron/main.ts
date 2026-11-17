import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { copyFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { closeDatabase, getDatabase, openDatabase } from './db/connection';
import { runMigrations } from './db/migrate';
import { createUserRepository } from './db/repositories/userRepository';
import { createSettingsRepository } from './db/repositories/settingsRepository';
import { createCatalogRepository } from './db/repositories/catalogRepository';
import { createOrdersRepository } from './db/repositories/ordersRepository';
import { createStaffRepository } from './db/repositories/staffRepository';
import { createVehiclesRepository } from './db/repositories/vehiclesRepository';
import { createSequenceRepository } from './db/repositories/sequenceRepository';
import { seedDefaultAdmin } from './db/seed';
import { seedDemoData } from './db/seedDemo';
import { createAuthService } from './services/authService';
import { createSettingsService } from './services/settingsService';
import { createUserService } from './services/userService';
import { createCatalogService } from './services/catalogService';
import { createOrdersService } from './services/ordersService';
import { createStaffService } from './services/staffService';
import { createVehiclesService } from './services/vehiclesService';
import { createReportsService } from './services/reportsService';
import { createCsvService } from './services/csvService';
import { createBackupService } from './services/backupService';
import { createPrintService } from './services/printService';
import { buildRegistry, dispatch } from './ipc';
import { configureLogger, logError, logInfo } from './services/logger';
import type { AuthService } from './services/authService';

const isDev = !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const allowDemoData = process.env.SEED_DEMO === '1' || process.argv.includes('--demo-data');

let mainWindow: BrowserWindow | null = null;
let authService: AuthService | null = null;
let registry: ReturnType<typeof buildRegistry> | null = null;
let backupServiceInstance: ReturnType<typeof createBackupService> | null = null;

function databaseFile(): string {
  return path.join(app.getPath('userData'), 'data', 'fastfood.db');
}

function migrationsDirectory(): string {
  // Copied next to the compiled JS by scripts/copy-electron-assets.mjs,
  // so the same relative path works in dev, in the asar build and in tests.
  return path.join(__dirname, 'db', 'migrations');
}

function backupDirectory(): string {
  return path.join(app.getPath('userData'), 'backups');
}

function exportDirectory(): string {
  return path.join(app.getPath('documents'), 'Gul Khan Fast Food');
}

/**
 * Window/taskbar icon. Packaged builds get it from the exe (build/icon.ico); in
 * development electron-builder's resources folder is not present, so it is optional.
 */
function windowIcon(): string | undefined {
  const candidate = path.join(__dirname, '../../build/icon.png');
  return existsSync(candidate) ? candidate : undefined;
}

async function bootstrapServices(): Promise<void> {
  configureLogger(path.join(app.getPath('userData'), 'logs'));
  logInfo(`Starting app version ${app.getVersion()} (dev: ${isDev})`);

  const db = openDatabase(databaseFile());
  const applied = runMigrations(db, migrationsDirectory());
  logInfo(`Database ready. Migrations applied this run: ${applied}`);

  // Repositories prepare statements, so they are created after migrations.
  const users = createUserRepository(db);
  const settingsRepo = createSettingsRepository(db);
  const catalogRepo = createCatalogRepository(db);
  const ordersRepo = createOrdersRepository(db);
  const staffRepo = createStaffRepository(db);
  const vehiclesRepo = createVehiclesRepository(db);
  const sequences = createSequenceRepository(db);

  await seedDefaultAdmin(users);
  if (allowDemoData) {
    await seedDemoData({
      users,
      catalog: catalogRepo,
      orders: ordersRepo,
      staff: staffRepo,
      vehicles: vehiclesRepo,
      sequences,
    });
  }

  const auth = createAuthService(users);
  authService = auth;

  const staffService = createStaffService({
    staff: staffRepo,
    vehicles: vehiclesRepo,
    commissionForMonth: (deliveryBoyId, month) => {
      const from = `${month}-01`;
      const to = `${month}-31`;
      return (
        ordersRepo.deliveriesByBoy(from, to).find((row) => row.deliveryBoyId === deliveryBoyId)
          ?.commission ?? 0
      );
    },
  });

  const backups = createBackupService(databaseFile(), backupDirectory(), {
    checkpoint: () => {
      getDatabase().pragma('wal_checkpoint(TRUNCATE)');
    },
    replaceWith: (sourcePath) => {
      closeDatabase();
      copyFileSync(sourcePath, databaseFile());
      // Drop stale WAL/SHM files from the previous database before reopening.
      for (const suffix of ['-wal', '-shm']) {
        try {
          unlinkSync(`${databaseFile()}${suffix}`);
        } catch {
          // The file may not exist; that is fine.
        }
      }
      openDatabase(databaseFile());
    },
  });

  backupServiceInstance = backups;

  const printService = createPrintService({
    getWindow: () => mainWindow,
    pdfDirectory: exportDirectory,
    markPrinted: (orderId) => {
      ordersRepo.markInvoicePrinted(orderId);
    },
  });

  const reportsService = createReportsService({
    orders: ordersRepo,
    catalog: catalogRepo,
    staff: staffRepo,
    vehicles: vehiclesRepo,
    staffService,
  });

  const csvService = createCsvService({
    reports: reportsService,
    exportDirectory,
    salarySummary: (month) => reportsService.salarySummary(month),
  });

  registry = buildRegistry({
    auth,
    catalog: createCatalogService(catalogRepo),
    orders: createOrdersService({
      orders: ordersRepo,
      catalog: catalogRepo,
      sequences,
      settings: settingsRepo,
      staff: staffRepo,
      users,
    }),
    staff: staffService,
    vehicles: createVehiclesService({ vehicles: vehiclesRepo, staff: staffRepo }),
    reports: reportsService,
    settings: createSettingsService(settingsRepo),
    users: createUserService(users),
    backups,
    print: printService,
    csv: csvService,
  });
}

function registerIpcHandlers(): void {
  const handlers = registry;
  const auth = authService;
  if (!handlers || !auth) throw new Error('Services were not initialised');

  // Every channel goes through the same dispatcher used by the dev bridge,
  // so auth/role/capability/validation rules cannot drift between the two.
  for (const channel of Object.keys(handlers)) {
    ipcMain.handle(channel, async (_event, payload: unknown) =>
      dispatch(
        channel,
        handlers,
        payload,
        () => auth.getCurrentUser(),
        auth.getCurrentUser() !== null,
      ),
    );
  }

  // Logo picker needs a native dialog, so it is registered here rather than in the
  // pure service layer.
  ipcMain.handle('settings:pick-logo', async () => {
    if (!auth.getCurrentUser() || auth.getCurrentUser()?.role !== 'admin') {
      return {
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Your role does not allow this action' },
      };
    }

    const result = await dialog.showOpenDialog({
      title: 'Choose the shop logo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });

    if (result.canceled || !result.filePaths[0]) return { ok: true, data: null };

    const filePath = result.filePaths[0];
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const mime = extension === 'jpg' ? 'jpeg' : extension;
    const base64 = readFileSync(filePath).toString('base64');

    return { ok: true, data: `data:image/${mime};base64,${base64}` };
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#F8F9FA',
    title: 'Gul Khan Fast Food',
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload imports the shared channel constants, which needs a real require.
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = devServerUrl && url.startsWith(devServerUrl);
    if (!allowed) event.preventDefault();
  });

  if (isDev && devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await bootstrapServices();
    } catch (error) {
      logError('Startup failed while preparing the database', error);
      dialog.showErrorBox(
        'Cannot start Gul Khan Fast Food',
        'The database could not be opened. Please close any other copy of the app and try again.',
      );
      app.quit();
      return;
    }

    registerIpcHandlers();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    // Automatic backup on close, keeping the last 7 (Rules.md section 3).
    try {
      if (registry) {
        const backupOnClose =
          createSettingsRepository(getDatabase()).readShopSettings().backupOnClose;
        if (backupOnClose) {
          backupServiceInstance?.createBackup('auto');
        }
      }
    } catch (error) {
      logError('Automatic backup on close failed', error);
    }

    closeDatabase();
  });
}

process.on('uncaughtException', (error) => {
  logError('Uncaught exception in main process', error);
});
