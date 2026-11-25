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
  | 'tables'
  // Roadmap Phase 4 — stock, recipes, costing, shop expenses.
  | 'stock'
  | 'expenses';

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
  | 'tables:write'
  // Phase 4.A/4.B — stock, recipes, purchases and shop expenses.
  | 'inventory:read'
  | 'inventory:write'
  | 'purchases:write'
  | 'purchases:void'
  | 'stock:adjust'
  | 'recipes:write'
  | 'expenses:read'
  | 'expenses:write'
  | 'expenses:void'
  // The owner's private numbers: cost, margin and profit.
  | 'costs:read';

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
  /** Set when the money moved because of a stock purchase (4.B). */
  refPurchaseId: number | null;
  /** Set when the money moved because of a shop expense (4.F). */
  refExpenseId: number | null;
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
  /** Purchases paid from the drawer during this shift. */
  expenses: number;
  /** Cash returned to the drawer by void purchases (already netted out of the two figures above). */
  purchaseReversals: number;
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
  /** What the line cost to make, frozen at sale time. Null = no cost data (old bill or no recipe). */
  costTotal: number | null;
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
  /** Sum of the frozen line costs. Null when any line has no cost data. */
  costTotal: number | null;
  /** Net sales (after discount, ex-tax) minus costTotal. Null when cost is unknown. */
  profit: number | null;
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

  /**
   * Phase 4 cards. Each is optional in the type only because a database that has
   * not run the 015–021 migrations yet must still render the dashboard; the
   * service fills them whenever the tables exist.
   */
  /** How much of the day could be costed, and what it cost. Null = no bills yet. */
  todayProfit: {
    knownNetSales: number;
    cogs: number;
    grossProfit: number;
    unpricedBills: number;
  } | null;
  /** Money on the shelf, and how many ingredients have fallen below reorder. */
  stock: { value: number; lowStockCount: number; outOfStockCount: number } | null;
  /** Operating cost booked today (4.E). */
  todayExpenses: number;
  /** Active menu items with no recipe, so their profit is unknown. */
  missingRecipes: number;
  /**
   * Monthly bills due now or already late (4.E2). Read-only: the dashboard says the
   * rent is due, the Expenses page books it — a screen that opens on the counter
   * must never move money by itself.
   */
  billsDue: Array<{
    id: number;
    name: string;
    dueDate: string;
    daysUntilDue: number;
    typicalAmount: number;
    overdue: boolean;
  }>;
  /** Ingredient price rises over the last 30 days, worst first. */
  priceChecks: Array<{
    ingredientId: number;
    name: string;
    baseUnit: BaseUnit;
    oldCostMilli: number;
    newCostMilli: number;
    changeX100: number;
  }>;
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
/* Stock: ingredients, suppliers and purchases (Roadmap 4.A / 4.B)     */
/* ------------------------------------------------------------------ */

/** The smallest unit the app counts an ingredient in. Quantities are integers. */
export type BaseUnit = 'g' | 'ml' | 'pcs';

/**
 * Unit cost precision. A gram of chicken costs about 70 paisa, but a gram of salt
 * costs a fraction of one, so unit costs are stored as MILLI-PAISA per base unit
 * (paisa × 1000). Values at a paisa boundary round once, when they are written.
 */
export const MILLI_PAISA = 1000;

export type StockMovementKind =
  | 'opening'
  | 'purchase'
  | 'purchase_void'
  | 'sale'
  | 'sale_reversal'
  | 'wastage'
  | 'adjustment'
  | 'supplier_return'
  | 'stock_count'
  | 'sub_recipe_make'
  | 'sub_recipe_unmake';

export type PurchaseStatus = 'posted' | 'void';

/** Why stock was thrown away. Free text stays in `reason` for the detail. */
export type WastageReason = 'spoiled' | 'dropped' | 'expired' | 'staff_meal' | 'test' | 'other';

export const WASTAGE_REASON_LABELS: Record<WastageReason, string> = {
  spoiled: 'Spoiled / went bad',
  dropped: 'Dropped or spilled',
  expired: 'Expired',
  staff_meal: 'Staff meal',
  test: 'Test / trial batch',
  other: 'Other',
};

export interface Supplier {
  id: number;
  name: string;
  phone: string;
  address: string;
  notes: string;
  active: boolean;
  /** Credit purchases minus what has been paid to this supplier. */
  balance: number;
}

