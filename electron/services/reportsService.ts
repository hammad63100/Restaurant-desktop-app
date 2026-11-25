import type {
  DailySalesRow,
  DashboardStats,
  DateRange,
  DeliveryReportRow,
  ExpenseReport,
  ItemProfitRow,
  ProfitAndLoss,
  PurchaseReport,
  ReportBundle,
  SalarySummaryRow,
  StockValuation,
  StockValueRow,
  TopItemRow,
  VehicleExpenseRow,
  WastageReason,
  WastageReportFull,
} from '../../src/types/api';
import type { OrdersRepository } from '../db/repositories/ordersRepository';
import type { CatalogRepository } from '../db/repositories/catalogRepository';
import type { StaffRepository } from '../db/repositories/staffRepository';
import type { VehiclesRepository } from '../db/repositories/vehiclesRepository';
import type { ExpensesRepository } from '../db/repositories/expensesRepository';
import type { InventoryRepository } from '../db/repositories/inventoryRepository';
import type { StockOpsRepository } from '../db/repositories/stockOpsRepository';
import type { RecurringBillsRepository } from '../db/repositories/recurringBillsRepository';
import type { StaffService } from './staffService';
import { daysUntil, monthEnd, monthStart, toSqlDate, todaySqlDate } from '../utils/datetime';
import { daysBetween, dueDateFor } from './expensesService';

/** Last `count` days ending today, filling gaps with zero rows. */
export function lastNDays(count: number): { fromDate: string; toDate: string; days: string[] } {
  const days: string[] = [];
  const today = new Date();

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    days.push(toSqlDate(date));
  }

  return {
    fromDate: days[0] ?? todaySqlDate(),
    toDate: days[days.length - 1] ?? todaySqlDate(),
    days,
  };
}

