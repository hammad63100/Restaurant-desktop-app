import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DateRange, ExportReportName, ReportBundle } from '../../src/types/api';
import type { ReportsService } from './reportsService';
import { formatAmount } from '../utils/money';
import { logInfo } from './logger';

export type { ExportReportName };

const HEADERS: Record<ExportReportName, string[]> = {
  daily_sales: ['Date', 'Orders', 'Sales'],
  top_items: ['Item', 'Quantity sold', 'Revenue'],
  salary: ['Name', 'Role', 'Month', 'Net pay', 'Paid'],
  delivery: ['Delivery boy', 'Deliveries', 'Delivered value', 'Commission'],
  vehicle_expenses: ['Vehicle', 'Fuel', 'Maintenance', 'Other', 'Total', 'Entries'],
  // 4.G — the owner's own numbers.
  profit: ['Line', 'Amount'],
  item_profit: ['Item', 'Qty sold', 'Revenue', 'Cost', 'Profit', 'Margin %', 'Unpriced revenue'],
  stock_value: ['Ingredient', 'Category', 'On hand', 'Unit', 'Average cost', 'Value', 'Low stock'],
  purchases: ['Date', 'Purchase', 'Supplier', 'Bill', 'Total', 'Paid', 'Outstanding', 'Status'],
  purchases_by_ingredient: ['Ingredient', 'Bills', 'Quantity', 'Unit', 'Spend', 'Price change %'],
  wastage: ['Ingredient', 'Reason', 'Times', 'Quantity', 'Value'],
  expenses: ['Category', 'Entries', 'Total'],
};

/** Escapes one CSV cell; quotes values that contain a comma, quote or newline. */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * CSV export needs no extra library (Rules.md: do not add a package for a few
 * lines of code). Excel opens these files directly; amounts are exported in rupees.
 */