export interface SupplierInput {
  id?: number;
  name: string;
  phone: string;
  address: string;
  notes: string;
  active: boolean;
}

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  baseUnit: BaseUnit;
  /** What the supplier sells in: kg, litre, dozen, packet… free text. */
  purchaseUnit: string;
  /** How many base units one purchase unit holds (1 kg = 1000 g). */
  unitsPerPurchase: number;
  /** Low-stock alert level, in base units. */
  reorderLevel: number;
  /** Cached total of the stock ledger. Never edited by a screen. */
  qtyOnHand: number;
  /** Moving weighted average, milli-paisa per base unit. */
  avgCostMilli: number;
  /** Price of the most recent posted purchase, milli-paisa per base unit. */
  lastCostMilli: number;
  supplierId: number | null;
  supplierName: string | null;
  active: boolean;
  /** qtyOnHand × avgCostMilli rounded to paisa. */
  stockValue: number;
  lowStock: boolean;
  /** Used by at least one recipe, so it cannot be deleted, only deactivated. */
  usedInRecipes: number;
  /**
   * Base units one batch produces (Roadmap 4.I). 0 = bought from a supplier;
   * > 0 = made in-house, and its cost comes from its batch recipe.
   */
  batchYieldBase: number;
}

export interface IngredientInput {
  id?: number;
  name: string;
  category: string;
  baseUnit: BaseUnit;
  purchaseUnit: string;
  unitsPerPurchase: number;
  reorderLevel: number;
  supplierId: number | null;
  active: boolean;
}

/** One row of the starter catalogue the owner can load on first use. */
export interface StarterIngredient {
  name: string;
  category: string;
  baseUnit: BaseUnit;
  purchaseUnit: string;
  unitsPerPurchase: number;
  /** Suggested low-stock level in base units; the owner can change it after loading. */
  reorderLevel: number;
}

export interface StarterCatalogueGroup {
  category: string;
  /** Items inherit the group's category, so it is not repeated on every row. */
  items: Array<Omit<StarterIngredient, 'category'>>;
}

export interface LoadStarterListInput {
  /** Names chosen by the owner. Names already in the list are skipped. */
  names: string[];
}

export interface LoadStarterListResult {
  created: number;
  skipped: number;
}

export interface StockOverview {
  ingredients: Ingredient[];
  totalValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  ingredientCount: number;
}

export interface PurchaseLine {
  id: number;
  purchaseId: number;
  ingredientId: number;
  ingredientName: string;
  baseUnit: BaseUnit;
  /** Quantity in the purchase unit, ×1000 (2.5 kg = 2500). */
  qtyPurchaseMilli: number;
  /** Quantity converted to base units. */
  qtyBase: number;
  /** Price per purchase unit, in paisa (Rs 710/kg = 71,000). */
  unitPrice: number;
  /** Landed unit cost in milli-paisa per base unit, after extra charges. */
  landedCostMilli: number;
  lineTotal: number;
}

export interface PurchaseLineInput {
  ingredientId: number;
  /** Quantity in the purchase unit, ×1000 so 2.5 kg is 2500. */
  qtyPurchaseMilli: number;
  unitPrice: number;
}

export interface Purchase {
  id: number;
  purchaseNo: string;
  supplierId: number | null;
  supplierName: string | null;
  billNo: string;
  purchasedOn: string;
  subtotal: number;
  extraCharges: number;
  total: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  status: PurchaseStatus;
  voidReason: string;
  voidedAt: string | null;
  notes: string;
  createdByName: string;
  createdAt: string;
  lines: PurchaseLine[];
}

export interface NewPurchaseInput {
  supplierId: number | null;
  billNo: string;
  purchasedOn: string;
  extraCharges: number;
  paidAmount: number;
  paymentMethod: PaymentMethod;
  notes: string;
  lines: PurchaseLineInput[];
}

/** Opening stock: what is on the shelf on go-live day, at what cost. */
export interface OpeningStockInput {
  lines: Array<{ ingredientId: number; qtyBase: number; unitCostMilli: number }>;
}

export interface StockMovement {
  id: number;
  ingredientId: number;
  kind: StockMovementKind;
  /** Signed: positive adds stock, negative removes it. */
  qty: number;
  unitCostMilli: number;
  /** paisa value of the movement (qty × unit cost). */
  value: number;
  reason: string;
  refPurchaseId: number | null;
  refOrderId: number | null;
  /** Only on wastage rows: the reason code, for the wastage report (4.F). */
  wastageReason: WastageReason | null;
  createdByName: string;
  createdAt: string;
}

export interface IngredientDetail {
  ingredient: Ingredient;
  movements: StockMovement[];
  /** Purchases of this ingredient, newest first — the price history. */
  priceHistory: Array<{
    purchasedOn: string;
    supplierName: string | null;
    purchaseNo: string;
    qtyPurchaseMilli: number;
    purchaseUnit: string;
    unitPrice: number;
    landedCostMilli: number;
  }>;
  usedInItems: Array<{ itemId: number; itemName: string; qtyBase: number }>;
}

/* ------------------------------------------------------------------ */
/* Wastage, adjustments and stock counts (4.F)                         */
/* ------------------------------------------------------------------ */

export interface StockCount {
  id: number;
  countNo: string;
  countedOn: string;
  /** Sum of |variance| × average cost, in paisa, frozen at count time. */
  varianceValue: number;
  lineCount: number;
  notes: string;
  createdByName: string;
  createdAt: string;
}

