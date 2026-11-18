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
  | 'home'
  | 'orders'
  | 'menu'
  | 'staff'
  | 'vehicles'
  | 'reports'
  | 'users'
  | 'settings'
  // Phase 2 (3.A) — customer credit ("udhaar") ledger.
  | 'udhaar'
  // Phase 2 (3.B) — day close.
  | 'shifts'
  // Phase 3 — dine-in floor plan, merging and splitting bills.
  | 'tables';

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
  | 'backup:write'
  // Phase 2 (3.A) — payments and the udhaar ledger.
  | 'payments:write'
  | 'payments:void'
  | 'udhaar:read'
  | 'udhaar:settle'
  // Phase 2 (3.B) — day close / shift.
  | 'shifts:read'
  | 'shifts:write'
  // Phase 2 (3.C) — discount rules and manager approval.
  | 'discount:write'
  | 'discount:approve'
  | 'kot:print'
  // Editing the floor plan, merging bills and splitting them.
  | 'tables:write';

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

/** How money reached the till. 'credit' means it did not reach it yet (udhaar). */
export type PaymentMethod = 'cash' | 'card' | 'jazzcash' | 'easypaisa' | 'bank_transfer' | 'credit';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded';

export interface Payment {
  id: number;
  orderId: number;
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  changeDue: number | null;
  reference: string;
  createdBy: number;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string;
}

export interface AddPaymentInput {
  orderId: number;
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  changeDue: number | null;
  reference: string;
}

export interface DiscountRule {
  id: number;
  role: UserRole;
  maxPercentX100: number;
  maxAmount: number | null;
  requiresApprovalAbovePercentX100: number;
  active: boolean;
}

export interface PromoCode {
  id: number;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  minOrder: number;
  validFrom: string | null;
  validTo: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
}

/** Result of checking a requested discount. Never clamps: it reports instead. */
export interface DiscountDecision {
  allowed: boolean;
  needsApproval: boolean;
  amount: number;
  percentX100: number;
  errors: string[];
  promoCode: string;
  /** Set only when a promo code supplied the discount, so the order can count it. */
  promoId: number | null;
}

export interface DiscountApproval {
  id: number;
  orderId: number | null;
  requestedBy: number;
  approvedBy: number | null;
  percentX100: number;
  amount: number;
  reason: string;
  createdAt: string;
}

export type ShiftStatus = 'open' | 'closed';
export type CashMovementKind = 'sale' | 'cash_in' | 'cash_out' | 'refund' | 'expense';

export interface Shift {
  id: number;
  terminal: string;
  openedBy: number;
  openedByName: string;
  openedAt: string;
  closedBy: number | null;
  closedByName: string | null;
  closedAt: string | null;
  openingCash: number;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
  status: ShiftStatus;
  notes: string;
}

export interface CashMovement {
  id: number;
  shiftId: number;
  kind: CashMovementKind;
  method: PaymentMethod;
  amount: number;
  reason: string;
  refOrderId: number | null;
  createdBy: number;
  createdByName: string;
  createdAt: string;
}

/** The X/Z report: everything the day-close screen and the printed slip need. */
export interface ShiftReport {
  shift: Shift;
  salesByMethod: CollectionByMethod[];
  totalSales: number;
  orderCount: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  refunds: number;
  expenses: number;
  discountTotal: number;
  cancelledCount: number;
  cancelledValue: number;
  topItems: TopItemRow[];
  /** Cash-in/out/refund/expense rows for this shift, newest last. */
  movements: CashMovement[];
  /**
   * What should be in the drawer right now. For an open shift this is computed
   * live (that is the point of an X report); for a closed one it is the stored
   * figure from the close.
   */
  expectedCash: number;
  /** Null for an X report (shift still open). */
  variance: number | null;
}

export interface CollectionByMethod {
  method: PaymentMethod;
  count: number;
  total: number;
}

export interface CustomerLedgerEntry {
  id: number;
  customerId: number;
  orderId: number | null;
  paymentId: number | null;
  entryType: 'charge' | 'payment';
  amount: number;
  balanceAfter: number;
  note: string;
  createdAt: string;
}

