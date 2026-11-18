import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Filter, Plus, RefreshCw, Search, XCircle } from 'lucide-react';
import type { OrderFilter, OrderStatus, OrderSummary, OrderType } from '../../types/api';
import {
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_STATUS_CLASSES,
  PAYMENT_STATUS_LABELS,
} from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../store/settingsStore';
import { formatAmount, formatDateTime, monthStartIso, todayIso } from '../../utils/format';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Table, type Column } from '../../components/Table';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';

const STATUSES: Array<OrderStatus | 'all'> = [
  'all',
  'pending',
  'preparing',
  'ready',
  'delivered',
  'cancelled',
];

const TYPES: Array<OrderType | 'all'> = ['all', 'dine_in', 'takeaway', 'delivery'];

export function OrdersPage() {
  const navigate = useNavigate();
  const { allow } = useAuth();
  const currency = useSettings((settings) => settings.currency);

  const [filter, setFilter] = useState<OrderFilter>({
    search: '',
    status: 'all',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 200,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<OrderSummary | null>(null);

  /**
   * Keyset paging: the first page comes from useAsync, and "load more" appends the
   * next slice. Offsetting by page number would repeat or skip rows whenever a new
   * order arrives while the cashier is scrolling.
   */
  const PAGE_SIZE = 50;
  const [olderOrders, setOlderOrders] = useState<OrderSummary[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const orders = useAsync(
    async () => unwrap(await getApi().orders.list({ ...filter, limit: PAGE_SIZE })),
    [filter.search, filter.status, filter.type, filter.fromDate, filter.toDate],
  );

  /**
   * Changing a filter discards accumulated pages. Done in the setter rather than an
   * effect, so a page of stale rows is never rendered between the two renders.
   */
  const changeFilter = (patch: Partial<OrderFilter>) => {
    setOlderOrders([]);
    setFilter((current) => ({ ...current, ...patch }));
  };

  const visibleOrders = [...(orders.data ?? []), ...olderOrders];
  const lastOrder = visibleOrders[visibleOrders.length - 1];
  // A short page is the end of the list: no point asking for more.
  const hasMore = (orders.data ?? []).length === PAGE_SIZE;

  const loadMore = async () => {
    if (!lastOrder || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const next = unwrap(
        await getApi().orders.list({
          ...filter,
          limit: PAGE_SIZE,
          after: { createdAt: lastOrder.createdAt, id: lastOrder.id },
        }),
      );
      setOlderOrders((current) => [...current, ...next]);
    } catch (error) {
      toast.error(errorMessage(error, 'Older orders could not be loaded'));
    } finally {
      setIsLoadingMore(false);
    }
  };

  const cancelOrder = async () => {
    if (!cancelTarget) return;
    try {
      unwrap(await getApi().orders.cancel(cancelTarget.id));
      toast.success(`Order ${cancelTarget.orderNo} cancelled`);
      setOlderOrders([]);
      await orders.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const columns: Column<OrderSummary>[] = [
    {
      key: 'orderNo',
      header: 'Order',
      render: (row) => (
        <div>
          <p className="flex items-center gap-2 font-medium">
            {row.orderNo}
            {row.amendmentCount > 0 && (
              <span
                className="rounded-control bg-status-pending/10 px-1.5 py-0.5 text-[11px] font-semibold text-status-pending"
                title={`Edited ${row.amendmentCount} time(s)`}
              >
                edited
              </span>
            )}
            {row.tokenNo !== null && (
              <span
                className="rounded-control bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary"
                title="Token called out to the customer"
              >
                #{row.tokenNo}
              </span>
            )}
          </p>
          <p className="text-caption text-text-secondary">{row.invoiceNo ?? '—'}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (row) => ORDER_TYPE_LABELS[row.type] },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <div>
          <p>{row.customerName || 'Walk-in'}</p>
          {row.customerPhone && (
            <p className="text-caption text-text-secondary">{row.customerPhone}</p>
          )}
        </div>
      ),
    },
    {
      key: 'staff',
      header: 'Staff',
      render: (row) => row.waiterName ?? row.deliveryBoyName ?? '—',
    },
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
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => (
        <div>
          <p className="font-medium">
            {currency} {formatAmount(row.total)}
          </p>
          <span
            className={`mt-0.5 inline-flex rounded-full px-1.5 text-[11px] ${
              PAYMENT_STATUS_CLASSES[row.paymentStatus]
            }`}
          >
            {PAYMENT_STATUS_LABELS[row.paymentStatus]}
          </span>
        </div>
      ),
    },
    {
      key: 'createdAt',
      header: 'Taken',
      align: 'right',
      render: (row) => (
        <div>
          <p>{formatDateTime(row.createdAt)}</p>
          <p className="text-caption text-text-secondary">{row.createdByName}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            title="Open invoice"
            onClick={() => navigate(`/invoice/${row.id}`)}
          >
            <Eye aria-hidden className="h-4 w-4" />
          </Button>
          {allow('orders:cancel') && row.status !== 'cancelled' && row.status !== 'delivered' && (
            <Button variant="ghost" title="Cancel order" onClick={() => setCancelTarget(row)}>
              <XCircle aria-hidden className="h-4 w-4 text-status-cancelled" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const activeFilterCount = [
    filter.status !== 'all' ? filter.status : null,
    filter.type !== 'all' ? filter.type : null,
    filter.fromDate,
    filter.toDate,
  ].filter(Boolean).length;

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Search old orders, reprint invoices and move orders along."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => void orders.reload()}
              isLoading={orders.isLoading}
            >
              <RefreshCw aria-hidden className="h-4 w-4" />
              Refresh
            </Button>
            <Link
              to="/orders/new"
              className="inline-flex h-control items-center justify-center gap-2 rounded-control bg-primary px-4 text-button font-semibold text-white hover:bg-primary-dark"
            >
              <Plus aria-hidden className="h-4 w-4" />
              New order
            </Link>
          </>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            />
            <input
              value={filter.search}
              onChange={(event) => changeFilter({ search: event.target.value })}
              placeholder="Search order no., invoice no., customer or phone"
              aria-label="Search orders"
              className="h-control w-full rounded-control border border-border bg-surface pl-9 pr-3 text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => changeFilter({ status })}
                className={`h-8 rounded-full border px-3 text-caption font-medium ${
                  filter.status === status
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-surface text-text-secondary hover:text-text-primary'
                }`}
              >
                {status === 'all' ? 'All' : ORDER_STATUS_LABELS[status]}
              </button>
            ))}
          </div>

          <Button variant="secondary" onClick={() => setShowFilters((value) => !value)}>
            <Filter aria-hidden className="h-4 w-4" />
            More filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
        </div>

        {showFilters && (
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <label className="flex flex-col gap-1 text-caption text-text-secondary">
              Type
              <select
                value={filter.type}
                onChange={(event) =>
                  changeFilter({ type: event.target.value as OrderType | 'all' })
                }
                className="h-control rounded-control border border-border bg-surface px-3 text-body"
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === 'all' ? 'All types' : ORDER_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-caption text-text-secondary">
              From
              <input
                type="date"
                value={filter.fromDate}
                onChange={(event) => changeFilter({ fromDate: event.target.value })}
                className="h-control rounded-control border border-border bg-surface px-3 text-body"
              />
            </label>

            <label className="flex flex-col gap-1 text-caption text-text-secondary">
              To
              <input
                type="date"
                value={filter.toDate}
                onChange={(event) => changeFilter({ toDate: event.target.value })}
                className="h-control rounded-control border border-border bg-surface px-3 text-body"
              />
            </label>

            <Button
              variant="ghost"
              onClick={() =>
                changeFilter({
                  search: '',
                  status: 'all',
                  type: 'all',
                  fromDate: '',
                  toDate: '',
                })
              }
            >
              Clear filters
            </Button>

            <Button
              variant="secondary"
              onClick={() => changeFilter({ fromDate: monthStartIso(), toDate: todayIso() })}
            >
              This month
            </Button>
          </div>
        )}
      </Card>

      <Table
        columns={columns}
        rows={visibleOrders}
        rowKey={(row) => row.id}
        isLoading={orders.isLoading}
        emptyMessage="No orders found"
        emptyHint="Change the filters or take a new order."
      />

      {hasMore && (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" isLoading={isLoadingMore} onClick={() => void loadMore()}>
            Load older orders
          </Button>
        </div>
      )}

      <ConfirmDialog
        isOpen={cancelTarget !== null}
        title="Cancel this order?"
        message={`Order ${cancelTarget?.orderNo ?? ''} will be marked cancelled. This cannot be undone.`}
        confirmLabel="Cancel order"
        onConfirm={cancelOrder}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
