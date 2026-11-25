import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Bike,
  ClipboardList,
  Package,
  Plus,
  ShoppingBag,
  TrendingUp,
  Utensils,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import type { OrderSummary } from '../../types/api';
import { ORDER_STATUS_CLASSES, ORDER_STATUS_LABELS, ORDER_TYPE_LABELS } from '../../types/labels';
import { getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../store/settingsStore';
import { formatAmount, formatDate, formatDateTime } from '../../utils/format';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { PageHeader } from '../../components/PageHeader';
import { Table, type Column } from '../../components/Table';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  Icon: typeof ShoppingBag;
  to: string;
  tone: 'primary' | 'accent' | 'success' | 'info';
}

const TONES = {
  primary: 'bg-primary/10 text-primary',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-status-success/10 text-status-success',
  info: 'bg-status-preparing/10 text-status-preparing',
};

function StatCard({ label, value, hint, Icon, to, tone }: StatCardProps) {
  return (
    <Link
      to={to}
      className="card block p-4 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-control ${TONES[tone]}`}
        >
          <Icon aria-hidden className="h-5 w-5" />
        </span>
        <ArrowRight aria-hidden className="h-4 w-4 text-text-secondary" />
      </div>
      <p className="text-caption text-text-secondary">{label}</p>
      <p className="text-big-number tabular text-text-primary">{value}</p>
      {hint && <p className="mt-0.5 text-caption text-text-secondary">{hint}</p>}
    </Link>
  );
}