export interface StockCountLine {
  id: number;
  ingredientId: number;
  ingredientName: string;
  baseUnit: BaseUnit;
  /** What the ledger said. */
  bookQty: number;
  /** What the owner counted. */
  countedQty: number;
  /** counted − book. */
  variance: number;
  unitCostMilli: number;
  varianceValue: number;
}

export interface StockCountDetail {
  count: StockCount;
  lines: StockCountLine[];
}

/** One row of the wastage report: a reason for one ingredient. */
export interface WastageRow {
  ingredientId: number;
  ingredientName: string;
  baseUnit: BaseUnit;
  reason: WastageReason;
  movements: number;
  /** Absolute base units lost. */
  qty: number;
  /** Money lost, in paisa. */
  value: number;
}

export interface WastageOverview {
  from: string;
  to: string;
  rows: WastageRow[];
  total: number;
  qty: number;
}

export interface WastageInput {
  ingredientId: number;
  /** Positive base units to throw away; the service makes it negative. */
  qtyBase: number;
  reason: WastageReason;
  notes: string;
  /** Calendar day it happened (YYYY-MM-DD). Defaults to today server-side. */
  happenedOn: string;
}

/**
 * Returning stock to the supplier (4.F).
 *
 * Not a void: the bill stands because the rest of the delivery was kept, and the
 * supplier owes a credit for what went back. Not a wastage either — the food is not
 * lost, it left the shop on purpose. The ledger gets a `supplier_return` movement so
 * the stock leaves at the current average cost and the money can be claimed back.
 */
export interface SupplierReturnInput {
  ingredientId: number;
  /** Positive base units going back; the service makes it negative. */
  qtyBase: number;
  supplierId: number | null;
  /** Why it went back — damaged in transit, wrong item, short date. */
  reason: string;
  happenedOn: string;
}

export interface AdjustmentInput {
  ingredientId: number;
  /** Signed base units: positive finds stock, negative removes it. */
  qtyBase: number;
  reason: string;
}

export interface CountLineInput {
  ingredientId: number;
  countedQty: number;
}

export interface StockCountInput {
  countedOn: string;
  notes: string;
  lines: CountLineInput[];
}

/* -------------------------- sub-recipes (4.I) -------------------------- */

/**
 * One component of a house-made ingredient's batch recipe.
 *
 * `lineCost` uses the component's live average cost, so opening the screen on a
 * different day gives a different — correct — answer. That is the point: "what
 * does my mayo cost me today?" moves with the price of oil.
 */
export interface BatchRecipeLine {
  id: number;
  componentId: number;
  componentName: string;
  baseUnit: BaseUnit;
  /** Base units of the component in ONE batch. */
  qtyBase: number;
  wastePercentX100: number;
  /** Cost per base unit at the moment the recipe was read. */
  unitCostMilli: number;
  /** qty × unit cost, in paisa. */
  lineCost: number;
  /** True when the component is itself made in-house — refused by the service. */
  isMade: boolean;
  onHand: number;
}

export interface BatchRecipe {
  ingredientId: number;
  ingredientName: string;
  baseUnit: BaseUnit;
  /** Base units one batch produces. 0 = bought. */
  batchYieldBase: number;
  lines: BatchRecipeLine[];
  /** Cost of one batch's components, in paisa. */
  batchCost: number;
  /** Derived: batchCost ÷ yield. Null when the yield is not set yet. */
  unitCostMilli: number | null;
  isMade: boolean;
  usedInRecipes: boolean;
}

export interface SaveBatchRecipeInput {
  ingredientId: number;
  /** Base units one batch produces. 0 turns the ingredient back into a bought one. */
  batchYieldBase: number;
  lines: Array<{ componentId: number; qtyBase: number; wastePercentX100: number }>;
}

/** One row of the "House-made" list. */
export interface MadeIngredientRow {
  ingredientId: number;
  name: string;
  baseUnit: BaseUnit;
  qtyOnHand: number;
  batchYieldBase: number;
  lineCount: number;
  batchCost: number;
  /** What one base unit costs to make. */
  madeUnitCostMilli: number;
  /**
   * Bought price − made price. Positive means making it is cheaper than buying
   * it. Null when the ingredient has never been bought, so there is nothing to
   * compare against.
   */
  comparedToBoughtMilli: number | null;
  /** Whole batches the current shelf can supply. */
  canMakeBatches: number;
}

/** A batch that was actually made — a stock document, frozen at its cost. */
export interface MadeBatch {
  id: number;
  batchNo: string;
  ingredientId: number;
  ingredientName: string;
  baseUnit: BaseUnit;
  qtyBase: number;
  totalCost: number;
  unitCostMilli: number;
  madeOn: string;
  notes: string;
  createdByName: string;
  lines: Array<{
    id: number;
    componentId: number;
    componentName: string;
    baseUnit: BaseUnit;
    qtyBase: number;
    unitCostMilli: number;
    cost: number;
  }>;
}