export interface UdhaarAccount {
  customerId: number;
  name: string;
  phone: string;
  balance: number;
  lastActivity: string | null;
}

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
  /** Dine-in table. Ignored (and cleared) for takeaway and delivery. */
  tableId?: number | null;
  discount: number;
  /** Why the discount was given. Stored on the order for the audit trail. */
  discountReason?: string;
  promoCode?: string;
  /** Set when a manager approved an above-limit discount. */
  approvedBy?: number | null;
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
  tokenNo: number | null;
  /** How many times this bill has been edited (0 = untouched). */
  amendmentCount: number;
  /** Set when this bill was merged into another one; its money stayed here. */
  mergedIntoOrderId: number | null;
  /** Set when this bill was carved out of another one. */
  splitFromOrderId: number | null;
  /** The dine-in table this bill sits at, if any. */
  tableId: number | null;
  customerName: string;
  customerPhone: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** Money collected so far, read from orders.paid_amount (never recomputed). */
  paidAmount: number;
  paymentStatus: PaymentStatus;
  createdAt: string;
  createdByName: string;
  waiterName: string | null;
  deliveryBoyName: string | null;
}

export interface OrderDetail extends OrderSummary {
  customerAddress: string;
  waiterId: number | null;
  deliveryBoyId: number | null;
  /** Who approved the discount on this bill, when one was needed. */
  approvedBy: number | null;
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
  /**
   * Keyset cursor: return only orders older than this one. Offsetting by page
   * number gets slower the deeper you scroll and can repeat a row when a new order
   * is created between pages, so the list asks for "after this" instead.
   */
  after?: { createdAt: string; id: number } | null;
}

/* ------------------------------------------------------------------ */
/* Dine-in tables, merge and split (Phase 3)                           */
/* ------------------------------------------------------------------ */

export interface DiningTable {
  id: number;
  name: string;
  seats: number;
  area: string;
  active: boolean;
  /** The open dine-in order sitting here, if any. */
  orderId: number | null;
  orderNo: string | null;
  /** What that order is worth so far, in paisa. 0 when the table is free. */
  openTotal: number;
  /** Total of everything ever rung up at this table, for the owner's report. */
  lifetimeSales: number;
}

/* ------------------------------------------------------------------ */
/* Order amendments (Phase 3)                                          */
/* ------------------------------------------------------------------ */

/** What a bill looked like at one point in its life, for the history view. */
export interface AmendmentSnapshot {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  items: Array<{ itemId: number; name: string; qty: number; price: number; lineTotal: number }>;
}

export interface OrderAmendment {
  version: number;
  reason: string;
  before: AmendmentSnapshot;
  after: AmendmentSnapshot;
  changedByName: string;
  createdAt: string;
}

export interface AmendOrderInput {
  id: number;
  /** Why the bill is being changed. Mandatory: it is the audit trail. */
  reason: string;
  /** The complete new set of lines. Replaces what was there. */
  items: Array<{ itemId: number; qty: number; notes: string }>;
  discount: number;
  /** Set when the new discount needs a manager's approval. */
  approvedBy?: number | null;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  waiterId?: number | null;
  notes?: string;
}

export interface MergeResult {
  order: OrderDetail;
  /** The order numbers that were absorbed, oldest first. */
  mergedOrderNos: string[];
}

export interface SplitResult {
  /** The bill the lines were taken from. */
  source: OrderDetail;
  /** The new bill holding the moved lines. */
  target: OrderDetail;
}

/* ------------------------------------------------------------------ */
/* Kitchen tickets and tokens (feature 3.D)                            */
/* ------------------------------------------------------------------ */

export interface KOTItem {
  /** order_items.id — lets a reprint target specific lines later. */
  id: number;
  name: string;
  qty: number;
  notes: string;
}

/**
 * A kitchen ticket. Deliberately has no prices: the kitchen works from what to
 * cook, not from what the customer paid.
 */
export interface KOT {
  orderId: number;
  orderNo: string;
  tokenNo: number | null;
  type: OrderType;
  status: OrderStatus;
  customerName: string;
  waiterName: string | null;
  notes: string;
  createdAt: string;
  items: KOTItem[];
  /** 0 means this is the first print; anything else is a reprint. */
  printCount: number;
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
  /** Print without the system dialog. Off means the cashier picks a printer each time. */
  printerSilent: boolean;
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
  /** Replaces the lines of a saved bill, keeping a full snapshot of both versions. */
  amend(input: AmendOrderInput): Promise<ApiResult<OrderDetail>>;
  /** The edit history, oldest first. */
  amendments(id: number): Promise<ApiResult<OrderAmendment[]>>;
  updateStatus(id: number, status: OrderStatus): Promise<ApiResult<OrderSummary>>;
  cancel(id: number): Promise<ApiResult<OrderSummary>>;
  invoice(id: number): Promise<ApiResult<InvoiceData>>;
  markPrinted(id: number): Promise<ApiResult<OrderDetail>>;
  print(id: number, paper: '80mm' | 'a4'): Promise<ApiResult<{ printed: boolean }>>;
  savePdf(id: number, paper: '80mm' | 'a4'): Promise<ApiResult<{ path: string | null }>>;
}

