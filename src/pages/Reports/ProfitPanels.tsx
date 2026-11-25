import { useMemo } from 'react';
import type { ItemProfitRow, StockValuation } from '../../types/api';
import { Table, type Column } from '../../components/Table';
import { Card, CardHeading } from '../../components/Card';
import { Alert } from '../../components/Alert';
import { Badge } from '../../components/Badge';
import { formatAmount } from '../../utils/format';
import { formatQuantity, formatUnitCost } from '../../utils/units';

/**
 * Item profitability (Roadmap 4.G).
 *
 * Answers the question the top-items table cannot: which dishes actually make
 * money. Revenue and cost come from the frozen line snapshot, so this reconciles
 * with the P&L of the same period to the paisa.
 *
 * An item that sold with no recipe has no cost at all. Rather than showing a 100%
 * margin, the row says "unknown" and names the revenue that could not be priced —
 * a fake margin is worse than an admission.
 */
export function ItemProfitPanel({
  rows,
  currency,
  isLoading,
  error,
}: {
  rows: ItemProfitRow[];
  currency: string;
  isLoading: boolean;
  error: string | null;
}) {
  const totals = useMemo(() => {
    const priced = rows.filter((row) => row.marginX100 !== null);
    const revenue = priced.reduce((total, row) => total + row.pricedRevenue, 0);
    const cost = priced.reduce((total, row) => total + row.cost, 0);
    return {
      revenue,
      cost,
      profit: revenue - cost,
      marginX100: revenue > 0 ? Math.round(((revenue - cost) * 10_000) / revenue) : null,
      unpricedRevenue: rows.reduce((total, row) => total + row.unpricedRevenue, 0),
    };
  }, [rows]);

  const columns: Array<Column<ItemProfitRow>> = [
    {
      key: 'name',
      header: 'Item',
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          {row.unpricedReason === 'no_recipe' && (
            <p className="text-caption text-[#8a5b00]">No recipe — add one to cost it</p>
          )}
          {row.unpricedReason === 'sold_before_recipe' && (
            <p className="text-caption text-text-secondary">
              Sold before its recipe existed
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Sold',
      align: 'right',
      render: (row) => <span className="tabular">{row.qty}</span>,
    },
    {
      key: 'revenue',
      header: 'Revenue',
      align: 'right',
      render: (row) => <span className="tabular">{formatAmount(row.revenue)}</span>,
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right',
      render: (row) => <span className="tabular">{formatAmount(row.cost)}</span>,
    },
    {
      key: 'profit',
      header: 'Profit',
      align: 'right',
      render: (row) => (
        <span
          className={`font-semibold tabular ${
            row.pricedRevenue === 0
              ? 'text-text-secondary'
              : row.profit >= 0
                ? 'text-status-success'
                : 'text-status-cancelled'
          }`}
        >
          {row.pricedRevenue === 0 ? '—' : formatAmount(row.profit)}
        </span>
      ),
    },
    {
      key: 'margin',
      header: 'Margin',
      align: 'right',
      render: (row) =>
        row.marginX100 === null ? (
          <Badge tone="pending">Unknown</Badge>
        ) : (
          <span
            className={`tabular ${
              row.marginX100 < 2000 ? 'font-semibold text-status-cancelled' : 'text-text-primary'
            }`}
          >
            {(row.marginX100 / 100).toFixed(1)}%
          </span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      {totals.unpricedRevenue > 0 && (
        <Alert tone="info">{`${currency} ${formatAmount(
          totals.unpricedRevenue,
        )} of sales could not be costed, so their profit is not in the margin above. Items marked "no recipe" need one; items marked "sold before its recipe existed" are already fixed for future bills — only amending the old bill can price it.`}</Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Revenue (costed)" value={`${currency} ${formatAmount(totals.revenue)}`} />
        <Tile label="Cost of those sales" value={`${currency} ${formatAmount(totals.cost)}`} />
        <Tile
          label="Profit"
          value={`${currency} ${formatAmount(totals.profit)}`}
          tone={totals.profit >= 0 ? 'good' : 'bad'}
        />
        <Tile
          label="Overall margin"
          value={totals.marginX100 === null ? '—' : `${(totals.marginX100 / 100).toFixed(1)}%`}
        />
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.itemId ?? row.name}`}
        isLoading={isLoading}
        emptyMessage="Nothing sold in this period"
      />
    </div>
  );
}

/**
 * Stock valuation (Roadmap 4.G).
 *
 * What is on the shelf, worth what it cost. The important second number is
 * `lowStockValue`: money already spent on ingredients the shop is about to run out
 * of, which is the one stock figure an owner can act on today.
 */
export function StockValuePanel({
  valuation,
  currency,
  isLoading,
  error,
}: {
  valuation: StockValuation | null;
  currency: string;
  isLoading: boolean;
  error: string | null;
}) {
  const columns: Array<Column<StockValuation['rows'][number]>> = [
    {
      key: 'name',
      header: 'Ingredient',
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-caption text-text-secondary">
            {row.category}
            {row.supplierName ? ` · ${row.supplierName}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'On the shelf',
      align: 'right',
      render: (row) => (
        <span className={`tabular ${row.lowStock ? 'font-semibold text-[#8a5b00]' : ''}`}>
          {formatQuantity(row.qtyOnHand, row.baseUnit, row.purchaseUnit, row.unitsPerPurchase)}
        </span>
      ),
    },
    {
      key: 'cost',
      header: 'Average cost',
      align: 'right',
      render: (row) => (
        <span className="tabular text-text-secondary">
          {formatUnitCost(row.avgCostMilli, row.baseUnit)}
        </span>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      render: (row) => (
        <span className="font-semibold tabular">{formatAmount(row.value)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Money on the shelf" value={`${currency} ${formatAmount(valuation?.totalValue ?? 0)}`} />
        <Tile label="Ingredients" value={String(valuation?.itemCount ?? 0)} />
        <Tile
          label="Low stock"
          value={String(valuation?.lowStockCount ?? 0)}
          tone={(valuation?.lowStockCount ?? 0) > 0 ? 'warn' : 'plain'}
        />
        <Tile
          label="Value in low stock"
          value={`${currency} ${formatAmount(valuation?.lowStockValue ?? 0)}`}
          tone={(valuation?.lowStockValue ?? 0) > 0 ? 'warn' : 'plain'}
        />
      </div>

      {(valuation?.byCategory.length ?? 0) > 1 && (
        <Card>
          <CardHeading title="Where the money sits" />
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {valuation?.byCategory.map((group) => (
              <div key={group.category} className="flex items-baseline gap-2">
                <span className="text-body text-text-secondary">{group.category}</span>
                <span className="font-semibold tabular">
                  {currency} {formatAmount(group.value)}
                </span>
                <span className="text-caption text-text-secondary">({group.itemCount})</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Table
        columns={columns}
        rows={valuation?.rows ?? []}
        rowKey={(row) => row.ingredientId}
        isLoading={isLoading}
        emptyMessage="No ingredients in the stock list yet"
      />
    </div>
  );
}

/** A single number with a label and an optional colour, used by both panels. */
function Tile({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'good' | 'bad' | 'warn';
}) {
  const colour =
    tone === 'good'
      ? 'text-status-success'
      : tone === 'bad'
        ? 'text-status-cancelled'
        : tone === 'warn'
          ? 'text-[#8a5b00]'
          : 'text-text-primary';

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <p className="text-caption text-text-secondary">{label}</p>
      <p className={`mt-1 text-[22px] font-bold tabular ${colour}`}>{value}</p>
    </div>
  );
}