export interface SubRecipeOverview {
  rows: MadeIngredientRow[];
  madeCount: number;
  /** Made ingredients with no components yet — their cost cannot be worked out. */
  missingRecipeCount: number;
  recentBatches: Array<{
    id: number;
    batchNo: string;
    ingredientId: number;
    ingredientName: string;
    baseUnit: BaseUnit;
    qtyBase: number;
    totalCost: number;
    unitCostMilli: number;
    madeOn: string;
    createdByName: string;
  }>;
}

export interface StockApi {
  overview(): Promise<ApiResult<StockOverview>>;
  ingredients(): Promise<ApiResult<Ingredient[]>>;
  ingredient(input: { id: number }): Promise<ApiResult<IngredientDetail>>;
  saveIngredient(input: IngredientInput): Promise<ApiResult<Ingredient>>;
  deleteIngredient(id: number): Promise<ApiResult<null>>;
  starterCatalogue(): Promise<ApiResult<StarterCatalogueGroup[]>>;
  subRecipes(): Promise<ApiResult<SubRecipeOverview>>;
  subRecipe(input: { ingredientId: number }): Promise<ApiResult<BatchRecipe>>;
  saveSubRecipe(input: SaveBatchRecipeInput): Promise<ApiResult<BatchRecipe>>;
  /** Takes the components off the shelf and puts the product on, at a derived cost. */
  makeSubRecipeBatch(input: {
    ingredientId: number;
    batches: number;
    madeOn?: string;
    notes?: string;
  }): Promise<ApiResult<MadeBatch>>;
  subRecipeBatches(input: { ingredientId: number }): Promise<ApiResult<MadeBatch[]>>;
  loadStarterList(input: LoadStarterListInput): Promise<ApiResult<LoadStarterListResult>>;
  suppliers(): Promise<ApiResult<Supplier[]>>;
  saveSupplier(input: SupplierInput): Promise<ApiResult<Supplier>>;
  deleteSupplier(id: number): Promise<ApiResult<null>>;
  purchases(input: { fromDate: string; toDate: string; limit: number }): Promise<ApiResult<Purchase[]>>;
  purchase(input: { id: number }): Promise<ApiResult<Purchase>>;
  createPurchase(input: NewPurchaseInput): Promise<ApiResult<Purchase>>;
  voidPurchase(input: { id: number; reason: string }): Promise<ApiResult<Purchase>>;
  openingStock(input: OpeningStockInput): Promise<ApiResult<{ applied: number }>>;
  movements(input: { ingredientId: number; limit: number }): Promise<ApiResult<StockMovement[]>>;

  /* 4.F — wastage, adjustments and counts */
  recordWastage(input: WastageInput): Promise<ApiResult<StockMovement>>;
  supplierReturn(input: SupplierReturnInput): Promise<ApiResult<StockMovement>>;
  adjust(input: AdjustmentInput): Promise<ApiResult<StockMovement>>;
  wastageReport(range: { fromDate: string; toDate: string }): Promise<ApiResult<WastageOverview>>;
  counts(): Promise<ApiResult<StockCount[]>>;
  count(input: { id: number }): Promise<ApiResult<StockCountDetail>>;
  saveCount(input: StockCountInput): Promise<ApiResult<StockCountDetail>>;
}

/* ------------------------------------------------------------------ */
/* Recipes and costing (Roadmap 4.C)                                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Shop expenses (4.F)                                                 */
/* ------------------------------------------------------------------ */

export interface ExpenseCategory {
  id: number;
  name: string;
  sortOrder: number;
  /** 'Other' ships with the app and cannot be removed. */
  isSystem: boolean;
  active: boolean;
  /** Active expenses filed under it, for the "in use" column and delete guard. */
  expenseCount: number;
  /** Total of those expenses, in paisa. */
  totalAmount: number;
}

export type ExpensePaidFrom = 'cash' | 'bank' | 'other';

export interface Expense {
  id: number;
  expenseNo: string;
  categoryId: number;
  categoryName: string;
  /** Calendar day (YYYY-MM-DD). */
  spentOn: string;
  amount: number;
  paidFrom: ExpensePaidFrom;
  payee: string;
  notes: string;
  /** The open shift the money left, or null when it came from outside the till. */
  shiftId: number | null;
  status: 'active' | 'void';
  voidReason: string;
  voidedAt: string | null;
  voidedByName: string | null;
  createdBy: number;
  createdByName: string;
  createdAt: string;
}

export interface ExpenseSummaryRow {
  categoryName: string;
  count: number;
  total: number;
}

export interface ExpenseOverview {
  from: string;
  to: string;
  expenses: Expense[];
  categories: ExpenseCategory[];
  summary: ExpenseSummaryRow[];
  total: number;
  /** True when the drawer shift is open, so a cash expense can leave the till. */
  drawerOpen: boolean;
}