export function createCsvService(deps: {
  reports: ReportsService;
  exportDirectory: () => string;
  salarySummary: (month: string) => ReturnType<ReportsService['salarySummary']>;
}) {
  const { reports, exportDirectory, salarySummary } = deps;

  async function askWhereToSave(defaultName: string): Promise<string | null> {
    const { dialog } = await import('electron');
    const result = await dialog.showSaveDialog({
      title: 'Save report',
      defaultPath: path.join(exportDirectory(), defaultName),
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
    });

    return result.canceled || !result.filePath ? null : result.filePath;
  }

  function bundleRange(range: DateRange): ReportBundle {
    return reports.range(range);
  }

  return {
    /** Builds the CSV text without touching the filesystem (used by tests). */
    buildCsv(report: ExportReportName, range: DateRange): string {
      const bundle = bundleRange(range);

      switch (report) {
        case 'daily_sales':
          return toCsv(
            HEADERS.daily_sales,
            bundle.dailySales.map((row) => [row.date, row.orders, formatAmount(row.sales)]),
          );

        case 'top_items':
          return toCsv(
            HEADERS.top_items,
            bundle.topItems.map((row) => [row.name, row.qty, formatAmount(row.revenue)]),
          );

        case 'salary': {
          const month = range.fromDate.slice(0, 7);
          return toCsv(
            HEADERS.salary,
            salarySummary(month).map((row) => [
              row.name,
              row.role,
              row.month,
              formatAmount(row.netPay),
              row.paid ? 'Yes' : 'No',
            ]),
          );
        }

        case 'delivery':
          return toCsv(
            HEADERS.delivery,
            reports
              .deliveryReport(range)
              .map((row) => [
                row.name,
                row.deliveries,
                formatAmount(row.deliveredValue),
                formatAmount(row.commission),
              ]),
          );

        case 'vehicle_expenses':
          return toCsv(
            HEADERS.vehicle_expenses,
            reports
              .vehicleExpenses(range)
              .map((row) => [
                row.plateNo,
                formatAmount(row.fuel),
                formatAmount(row.maintenance),
                formatAmount(row.other),
                formatAmount(row.total),
                row.entries,
              ]),
          );

        /*
         * 4.G: the five new reports. Rupees go out (not paisa) because the file is
         * opened in Excel by a shopkeeper, matching every other export here.
         */

        case 'profit': {
          const pnl = reports.profitAndLoss(range);
          return toCsv(HEADERS.profit, [
            ['Net sales (ex tax)', formatAmount(pnl.netSales)],
            ['  of which costed', formatAmount(pnl.knownNetSales)],
            ['  of which unpriced', formatAmount(pnl.unknownNetSales)],
            ['Cost of food sold', formatAmount(pnl.cogs)],
            ['Gross profit', formatAmount(pnl.grossProfit)],
            ['Shop expenses', formatAmount(pnl.shopExpenses)],
            ['Salaries paid', formatAmount(pnl.salaries)],
            ['Vehicle fuel and repairs', formatAmount(pnl.vehicleCosts)],
            ['Total running costs', formatAmount(pnl.operatingExpenses)],
            ['Net profit', formatAmount(pnl.netProfit)],
            ['Tax collected (not income)', formatAmount(pnl.tax)],
            ['Bills', pnl.orderCount],
            ['Wastage written off', formatAmount(pnl.wastageValue)],
            ['Cancelled bills', pnl.cancelledCount],
          ]);
        }

        case 'item_profit':
          return toCsv(
            HEADERS.item_profit,
            reports.itemProfit(range).map((row) => [
              row.name,
              row.qty,
              formatAmount(row.revenue),
              formatAmount(row.cost),
              formatAmount(row.profit),
              row.marginX100 === null ? '' : (row.marginX100 / 100).toFixed(2),
              formatAmount(row.unpricedRevenue),
            ]),
          );

        case 'stock_value':
          return toCsv(
            HEADERS.stock_value,
            reports.stockValuation().rows.map((row) => [
              row.name,
              row.category,
              row.qtyOnHand,
              row.baseUnit,
              // Average cost is milli-paisa per base unit; show rupees.
              (row.avgCostMilli / 100_000).toFixed(2),
              formatAmount(row.value),
              row.lowStock ? 'Yes' : 'No',
            ]),
          );

        case 'purchases':
          return toCsv(
            HEADERS.purchases,
            reports.purchaseReport(range).rows.map((row) => [
              row.purchasedOn,
              row.purchaseNo,
              row.supplierName ?? '',
              row.billNo,
              formatAmount(row.total),
              formatAmount(row.paidAmount),
              formatAmount(row.outstanding),
              row.status,
            ]),
          );

        case 'purchases_by_ingredient':
          return toCsv(
            HEADERS.purchases_by_ingredient,
            reports.purchaseReport(range).byIngredient.map((row) => [
              row.name,
              row.purchaseCount,
              row.qtyBase,
              row.baseUnit,
              formatAmount(row.spend),
              row.changeX100 === null ? '' : (row.changeX100 / 100).toFixed(1),
            ]),
          );

        case 'wastage':
          return toCsv(
            HEADERS.wastage,
            reports.wastageReport(range).rows.map((row) => [
              row.ingredientName,
              row.reason,
              row.movements,
              row.qty,
              formatAmount(row.value),
            ]),
          );

        case 'expenses': {
          const report = reports.expenseReport(range);
          // The typed expenses first, then the other ledgers — labelled so nobody
          // adds the two halves together by accident in Excel.
          return toCsv(HEADERS.expenses, [
            ...report.byCategory.map((row) => [
              row.categoryName,
              row.count,
              formatAmount(row.total),
            ]),
            ...report.otherCosts.map((line) => [
              `${line.label} (${line.source}, not in the total)`,
              line.count,
              formatAmount(line.total),
            ]),
          ]);
        }

        default:
          return toCsv(HEADERS.daily_sales, []);
      }
    },

    async exportReport(
      report: ExportReportName,
      range: DateRange,
    ): Promise<{ path: string | null }> {
      const csv = this.buildCsv(report, range);
      const defaultName = `${report}-${range.fromDate}-to-${range.toDate}.csv`;
      const targetPath = await askWhereToSave(defaultName);

      if (!targetPath) return { path: null };

      // BOM so Excel opens UTF-8 correctly on Windows.
      writeFileSync(targetPath, `\uFEFF${csv}`, 'utf8');
      logInfo(`Report exported: ${report} -> ${path.basename(targetPath)}`);
      return { path: targetPath };
    },
  };
}

export type CsvService = ReturnType<typeof createCsvService>;
