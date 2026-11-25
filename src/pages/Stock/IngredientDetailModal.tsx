import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Undo2 } from 'lucide-react';
import type { IngredientDetail, StockMovement, StockMovementKind } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatAmount, formatDate, formatDateTime } from '../../utils/format';
import { BASE_UNIT_SHORT, formatQuantity, formatUnitCost } from '../../utils/units';
import { Modal } from '../../components/Modal';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { Alert } from '../../components/Alert';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/Button';
import { SupplierReturnModal } from './SupplierReturnModal';

interface IngredientDetailModalProps {
  ingredientId: number;
  onClose: () => void;
}

/**
 * Everything the app knows about one ingredient, in one place.
 *
 * Three questions a shopkeeper actually asks, in the order he asks them:
 *
 *   1. "How much do I have, and at what price?"      → the header
 *   2. "What did I pay last time, and the time before?" → price history
 *   3. "Where did it all go?"                        → the ledger
 *
 * The ledger is the honest one: `qty_on_hand` is a cache of it, so if the two ever
 * disagree the list below is the truth. That is exactly why it is worth showing.
 */

const MOVEMENT_LABELS: Record<StockMovementKind, string> = {
  opening: 'Opening stock',
  purchase: 'Purchase',
  purchase_void: 'Purchase voided',
  sale: 'Sold',
  sale_reversal: 'Sale reversed',
  wastage: 'Wastage',
  adjustment: 'Adjustment',
  supplier_return: 'Returned to supplier',
  stock_count: 'Stock count',
  sub_recipe_make: 'Batch made',
  sub_recipe_unmake: 'Batch undone',
};

/** Which movements add stock, which remove it, and which are a correction. */
const MOVEMENT_TONE: Record<StockMovementKind, 'success' | 'danger' | 'neutral'> = {
  opening: 'success',
  purchase: 'success',
  purchase_void: 'danger',
  sale: 'danger',
  sale_reversal: 'success',
  wastage: 'danger',
  adjustment: 'neutral',
  supplier_return: 'danger',
  // A batch is signed like any other movement: the components come off (negative)
  // and the product goes on (positive). Showing both under one label is honest —
  // the qty column already carries the direction.
  sub_recipe_make: 'neutral',
  sub_recipe_unmake: 'neutral',
  stock_count: 'neutral',
};