export interface ExpenseInput {
  categoryId: number;
  spentOn: string;
  amount: number;
  paidFrom: ExpensePaidFrom;
  payee: string;
  notes: string;
}

/* ------------------------- recurring bills (4.E2) ------------------------ */

export interface RecurringBill {
  id: number;
  categoryId: number;
  categoryName: string;
  name: string;
  /** Typical amount in paisa; 0 means "unknown, ask me". Never posts by itself. */
  typicalAmount: number;
  /** Day of the month it is due (1–31). In a short month, 31 means the last day. */
  dueDay: number;
  /** Days before the due date the dashboard starts warning. */
  remindDays: number;
  payee: string;
  paidFrom: ExpensePaidFrom;
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringBillPayment {
  id: number;
  templateId: number;
  /** `YYYY-MM` — the month this settles. */
  period: string;
  /** The expense it created, so the money is counted exactly once. */
  expenseId: number | null;
  amount: number;
  status: 'paid' | 'skipped';
  note: string;
  createdAt: string;
}

/**
 * One bill in one month, resolved against today.
 *
 * `state` is the whole point of the screen:
 *   * `paid`    — settled this month,
 *   * `skipped` — the owner decided not to pay this month,
 *   * `due`     — the due date is within `remindDays`,
 *   * `overdue` — the due date has passed and nothing was recorded,
 *   * `upcoming`— later this month.
 */
export interface RecurringBillStatus {
  bill: RecurringBill;
  /** The month being described, `YYYY-MM`. */
  period: string;
  /** The date it is due in that month, `YYYY-MM-DD`. */
  dueDate: string;
  /** Days from today to the due date; negative once it has passed. */
  daysUntilDue: number;
  state: 'paid' | 'skipped' | 'due' | 'overdue' | 'upcoming';
  payment: RecurringBillPayment | null;
}

export interface RecurringBillsOverview {
  /** The month these statuses describe. */
  period: string;
  rows: RecurringBillStatus[];
  /** Bills that need attention: due today/soon or overdue, and unpaid. */
  needsAttention: number;
  /** What those outstanding bills typically come to, in paisa. */
  outstandingTypical: number;
}

export interface RecurringBillInput {
  id?: number;
  categoryId: number;
  name: string;
  typicalAmount: number;
  dueDay: number;
  remindDays: number;
  payee: string;
  paidFrom: ExpensePaidFrom;
  notes: string;
  active: boolean;
}

export interface ExpenseApi {
  overview(input: {
    from: string;
    to: string;
    status?: 'active' | 'void' | 'all';
  }): Promise<ApiResult<ExpenseOverview>>;
  save(input: ExpenseInput): Promise<ApiResult<Expense>>;
  void(input: { id: number; reason: string }): Promise<ApiResult<Expense>>;
  saveCategory(input: {
    id?: number;
    name: string;
    sortOrder: number;
  }): Promise<ApiResult<ExpenseCategory>>;
  deleteCategory(input: { id: number }): Promise<ApiResult<null>>;
  recurringBills(period?: string): Promise<ApiResult<RecurringBillsOverview>>;
  saveRecurringBill(input: RecurringBillInput): Promise<ApiResult<RecurringBill>>;
  deleteRecurringBill(input: { id: number }): Promise<ApiResult<null>>;
  /** Records "paid" (creating a real expense) or "skipped" for one month. */
  settleRecurringBill(input: {
    templateId: number;
    period: string;
    status: 'paid' | 'skipped';
    amount: number;
    note: string;
  }): Promise<ApiResult<RecurringBillStatus>>;
  /** Undoes a settlement, voiding the expense it created. */
  unsettleRecurringBill(input: { templateId: number; period: string }): Promise<ApiResult<null>>;
}

export interface RecipeLine {
  id: number;
  ingredientId: number;
  ingredientName: string;
  baseUnit: BaseUnit;
  /** Quantity per one serving, in the ingredient's base unit. */
  qtyBase: number;
  /** Trim/cooking-loss allowance, percent ×100 (5% = 500). */
  wastePercentX100: number;
  /** Current average cost of the line, milli-paisa per base unit. */
  unitCostMilli: number;
  /** qty × unit cost, rounded to paisa. */
  lineCost: number;
}

export interface Recipe {
  itemId: number;
  itemName: string;
  /** Selling price the owner chose, integer paisa. */
  price: number;
  lines: RecipeLine[];
  /** Sum of the lines, in paisa. 0 when there are no lines. */
  costTotal: number;
  /** price − costTotal. Null when there is no recipe (cost unknown, never zero). */
  profit: number | null;
  /** profit ÷ price, percent ×100 (5870 = 58.70%). Null without a recipe. */
  marginPercentX100: number | null;
  /** Recipe exists? False means "cost unknown", not "free". */
  hasRecipe: boolean;
}

export interface MenuCostRow {
  itemId: number;
  itemName: string;
  categoryName: string;
  price: number;
  costTotal: number;
  profit: number | null;
  marginPercentX100: number | null;
  hasRecipe: boolean;
  /** Smallest stock ÷ recipe quantity across the lines; null without a recipe. */
  canMake: number | null;
  /** Below the margin floor in settings. */
  belowTarget: boolean;
}

export interface MenuCostOverview {
  rows: MenuCostRow[];
  marginAlertPercent: number;
  missingRecipeCount: number;
  belowTargetCount: number;
}

export interface SaveRecipeInput {
  itemId: number;
  lines: Array<{ ingredientId: number; qtyBase: number; wastePercentX100: number }>;
}

export interface PriceSuggestionInput {
  /** Target margin, percent ×100 (5500 = 55%). */
  marginPercentX100: number;
  /** Cost of one serving in paisa. */
  costTotal: number;
}

export interface RecipeApi {
  menuCosts(): Promise<ApiResult<MenuCostOverview>>;
  recipe(itemId: number): Promise<ApiResult<Recipe>>;
  saveRecipe(input: SaveRecipeInput): Promise<ApiResult<Recipe>>;
  suggestPrice(input: PriceSuggestionInput): Promise<ApiResult<{ price: number }>>;
  setItemPrice(input: { itemId: number; price: number }): Promise<ApiResult<MenuCostRow>>;
  stockSettings(): Promise<ApiResult<StockSettings>>;
  saveStockSettings(input: StockSettings): Promise<ApiResult<StockSettings>>;
}

export interface StockSettings {
  /** Sell below zero stock (true) or block the sale (false). */
  allowNegativeStock: boolean;
  /** Mark items sold out automatically when they cannot be made. */
  autoSoldOut: boolean;
  /** Margin floor, percent ×100. Items below it are flagged. */
  marginAlertPercentX100: number;
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

/* ------------------------------------------------------------------ */
/* Profit & loss (4.G)                                                 */
/* ------------------------------------------------------------------ */

export interface ProfitAndLoss {
  from: string;
  to: string;
  orderCount: number;
  /** Food sold before discounts, ex tax. */
  subtotal: number;
  discount: number;
  /** Net sales = subtotal − discount. The revenue the shop actually earned. */
  netSales: number;
  /**
   * Net sales of the bills that COULD be costed. `cogs` and `grossProfit` are built
   * from this figure, so they are a like-for-like pair and never mix in a bill whose
   * cost is unknown.
   */
  knownNetSales: number;
  /**
   * Net sales of the bills that could NOT be costed (saved before their item had a
   * recipe). Named separately so the profit is honest instead of being zeroed for
   * the whole period.
   */
  unknownNetSales: number;
  /** How many bills carried an unpriced line. */
  unpricedBills: number;
  tax: number;
  /** Taken at the till, including tax. */
  totalCollected: number;
  /**
   * Cost of the food on the bills that could be costed, from the frozen per-line
   * snapshot. Never null: the honest split lives in `unknownNetSales` instead.
   */
  cogs: number;
  /** How many sold lines had no cost, so the screen can explain the gap. */
  linesWithoutCost: number;
  /** knownNetSales − cogs. */
  grossProfit: number;