/** Small bar chart without extra libraries: one bar per day of the last week. */
function SalesSparkline({ rows }: { rows: { date: string; sales: number }[] }) {
  const max = Math.max(...rows.map((row) => row.sales), 1);

  return (
    <div
      className="flex h-32 items-end gap-2"
      role="img"
      aria-label="Sales for the last seven days"
    >
      {rows.map((row) => (
        <div key={row.date} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-primary/80"
            style={{ height: `${Math.max(4, Math.round((row.sales / max) * 96))}px` }}
            title={`${formatDate(row.date)}: Rs ${formatAmount(row.sales)}`}
          />
          <span className="text-[10px] text-text-secondary">
            {new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { can, allow, user } = useAuth();
  // Cost, profit, stock value and shop expenses are the owner's numbers (4.G).
  const canSeeCosts = allow('costs:read');
  const canSeeExpenses = allow('expenses:read');
  const currency = useSettings((settings) => settings.currency);

  const { data, isLoading, error, reload } = useAsync(
    async () => unwrap(await getApi().reports.dashboard()),
    [],
  );

  const recentColumns: Column<OrderSummary>[] = [
    {
      key: 'orderNo',
      header: 'Order',
      render: (row) => <span className="font-medium">{row.orderNo}</span>,
    },
    { key: 'type', header: 'Type', render: (row) => ORDER_TYPE_LABELS[row.type] },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${ORDER_STATUS_CLASSES[row.status]}`}
        >
          {ORDER_STATUS_LABELS[row.status]}
        </span>
      ),
    },
    { key: 'customer', header: 'Customer', render: (row) => row.customerName || 'Walk-in' },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => `${currency} ${formatAmount(row.total)}`,
    },
    {
      key: 'createdAt',
      header: 'Time',
      align: 'right',
      render: (row) => formatDateTime(row.createdAt),
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName?.split(' ')[0] ?? 'there'}`}
        subtitle="Today's counter at a glance."
        actions={
          <>
            <Button variant="secondary" onClick={() => void reload()} isLoading={isLoading}>
              Refresh
            </Button>
            {can('orders') && (
              <Link
                to="/orders"
                className="inline-flex h-control items-center justify-center gap-2 rounded-control bg-primary px-4 text-button font-semibold text-white hover:bg-primary-dark"
              >
                <Plus aria-hidden className="h-4 w-4" />
                New order
              </Link>
            )}
          </>
        }
      />

      {error && (
        <Card className="mb-4 border-status-cancelled/30 bg-status-cancelled/5">
          <p className="text-body text-status-cancelled">{error}</p>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's sales"
          value={`${currency} ${formatAmount(data?.todaySales ?? 0)}`}
          hint={data ? `${data.todayOrders} paid/in-progress orders` : 'Loading…'}
          Icon={ShoppingBag}
          to="/orders"
          tone="primary"
        />
        <StatCard
          label="This month"
          value={`${currency} ${formatAmount(data?.monthSales ?? 0)}`}
          hint="Month to date"
          Icon={TrendingUp}
          to={can('reports') ? '/reports' : '/orders'}
          tone="success"
        />
        <StatCard
          label="Pending deliveries"
          value={String(data?.pendingDeliveries ?? 0)}
          hint="Not delivered yet"
          Icon={Bike}
          to="/orders"
          tone="accent"
        />
        <StatCard
          label="Menu items"
          value={String(data?.totalItems ?? 0)}
          hint={`${data?.activeStaff ?? 0} active staff`}
          Icon={Utensils}
          to={can('menu') ? '/menu' : '/orders'}
          tone="info"
        />
      </div>

      {/*
       * Monthly bills that are due or late (4.E2).
       *
       * A nudge, not a booking: this banner never creates an expense — it says what
       * is coming and links to the screen where the owner confirms the amount. Rent
       * is the one cost that is easy to forget for a week and impossible to explain
       * afterwards, which is exactly why it belongs on the first screen he opens.
       */}
      {canSeeExpenses && (data?.billsDue.length ?? 0) > 0 && (
        <Card className="mb-6 border-warning/40 bg-warning/5">
          <div className="flex flex-wrap items-start gap-3">
            <BellRing aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-text-primary">
                {data!.billsDue.length} monthly bill
                {data!.billsDue.length === 1 ? '' : 's'} to settle
              </p>
              <p className="text-body text-text-secondary">
                {data!.billsDue
                  .map(
                    (bill) =>
                      `${bill.name} — ${
                        bill.overdue
                          ? `${Math.abs(bill.daysUntilDue)} day${Math.abs(bill.daysUntilDue) === 1 ? '' : 's'} late`
                          : bill.daysUntilDue === 0
                            ? 'due today'
                            : `due in ${bill.daysUntilDue} day${bill.daysUntilDue === 1 ? '' : 's'}`
                      }`,
                  )
                  .join(' · ')}
              </p>
            </div>
            <Link
              to="/expenses"
              className="text-button font-medium text-primary hover:underline"
            >
              {allow('expenses:write') ? 'Record the payment' : 'View expenses'}
            </Link>
          </div>
        </Card>
      )}

      {/*
       * Roadmap 4.G cards. They only appear for a role that may see costs
       * (`costs:read`), because every number here — the day's gross profit, the
       * money on the shelf, today's spend — is one of the owner's private figures.
       */}
      {canSeeCosts && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Today's gross profit"
            value={
              data?.todayProfit
                ? `${currency} ${formatAmount(data.todayProfit.grossProfit)}`
                : '—'
            }
            hint={
              data?.todayProfit
                ? data.todayProfit.unpricedBills > 0
                  ? `${data.todayProfit.unpricedBills} bill(s) include an item with no recipe`
                  : 'Sales minus the cost of the food'
                : data && data.todayOrders > 0
                  ? 'No recipe means no cost, so no profit'
                  : 'No bills yet today'
            }
            Icon={Wallet}
            to="/reports"
            tone="success"
          />
          <StatCard
            label="Stock on the shelf"
            value={
              data?.stock ? `${currency} ${formatAmount(data.stock.value)}` : '—'
            }
            hint={
              data?.stock
                ? `${data.stock.lowStockCount} low · ${data.stock.outOfStockCount} out`
                : 'No stock list yet'
            }
            Icon={Package}
            to="/stock"
            tone="primary"
          />
          <StatCard
            label="Spent today"
            value={`${currency} ${formatAmount(data?.todayExpenses ?? 0)}`}
            hint="Rent, bills, salaries, repairs"
            Icon={TrendingUp}
            to="/expenses"
            tone="accent"
          />
          <StatCard
            label="Items with no recipe"
            value={String(data?.missingRecipes ?? 0)}
            hint={
              (data?.missingRecipes ?? 0) > 0
                ? 'Their profit cannot be worked out'
                : 'Every item is costed'
            }
            Icon={UtensilsCrossed}
            to={can('menu') ? '/menu' : '/orders'}
            tone={(data?.missingRecipes ?? 0) > 0 ? 'accent' : 'info'}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeading
            title="Recent orders"
            subtitle="The last orders taken at the counter"
            action={
              <Link
                to="/orders"
                className="text-caption font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            }
          />
          <Table
            columns={recentColumns}
            rows={data?.recentOrders ?? []}
            rowKey={(row) => row.id}
            isLoading={isLoading}
            emptyMessage="No orders yet"
            emptyHint="Orders you create on the Orders page will appear here."
          />
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeading title="Last 7 days" subtitle="Sales trend" />
            {data && data.salesByDay.length > 0 ? (
              <SalesSparkline rows={data.salesByDay} />
            ) : (
              <p className="py-8 text-center text-caption text-text-secondary">
                No sales recorded in the last 7 days.
              </p>
            )}
          </Card>

          <Card>
            <CardHeading title="Document reminders" subtitle="Expiring in the next 30 days" />
            {data && data.expiringVehicles.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {data.expiringVehicles.map((alert) => (
                  <li
                    key={`${alert.vehicleId}-${alert.document}`}
                    className="flex items-start gap-2 text-body"
                  >
                    <AlertTriangle
                      aria-hidden
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        alert.daysLeft < 0 ? 'text-status-cancelled' : 'text-secondary'
                      }`}
                    />
                    <span>
                      <span className="font-medium">{alert.plateNo}</span>{' '}
                      {alert.document === 'registration' ? 'registration' : 'insurance'}{' '}
                      {alert.daysLeft < 0
                        ? `expired ${Math.abs(alert.daysLeft)} days ago`
                        : `expires in ${alert.daysLeft} days`}{' '}
                      <span className="text-text-secondary">({formatDate(alert.expiryDate)})</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-caption text-text-secondary">
                No vehicle documents are expiring soon.
              </p>
            )}
          </Card>

          <Card>
            <CardHeading title="Quick actions" />
            <div className="flex flex-col gap-2">
              <Link
                to="/orders"
                className="flex h-control items-center gap-2 rounded-control border border-border px-3 text-button hover:bg-background"
              >
                <ClipboardList aria-hidden className="h-4 w-4 text-primary" />
                Go to orders
              </Link>
              {can('menu') && (
                <Link
                  to="/menu"
                  className="flex h-control items-center gap-2 rounded-control border border-border px-3 text-button hover:bg-background"
                >
                  <Utensils aria-hidden className="h-4 w-4 text-accent" />
                  Manage menu
                </Link>
              )}
              {can('staff') && (
                <Link
                  to="/staff"
                  className="flex h-control items-center gap-2 rounded-control border border-border px-3 text-button hover:bg-background"
                >
                  <Bike aria-hidden className="h-4 w-4 text-status-success" />
                  Staff and salaries
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>

      {data && data.recentOrders.length > 0 && (
        <p className="mt-4 flex items-center gap-1 text-caption text-text-secondary">
          <Badge tone="neutral">Tip</Badge>
          Click a dashboard card to jump straight to that module.
        </p>
      )}
    </div>
  );
}