export function createReportsService(deps: {
  orders: OrdersRepository;
  catalog: CatalogRepository;
  staff: StaffRepository;
  vehicles: VehiclesRepository;
  staffService: StaffService;
  /** Shop expenses (4.E). Null while that migration has not run. */
  expenses?: ExpensesRepository;
  /** Stock, for valuation and purchases (4.G). Null before 4.A. */
  inventory?: InventoryRepository;
  /** Wastage read model (4.F). Null before 4.F. */
  stockOps?: StockOpsRepository;
  /** Active menu items without a recipe — the dashboard's "profit unknown" card. */
  missingRecipes?: () => number;
  /** Recurring bills (4.E2) — the dashboard's "rent is due" nudge. */
  recurring?: RecurringBillsRepository;
}) {
  const { orders, catalog, staff, vehicles, staffService, expenses, inventory, stockOps } = deps;
  const recurring = deps.recurring;

  /** `stockValue` is a cache-backed number; round the same way the shelf does. */
  const valueOf = (qtyOnHand: number, avgCostMilli: number): number =>
    Math.round((qtyOnHand * avgCostMilli) / 1000);

  function fillDaily(
    days: string[],
    rows: Array<{ date: string; orders: number; sales: number }>,
  ): DailySalesRow[] {
    const byDate = new Map(rows.map((row) => [row.date, row]));
    return days.map((date) => ({
      date,
      orders: byDate.get(date)?.orders ?? 0,
      sales: byDate.get(date)?.sales ?? 0,
    }));
  }

  return {
    dashboard(): DashboardStats {
      const today = todaySqlDate();
      const week = lastNDays(7);
      const month = today.slice(0, 7);

      const todayTotals = orders.todayTotals(today);
      const weekRows = orders.salesByDay(week.fromDate, week.toDate);

      const expiring = vehicles.expiringBefore(toSqlDate(new Date(Date.now() + 30 * 86_400_000)));

      const expiringVehicles = expiring.flatMap((vehicle) => {
        const alerts: DashboardStats['expiringVehicles'] = [];

        if (vehicle.registrationExpiry) {
          alerts.push({
            vehicleId: vehicle.id,
            plateNo: vehicle.plateNo,
            document: 'registration',
            expiryDate: vehicle.registrationExpiry,
            daysLeft: daysUntil(vehicle.registrationExpiry),
          });
        }
        if (vehicle.insuranceExpiry) {
          alerts.push({
            vehicleId: vehicle.id,
            plateNo: vehicle.plateNo,
            document: 'insurance',
            expiryDate: vehicle.insuranceExpiry,
            daysLeft: daysUntil(vehicle.insuranceExpiry),
          });
        }

        return alerts;
      });

      /*
       * The Phase 4 cards. Today's profit is computed for TODAY only and uses the
       * same known/unknown split as the full report — a card that silently counts an
       * unpriced bill as free food would be worse than no card at all. Each block
       * guards its own repository so a database that has not run 015+ still opens.
       */
      const todayPnl = orders.profitAndLoss(today, today);
      /*
       * No costed bill means no profit figure, not a zero and never a loss. A day
       * whose only bills were items without recipes has sales we cannot price; the
       * card must say so rather than print "−Rs 1,371 profit" on a day that sold
       * Rs 4,000 of food.
       */
      const todayProfit =
        todayPnl.knownNetSales === 0
          ? null
          : {
              knownNetSales: todayPnl.knownNetSales,
              cogs: todayPnl.cogs,
              grossProfit: todayPnl.knownNetSales - todayPnl.cogs,
              unpricedBills: todayPnl.unpricedBills,
            };

      const stock = inventory
        ? {
            value: inventory.stockValueTotal(),
            lowStockCount: inventory.lowStockCount(),
            outOfStockCount: inventory.outOfStockCount(),
          }
        : null;

      /*
       * "Spent today" means every operating cost of the day, not just the rows typed
       * on the Expenses page — otherwise paying a day's wages would leave the card
       * reading zero.
       */
      const todayExpenses =
        (expenses?.summary(today, today).total ?? 0) +
        staff.salaryPaidBetween(today, today).total +
        vehicles.expensesBetween(today, today).total;

      /*
       * Bills that need the owner's attention this month.
       *
       * Read-only on purpose: opening the dashboard must never book money. It only
       * says "the rent is due in two days" — the expense is created when he confirms
       * the amount on the Expenses page.
       */
      const billsDue = (() => {
        if (!recurring?.isReady) return [];

        const period = today.slice(0, 7);
        return recurring
          .list()
          .filter((bill) => bill.active)
          .map((bill) => {
            const payment = recurring.findPayment(bill.id, period);
            const dueDate = dueDateFor(bill.dueDay, period);
            const daysUntilDue = daysBetween(today, dueDate);
            const state = payment
              ? payment.status
              : daysUntilDue < 0
                ? 'overdue'
                : daysUntilDue <= bill.remindDays
                  ? 'due'
                  : 'upcoming';

            return { bill, period, dueDate, daysUntilDue, state, payment };
          })
          .filter((row) => row.state === 'due' || row.state === 'overdue')
          .map((row) => ({
            id: row.bill.id,
            name: row.bill.name,
            dueDate: row.dueDate,
            daysUntilDue: row.daysUntilDue,
            typicalAmount: row.bill.typicalAmount,
            overdue: row.state === 'overdue',
          }));
      })();

      const priceChecks = (inventory?.priceRises(toSqlDate(new Date(Date.now() - 30 * 86_400_000))) ?? [])
        .map((row) => ({
          ...row,
          changeX100:
            row.oldCostMilli > 0
              ? Math.round(((row.newCostMilli - row.oldCostMilli) * 10_000) / row.oldCostMilli)
              : 0,
        }));

      return {
        todaySales: todayTotals.sales,
        todayOrders: todayTotals.orders,
        pendingDeliveries: orders.pendingDeliveries(),
        monthSales: orders.rangeSales(monthStart(month), monthEnd(month)),
        totalItems: catalog.countActiveItems(),
        activeStaff: staff.listWaiters().length + staff.listDeliveryBoys().length,
        expiringVehicles: expiringVehicles.sort((a, b) => a.daysLeft - b.daysLeft),
        recentOrders: orders.recent(8),
        salesByDay: fillDaily(week.days, weekRows),
        todayProfit,
        stock,
        todayExpenses,
        missingRecipes: deps.missingRecipes?.() ?? 0,
        priceChecks,
        billsDue,
      };
    },

    /**
     * Profit & loss (Roadmap 4.G) — the number the owner actually asked for.
     *
     *   net sales − cost of the food sold = gross profit
     *   gross profit − the shop's expenses = net profit
     *
     * Two honesty rules are baked in:
     *
     *   * Sales and cost are summed over the SAME bills. A bill saved before its
     *     item had a recipe can never be priced after the fact, so it is excluded
     *     from the profit and reported separately as `unknownNetSales`. Zeroing the
     *     whole period would make the P&L useless in any shop that added recipes
     *     later; treating those bills as free would invent profit.
     *   * Tax is shown and then excluded. It is collected for the government; a
     *     P&L that counts it as income would inflate every margin.
     */
    profitAndLoss(range: DateRange): ProfitAndLoss {
      const sales = orders.profitAndLoss(range.fromDate, range.toDate);
      const shop = expenses?.summary(range.fromDate, range.toDate) ?? { rows: [], total: 0 };

      /*
       * Wages and the van are real costs the shop pays, and until now the P&L did not
       * see them: it showed a profit the owner never had, by exactly what he handed
       * out on salary day and what he put in the tank. They come from their own
       * tables, never from the Expenses page, so nothing is counted twice.
       */
      const salary = staff.salaryPaidBetween(range.fromDate, range.toDate);
      const fleet = vehicles.expensesBetween(range.fromDate, range.toDate);

      // The pair that actually belongs together: the sales we could price, and
      // what those sales cost.
      const grossProfit = sales.knownNetSales - sales.cogs;
      const operatingExpenses = shop.total + salary.total + fleet.total;

      return {
        from: range.fromDate,
        to: range.toDate,
        orderCount: sales.orders,
        subtotal: sales.subtotal,
        discount: sales.discount,
        netSales: sales.netSales,
        knownNetSales: sales.knownNetSales,
        unknownNetSales: sales.unknownNetSales,
        unpricedBills: sales.unpricedBills,
        tax: sales.tax,
        totalCollected: sales.total,
        cogs: sales.cogs,
        linesWithoutCost: sales.linesWithoutCost,
        grossProfit,
        shopExpenses: shop.total,
        salaries: salary.total,
        vehicleCosts: fleet.total,
        operatingExpenses,
        wastageValue: sales.wastageValue,
        wastageQty: sales.wastageQty,
        netProfit: grossProfit - operatingExpenses,
        cancelledCount: sales.cancelled,
        cancelledValue: sales.cancelledValue,
        expensesByCategory: shop.rows,
        salariesByPerson: salary.byPerson.map((row) => ({
          name: row.name,
          personType: row.personType,
          total: row.total,
          count: row.count,
        })),
        vehicleByType: fleet.byType,
      };
    },

    /**
     * Item profitability (4.G).
     *
     * Revenue and cost are read from the frozen line snapshot, so this table always
     * reconciles with the P&L of the same period. An item whose lines carried no
     * cost is reported with `marginX100: null` and its unpriced revenue named
     * separately — "unknown" and "zero profit" are different facts.
     */
    itemProfit(range: DateRange): ItemProfitRow[] {
      const rows = orders.itemProfit(range.fromDate, range.toDate);

      return rows.map((row) => {
        const profit = row.pricedRevenue - row.cost;
        return {
          itemId: row.itemId,
          name: row.name,
          qty: row.qty,
          revenue: row.revenue,
          pricedRevenue: row.pricedRevenue,
          cost: row.cost,
          profit,
          marginX100:
            row.pricedRevenue > 0
              ? Math.round((profit * 10_000) / row.pricedRevenue)
              : null,
          unpricedQty: row.unpricedQty,
          unpricedRevenue: row.unpricedRevenue,
          /*
           * Two different problems hide behind an unpriced line, and the owner's
           * next action differs:
           *
           *   * no recipe at all  → add the recipe (the card on the dashboard counts
           *     these), and future sales will be costed;
           *   * recipe added later → nothing is wrong now, the old bills simply
           *     predate it. Amending a bill is the only way to price it, and that
           *     is a deliberate act.
           */
          hasRecipe: row.hasRecipeNow === 1,
          unpricedReason:
            row.unpricedQty === 0
              ? null
              : row.hasRecipeNow === 1
                ? 'sold_before_recipe'
                : 'no_recipe',
        };
      });
    },

    /**
     * What is on the shelf and what it is worth (4.G).
     *
     * Reads the cache (`ingredients.qty_on_hand`) through the same list the Stock
     * page uses, so the total here and the "Stock value" tile there can never
     * differ. `lowStockValue` answers the question the count alone cannot: how much
     * of my money is sitting in things I am about to run out of?
     */
    stockValuation(): StockValuation {
      if (!inventory) {
        return {
          rows: [],
          totalValue: 0,
          itemCount: 0,
          lowStockCount: 0,
          lowStockValue: 0,
          byCategory: [],
        };
      }

      const rows: StockValueRow[] = inventory
        .listIngredients()
        .filter((ingredient) => ingredient.active)
        .map((ingredient) => ({
          ingredientId: ingredient.id,
          name: ingredient.name,
          category: ingredient.category,
          baseUnit: ingredient.baseUnit,
          purchaseUnit: ingredient.purchaseUnit,
          unitsPerPurchase: ingredient.unitsPerPurchase,
          qtyOnHand: ingredient.qtyOnHand,
          avgCostMilli: ingredient.avgCostMilli,
          value: valueOf(ingredient.qtyOnHand, ingredient.avgCostMilli),
          reorderLevel: ingredient.reorderLevel,
          lowStock: ingredient.lowStock,
          supplierName: ingredient.supplierName,
        }))
        .sort((a, b) => b.value - a.value);

      const categories = new Map<string, { itemCount: number; value: number }>();
      for (const row of rows) {
        const current = categories.get(row.category) ?? { itemCount: 0, value: 0 };
        categories.set(row.category, {
          itemCount: current.itemCount + 1,
          value: current.value + row.value,
        });
      }

      const low = rows.filter((row) => row.lowStock);

      return {
        rows,
        totalValue: rows.reduce((total, row) => total + row.value, 0),
        itemCount: rows.length,
        lowStockCount: low.length,
        lowStockValue: low.reduce((total, row) => total + row.value, 0),
        byCategory: Array.from(categories.entries())
          .map(([category, value]) => ({ category, ...value }))
          .sort((a, b) => b.value - a.value),
      };
    },

    /** Purchases in a period, what was paid and what is still owed (4.G). */
    purchaseReport(range: DateRange): PurchaseReport {
      const built = inventory?.purchaseReportRows(range.fromDate, range.toDate) ?? {
        rows: [],
        voidedCount: 0,
        voidedValue: 0,
      };

      const live = built.rows.filter((row) => row.status === 'posted');
      const bySupplier = new Map<
        string,
        { supplierName: string | null; count: number; total: number; outstanding: number }
      >();

      for (const row of live) {
        const key = row.supplierName ?? '';
        const current = bySupplier.get(key) ?? {
          supplierName: row.supplierName,
          count: 0,
          total: 0,
          outstanding: 0,
        };
        bySupplier.set(key, {
          supplierName: row.supplierName,
          count: current.count + 1,
          total: current.total + row.total,
          outstanding: current.outstanding + row.outstanding,
        });
      }

      /*
       * The ingredient view. The percentage is computed from the FIRST and LAST
       * landed cost in the window, not from the min and max: a one-off expensive
       * emergency purchase is not a trend, but a steady creep is.
       */
      const byIngredient = (inventory?.purchasesByIngredient(range.fromDate, range.toDate) ?? []).map(
        (row) => ({
          ...row,
          changeX100:
            row.firstCostMilli && row.lastCostMilli && row.firstCostMilli > 0
              ? Math.round(((row.lastCostMilli - row.firstCostMilli) * 10_000) / row.firstCostMilli)
              : null,
        }),
      );

      return {
        from: range.fromDate,
        to: range.toDate,
        rows: built.rows,
        byIngredient,
        // Money is counted over posted bills only; a voided delivery is not a cost.
        paid: live.reduce((total, row) => total + row.paidAmount, 0),
        received: live.reduce((total, row) => total + row.total, 0),
        outstanding: live.reduce((total, row) => total + row.outstanding, 0),
        voidedCount: built.voidedCount,
        voidedValue: built.voidedValue,
        bySupplier: Array.from(bySupplier.values()).sort((a, b) => b.total - a.total),
      };
    },

    /**
     * The wastage report, with the two additions the report screen needs (4.G):
     * a per-day trend so a bad week is visible, and the single reason that cost
     * the most. The rows and totals come from the 4.F read model untouched, so the
     * Wastage tab on Stock and this tab can never disagree.
     */
    wastageReport(range: DateRange): WastageReportFull {
      const read = stockOps?.wastageReport(range.fromDate, range.toDate);
      const base = {
        from: range.fromDate,
        to: range.toDate,
        rows: read?.rows ?? ([] as WastageReportFull['rows']),
        total: read?.total ?? 0,
        qty: read?.qty ?? 0,
      };

      const days = stockOps?.wastageByDay(range.fromDate, range.toDate) ?? [];

      const byReason = new Map<WastageReason, number>();
      for (const row of base.rows) {
        byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + row.value);
      }
      const worst = Array.from(byReason.entries()).sort((a, b) => b[1] - a[1])[0];

      return {
        ...base,
        byDay: days,
        worstReason: worst ? { reason: worst[0], value: worst[1] } : null,
      };
    },

    /** Expenses in a period, grouped by category, by wallet and by day (4.G). */
    expenseReport(range: DateRange): ExpenseReport {
      const rows = expenses?.list({ from: range.fromDate, to: range.toDate, status: 'all' }) ?? [];
      const active = rows.filter((row) => row.status === 'active');
      const voided = rows.filter((row) => row.status === 'void');

      const byPaidFrom = new Map<string, { count: number; total: number }>();
      const byDay = new Map<string, { count: number; total: number }>();

      for (const row of active) {
        const wallet = byPaidFrom.get(row.paidFrom) ?? { count: 0, total: 0 };
        byPaidFrom.set(row.paidFrom, { count: wallet.count + 1, total: wallet.total + row.amount });

        const day = byDay.get(row.spentOn) ?? { count: 0, total: 0 };
        byDay.set(row.spentOn, { count: day.count + 1, total: day.total + row.amount });
      }

      /*
       * The other three cost ledgers, named and totalled but deliberately NOT added
       * into `total`. The plan (§9.3) wants them visible on this screen so the owner
       * sees the whole hisab in one place, and separate so nothing is counted twice:
       * `total` stays "what I typed here".
       */
      const salary = staff.salaryPaidBetween(range.fromDate, range.toDate);
      const fleet = vehicles.expensesBetween(range.fromDate, range.toDate);
      const wasted = stockOps?.wastageReport(range.fromDate, range.toDate);

      const otherCosts: ExpenseReport['otherCosts'] = [
        {
          key: 'salaries',
          label: 'Salaries paid',
          total: salary.total,
          count: salary.count,
          source: 'Salaries page',
        },
        {
          key: 'vehicles',
          label: 'Vehicle fuel and repairs',
          total: fleet.total,
          count: fleet.count,
          source: 'Vehicles page',
        },
        {
          key: 'wastage',
          label: 'Wastage (cost of food thrown away)',
          total: wasted?.total ?? 0,
          count: wasted?.rows.reduce((total, row) => total + row.movements, 0) ?? 0,
          source: 'Stock → Wastage',
        },
      ];

      return {
        from: range.fromDate,
        to: range.toDate,
        total: active.reduce((total, row) => total + row.amount, 0),
        count: active.length,
        otherCosts,
        byCategory: expenses?.summary(range.fromDate, range.toDate).rows ?? [],
        byPaidFrom: Array.from(byPaidFrom.entries())
          .map(([paidFrom, value]) => ({
            paidFrom: paidFrom as ExpenseReport['byPaidFrom'][number]['paidFrom'],
            ...value,
          }))
          .sort((a, b) => b.total - a.total),
        byDay: Array.from(byDay.entries())
          .map(([date, value]) => ({ date, ...value }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        voidedCount: voided.length,
        voidedValue: voided.reduce((total, row) => total + row.amount, 0),
      };
    },

    range(range: DateRange): ReportBundle {
      const totals = orders.rangeTotals(range.fromDate, range.toDate);
      const days = enumerateDays(range);

      return {
        range,
        dailySales: fillDaily(days, orders.salesByDay(range.fromDate, range.toDate)),
        topItems: orders.topItems(range.fromDate, range.toDate, 10) as TopItemRow[],
        totals: {
          orders: totals.orders,
          sales: totals.sales,
          discount: totals.discount,
          tax: totals.tax,
          cancelled: totals.cancelled,
        },
        byType: orders.salesByType(range.fromDate, range.toDate),
      };
    },

    salarySummary(month: string): SalarySummaryRow[] {
      return staffService.peopleWithSalary(month);
    },

    deliveryReport(range: DateRange): DeliveryReportRow[] {
      return orders.deliveriesByBoy(range.fromDate, range.toDate) as DeliveryReportRow[];
    },

    vehicleExpenses(range: DateRange): VehicleExpenseRow[] {
      return vehicles.list().map((vehicle) => {
        const rows = vehicles.expenses(vehicle.id, range.fromDate, range.toDate);
        const fuel = rows
          .filter((row) => row.type === 'fuel')
          .reduce((sum, row) => sum + row.amount, 0);
        const maintenance = rows
          .filter((row) => row.type === 'maintenance' || row.type === 'repair')
          .reduce((sum, row) => sum + row.amount, 0);
        const other = rows
          .filter((row) => row.type === 'other')
          .reduce((sum, row) => sum + row.amount, 0);

        return {
          vehicleId: vehicle.id,
          plateNo: vehicle.plateNo,
          fuel,
          maintenance,
          other,
          total: fuel + maintenance + other,
          entries: rows.length,
        };
      });
    },
  };
}

/** Every date between two `YYYY-MM-DD` values, inclusive. */
export function enumerateDays(range: DateRange): string[] {
  const days: string[] = [];
  const cursor = new Date(`${range.fromDate}T00:00:00`);
  const end = new Date(`${range.toDate}T00:00:00`);
  let guard = 0;

  while (cursor <= end && guard < 400) {
    days.push(toSqlDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return days;
}

export type ReportsService = ReturnType<typeof createReportsService>;