  /*
   * Operating costs, in four labelled lines rather than one total.
   *
   * A shop types rent into Expenses but pays wages somewhere else entirely, and the
   * plan's own rule (§9.3) is that the same money must never be counted twice. So
   * `shopExpenses` means ONLY the rows typed on the Expenses page, and salaries and
   * vehicle costs are read from their own tables. If the owner also types "salaries"
   * as an expense, nothing breaks — that is a separate row and both are real until
   * they stop duplicating it.
   */
  shopExpenses: number;
  /** Salaries paid in the window, from `salary_payments.paid_on`. */
  salaries: number;
  /** Fuel, maintenance and repairs in the window, from `vehicle_expenses`. */
  vehicleCosts: number;
  /** shopExpenses + salaries + vehicleCosts — everything net profit subtracts. */
  operatingExpenses: number;
  /** Salaries already counted inside shopExpenses (0 when none). */
  wastageValue: number;
  wastageQty: number;
  /** grossProfit − operatingExpenses. */
  netProfit: number;
  /** Cancelled bills, listed so a void never disappears from the hisab. */
  cancelledCount: number;
  cancelledValue: number;
  expensesByCategory: ExpenseSummaryRow[];
  /** Named salary payouts in the window, so the owner can see who was paid. */
  salariesByPerson: Array<{ name: string; personType: string; total: number; count: number }>;
  /** Vehicle spend split by fuel / maintenance / repair / other. */
  vehicleByType: Array<{ type: string; total: number }>;
}

/* ------------------- 4.G reports: margin, stock, purchases ---------------- */

/**
 * One menu item's real profitability (4.G).
 *
 * `revenue` and `cost` come from the frozen snapshot on the sold line, so this
 * table never disagrees with the P&L above it. A line sold before the item had a
 * recipe has no cost — `unpricedQty` / `unpricedRevenue` say so rather than
 * pretending the food was free.
 */
export interface ItemProfitRow {
  itemId: number | null;
  name: string;
  qty: number;
  revenue: number;
  /** Revenue from lines that carried a cost snapshot. */
  pricedRevenue: number;
  cost: number;
  /** pricedRevenue − cost. */
  profit: number;
  /**
   * Profit as a percentage of pricedRevenue, ×100 (3550 = 35.50%). NULL when no
   * line had a cost, so the screen can print "—" instead of a fake 0%.
   */
  marginX100: number | null;
  /** Quantity and revenue of sales that could not be costed. */
  unpricedQty: number;
  unpricedRevenue: number;
  /** True when the item has a recipe now, whether or not these lines had one. */
  hasRecipe: boolean;
  /**
   * Why some of this item's revenue could not be priced:
   *  * `no_recipe` — it has none today, so it needs one;
   *  * `sold_before_recipe` — the recipe was added after these bills were saved, so
   *    nothing is wrong now and only an amended bill can price the old lines;
   *  * null — every line was costed.
   */
  unpricedReason: 'no_recipe' | 'sold_before_recipe' | null;
}

/** What is on the shelf and what it is worth (4.G). */
export interface StockValueRow {
  ingredientId: number;
  name: string;
  category: string;
  baseUnit: BaseUnit;
  purchaseUnit: string;
  unitsPerPurchase: number;
  qtyOnHand: number;
  avgCostMilli: number;
  /** qtyOnHand × avgCostMilli ÷ 1000, in paisa. */
  value: number;
  reorderLevel: number;
  lowStock: boolean;
  supplierName: string | null;
}

export interface StockValuation {
  rows: StockValueRow[];
  /** Total money sitting on the shelf, in paisa. */
  totalValue: number;
  /** Row count and how much of the total sits in the low-stock items. */
  itemCount: number;
  lowStockCount: number;
  lowStockValue: number;
  byCategory: Array<{ category: string; itemCount: number; value: number }>;
}

/** Purchases in a period — the money that left for stock (4.G). */
export interface PurchaseReportRow {
  purchaseId: number;
  purchaseNo: string;
  purchasedOn: string;
  supplierName: string | null;
  billNo: string;
  subtotal: number;
  extraCharges: number;
  total: number;
  paidAmount: number;
  outstanding: number;
  paymentMethod: PaymentMethod;
  status: PurchaseStatus;
  lineCount: number;
}

/**
 * One ingredient's buying history in a period (4.G).
 *
 * `firstCostMilli` → `lastCostMilli` is the price trend: the same packet cost more
 * this month than last, which quietly eats every margin that uses it.
 */
export interface PurchaseIngredientRow {
  ingredientId: number;
  name: string;
  baseUnit: BaseUnit;
  purchaseCount: number;
  qtyBase: number;
  spend: number;
  minCostMilli: number;
  maxCostMilli: number;
  firstCostMilli: number | null;
  lastCostMilli: number | null;
  /** last vs first, ×100 (1200 = the price rose 12%). Null when only one price. */
  changeX100: number | null;
}

export interface PurchaseReport {
  from: string;
  to: string;
  rows: PurchaseReportRow[];
  /** The same purchases seen from the ingredient side, dearest first. */
  byIngredient: PurchaseIngredientRow[];
  /** Cash actually paid, excluding voided bills. */
  paid: number;
  /** Total value of the purchases received, excluding voided bills. */
  received: number;
  /** What is still owed on credit purchases. */
  outstanding: number;
  voidedCount: number;
  voidedValue: number;
  bySupplier: Array<{ supplierName: string | null; count: number; total: number; outstanding: number }>;
}

/** The wastage report plus a per-day trend, so the owner sees a bad month (4.G). */
export interface WastageReportFull extends WastageOverview {
  byDay: Array<{ date: string; qty: number; value: number }>;
  /** The reason that cost the most this period, or null when nothing was wasted. */
  worstReason: { reason: WastageReason; value: number } | null;
}

/**
 * Costs the shop paid that were NOT typed on the Expenses page (4.G / §9.3).
 *
 * Salaries, vehicle running costs and wastage already live in their own tables.
 * The plan is explicit that the report must list them as separate read-only lines
 * rather than have the owner retype them — retyping is how the same money gets
 * counted twice. They are shown beside the expenses but never added into `total`.
 */
export interface CostLine {
  key: 'salaries' | 'vehicles' | 'wastage';
  label: string;
  total: number;
  /** How many records make up the total (payouts, fuel/repair entries, wasted lines). */
  count: number;
  /** Where it is entered, so the line says what to do about it. */
  source: string;
}

/** Expenses in a period, grouped for the report tab (4.G). */
export interface ExpenseReport {
  from: string;
  to: string;
  /** Expenses typed on the Expenses page only — never salaries or vehicle costs. */
  total: number;
  count: number;
  /** Salaries, vehicle costs and wastage, listed but not summed into `total`. */
  otherCosts: CostLine[];
  byCategory: ExpenseSummaryRow[];
  byPaidFrom: Array<{ paidFrom: ExpensePaidFrom; count: number; total: number }>;
  byDay: Array<{ date: string; count: number; total: number }>;
  voidedCount: number;
  voidedValue: number;
}

export interface ReportsApi {
  dashboard(): Promise<ApiResult<DashboardStats>>;
  profitAndLoss(range: DateRange): Promise<ApiResult<ProfitAndLoss>>;
  range(range: DateRange): Promise<ApiResult<ReportBundle>>;
  salarySummary(month: string): Promise<ApiResult<SalarySummaryRow[]>>;
  deliveryReport(range: DateRange): Promise<ApiResult<DeliveryReportRow[]>>;
  vehicleExpenses(range: DateRange): Promise<ApiResult<VehicleExpenseRow[]>>;
  itemProfit(range: DateRange): Promise<ApiResult<ItemProfitRow[]>>;
  stockValuation(): Promise<ApiResult<StockValuation>>;
  purchaseReport(range: DateRange): Promise<ApiResult<PurchaseReport>>;
  wastageReport(range: DateRange): Promise<ApiResult<WastageReportFull>>;
  expenseReport(range: DateRange): Promise<ApiResult<ExpenseReport>>;
  exportCsv(
    report: ExportReportName,
    range: DateRange,
  ): Promise<ApiResult<{ path: string | null }>>;
}

/** The reports that can be written to a CSV file. */
export type ExportReportName =
  | 'daily_sales'
  | 'top_items'
  | 'salary'
  | 'delivery'
  | 'vehicle_expenses'
  | 'profit'
  | 'item_profit'
  | 'stock_value'
  | 'purchases'
  | 'purchases_by_ingredient'
  | 'wastage'
  | 'expenses';

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
  stock: StockApi;
  recipes: RecipeApi;
  expenses: ExpenseApi;
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
  reportItemProfit: 'reports:item-profit',
  reportStockValuation: 'reports:stock-valuation',
  reportPurchases: 'reports:purchases',
  reportWastage: 'reports:wastage',
  reportExpenses: 'reports:expenses',

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

