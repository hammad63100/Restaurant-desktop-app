import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, TrendingUp } from 'lucide-react';
import type { DateRange, ExportReportName, TopItemRow } from '../../types/api';
import { ORDER_TYPE_LABELS } from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useSettings } from '../../store/settingsStore';
import { useAuth } from '../../hooks/useAuth';
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
import { Alert } from '../../components/Alert';
import { ExpensesPanel, PurchasesPanel, WastagePanel } from './SpendPanels';
import { ItemProfitPanel, StockValuePanel } from './ProfitPanels';

type Tab =
  | 'profit'
  | 'itemProfit'
  | 'stockValue'
  | 'purchases'
  | 'wastage'
  | 'expenses'
  | 'sales'
  | 'items'
  | 'delivery'
  | 'salary'
  | 'vehicles';

const TABS: Array<{ value: Tab; label: string; exportName: ExportReportName }> = [
  // Profit first: it is the number the owner opens this page for.
  { value: 'profit', label: 'Profit & loss', exportName: 'profit' },
  { value: 'itemProfit', label: 'Item profit', exportName: 'item_profit' },
  { value: 'stockValue', label: 'Stock value', exportName: 'stock_value' },
  { value: 'purchases', label: 'Purchases', exportName: 'purchases' },
  { value: 'wastage', label: 'Wastage', exportName: 'wastage' },
  { value: 'expenses', label: 'Expenses', exportName: 'expenses' },
  { value: 'sales', label: 'Sales', exportName: 'daily_sales' },
  { value: 'items', label: 'Top items', exportName: 'top_items' },
  { value: 'delivery', label: 'Deliveries', exportName: 'delivery' },
  { value: 'salary', label: 'Salaries', exportName: 'salary' },
  { value: 'vehicles', label: 'Vehicle costs', exportName: 'vehicle_expenses' },
];

