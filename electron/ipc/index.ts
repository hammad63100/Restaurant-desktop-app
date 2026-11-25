import type { AuthService } from '../services/authService';
import type { CatalogService } from '../services/catalogService';
import type { OrdersService } from '../services/ordersService';
import type { StaffService } from '../services/staffService';
import type { VehiclesService } from '../services/vehiclesService';
import type { ReportsService } from '../services/reportsService';
import type { SettingsService } from '../services/settingsService';
import type { UserService } from '../services/userService';
import type { BackupService } from '../services/backupService';
import type { PrintService } from '../services/printService';
import type { CsvService } from '../services/csvService';
import type { PaymentsService } from '../services/paymentsService';
import type { ShiftsService } from '../services/shiftsService';
import type { DiscountsService } from '../services/discountsService';
import type { KotService } from '../services/kotService';
import type { TablesService } from '../services/tablesService';
import { authHandlers } from './auth.ipc';
import { menuHandlers } from './menu.ipc';
import { ordersHandlers } from './orders.ipc';
import { staffHandlers } from './staff.ipc';
import { vehiclesHandlers } from './vehicles.ipc';
import { reportsHandlers } from './reports.ipc';
import { settingsHandlers } from './settings.ipc';
import { usersHandlers } from './users.ipc';
import { paymentsHandlers } from './payments.ipc';
import { shiftsHandlers } from './shifts.ipc';
import { discountsHandlers } from './discounts.ipc';
import { kotHandlers } from './kot.ipc';
import { tablesHandlers } from './tables.ipc';
import type { HandlerRegistry } from './registry';

export interface IpcServices {
  auth: AuthService;
  catalog: CatalogService;
  orders: OrdersService;
  staff: StaffService;
  vehicles: VehiclesService;
  reports: ReportsService;
  settings: SettingsService;
  users: UserService;
  backups: BackupService;
  print: PrintService;
  csv: CsvService;
  payments: PaymentsService;
  shifts: ShiftsService;
  discounts: DiscountsService;
  kot: KotService;
  tables: TablesService;
}

/**
 * One place where every channel is declared. Both the Electron main process and
 * the dev-only HTTP bridge consume this same registry, so there is a single
 * implementation of every rule (auth, role, capability, validation).
 */
export function buildRegistry(services: IpcServices): HandlerRegistry {
  return {
    ...authHandlers(services.auth),
    ...menuHandlers(services.catalog),
    ...ordersHandlers(services.orders, services.print),
    ...staffHandlers(services.staff),
    ...vehiclesHandlers(services.vehicles),
    ...reportsHandlers(services.reports, services.csv),
    ...settingsHandlers(services.settings, services.backups),
    ...usersHandlers(services.users),
    ...paymentsHandlers(services.payments),
    ...shiftsHandlers(services.shifts, services.print),
    ...discountsHandlers(services.discounts),
    ...kotHandlers(services.kot),
    ...tablesHandlers(services.tables),
  };
}

export type { HandlerRegistry } from './registry';
export { dispatch } from './registry';
