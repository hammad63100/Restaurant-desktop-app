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