/** The tabs that come from the 4.G report channels, all gated on `costs:read`. */
const COST_TABS: Tab[] = ['profit', 'itemProfit', 'stockValue', 'purchases', 'wastage', 'expenses'];

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
  const { allow } = useAuth();
  const [tab, setTab] = useState<Tab>('profit');
  const [range, setRange] = useState<DateRange>({ fromDate: monthStartIso(), toDate: todayIso() });
  const [salaryMonth, setSalaryMonth] = useState(currentMonth());
  const [isExporting, setIsExporting] = useState(false);

  const sales = useAsync(
    async () => unwrap(await getApi().reports.range(range)),
    [range.fromDate, range.toDate],
  );

  // The P&L is gated on costs:read in the main process; a role without it simply
  // never asks, so the tab shows a dash instead of an error.
  const canCost = allow('costs:read');
  const profit = useAsync(
    async () => (canCost ? unwrap(await getApi().reports.profitAndLoss(range)) : null),
    [range.fromDate, range.toDate, canCost],
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

  /*
   * 4.G report reads. Each is asked for only when its tab is open AND the role may
   * see costs, so a manager (no `costs:read`) never fires a request that would come
   * back FORBIDDEN, and the page does not load five reports to show one.
   */
  const itemProfit = useAsync(
    async () =>
      canCost && tab === 'itemProfit' ? unwrap(await getApi().reports.itemProfit(range)) : null,
    [range.fromDate, range.toDate, canCost, tab],
  );
  const stockValue = useAsync(
    async () =>
      canCost && tab === 'stockValue' ? unwrap(await getApi().reports.stockValuation()) : null,
    [canCost, tab],
  );
  const purchaseReport = useAsync(
    async () =>
      canCost && tab === 'purchases' ? unwrap(await getApi().reports.purchaseReport(range)) : null,
    [range.fromDate, range.toDate, canCost, tab],
  );
  const wastageReport = useAsync(
    async () =>
      canCost && tab === 'wastage'
        ? unwrap(await getApi().reports.wastageReport(range))
        : null,
    [range.fromDate, range.toDate, canCost, tab],
  );
  const expenseReport = useAsync(
    async () =>
      canCost && tab === 'expenses' ? unwrap(await getApi().reports.expenseReport(range)) : null,
    [range.fromDate, range.toDate, canCost, tab],
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

      {/* ------------------------------ Profit & loss ------------------------------ */}
      {tab === 'profit' && (
        <div className="flex flex-col gap-4">
          {!canCost && (
            <Alert tone="info">
              Your role can see the shop's takings but not its costs, so the profit
              figures are hidden. Ask the owner for the numbers.
            </Alert>
          )}

          {canCost && profit.data && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <SummaryTile label="Net sales" value={formatAmount(profit.data.netSales)} />
                <SummaryTile label="Cost of food" value={formatAmount(profit.data.cogs)} />
                <SummaryTile
                  label="Gross profit"
                  value={formatAmount(profit.data.grossProfit)}
                />
                <SummaryTile
                  label="Running costs"
                  value={formatAmount(profit.data.operatingExpenses)}
                />
              </div>

              <Card>
                <CardHeading
                  title="Profit & loss"
                  subtitle={`${formatDate(profit.data.from)} to ${formatDate(profit.data.to)}`}
                />

                {profit.data.unknownNetSales > 0 && (
                  <Alert tone="warning">{`${formatAmount(
                    profit.data.unknownNetSales,
                  )} of sales in this period came from ${profit.data.unpricedBills} bill${
                    profit.data.unpricedBills === 1 ? '' : 's'
                  } saved before ${profit.data.linesWithoutCost === 1 ? 'an item had' : 'their items had'} a recipe, so ${
                    profit.data.unpricedBills === 1 ? 'it is' : 'they are'
                  } not counted in the profit below. The two figures together are the whole picture.`}</Alert>
                )}

                <dl className="mt-3 flex flex-col divide-y divide-border">
                  <PnlRow label="Food sold (before discount)" value={profit.data.subtotal} />
                  <PnlRow label="Discounts given" value={profit.data.discount} negative />
                  <PnlRow label="Net sales" value={profit.data.netSales} strong />
                  {profit.data.unknownNetSales > 0 && (
                    <>
                      <PnlRow
                        label="  · of which could be costed"
                        value={profit.data.knownNetSales}
                      />
                      <PnlRow
                        label="  · of which has no recipe"
                        value={profit.data.unknownNetSales}
                      />
                    </>
                  )}
                  <PnlRow
                    label="Cost of the food sold"
                    value={profit.data.cogs}
                    negative
                  />
                  <PnlRow label="Gross profit" value={profit.data.grossProfit} strong />

                  {/*
                    Four cost lines, one per source table. Showing them separately is
                    the point: an owner who sees "salaries 0" knows the payouts were
                    never recorded, which one lumpy "expenses" total would hide.
                  */}
                  <PnlRow
                    label="Shop expenses (rent, bills, repairs)"
                    value={profit.data.shopExpenses}
                    negative
                  />
                  <PnlRow label="Salaries paid" value={profit.data.salaries} negative />
                  <PnlRow
                    label="Vehicle fuel and repairs"
                    value={profit.data.vehicleCosts}
                    negative
                  />
                  <PnlRow
                    label="Total running costs"
                    value={profit.data.operatingExpenses}
                    strong
                  />
                  <PnlRow label="Net profit" value={profit.data.netProfit} strong highlight />
                </dl>

                <p className="mt-3 text-caption text-text-secondary">
                  Tax of {formatAmount(profit.data.tax)} is collected on behalf of the
                  government and is not counted as income. {profit.data.orderCount} bills,
                  of which {profit.data.cancelledCount} were cancelled
                  {profit.data.cancelledValue > 0
                    ? ` (${formatAmount(profit.data.cancelledValue)} voided)`
                    : ''}
                  . Wastage of {formatAmount(profit.data.wastageValue)} is already inside
                  the cost of food, because those ingredients were bought and never sold.
                  {profit.data.salaries === 0 &&
                    ' No salary payouts fell in this period — if wages were paid, record them on the Salaries page or this profit will look too high.'}
                </p>
              </Card>

              {profit.data.expensesByCategory.length > 0 && (
                <Card>
                  <CardHeading
                    title="Where the expenses went"
                    subtitle="The same money, grouped by category."
                  />
                  <ul className="mt-2 flex flex-col divide-y divide-border">
                    {profit.data.expensesByCategory.map((row) => (
                      <li
                        key={row.categoryName}
                        className="flex items-center justify-between py-2"
                      >
                        <span>
                          {row.categoryName}{' '}
                          <span className="text-caption text-text-secondary">
                            ({row.count})
                          </span>
                        </span>
                        <span className="font-medium tabular">{formatAmount(row.total)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------------------- 4.G report tabs ---------------------------- */}

      {COST_TABS.includes(tab) && !canCost && (
        <Alert tone="info">
          Your role can see the shop's takings but not its costs, so this report is
          hidden. Ask the owner for the numbers.
        </Alert>
      )}

      {tab === 'itemProfit' && canCost && (
        <ItemProfitPanel
          rows={itemProfit.data ?? []}
          currency={currency}
          isLoading={itemProfit.isLoading}
          error={itemProfit.error}
        />
      )}

      {tab === 'stockValue' && canCost && (
        <StockValuePanel
          valuation={stockValue.data}
          currency={currency}
          isLoading={stockValue.isLoading}
          error={stockValue.error}
        />
      )}

      {tab === 'purchases' && canCost && (
        <PurchasesPanel
          report={purchaseReport.data}
          currency={currency}
          isLoading={purchaseReport.isLoading}
          error={purchaseReport.error}
        />
      )}

      {tab === 'wastage' && canCost && (
        <WastagePanel
          report={wastageReport.data}
          currency={currency}
          isLoading={wastageReport.isLoading}
          error={wastageReport.error}
        />
      )}

      {tab === 'expenses' && canCost && (
        <ExpensesPanel
          report={expenseReport.data}
          currency={currency}
          isLoading={expenseReport.isLoading}
          error={expenseReport.error}
        />
      )}

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

/**
 * One line of the P&L. A NULL value means "unknown", never zero: an item without a
 * recipe has no cost, and pretending it cost nothing would invent profit.
 */
function PnlRow({
  label,
  value,
  negative = false,
  strong = false,
  highlight = false,
}: {
  label: string;
  value: number;
  negative?: boolean;
  strong?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className={strong ? 'font-medium' : 'text-text-secondary'}>{label}</dt>
      <dd
        className={`tabular ${strong ? 'font-semibold' : ''} ${
          highlight
            ? value < 0
              ? 'text-status-cancelled'
              : 'text-status-success'
            : ''
        }`}
      >
        {`${negative ? '−' : ''}${formatAmount(value)}`}
      </dd>
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
