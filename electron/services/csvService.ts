import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DateRange, ReportBundle } from '../../src/types/api';
import type { ReportsService } from './reportsService';
import { formatAmount } from '../utils/money';
import { logInfo } from './logger';

export type ExportReportName =
  'daily_sales' | 'top_items' | 'salary' | 'delivery' | 'vehicle_expenses';

const HEADERS: Record<ExportReportName, string[]> = {
  daily_sales: ['Date', 'Orders', 'Sales'],
  top_items: ['Item', 'Quantity sold', 'Revenue'],
  salary: ['Name', 'Role', 'Month', 'Net pay', 'Paid'],
  delivery: ['Delivery boy', 'Deliveries', 'Delivered value', 'Commission'],
  vehicle_expenses: ['Vehicle', 'Fuel', 'Maintenance', 'Other', 'Total', 'Entries'],
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
