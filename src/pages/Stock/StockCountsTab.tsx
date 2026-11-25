import { useState } from 'react';
import { ClipboardCheck, Scale, SlidersHorizontal } from 'lucide-react';
import type { Ingredient, StockCount } from '../../types/api';
import { getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { formatAmount, formatDate } from '../../utils/format';
import { Button } from '../../components/Button';
import { Table, type Column } from '../../components/Table';
import { Alert } from '../../components/Alert';
import { Badge } from '../../components/Badge';
import { StockCountModal } from './StockCountModal';
import { StockCountDetailModal } from './StockCountDetailModal';
import { AdjustmentModal } from './AdjustmentModal';

/**
 * Stock counts and adjustments (Roadmap 4.F).
 *
 * Both live on one tab because they answer the same question — "why is the shelf
 * different from the book?" — and the owner should not have to guess which of two
 * screens to open. The count is the big, periodic, shelf-wide version; the
 * adjustment is the small, one-off correction.
 */
export function StockCountsTab({
  ingredients,
  canWrite,
  onChanged,
}: {
  ingredients: Ingredient[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [countOpen, setCountOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [detail, setDetail] = useState<StockCount | null>(null);

  const counts = useAsync(async () => unwrap(await getApi().stock.counts()), []);

  const refresh = async () => {
    await counts.reload();
    onChanged();
  };

  const rows = counts.data ?? [];

  const columns: Array<Column<StockCount>> = [
    {
      key: 'countNo',
      header: 'Count',
      render: (count) => (
        <button
          type="button"
          onClick={() => setDetail(count)}
          className="text-left"
          title="See what the count found"
        >
          <p className="font-medium tabular text-text-primary underline-offset-2 hover:underline">
            {count.countNo}
          </p>
          <p className="text-caption text-text-secondary">{formatDate(count.countedOn)}</p>
        </button>
      ),
    },
    {
      key: 'lines',
      header: 'Lines',
      align: 'right',
      render: (count) => <span className="tabular text-text-secondary">{count.lineCount}</span>,
    },
    {
      key: 'variance',
      header: 'Value of difference',
      align: 'right',
      render: (count) =>
        count.varianceValue === 0 ? (
          <Badge tone="success">Matched</Badge>
        ) : (
          <span className="font-semibold tabular text-status-cancelled">
            Rs {formatAmount(count.varianceValue)}
          </span>
        ),
    },
    {
      key: 'by',
      header: 'Counted by',
      render: (count) => (
        <span className="text-text-secondary">
          {count.createdByName}
          {count.notes ? <span className="block text-caption">{count.notes}</span> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-text-secondary">
          A count sets the shelf to the number you counted. An adjustment corrects one
          ingredient by a known amount.
        </p>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setAdjustOpen(true)}>
              <SlidersHorizontal aria-hidden className="h-4 w-4" />
              Adjust stock
            </Button>
            <Button onClick={() => setCountOpen(true)}>
              <ClipboardCheck aria-hidden className="h-4 w-4" />
              Count the shelf
            </Button>
          </div>
        )}
      </div>

      {counts.error && <Alert tone="error">{counts.error}</Alert>}

      <Table
        columns={columns}
        rows={rows}
        rowKey={(count) => count.id}
        isLoading={counts.isLoading}
        emptyMessage="No stock count has been saved yet"
        emptyHint="Count the shelf at closing time and the app will value the difference."
      />

      {rows.length > 0 && (
        <p className="flex items-start gap-2 text-caption text-text-secondary">
          <Scale aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The value of each difference is frozen at the average cost on the day of the count, so a
          later price change never rewrites history.
        </p>
      )}

      {countOpen && (
        <StockCountModal
          ingredients={ingredients}
          onClose={() => setCountOpen(false)}
          onSaved={() => {
            void refresh();
          }}
        />
      )}

      {adjustOpen && (
        <AdjustmentModal
          ingredients={ingredients}
          onClose={() => setAdjustOpen(false)}
          onSaved={() => {
            void refresh();
          }}
        />
      )}

      {detail && (
        <StockCountDetailModal
          count={detail}
          onClose={() => {
            setDetail(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
