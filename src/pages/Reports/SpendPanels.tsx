import { WASTAGE_REASON_LABELS, type ExpenseReport, type PurchaseReport, type WastageReportFull } from '../../types/api';
import { Table, type Column } from '../../components/Table';
import { Card, CardHeading } from '../../components/Card';
import { Alert } from '../../components/Alert';
import { Badge } from '../../components/Badge';
import { formatAmount, formatDate } from '../../utils/format';
import { formatQuantity, formatUnitCost } from '../../utils/units';

/**
 * Purchases (Roadmap 4.G).
 *
 * The money that left for stock, and — the part an owner actually checks — what is
 * still owed. `outstanding` is only ever non-zero on a credit bill that is not
 * voided; a cash bill is settled at the counter and a voided one never happened.
 */
export function PurchasesPanel({
  report,
  currency,
  isLoading,
  error,
}: {
  report: PurchaseReport | null;
  currency: string;
  isLoading: boolean;
  error: string | null;
}) {
  const columns: Array<Column<PurchaseReport['rows'][number]>> = [
    {
      key: 'purchaseNo',
      header: 'Purchase',
      render: (row) => (
        <div>
          <p className="font-medium tabular">{row.purchaseNo}</p>
          <p className="text-caption text-text-secondary">{formatDate(row.purchasedOn)}</p>
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (row) => (
        <div>
          <p>{row.supplierName ?? 'Cash purchase'}</p>
          {row.billNo && <p className="text-caption text-text-secondary">Bill {row.billNo}</p>}
        </div>
      ),
    },
    {
      key: 'lines',
      header: 'Items',
      align: 'right',
      render: (row) => <span className="tabular text-text-secondary">{row.lineCount}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => <span className="tabular">{formatAmount(row.total)}</span>,
    },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      render: (row) => <span className="tabular text-text-secondary">{formatAmount(row.paidAmount)}</span>,
    },
    {
      key: 'outstanding',
      header: 'Owed',
      align: 'right',
      render: (row) =>
        row.status === 'void' ? (
          <Badge tone="danger">Voided</Badge>
        ) : row.outstanding > 0 ? (
          <span className="font-semibold tabular text-status-cancelled">
            {formatAmount(row.outstanding)}
          </span>
        ) : (
          <span className="text-text-secondary">—</span>
        ),
    },
  ];

  const ingredientColumns: Array<Column<PurchaseReport['byIngredient'][number]>> = [
    {
      key: 'name',
      header: 'Ingredient',
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-caption text-text-secondary">
            {row.purchaseCount} bill{row.purchaseCount === 1 ? '' : 's'}
          </p>
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Bought',
      align: 'right',
      render: (row) => <span className="tabular">{formatQuantity(row.qtyBase, row.baseUnit)}</span>,
    },
    {
      key: 'spend',
      header: 'Spent',
      align: 'right',
      render: (row) => <span className="font-semibold tabular">{formatAmount(row.spend)}</span>,
    },
    {
      key: 'price',
      header: 'Last price',
      align: 'right',
      render: (row) =>
        row.lastCostMilli === null ? (
          <span className="text-text-secondary">—</span>
        ) : (
          <span className="tabular text-text-secondary">
            {formatUnitCost(row.lastCostMilli, row.baseUnit)}
          </span>
        ),
    },
    {
      key: 'change',
      header: 'Change',
      align: 'right',
      render: (row) => {
        if (row.changeX100 === null) return <span className="text-text-secondary">—</span>;
        if (row.changeX100 === 0) return <Badge tone="success">Unchanged</Badge>;
        return (
          <Badge tone={row.changeX100 > 0 ? 'danger' : 'success'}>
            {row.changeX100 > 0 ? '+' : ''}
            {(row.changeX100 / 100).toFixed(1)}%
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Stock received" value={`${currency} ${formatAmount(report?.received ?? 0)}`} />
        <Tile label="Cash paid" value={`${currency} ${formatAmount(report?.paid ?? 0)}`} />
        <Tile
          label="Still owed"
          value={`${currency} ${formatAmount(report?.outstanding ?? 0)}`}
          tone={(report?.outstanding ?? 0) > 0 ? 'warn' : 'plain'}
        />
        <Tile
          label="Voided bills"
          value={String(report?.voidedCount ?? 0)}
          hint={report?.voidedValue ? `${currency} ${formatAmount(report.voidedValue)}` : undefined}
        />
      </div>

      {(report?.bySupplier.length ?? 0) > 0 && (
        <Card>
          <CardHeading title="By supplier" />
          <div className="mt-2 flex flex-col gap-1">
            {report?.bySupplier.map((row) => (
              <div
                key={row.supplierName ?? 'cash'}
                className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1 last:border-0"
              >
                <span className="text-body">{row.supplierName ?? 'Cash purchase'}</span>
                <span className="flex items-baseline gap-4">
                  <span className="text-caption text-text-secondary">{row.count} bills</span>
                  <span className="font-semibold tabular">{formatAmount(row.total)}</span>
                  {row.outstanding > 0 && (
                    <span className="text-caption tabular text-status-cancelled">
                      {formatAmount(row.outstanding)} owed
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/*
        The same money seen from the other side. The bill list answers "what did I
        pay?"; this answers "what has been getting dearer?" — which is the question
        that protects the margin, because a rise here silently eats every recipe
        that uses the ingredient.
      */}
      {(report?.byIngredient.length ?? 0) > 0 && (
        <Card>
          <CardHeading
            title="By ingredient, with price trend"
            subtitle="First and last price paid in this period — a rise here eats every recipe that uses it"
          />
          <div className="mt-3">
            <Table
              columns={ingredientColumns}
              rows={report?.byIngredient ?? []}
              rowKey={(row) => row.ingredientId}
              emptyMessage="No ingredient purchases in this period"
            />
          </div>
        </Card>
      )}

      <Table
        columns={columns}
        rows={report?.rows ?? []}
        rowKey={(row) => row.purchaseId}
        isLoading={isLoading}
        emptyMessage="No purchases in this period"
        emptyHint="Press Add purchase on the Stock page when a delivery arrives."
      />
    </div>
  );
}

/**
 * Wastage (Roadmap 4.G).
 *
 * The Stock page already has an entry screen; this is the report the owner reads.
 * Same numbers (straight from the 4.F read model), plus a daily trend and the
 * single worst reason, which is what turns "we lost Rs 900" into "we lost Rs 900
 * because buns keep expiring".
 */
export function WastagePanel({
  report,
  currency,
  isLoading,
  error,
}: {
  report: WastageReportFull | null;
  currency: string;
  isLoading: boolean;
  error: string | null;
}) {
  const columns: Array<Column<WastageReportFull['rows'][number]>> = [
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
      key: 'times',
      header: 'Times',
      align: 'right',
      render: (row) => <span className="tabular text-text-secondary">{row.movements}</span>,
    },
    {
      key: 'qty',
      header: 'Quantity',
      align: 'right',
      render: (row) => <span className="tabular">{formatQuantity(row.qty, row.baseUnit)}</span>,
    },
    {
      key: 'value',
      header: 'Worth',
      align: 'right',
      render: (row) => <span className="font-semibold tabular">{formatAmount(row.value)}</span>,
    },
  ];

  const worstDay = report?.byDay.reduce(
    (worst, day) => (day.value > (worst?.value ?? 0) ? day : worst),
    undefined as { date: string; qty: number; value: number } | undefined,
  );

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total loss" value={`${currency} ${formatAmount(report?.total ?? 0)}`} tone="bad" />
        <Tile
          label="Biggest reason"
          value={
            report?.worstReason ? WASTAGE_REASON_LABELS[report.worstReason.reason] : 'Nothing wasted'
          }
          hint={
            report?.worstReason ? `${currency} ${formatAmount(report.worstReason.value)}` : undefined
          }
        />
        <Tile
          label="Worst day"
          value={worstDay ? formatDate(worstDay.date) : '—'}
          hint={worstDay ? `${currency} ${formatAmount(worstDay.value)}` : undefined}
        />
        <Tile label="Entries" value={String(report?.rows.reduce((t, r) => t + r.movements, 0) ?? 0)} />
      </div>

      {(report?.byDay.length ?? 0) > 1 && (
        <Card>
          <CardHeading title="Day by day" />
          <div className="mt-3 flex items-end gap-1">
            {report?.byDay.map((day) => {
              const peak = Math.max(...(report?.byDay.map((d) => d.value) ?? [1]), 1);
              const height = Math.max(4, Math.round((day.value / peak) * 64));
              return (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={`${day.date}: ${formatAmount(day.value)}`}>
                  <div
                    className="w-full rounded-t bg-status-cancelled/70"
                    style={{ height: `${height}px` }}
                  />
                  <span className="text-[10px] text-text-secondary">{day.date.slice(8)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Table
        columns={columns}
        rows={report?.rows ?? []}
        rowKey={(row) => `${row.ingredientId}-${row.reason}`}
        isLoading={isLoading}
        emptyMessage="Nothing was wasted in this period"
        emptyHint="Nothing recorded is not the same as nothing lost — check the Wastage tab on Stock."
      />
    </div>
  );
}

/**
 * Expenses (Roadmap 4.G).
 *
 * The operating costs that turn gross profit into net profit. Grouped three ways
 * because the useful question changes: "what did we spend on?" (category), "where
 * did it come from?" (the till or the bank), and "which day was heavy?".
 */
export function ExpensesPanel({
  report,
  currency,
  isLoading,
  error,
}: {
  report: ExpenseReport | null;
  currency: string;
  isLoading: boolean;
  error: string | null;
}) {
  const categoryColumns: Array<Column<ExpenseReport['byCategory'][number]>> = [
    { key: 'name', header: 'Category', render: (row) => row.categoryName },
    {
      key: 'count',
      header: 'Entries',
      align: 'right',
      render: (row) => <span className="tabular text-text-secondary">{row.count}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => <span className="font-semibold tabular">{formatAmount(row.total)}</span>,
    },
  ];

  const WALLET_LABELS: Record<string, string> = {
    cash: 'From the drawer',
    bank: 'Bank account',
    outside: 'Paid from outside',
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total spent" value={`${currency} ${formatAmount(report?.total ?? 0)}`} />
        <Tile label="Entries" value={String(report?.count ?? 0)} />
        <Tile
          label="From the drawer"
          value={`${currency} ${formatAmount(
            report?.byPaidFrom.find((row) => row.paidFrom === 'cash')?.total ?? 0,
          )}`}
        />
        <Tile
          label="Voided"
          value={String(report?.voidedCount ?? 0)}
          hint={report?.voidedValue ? `${currency} ${formatAmount(report.voidedValue)}` : undefined}
        />
      </div>

      {/*
        The other cost ledgers, shown on this screen but never folded into the total
        above. The plan asks for them here so the owner sees one hisab; keeping them
        separate is what stops the same rupee being counted twice.
      */}
      {(report?.otherCosts.some((line) => line.total > 0) ?? false) && (
        <Card>
          <CardHeading
            title="Also paid this period"
            subtitle="Recorded elsewhere — listed here, not part of the expenses total above"
          />
          <div className="mt-2 flex flex-col gap-1">
            {report?.otherCosts.map((line) => (
              <div
                key={line.key}
                className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1 last:border-0"
              >
                <span className="text-body">
                  {line.label}
                  <span className="ml-2 text-caption text-text-secondary">
                    {line.source}
                    {line.count > 0 ? ` · ${line.count}` : ''}
                  </span>
                </span>
                <span
                  className={`font-semibold tabular ${
                    line.total > 0 ? 'text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  {currency} {formatAmount(line.total)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(report?.byPaidFrom.length ?? 0) > 0 && (
        <Card>
          <CardHeading title="Where the money came from" />
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {report?.byPaidFrom.map((row) => (
              <div key={row.paidFrom} className="flex items-baseline gap-2">
                <span className="text-body text-text-secondary">
                  {WALLET_LABELS[row.paidFrom] ?? row.paidFrom}
                </span>
                <span className="font-semibold tabular">
                  {currency} {formatAmount(row.total)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Table
        columns={categoryColumns}
        rows={report?.byCategory ?? []}
        rowKey={(row) => row.categoryName}
        isLoading={isLoading}
        emptyMessage="No expenses in this period"
        emptyHint="Enter rent, electricity and salaries on the Expenses page."
      />
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'plain' | 'bad' | 'warn';
}) {
  const colour =
    tone === 'bad' ? 'text-status-cancelled' : tone === 'warn' ? 'text-[#8a5b00]' : 'text-text-primary';

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <p className="text-caption text-text-secondary">{label}</p>
      <p className={`mt-1 text-[22px] font-bold tabular ${colour}`}>{value}</p>
      {hint && <p className="text-caption text-text-secondary">{hint}</p>}
    </div>
  );
}
