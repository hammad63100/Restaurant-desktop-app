/**
 * Contract shared between the Electron main process, the preload script and React.
 * This file must stay dependency-free (types only) so both tsconfigs can compile it.
 *
 * Money rule (docs/Rules.md): every amount in this contract is an INTEGER number of
 * paisa (1 rupee = 100 paisa). The UI converts to rupees for display and input only.
 */

export type UserRole = 'admin' | 'cashier' | 'manager';

/** Pages a role is allowed to open. Enforced in the main process. */
export type PageKey =
  'home' | 'orders' | 'menu' | 'staff' | 'vehicles' | 'reports' | 'users' | 'settings';

/** Fine grained write permissions, so a cashier can open the menu but not edit it. */
export type Capability =
  | 'orders:write'
  | 'orders:cancel'
  | 'menu:write'
  | 'staff:write'
  | 'vehicles:write'
  | 'reports:read'
  | 'users:write'
  | 'settings:write'
  | 'backup:write';

export interface RolePermissions {
  role: UserRole;
  pages: PageKey[];
  capabilities: Capability[];
}

/** The user object that is safe to send to the renderer. Never contains a password hash. */
export interface SessionUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  mustChangePassword: boolean;
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'TOO_MANY_ATTEMPTS'
  | 'WEAK_PASSWORD'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DB_ERROR'
  | 'PRINT_ERROR'
  | 'INTERNAL_ERROR';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface LoginInput {
  username: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export interface Category {
  id: number;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface CategoryInput {
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface MenuItem {
  id: number;
  categoryId: number;
  categoryName: string;
  name: string;
  price: number;
  available: boolean;
  image: string | null;
  active: boolean;
}

export interface MenuItemInput {
  categoryId: number;
  name: string;
  price: number;
  available: boolean;
  image: string | null;
}

/* ------------------------------------------------------------------ */
/* Orders and invoices                                                 */
/* ------------------------------------------------------------------ */

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

export interface OrderItemInput {
  itemId: number;
  qty: number;
  notes: string;
}

export interface OrderItemRecord {
  id: number;
  itemId: number;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
  notes: string;
}

export interface NewOrderInput {
  type: OrderType;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  waiterId: number | null;
  deliveryBoyId: number | null;
  discount: number;
  taxPercent: number;
  notes: string;
  items: OrderItemInput[];
}

export interface OrderSummary {
  id: number;
  orderNo: string;
  invoiceNo: string | null;
  type: OrderType;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  createdAt: string;
  createdByName: string;
  waiterName: string | null;
  deliveryBoyName: string | null;
}

export interface OrderDetail extends OrderSummary {
  customerAddress: string;
  waiterId: number | null;
  deliveryBoyId: number | null;
  taxPercent: number;
  notes: string;
  printedAt: string | null;
  items: OrderItemRecord[];
}

export interface OrderFilter {
  search: string;
  status: OrderStatus | 'all';
  type: OrderType | 'all';
  fromDate: string;
  toDate: string;
  limit: number;
}

export interface InvoiceData {
  order: OrderDetail;
  shop: ShopSettings;
  cashierName: string;
}

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

export type PersonType = 'waiter' | 'delivery_boy';

export interface Waiter {
  id: number;
  name: string;
  phone: string;
  cnic: string;
  address: string;
  joinDate: string;
  salary: number;
  active: boolean;
}

export interface WaiterInput {
  name: string;
  phone: string;
  cnic: string;
  address: string;
  joinDate: string;
  salary: number;
  active: boolean;
}

export interface DeliveryBoy extends Waiter {
  commission: number;
  vehicleId: number | null;
  vehiclePlate: string | null;
}

export interface DeliveryBoyInput extends WaiterInput {
  commission: number;
  vehicleId: number | null;
}

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave';

export interface AttendanceRecord {
  id: number;
  personType: PersonType;
  personId: number;
  date: string;
  status: AttendanceStatus;
}

export interface AdvanceRecord {
  id: number;
  personType: PersonType;
  personId: number;
  amount: number;
  date: string;
  note: string;
}

export interface AdvanceInput {
  personType: PersonType;
  personId: number;
  amount: number;
  date: string;
  note: string;
}

export interface SalaryPaymentRecord {
  id: number;
  personType: PersonType;
  personId: number;
  month: string;
  base: number;
  deductions: number;
  advances: number;
  net: number;
  paidOn: string;
}

export interface SalarySlip {
  personType: PersonType;
  personId: number;
  name: string;
  role: string;
  month: string;
  monthlySalary: number;
  workingDays: number;
  daysPresent: number;
  daysAbsent: number;
  halfDays: number;
  leaves: number;
  perDay: number;
  earnedSalary: number;
  commission: number;
  advances: number;
  deductions: number;
  netPay: number;
  paidOn: string | null;
}

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

export type VehicleType = 'bike' | 'car' | 'other';

export interface Vehicle {
  id: number;
  type: VehicleType;
  plateNo: string;
  model: string;
  color: string;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  active: boolean;
  assignedToId: number | null;
  assignedToName: string | null;
}

export interface VehicleInput {
  type: VehicleType;
  plateNo: string;
  model: string;
  color: string;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  active: boolean;
}

export interface VehicleAssignment {
  id: number;
  vehicleId: number;
  deliveryBoyId: number;
  deliveryBoyName: string;
  fromDate: string;
  toDate: string | null;
}

export type VehicleExpenseType = 'fuel' | 'maintenance' | 'repair' | 'other';

export interface VehicleExpense {
  id: number;
  vehicleId: number;
  type: VehicleExpenseType;
  amount: number;
  date: string;
  note: string;
}

export interface VehicleExpenseInput {
  vehicleId: number;
  type: VehicleExpenseType;
  amount: number;
  date: string;
  note: string;
}

/* ------------------------------------------------------------------ */
/* Dashboard and reports                                               */
/* ------------------------------------------------------------------ */

export interface DashboardStats {
  todaySales: number;
  todayOrders: number;
  pendingDeliveries: number;
  monthSales: number;
  totalItems: number;
  activeStaff: number;
  expiringVehicles: VehicleExpiryAlert[];
  recentOrders: OrderSummary[];
  salesByDay: DailySalesRow[];
}

export interface VehicleExpiryAlert {
  vehicleId: number;
  plateNo: string;
  document: 'registration' | 'insurance';
  expiryDate: string;
  daysLeft: number;
}

export interface DailySalesRow {
  date: string;
  orders: number;
  sales: number;
}

export interface TopItemRow {
  itemId: number;
  name: string;
  qty: number;
  revenue: number;
}

export interface SalarySummaryRow {
  personType: PersonType;
  personId: number;
  name: string;
  role: string;
  month: string;
  netPay: number;
  paid: boolean;
}

export interface DeliveryReportRow {
  deliveryBoyId: number;
  name: string;
  deliveries: number;
  deliveredValue: number;
  commission: number;
}

export interface VehicleExpenseRow {
  vehicleId: number;
  plateNo: string;
  fuel: number;
  maintenance: number;
  other: number;
  total: number;
  entries: number;
}

export interface DateRange {
  fromDate: string;
  toDate: string;
}

export interface ReportBundle {
  range: DateRange;
  dailySales: DailySalesRow[];
  topItems: TopItemRow[];
  totals: { orders: number; sales: number; discount: number; tax: number; cancelled: number };
  byType: { type: OrderType; orders: number; sales: number }[];
}

/* ------------------------------------------------------------------ */
/* Settings and users                                                  */
/* ------------------------------------------------------------------ */

export interface ShopSettings {
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  shopLogo: string | null;
  currency: string;
  taxPercent: number;
  receiptWidth: '80mm' | 'a4';
  backupOnClose: boolean;
}

export interface AppUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AppUserInput {
  username: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  password?: string;
}

export interface BackupFile {
  fileName: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* API surface exposed on window.api                                  */
/* ------------------------------------------------------------------ */

export interface AuthApi {
  login(input: LoginInput): Promise<ApiResult<SessionUser>>;
  logout(): Promise<ApiResult<null>>;
  getSession(): Promise<ApiResult<SessionUser | null>>;
  changePassword(input: ChangePasswordInput): Promise<ApiResult<SessionUser>>;
  getPermissions(): Promise<ApiResult<RolePermissions | null>>;
}

export interface MenuApi {
  listCategories(): Promise<ApiResult<Category[]>>;
  saveCategory(input: CategoryInput & { id?: number }): Promise<ApiResult<Category>>;
  deleteCategory(id: number): Promise<ApiResult<null>>;
  listItems(): Promise<ApiResult<MenuItem[]>>;
  saveItem(input: MenuItemInput & { id?: number }): Promise<ApiResult<MenuItem>>;
  deleteItem(id: number): Promise<ApiResult<null>>;
  toggleItem(id: number, available: boolean): Promise<ApiResult<null>>;
}

export interface OrdersApi {
  create(input: NewOrderInput): Promise<ApiResult<OrderDetail>>;
  list(filter: OrderFilter): Promise<ApiResult<OrderSummary[]>>;
  get(id: number): Promise<ApiResult<OrderDetail>>;
  updateStatus(id: number, status: OrderStatus): Promise<ApiResult<OrderSummary>>;
  cancel(id: number): Promise<ApiResult<OrderSummary>>;
  invoice(id: number): Promise<ApiResult<InvoiceData>>;
  markPrinted(id: number): Promise<ApiResult<OrderDetail>>;
  print(id: number, paper: '80mm' | 'a4'): Promise<ApiResult<{ printed: boolean }>>;
  savePdf(id: number, paper: '80mm' | 'a4'): Promise<ApiResult<{ path: string | null }>>;
}

export interface StaffApi {
  listWaiters(): Promise<ApiResult<Waiter[]>>;
  saveWaiter(input: WaiterInput & { id?: number }): Promise<ApiResult<Waiter>>;
  removeWaiter(id: number): Promise<ApiResult<null>>;
  listDeliveryBoys(): Promise<ApiResult<DeliveryBoy[]>>;
  saveDeliveryBoy(input: DeliveryBoyInput & { id?: number }): Promise<ApiResult<DeliveryBoy>>;
  removeDeliveryBoy(id: number): Promise<ApiResult<null>>;
  listAttendance(
    personType: PersonType,
    personId: number,
    month: string,
  ): Promise<ApiResult<AttendanceRecord[]>>;
  setAttendance(input: {
    personType: PersonType;
    personId: number;
    date: string;
    status: AttendanceStatus;
  }): Promise<ApiResult<AttendanceRecord>>;
  listAdvances(
    personType: PersonType,
    personId: number,
    month: string,
  ): Promise<ApiResult<AdvanceRecord[]>>;
  addAdvance(input: AdvanceInput): Promise<ApiResult<AdvanceRecord>>;
  removeAdvance(id: number): Promise<ApiResult<null>>;
  salarySlip(
    personType: PersonType,
    personId: number,
    month: string,
  ): Promise<ApiResult<SalarySlip>>;
  paySalary(input: {
    personType: PersonType;
    personId: number;
    month: string;
    deductions: number;
  }): Promise<ApiResult<SalaryPaymentRecord>>;
  salaryPayments(month: string): Promise<ApiResult<SalaryPaymentRecord[]>>;
}

export interface VehiclesApi {
  list(): Promise<ApiResult<Vehicle[]>>;
  save(input: VehicleInput & { id?: number }): Promise<ApiResult<Vehicle>>;
  remove(id: number): Promise<ApiResult<null>>;
  assign(
    vehicleId: number,
    deliveryBoyId: number | null,
    fromDate: string,
  ): Promise<ApiResult<Vehicle>>;
  assignments(vehicleId: number): Promise<ApiResult<VehicleAssignment[]>>;
  expenses(
    vehicleId: number,
    fromDate: string,
    toDate: string,
  ): Promise<ApiResult<VehicleExpense[]>>;
  addExpense(input: VehicleExpenseInput): Promise<ApiResult<VehicleExpense>>;
  removeExpense(id: number): Promise<ApiResult<null>>;
}

export interface ReportsApi {
  dashboard(): Promise<ApiResult<DashboardStats>>;
  range(range: DateRange): Promise<ApiResult<ReportBundle>>;
  salarySummary(month: string): Promise<ApiResult<SalarySummaryRow[]>>;
  deliveryReport(range: DateRange): Promise<ApiResult<DeliveryReportRow[]>>;
  vehicleExpenses(range: DateRange): Promise<ApiResult<VehicleExpenseRow[]>>;
  exportCsv(
    report: 'daily_sales' | 'top_items' | 'salary' | 'delivery' | 'vehicle_expenses',
    range: DateRange,
  ): Promise<ApiResult<{ path: string | null }>>;
}

export interface SettingsApi {
  get(): Promise<ApiResult<ShopSettings>>;
  save(input: ShopSettings): Promise<ApiResult<ShopSettings>>;
  pickLogo(): Promise<ApiResult<string | null>>;
  listBackups(): Promise<ApiResult<BackupFile[]>>;
  createBackup(): Promise<ApiResult<BackupFile | null>>;
  restoreBackup(filePath: string): Promise<ApiResult<null>>;
}

export interface UsersApi {
  list(): Promise<ApiResult<AppUser[]>>;
  save(input: AppUserInput & { id?: number }): Promise<ApiResult<AppUser>>;
  setActive(id: number, active: boolean): Promise<ApiResult<AppUser>>;
  resetPassword(id: number, newPassword: string): Promise<ApiResult<null>>;
}

export interface RendererApi {
  auth: AuthApi;
  menu: MenuApi;
  orders: OrdersApi;
  staff: StaffApi;
  vehicles: VehiclesApi;
  reports: ReportsApi;
  settings: SettingsApi;
  users: UsersApi;
}

/** IPC channel names, kept in one place so main, preload and the dev bridge cannot drift. */
export const CHANNELS = {
  login: 'auth:login',
  logout: 'auth:logout',
  session: 'auth:session',
  changePassword: 'auth:change-password',
  permissions: 'auth:permissions',

  categories: 'menu:categories',
  categorySave: 'menu:category-save',
  categoryDelete: 'menu:category-delete',
  items: 'menu:items',
  itemSave: 'menu:item-save',
  itemDelete: 'menu:item-delete',
  itemToggle: 'menu:item-toggle',

  orderCreate: 'orders:create',
  orderList: 'orders:list',
  orderGet: 'orders:get',
  orderStatus: 'orders:status',
  orderCancel: 'orders:cancel',
  orderInvoice: 'orders:invoice',
  orderMarkPrinted: 'orders:mark-printed',
  orderPrint: 'orders:print',
  orderPdf: 'orders:pdf',

  waiters: 'staff:waiters',
  waiterSave: 'staff:waiter-save',
  waiterDelete: 'staff:waiter-delete',
  deliveryBoys: 'staff:delivery-boys',
  deliveryBoySave: 'staff:delivery-boy-save',
  deliveryBoyDelete: 'staff:delivery-boy-delete',
  attendance: 'staff:attendance',
  attendanceSet: 'staff:attendance-set',
  advances: 'staff:advances',
  advanceAdd: 'staff:advance-add',
  advanceDelete: 'staff:advance-delete',
  salarySlip: 'staff:salary-slip',
  salaryPay: 'staff:salary-pay',
  salaryPayments: 'staff:salary-payments',

  vehicles: 'vehicles:list',
  vehicleSave: 'vehicles:save',
  vehicleDelete: 'vehicles:delete',
  vehicleAssign: 'vehicles:assign',
  vehicleAssignments: 'vehicles:assignments',
  vehicleExpenses: 'vehicles:expenses',
  vehicleExpenseAdd: 'vehicles:expense-add',
  vehicleExpenseDelete: 'vehicles:expense-delete',

  dashboard: 'reports:dashboard',
  reportRange: 'reports:range',
  reportSalary: 'reports:salary',
  reportDelivery: 'reports:delivery',
  reportVehicleExpenses: 'reports:vehicle-expenses',
  reportExport: 'reports:export',

  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsPickLogo: 'settings:pick-logo',
  backupList: 'settings:backup-list',
  backupCreate: 'settings:backup-create',
  backupRestore: 'settings:backup-restore',

  users: 'users:list',
  userSave: 'users:save',
  userActive: 'users:set-active',
  userPassword: 'users:reset-password',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
