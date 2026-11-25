import { AlertCircle } from 'lucide-react';
import type { StockCount } from '../../types/api';
import { getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { formatAmount, formatDateTime } from '../../utils/format';
import { formatQuantity } from '../../utils/units';
import { Modal } from '../../components/Modal';
import { Alert } from '../../components/Alert';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import type { StockCountLine } from '../../types/api';

/**
 * What one saved count found (Roadmap 4.F).
 *
 * The comparison is the useful part: book vs counted side by side, with the
 * difference signed so a shortfall reads as a loss rather than an absolute number.
 * The money is frozen at the moment of the count and never recalculated.
 */
export function StockCountDetailModal({
  count,
  onClose,
}: {
  count: StockCount;
  onClose: () => void;
}) {
  const detail = useAsync(async () => unwrap(await getApi().stock.count({ id: count.id })), [count.id]);

  const columns: Array<Column<StockCountLine>> = [
    {
      key: 'ingredient',
      header: 'Ingredient',
      render: (line) => <span className="font-medium">{line.ingredientName}</span>,
    },
    {
      key: 'book',
      header: 'On the book',
      align: 'right',
      render: (line) => formatQuantity(line.bookQty, line.baseUnit),
    },
    {
      key: 'counted',
      header: 'Counted',
      align: 'right',
      render: (line) => formatQuantity(line.countedQty, line.baseUnit),
    },
    {
      key: 'variance',
      header: 'Difference',
      align: 'right',
      render: (line) =>
        line.variance === 0 ? (
          <span className="text-text-secondary">—</span>
        ) : (
          <Badge tone={line.variance > 0 ? 'success' : 'danger'}>
            {line.variance > 0 ? '+' : ''}
            {line.variance}
          </Badge>
        ),
    },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      render: (line) => (
        <span className="tabular">
          {line.varianceValue === 0 ? '—' : `Rs ${formatAmount(line.varianceValue)}`}
        </span>
      ),
    },
  ];

  return (
    <Modal
      isOpen
      title={`Stock count ${count.countNo}`}
      description={`Counted on ${count.countedOn} by ${count.createdByName}`}
      onClose={onClose}
      size="lg"
      footer={
        <p className="mr-auto text-body text-text-secondary">
          Value of the difference:{' '}
          <span className="font-semibold tabular text-text-primary">
            Rs {formatAmount(count.varianceValue)}
          </span>
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        {detail.isLoading && <p className="text-body text-text-secondary">Loading the count…</p>}

        {detail.error && <Alert tone="error">{detail.error}</Alert>}

        {detail.data && (
          <>
            {count.notes && (
              <p className="rounded-card border border-border bg-background px-3 py-2 text-body">
                {count.notes}
              </p>
            )}

            <Table
              columns={columns}
              rows={detail.data.lines}
              rowKey={(line) => line.id}
              emptyMessage="This count had no lines."
            />

            <p className="flex items-start gap-2 text-caption text-text-secondary">
              <AlertCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The shelf was set to the counted quantity for every line above; the book quantity is
              what the ledger said at that moment. Saved {formatDateTime(count.createdAt)}.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