export interface PaymentsApi {
  addPayment(input: AddPaymentInput): Promise<ApiResult<Payment>>;
  voidPayment(id: number, reason: string): Promise<ApiResult<Payment>>;
  listByOrder(orderId: number): Promise<ApiResult<Payment[]>>;
  udhaarList(): Promise<ApiResult<UdhaarAccount[]>>;
  udhaarLedger(customerId: number): Promise<ApiResult<CustomerLedgerEntry[]>>;
  settleUdhaar(input: {
    customerId: number;
    method: PaymentMethod;
    amount: number;
    reference: string;
    orderId: number | null;
  }): Promise<ApiResult<CustomerLedgerEntry>>;
}

export interface DiscountsApi {
  rules(): Promise<ApiResult<DiscountRule[]>>;
  saveRule(input: DiscountRule): Promise<ApiResult<DiscountRule>>;
  validate(input: {
    subtotal: number;
    percentX100: number;
    amount: number;
    promoCode: string;
  }): Promise<ApiResult<DiscountDecision>>;
  approve(input: {
    orderId: number | null;
    percentX100: number;
    amount: number;
    reason: string;
    username: string;
    password: string;
  }): Promise<ApiResult<DiscountApproval>>;
  listPromos(): Promise<ApiResult<PromoCode[]>>;
  savePromo(input: Omit<PromoCode, 'id' | 'uses'> & { id?: number }): Promise<ApiResult<PromoCode>>;
  deletePromo(id: number): Promise<ApiResult<null>>;
}

export interface TablesApi {
  list(): Promise<ApiResult<DiningTable[]>>;
  save(input: {
    id?: number;
    name: string;
    seats: number;
    area: string;
    active: boolean;
  }): Promise<ApiResult<DiningTable>>;
  remove(id: number): Promise<ApiResult<null>>;
  /** Merges sourceId into targetId; both must be open dine-in orders with no money taken. */
  merge(input: { sourceId: number; targetId: number }): Promise<ApiResult<MergeResult>>;
  /** Moves the given order lines onto a brand new bill. */
  split(input: {
    orderId: number;
    itemIds: number[];
    moveTable: boolean;
  }): Promise<ApiResult<SplitResult>>;
}

export interface KotApi {
  /** The ticket for one order. Read-only; no side effects. */
  ticket(orderId: number): Promise<ApiResult<KOT>>;
  /** Renders and prints the kitchen ticket; records the print in kot_prints. */
  print(orderId: number): Promise<ApiResult<{ printed: boolean }>>;
}

export interface ShiftsApi {
  current(): Promise<ApiResult<Shift | null>>;
  open(openingCash: number): Promise<ApiResult<Shift>>;
  close(input: { countedCash: number; notes: string }): Promise<ApiResult<ShiftReport>>;
  report(shiftId?: number): Promise<ApiResult<ShiftReport>>;
  list(limit?: number): Promise<ApiResult<Shift[]>>;
  addCashMovement(input: {
    kind: CashMovementKind;
    amount: number;
    reason: string;
  }): Promise<ApiResult<CashMovement>>;
  print(shiftId: number, paper: '80mm' | 'a4'): Promise<ApiResult<{ printed: boolean }>>;
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
  payments: PaymentsApi;
  shifts: ShiftsApi;
  discounts: DiscountsApi;
  kot: KotApi;
  tables: TablesApi;
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

  paymentAdd: 'payment:add',
  paymentVoid: 'payment:void',
  paymentListByOrder: 'payment:list-by-order',
  udhaarList: 'udhaar:list',
  udhaarSettle: 'udhaar:settle',
  udhaarLedger: 'udhaar:ledger',

  shiftCurrent: 'shift:current',
  shiftOpen: 'shift:open',
  shiftClose: 'shift:close',
  shiftReport: 'shift:x-report',
  shiftList: 'shift:list',
  shiftCashMovement: 'shift:cash-movement',
  shiftPrint: 'shift:print',

  discountRules: 'discount:rules',
  discountSaveRule: 'discount:save-rule',
  discountValidate: 'discount:validate',
  discountApprove: 'discount:approve',
  promoList: 'promo:list',
  promoSave: 'promo:save',
  promoDelete: 'promo:delete',

  // Kitchen tickets (feature 3.D)
  kotTicket: 'kot:ticket',
  kotPrint: 'kot:print',

  // Dine-in tables, merge and split (Phase 3)
  tablesList: 'tables:list',
  tableSave: 'table:save',
  tableDelete: 'table:delete',
  orderMerge: 'order:merge',
  orderSplit: 'order:split',

  // Order amendments (Phase 3)
  orderAmend: 'order:amend',
  orderAmendments: 'order:amendments',

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