  // Stock, purchases and recipes (Roadmap Phase 4)
  stockOverview: 'stock:overview',
  ingredients: 'stock:ingredients',
  ingredientGet: 'stock:ingredient',
  ingredientSave: 'stock:ingredient-save',
  ingredientDelete: 'stock:ingredient-delete',
  starterCatalogue: 'stock:starter-catalogue',
  starterLoad: 'stock:starter-load',
  subRecipes: 'stock:sub-recipes',
  subRecipe: 'stock:sub-recipe',
  subRecipeSave: 'stock:sub-recipe-save',
  subRecipeMake: 'stock:sub-recipe-make',
  subRecipeBatches: 'stock:sub-recipe-batches',
  suppliers: 'stock:suppliers',
  supplierSave: 'stock:supplier-save',
  supplierDelete: 'stock:supplier-delete',
  purchases: 'stock:purchases',
  purchaseGet: 'stock:purchase',
  purchaseCreate: 'stock:purchase-create',
  purchaseVoid: 'stock:purchase-void',
  openingStock: 'stock:opening',
  stockMovements: 'stock:movements',

  // Wastage, adjustments and stock counts (4.F)
  stockWastage: 'stock:wastage',
  stockAdjust: 'stock:adjust',
  stockWastageReport: 'stock:wastage-report',
  stockSupplierReturn: 'stock:supplier-return',
  stockCounts: 'stock:counts',
  stockCountGet: 'stock:count',
  stockCountSave: 'stock:count-save',

  // Recipes and costing (4.C)
  menuCosts: 'recipes:menu-costs',
  recipeGet: 'recipes:get',
  recipeSave: 'recipes:save',
  recipeSuggestPrice: 'recipes:suggest-price',
  recipeSetItemPrice: 'recipes:set-item-price',
  stockSettingsGet: 'stock:settings',
  stockSettingsSave: 'stock:settings-save',

  // Shop expenses (4.F)
  reportProfit: 'reports:profit',
  expensesOverview: 'expenses:overview',
  expenseSave: 'expenses:save',
  expenseVoid: 'expenses:void',
  expenseCategorySave: 'expenses:category-save',
  expenseCategoryDelete: 'expenses:category-delete',
  recurringBills: 'expenses:recurring',
  recurringBillSave: 'expenses:recurring-save',
  recurringBillDelete: 'expenses:recurring-delete',
  recurringBillSettle: 'expenses:recurring-settle',
  recurringBillUnsettle: 'expenses:recurring-unsettle',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
