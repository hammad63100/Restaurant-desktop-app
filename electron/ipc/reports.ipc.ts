import { CHANNELS, type DateRange } from '../../src/types/api';
import { dateRangeSchema, exportReportSchema, monthSchema } from '../../src/types/schemas';
import type { ReportsService } from '../services/reportsService';
import type { CsvService } from '../services/csvService';
import type { HandlerRegistry } from './registry';

export function reportsHandlers(reports: ReportsService, csv: CsvService): HandlerRegistry {
  return {
    [CHANNELS.dashboard]: {
      handler: () => reports.dashboard(),
    },

    [CHANNELS.reportRange]: {
      capability: 'reports:read',
      schema: dateRangeSchema,
      handler: (input: DateRange) => reports.range(input),
    },

    [CHANNELS.reportProfit]: {
      // The owner's own numbers: cost, profit and the shop's expenses. A manager
      // without costs:read is deliberately left out (same rule as 4.C).
      capability: 'costs:read',
      schema: dateRangeSchema,
      handler: (input: DateRange) => reports.profitAndLoss(input),
    },

    /*
     * All five of the 4.G report reads are `costs:read`: item profit, stock
     * valuation (which is money), purchases, wastage value and expenses are the
     * owner's private numbers, exactly like the P&L above.
     */

    [CHANNELS.reportItemProfit]: {
      capability: 'costs:read',
      schema: dateRangeSchema,
      handler: (input: DateRange) => reports.itemProfit(input),
    },

    [CHANNELS.reportStockValuation]: {
      capability: 'costs:read',
      handler: () => reports.stockValuation(),
    },

    [CHANNELS.reportPurchases]: {
      capability: 'costs:read',
      schema: dateRangeSchema,
      handler: (input: DateRange) => reports.purchaseReport(input),
    },

    [CHANNELS.reportWastage]: {
      capability: 'costs:read',
      schema: dateRangeSchema,
      handler: (input: DateRange) => reports.wastageReport(input),
    },

    [CHANNELS.reportExpenses]: {
      capability: 'costs:read',
      schema: dateRangeSchema,
      handler: (input: DateRange) => reports.expenseReport(input),
    },

    [CHANNELS.reportSalary]: {
      capability: 'reports:read',
      schema: monthSchema,
      handler: (input: { month: string }) => reports.salarySummary(input.month),
    },

    [CHANNELS.reportDelivery]: {
      capability: 'reports:read',
      schema: dateRangeSchema,
      handler: (input: DateRange) => reports.deliveryReport(input),
    },

    [CHANNELS.reportVehicleExpenses]: {
      capability: 'reports:read',
      schema: dateRangeSchema,
      handler: (input: DateRange) => reports.vehicleExpenses(input),
    },

    [CHANNELS.reportExport]: {
      capability: 'reports:read',
      schema: exportReportSchema,
      handler: (input: { report: Parameters<CsvService['exportReport']>[0]; range: DateRange }) =>
        csv.exportReport(input.report, input.range),
    },
  };
}