export function IngredientDetailModal({ ingredientId, onClose }: IngredientDetailModalProps) {
  const [tab, setTab] = useState<'movements' | 'prices' | 'recipes'>('movements');
  const [returnOpen, setReturnOpen] = useState(false);
  const { allow } = useAuth();
  const canReturn = allow('stock:adjust');

  // The supplier picker only needs the list, so it is loaded with the detail rather
  // than passed down from the page — this modal can be opened from anywhere.
  const suppliers = useAsync(async () => unwrap(await getApi().stock.suppliers()), []);

  const detail = useAsync(
    async () => unwrap(await getApi().stock.ingredient({ id: ingredientId })),
    [ingredientId],
  );

  const data: IngredientDetail | null = detail.data ?? null;
  const ingredient = data?.ingredient ?? null;

  const movementColumns: Column<StockMovement>[] = [
    {
      key: 'when',
      header: 'When',
      render: (row) => (
        <span className="whitespace-nowrap text-caption">{formatDateTime(row.createdAt)}</span>
      ),
    },
    {
      key: 'kind',
      header: 'What',
      render: (row) => (
        <div>
          <Badge tone={MOVEMENT_TONE[row.kind]}>{MOVEMENT_LABELS[row.kind]}</Badge>
          {row.reason && <p className="mt-1 text-caption text-text-secondary">{row.reason}</p>}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Quantity',
      align: 'right',
      render: (row) => {
        const positive = row.qty > 0;
        return (
          <span
            className={`flex items-center justify-end gap-1 tabular font-medium ${
              positive ? 'text-status-success' : 'text-status-cancelled'
            }`}
          >
            {positive ? (
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight aria-hidden className="h-3.5 w-3.5" />
            )}
            {ingredient
              ? formatQuantity(
                  Math.abs(row.qty),
                  ingredient.baseUnit,
                  ingredient.purchaseUnit,
                  ingredient.unitsPerPurchase,
                )
              : Math.abs(row.qty)}
          </span>
        );
      },
    },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      render: (row) => (
        <span className="tabular text-caption text-text-secondary">{formatAmount(row.value)}</span>
      ),
    },
    {
      key: 'by',
      header: 'By',
      render: (row) => <span className="text-caption">{row.createdByName}</span>,
    },
  ];

  return (
    <Modal
      isOpen
      title={ingredient ? ingredient.name : 'Ingredient'}
      description={
        ingredient
          ? `${ingredient.category} · ${formatQuantity(
              ingredient.qtyOnHand,
              ingredient.baseUnit,
              ingredient.purchaseUnit,
              ingredient.unitsPerPurchase,
            )} on hand at ${formatUnitCost(ingredient.avgCostMilli, ingredient.baseUnit)}`
          : 'Loading…'
      }
      onClose={onClose}
      size="lg"
      footer={
        ingredient &&
        canReturn && (
          <Button variant="secondary" onClick={() => setReturnOpen(true)}>
            <Undo2 aria-hidden className="h-4 w-4" />
            Return to supplier
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {detail.error && <Alert tone="error">{errorMessage(detail.error)}</Alert>}

        {ingredient && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile
              label="On hand"
              value={formatQuantity(
                ingredient.qtyOnHand,
                ingredient.baseUnit,
                ingredient.purchaseUnit,
                ingredient.unitsPerPurchase,
              )}
            />
            <Tile
              label="Average cost"
              value={formatUnitCost(ingredient.avgCostMilli, ingredient.baseUnit)}
            />
            <Tile
              label="Stock value"
              value={formatAmount(
                Math.round((ingredient.qtyOnHand * ingredient.avgCostMilli) / 1000),
              )}
            />
            <Tile
              label="Reorder at"
              value={
                ingredient.reorderLevel > 0
                  ? formatQuantity(
                      ingredient.reorderLevel,
                      ingredient.baseUnit,
                      ingredient.purchaseUnit,
                      ingredient.unitsPerPurchase,
                    )
                  : '—'
              }
            />
          </div>
        )}

        {ingredient?.lowStock && (
          <Alert tone="warning">{`${ingredient.name} is at or below its reorder level. Time to buy more.`}</Alert>
        )}

        <div className="flex gap-1">
          {(
            [
              { value: 'movements', label: 'Ledger' },
              { value: 'prices', label: 'Price history' },
              { value: 'recipes', label: 'Used in' },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTab(option.value)}
              className={`h-8 rounded-full border px-3 text-button ${
                tab === option.value
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-surface text-text-secondary hover:text-text-primary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {tab === 'movements' && (
          <Table
            columns={movementColumns}
            rows={data?.movements ?? []}
            rowKey={(row) => row.id}
            isLoading={detail.isLoading}
            emptyMessage="No movements yet"
            emptyHint="Stock appears here as soon as something is bought, sold or counted."
          />
        )}

        {tab === 'prices' && (
          <Table
            columns={[
              {
                key: 'date',
                header: 'Bought on',
                render: (row) => formatDate(row.purchasedOn),
              },
              {
                key: 'purchase',
                header: 'Purchase',
                render: (row) => (
                  <div>
                    <p className="font-medium">{row.purchaseNo}</p>
                    <p className="text-caption text-text-secondary">
                      {row.supplierName ?? 'No supplier'}
                    </p>
                  </div>
                ),
              },
              {
                key: 'qty',
                header: 'Quantity',
                align: 'right',
                render: (row) =>
                  `${(row.qtyPurchaseMilli / 1000).toFixed(2)} ${row.purchaseUnit}`,
              },
              {
                key: 'price',
                header: 'Price paid',
                align: 'right',
                render: (row) => (
                  <span className="font-medium">{formatAmount(row.unitPrice)}</span>
                ),
              },
              {
                key: 'landed',
                header: 'Landed cost',
                align: 'right',
                render: (row) =>
                  ingredient ? (
                    <span className="text-caption text-text-secondary">
                      {`Rs ${(row.landedCostMilli / 1000).toFixed(2)} / ${
                        BASE_UNIT_SHORT[ingredient.baseUnit]
                      }`}
                    </span>
                  ) : null,
              },
            ]}
            rows={data?.priceHistory ?? []}
            rowKey={(row) => row.purchaseNo}
            isLoading={detail.isLoading}
            emptyMessage="No purchases yet"
            emptyHint="Every purchase is kept, so you can always see what you paid before."
          />
        )}

        {tab === 'recipes' && (
          <Table
            columns={[
              {
                key: 'item',
                header: 'Menu item',
                render: (row) => <span className="font-medium">{row.itemName}</span>,
              },
              {
                key: 'qty',
                header: 'Per serving',
                align: 'right',
                render: (row) =>
                  ingredient
                    ? formatQuantity(
                        row.qtyBase,
                        ingredient.baseUnit,
                        ingredient.purchaseUnit,
                        ingredient.unitsPerPurchase,
                      )
                    : row.qtyBase,
              },
              {
                key: 'cost',
                header: 'Cost in that item',
                align: 'right',
                render: (row) =>
                  ingredient ? (
                    <span className="tabular">
                      {formatAmount(Math.round((row.qtyBase * ingredient.avgCostMilli) / 1000))}
                    </span>
                  ) : null,
              },
            ]}
            rows={data?.usedInItems ?? []}
            rowKey={(row) => row.itemId}
            isLoading={detail.isLoading}
            emptyMessage="Not used in any recipe"
            emptyHint="Add it to a recipe on the Menu page and it will come off the shelf when that item sells."
          />
        )}

        {data && data.usedInItems.length > 0 && (
          <p className="text-caption text-text-secondary">
            Used in {data.usedInItems.length} recipe
            {data.usedInItems.length === 1 ? '' : 's'} — it cannot be deleted while it is.
          </p>
        )}
      </div>
      {ingredient && returnOpen && (
        <SupplierReturnModal
          ingredient={ingredient}
          suppliers={suppliers.data ?? []}
          onClose={() => setReturnOpen(false)}
          onSaved={() => {
            void detail.reload();
          }}
        />
      )}
    </Modal>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-border bg-surface-muted p-3">
      <p className="text-caption text-text-secondary">{label}</p>
      <p className="tabular font-semibold">{value}</p>
    </div>
  );
}
