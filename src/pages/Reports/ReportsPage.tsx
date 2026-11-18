import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, TrendingUp } from 'lucide-react';
import type { DateRange, TopItemRow } from '../../types/api';
import { ORDER_TYPE_LABELS } from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useSettings } from '../../store/settingsStore';
import {
  currentMonth,
  formatAmount,
  formatDate,
  formatMonth,
  monthEndIso,
  monthStartIso,
  todayIso,
} from '../../utils/format';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { Table, type Column } from '../../components/Table';
import { PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { toast } from '../../components/Toast';

type Tab = 'sales' | 'items' | 'delivery' | 'salary' | 'vehicles';
type ExportName = 'daily_sales' | 'top_items' | 'salary' | 'delivery' | 'vehicle_expenses';

const TABS: Array<{ value: Tab; label: string; exportName: ExportName }> = [
  { value: 'sales', label: 'Sales', exportName: 'daily_sales' },
  { value: 'items', label: 'Top items', exportName: 'top_items' },
  { value: 'delivery', label: 'Deliveries', exportName: 'delivery' },
  { value: 'salary', label: 'Salaries', exportName: 'salary' },
  { value: 'vehicles', label: 'Vehicle costs', exportName: 'vehicle_expenses' },
];

const PRESETS = [
  { label: 'Today', from: () => todayIso(), to: () => todayIso() },
  { label: 'Last 7 days', from: () => isoDaysAgo(6), to: () => todayIso() },
  { label: 'This month', from: () => monthStartIso(), to: () => todayIso() },
  {
    label: 'Last month',
    from: () => prevMonthStart(),
    to: () => prevMonthEnd(),
  },
];

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function prevMonthStart(): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function prevMonthEnd(): string {
  const date = new Date();
  date.setDate(0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ReportsPage() {
  const currency = useSettings((settings) => settings.currency);
  const [tab, setTab] = useState<Tab>('sales');
  const [range, setRange] = useState<DateRange>({ fromDate: monthStartIso(), toDate: todayIso() });
  const [salaryMonth, setSalaryMonth] = useState(currentMonth());
  const [isExporting, setIsExporting] = useState(false);

  const sales = useAsync(
    async () => unwrap(await getApi().reports.range(range)),
    [range.fromDate, range.toDate],
  );
  const salaries = useAsync(
    async () => unwrap(await getApi().reports.salarySummary(salaryMonth)),
    [salaryMonth],
  );
  const deliveries = useAsync(
    async () => unwrap(await getApi().reports.deliveryReport(range)),
    [range.fromDate, range.toDate],
  );
  const vehicles = useAsync(
    async () => unwrap(await getApi().reports.vehicleExpenses(range)),
    [range.fromDate, range.toDate],
  );

  const maxDaily = useMemo(
    () => Math.max(...(sales.data?.dailySales.map((row) => row.sales) ?? [0]), 1),
    [sales.data],
  );

  const exportCsv = async () => {
    const config = TABS.find((entry) => entry.value === tab);
    if (!config) return;

    setIsExporting(true);
    try {
      const result = unwrap(
        await getApi().reports.exportCsv(
          config.exportName,
          tab === 'salary'
            ? { fromDate: monthStartIso(salaryMonth), toDate: monthEndIso(salaryMonth) }
            : range,
        ),
      );

      if (result.path) toast.success(`Saved to ${result.path}`);
    } catch (error) {
      toast.error(errorMessage(error, 'The report could not be exported'));
    } finally {
      setIsExporting(false);
    }
  };

  const dailyColumns: Column<{ date: string; orders: number; sales: number }>[] = [
    { key: 'date', header: 'Date', render: (row) => formatDate(row.date) },
    { key: 'orders', header: 'Orders', align: 'center', render: (row) => row.orders },
    {
      key: 'sales',
      header: 'Sales',
      align: 'right',
      render: (row) => `${currency} ${formatAmount(row.sales)}`,
    },
  ];

  const itemColumns: Column<TopItemRow>[] = [
    { key: 'name', header: 'Item', render: (row) => row.name },
    { key: 'qty', header: 'Qty sold', align: 'center', render: (row) => row.qty },
    {
      key: 'revenue',
      header: 'Revenue',
      align: 'right',
      render: (row) => `${currency} ${formatAmount(row.revenue)}`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Sales, best sellers, deliveries, salaries and vehicle costs."
        actions={
          <Button variant="secondary" onClick={() => void exportCsv()} isLoading={isExporting}>
            <FileSpreadsheet aria-hidden className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-caption text-text-secondary">
            From
            <input
              type="date"
              value={range.fromDate}
              onChange={(event) => setRange({ ...range, fromDate: event.target.value })}
              className="h-control rounded-control border border-border bg-surface px-3 text-body"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-text-secondary">
            To
            <input
              type="date"
              value={range.toDate}
              onChange={(event) => setRange({ ...range, toDate: event.target.value })}
              className="h-control rounded-control border border-border bg-surface px-3 text-body"
            />
          </label>

          <div className="flex flex-wrap gap-1">
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="secondary"
                onClick={() => setRange({ fromDate: preset.from(), toDate: preset.to() })}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {tab === 'salary' && (
            <div className="w-44">
              <Select
                label="Salary month"
                options={Array.from({ length: 12 }, (_, index) => {
                  const date = new Date();
                  date.setMonth(date.getMonth() - index);
                  const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                  return { value, label: formatMonth(value) };
                })}
                value={salaryMonth}
                onChange={(event) => setSalaryMonth(event.target.value)}
              />
            </div>
          )}
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setTab(entry.value)}
            className={`h-9 rounded-full border px-4 text-button ${
              tab === entry.value
                ? 'border-primary bg-primary text-white'
                : 'border-border bg-surface text-text-secondary hover:text-text-primary'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* -------------------------------- Sales -------------------------------- */}
      {tab === 'sales' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
          <div>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryTile label="Orders" value={String(sales.data?.totals.orders ?? 0)} />
              <SummaryTile
                label="Sales"
                value={`${currency} ${formatAmount(sales.data?.totals.sales ?? 0)}`}
              />
              <SummaryTile
                label="Discount given"
                value={formatAmount(sales.data?.totals.discount ?? 0)}
              />
              <SummaryTile label="Cancelled" value={String(sales.data?.totals.cancelled ?? 0)} />
            </div>

            <Card>
              <CardHeading title="Daily sales" subtitle="Empty days are shown as zero." />
              <Table
                columns={dailyColumns}
                rows={sales.data?.dailySales ?? []}
                rowKey={(row) => row.date}
                isLoading={sales.isLoading}
                emptyMessage="No sales in this period"
                emptyHint="Try another date range."
              />
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeading title="Sales by order type" />
              <ul className="flex flex-col gap-2">
                {(sales.data?.byType ?? []).map((row) => (
                  <li key={row.type}>
                    <div className="mb-1 flex justify-between text-caption">
                      <span>{ORDER_TYPE_LABELS[row.type]}</span>
                      <span className="tabular">{formatAmount(row.sales)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-background">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.round((row.sales / Math.max(sales.data?.totals.sales ?? 1, 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-secondary">{row.orders} order(s)</p>
                  </li>
                ))}
                {(sales.data?.byType ?? []).length === 0 && (
                  <li className="text-caption text-text-secondary">No orders in this period.</li>
                )}
              </ul>
            </Card>

            <Card>
              <CardHeading title="Daily trend" subtitle="Bar height is relative to the best day." />
              <div className="flex h-32 items-end gap-1">
                {(sales.data?.dailySales ?? []).slice(-14).map((row) => (
                  <div
                    key={row.date}
                    className="flex-1 rounded-t bg-accent/80"
                    style={{ height: `${Math.max(3, Math.round((row.sales / maxDaily) * 110))}px` }}
                    title={`${formatDate(row.date)}: ${formatAmount(row.sales)}`}
                  />
                ))}
              </div>
              <p className="mt-2 flex items-center gap-1 text-caption text-text-secondary">
                <TrendingUp aria-hidden className="h-3.5 w-3.5" />
                Last 14 days in the selected range
              </p>
            </Card>
          </div>
        </div>
      )}

      {/* ------------------------------ Top items ------------------------------ */}
      {tab === 'items' && (
        <Card>
          <CardHeading
            title="Best selling items"
            subtitle="By quantity sold in the selected range."
          />
          <Table
            columns={itemColumns}
            rows={sales.data?.topItems ?? []}
            rowKey={(row) => row.itemId}
            isLoading={sales.isLoading}
            emptyMessage="No items sold in this period"
            emptyHint="Take an order first, then come back."
          />
        </Card>
      )}

      {/* ------------------------------ Deliveries ----------------------------- */}
      {tab === 'delivery' && (
        <Card>
          <CardHeading
            title="Delivery report"
            subtitle="Delivered orders per rider and the commission earned."
          />
          <Table
            columns={[
              { key: 'name', header: 'Delivery boy', render: (row) => row.name },
              {
                key: 'deliveries',
                header: 'Deliveries',
                align: 'center',
                render: (row) => row.deliveries,
              },
              {
                key: 'value',
                header: 'Delivered value',
                align: 'right',
                render: (row) => formatAmount(row.deliveredValue),
              },
              {
                key: 'commission',
                header: 'Commission',
                align: 'right',
                render: (row) => formatAmount(row.commission),
              },
            ]}
            rows={deliveries.data ?? []}
            rowKey={(row) => row.deliveryBoyId}
            isLoading={deliveries.isLoading}
            emptyMessage="No deliveries in this period"
            emptyHint="Delivered delivery orders appear here."
          />
        </Card>
      )}

      {/* ------------------------------- Salaries ------------------------------ */}
      {tab === 'salary' && (
        <Card>
          <CardHeading
            title={`Salary summary · ${formatMonth(salaryMonth)}`}
            subtitle="Full month view, based on attendance and advances."
          />
          <Table
            columns={[
              { key: 'name', header: 'Name', render: (row) => row.name },
              { key: 'role', header: 'Role', render: (row) => row.role },
              {
                key: 'net',
                header: 'Net pay',
                align: 'right',
                render: (row) => `${currency} ${formatAmount(row.netPay)}`,
              },
              {
                key: 'paid',
                header: 'Paid',
                align: 'center',
                render: (row) => (row.paid ? 'Yes' : 'No'),
              },
            ]}
            rows={salaries.data ?? []}
            rowKey={(row) => `${row.personType}-${row.personId}`}
            isLoading={salaries.isLoading}
            emptyMessage="No staff yet"
            emptyHint="Add waiters and delivery boys on the Staff page."
          />
        </Card>
      )}

      {/* --------------------------- Vehicle expenses -------------------------- */}
      {tab === 'vehicles' && (
        <Card>
          <CardHeading title="Vehicle costs" subtitle="Fuel, maintenance and other expenses." />
          <Table
            columns={[
              { key: 'plate', header: 'Vehicle', render: (row) => row.plateNo },
              {
                key: 'fuel',
                header: 'Fuel',
                align: 'right',
                render: (row) => formatAmount(row.fuel),
              },
              {
                key: 'maintenance',
                header: 'Maintenance',
                align: 'right',
                render: (row) => formatAmount(row.maintenance),
              },
              {
                key: 'other',
                header: 'Other',
                align: 'right',
                render: (row) => formatAmount(row.other),
              },
              {
                key: 'total',
                header: 'Total',
                align: 'right',
                render: (row) => <span className="font-medium">{formatAmount(row.total)}</span>,
              },
              { key: 'entries', header: 'Entries', align: 'center', render: (row) => row.entries },
            ]}
            rows={vehicles.data ?? []}
            rowKey={(row) => row.vehicleId}
            isLoading={vehicles.isLoading}
            emptyMessage="No vehicles yet"
            emptyHint="Add vehicles on the Vehicles page."
          />
        </Card>
      )}

      <p className="mt-4 flex items-center gap-1 text-caption text-text-secondary">
        <Download aria-hidden className="h-3.5 w-3.5" />
        Export CSV opens Excel. Amounts are exported in rupees; money is stored in paisa.
      </p>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <p className="text-caption text-text-secondary">{label}</p>
      <p className="text-section-title tabular text-text-primary">{value}</p>
    </div>
  );
}
