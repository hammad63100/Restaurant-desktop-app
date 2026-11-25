import type {
  DailySalesRow,
  DashboardStats,
  DateRange,
  DeliveryReportRow,
  ReportBundle,
  SalarySummaryRow,
  TopItemRow,
  VehicleExpenseRow,
} from '../../src/types/api';
import type { OrdersRepository } from '../db/repositories/ordersRepository';
import type { CatalogRepository } from '../db/repositories/catalogRepository';
import type { StaffRepository } from '../db/repositories/staffRepository';
import type { VehiclesRepository } from '../db/repositories/vehiclesRepository';
import type { StaffService } from './staffService';
import { daysUntil, monthEnd, monthStart, toSqlDate, todaySqlDate } from '../utils/datetime';

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
}) {
  const { orders, catalog, staff, vehicles, staffService } = deps;

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
