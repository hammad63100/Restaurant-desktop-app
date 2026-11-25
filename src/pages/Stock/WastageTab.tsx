import { useMemo, useState } from 'react';
import { CalendarRange, Coins, PackageX, Trash2 } from 'lucide-react';
import {
  WASTAGE_REASON_LABELS,
  type Ingredient,
  type WastageRow,
} from '../../types/api';
import { getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { formatAmount } from '../../utils/format';
import { formatQuantity } from '../../utils/units';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { Alert } from '../../components/Alert';
import { WastageModal } from './WastageModal';

/** The first day of the month the shop is in, so the tab opens on "this month". */
function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayText(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Wastage (Roadmap 4.F).
 *
 * Two halves, deliberately: the top says what was thrown away in a period and what
 * it cost, the bottom is the button that records it. The owner's question is always
 * "how much am I losing?", not "let me enter a row", so the report comes first.
 */
export function WastageTab({
  ingredients,
  canWrite,
  onChanged,
}: {
  ingredients: Ingredient[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(todayText());
  const [entryOpen, setEntryOpen] = useState(false);

  const report = useAsync(
    async () => unwrap(await getApi().stock.wastageReport({ fromDate, toDate })),
    [fromDate, toDate],
  );

  const refresh = async () => {
    await report.reload();
    onChanged();
  };

  const rows = useMemo(() => report.data?.rows ?? [], [report.data]);

  const byReason = useMemo(() => {
    const totals = new Map<string, { qty: number; value: number; unit: string }>();
    for (const row of rows) {
      const key = `${row.reason}|${row.baseUnit}`;
      const current = totals.get(key);
      totals.set(key, {
        qty: (current?.qty ?? 0) + row.qty,
        value: (current?.value ?? 0) + row.value,
        unit: row.baseUnit,
      });
    }
    return Array.from(totals.entries())
      .map(([key, value]) => ({ reason: key.split('|')[0], ...value }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  // The report is grouped by ingredient+reason, so the same reason can appear on
  // several rows; summing those rows gives the reason's share of the loss.
  const columns: Array<Column<WastageRow>> = [
    {
      key: 'ingredient',
      header: 'Ingredient',
      render: (row) => (
        <div>
          <p className="font-medium">{row.ingredientName}</p>
          <p className="text-caption text-text-secondary">{row.baseUnit}</p>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Why',
      render: (row) => <Badge tone="neutral">{WASTAGE_REASON_LABELS[row.reason]}</Badge>,
    },
    {
      key: 'movements',
      header: 'Times',
      align: 'right',
      render: (row) => <span className="tabular text-text-secondary">{row.movements}</span>,
    },
    {
      key: 'qty',
      header: 'Quantity lost',
      align: 'right',
      render: (row) => (
        <span className="tabular">
          {formatQuantity(row.qty, row.baseUnit)}
        </span>
      ),
    },
    {
      key: 'value',
      header: 'Worth',
      align: 'right',
      render: (row) => <span className="font-medium tabular">Rs {formatAmount(row.value)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Input
              label="From"
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </div>
          <div className="w-40">
            <Input
              label="To"
              type="date"
              value={toDate}
              max={todayText()}
              onChange={(event) => setToDate(event.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setFromDate(monthStart());
              setToDate(todayText());
            }}
          >
            <CalendarRange aria-hidden className="h-4 w-4" />
            This month
          </Button>
        </div>

        {canWrite && (
          <Button onClick={() => setEntryOpen(true)}>
            <Trash2 aria-hidden className="h-4 w-4" />
            Record wastage
          </Button>
        )}
      </div>

      {report.error && <Alert tone="error">{report.error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <SummaryTile
          label="Money thrown away"
          value={`Rs ${formatAmount(report.data?.total ?? 0)}`}
          icon={Coins}
          tone="danger"
        />
        <SummaryTile
          label="Entries"
          value={String(rows.reduce((total, row) => total + row.movements, 0))}
          icon={PackageX}
          tone="neutral"
        />
        <SummaryTile
          label="Ingredients affected"
          value={String(new Set(rows.map((row) => row.ingredientId)).size)}
          icon={Trash2}
          tone="neutral"
        />
      </div>

      {byReason.length > 0 && (
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="mb-2 text-caption font-medium text-text-secondary">
            Where the money went
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {byReason.map((entry) => (
              <div key={`${entry.reason}-${entry.unit}`} className="flex items-baseline gap-2">
                <span className="text-body">
                  {WASTAGE_REASON_LABELS[entry.reason as keyof typeof WASTAGE_REASON_LABELS] ??
                    entry.reason}
                </span>
                <span className="font-semibold tabular text-status-cancelled">
                  Rs {formatAmount(entry.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Table
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.ingredientId}-${row.reason}`}
        isLoading={report.isLoading}
        emptyMessage="Nothing was thrown away in this period"
        emptyHint="That is good news — or nothing has been recorded yet."
      />

      {entryOpen && (
        <WastageModal
          ingredients={ingredients}
          onClose={() => setEntryOpen(false)}
          onSaved={() => {
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Coins;
  tone: 'neutral' | 'danger';
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-caption text-text-secondary">{label}</p>
        <Icon aria-hidden className="h-4 w-4 text-text-secondary" />
      </div>
      <p
        className={`mt-1 text-[22px] font-bold tabular ${
          tone === 'danger' ? 'text-status-cancelled' : 'text-text-primary'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
