import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Boxes,
  CircleDollarSign,
  PackageOpen,
  PackagePlus,
  Pencil,
  ScrollText,
  Plus,
  Trash2,
  Truck,
} from 'lucide-react';
import type { Ingredient, Purchase, Supplier } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { formatAmount, formatDate, todayIso } from '../../utils/format';
import { formatQuantity, formatUnitCost } from '../../utils/units';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { Alert } from '../../components/Alert';
import { IngredientModal } from './IngredientModal';
import { StarterListModal } from './StarterListModal';
import { PurchaseModal } from './PurchaseModal';
import { SupplierModal } from './SupplierModal';
import { VoidPurchaseModal } from './VoidPurchaseModal';
import { PurchaseDetailModal } from './PurchaseDetailModal';
import { IngredientDetailModal } from './IngredientDetailModal';
import { WastageTab } from './WastageTab';
import { StockCountsTab } from './StockCountsTab';
import { OpeningStockModal } from './OpeningStockModal';
import { HouseMadeTab } from './HouseMadeTab';

type Tab = 'levels' | 'purchases' | 'suppliers' | 'wastage' | 'counts' | 'house-made';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'levels', label: 'Stock levels' },
  { value: 'purchases', label: 'Purchases' },
  { value: 'wastage', label: 'Wastage' },
  { value: 'counts', label: 'Stock counts' },
  { value: 'house-made', label: 'House-made' },
  { value: 'suppliers', label: 'Suppliers' },
];

/**
 * Stock page (Roadmap Phase 4.A / 4.B).
 *
 * Tabs: what is on the shelf, what was bought, and who it was bought from.
 * The owner's rule: the shelf is changed by purchases, wastage and counts —
 * never by typing a number into this page.
 */
export function StockPage() {
  const { allow } = useAuth();
  const canWrite = allow('inventory:write');
  const canPurchase = allow('purchases:write');
  const canVoid = allow('purchases:void');

  const [tab, setTab] = useState<Tab>('levels');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [lowOnly, setLowOnly] = useState(false);

  const [ingredientModal, setIngredientModal] = useState<Ingredient | 'new' | null>(null);
  const [starterOpen, setStarterOpen] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [supplierModal, setSupplierModal] = useState<Supplier | 'new' | null>(null);
  const [deleteIngredient, setDeleteIngredient] = useState<Ingredient | null>(null);
  const [deleteSupplier, setDeleteSupplier] = useState<Supplier | null>(null);
  const [voidTarget, setVoidTarget] = useState<Purchase | null>(null);
  const [purchaseDetail, setPurchaseDetail] = useState<Purchase | null>(null);
  // Which ingredient's ledger/price history is open. Detail is read-only, so even
  // a cashier may look at it (inventory:read), but the buttons that change things
  // stay behind canWrite.
  const [detailId, setDetailId] = useState<number | null>(null);

  const overview = useAsync(async () => unwrap(await getApi().stock.overview()), []);
  const suppliers = useAsync(async () => unwrap(await getApi().stock.suppliers()), []);
  const purchases = useAsync(
    async () =>
      unwrap(
        await getApi().stock.purchases({
          fromDate: '2000-01-01',
          toDate: todayIso(),
          limit: 200,
        }),
      ),
    [],
  );

  const reloadAll = async () => {
    await Promise.all([overview.reload(), suppliers.reload(), purchases.reload()]);
  };

  const ingredients = overview.data?.ingredients ?? [];

  const categories = useMemo(
    () => Array.from(new Set(ingredients.map((ingredient) => ingredient.category))).sort(),
    [ingredients],
  );

  const visibleIngredients = useMemo(() => {
    const term = search.trim().toLowerCase();
    return ingredients.filter((ingredient) => {
      const matchesCategory =
        categoryFilter === 'all' || ingredient.category === categoryFilter;
      const matchesSearch = !term || ingredient.name.toLowerCase().includes(term);
      const matchesLow = !lowOnly || ingredient.lowStock;
      return matchesCategory && matchesSearch && matchesLow;
    });
  }, [ingredients, categoryFilter, search, lowOnly]);

  const existingNames = useMemo(
    () => new Set(ingredients.map((ingredient) => ingredient.name.toLowerCase())),
    [ingredients],
  );

  const handleDeleteIngredient = async () => {
    if (!deleteIngredient) return;
    try {
      unwrap(await getApi().stock.deleteIngredient(deleteIngredient.id));
      toast.success(`${deleteIngredient.name} removed from the stock list`);
      setDeleteIngredient(null);
      await reloadAll();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const handleDeleteSupplier = async () => {
    if (!deleteSupplier) return;
    try {
      unwrap(await getApi().stock.deleteSupplier(deleteSupplier.id));
      toast.success(`${deleteSupplier.name} removed`);
      setDeleteSupplier(null);
      await reloadAll();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const ingredientColumns: Column<Ingredient>[] = [
    {
      key: 'name',
      header: 'Ingredient',
      render: (ingredient) => (
        <button
          type="button"
          onClick={() => setDetailId(ingredient.id)}
          className="text-left"
          title="See its ledger, price history and recipes"
        >
          <p className="font-medium text-text-primary underline-offset-2 hover:underline">
            {ingredient.name}
          </p>
          <p className="text-caption text-text-secondary">{ingredient.category}</p>
        </button>
      ),
    },
    {
      key: 'stock',
      header: 'On the shelf',
      align: 'right',
      render: (ingredient) => (
        <div>
          <p
            className={
              ingredient.qtyOnHand <= 0
                ? 'font-semibold tabular text-status-cancelled'
                : ingredient.lowStock
                  ? 'font-semibold tabular text-[#8a5b00]'
                  : 'tabular text-text-primary'
            }
          >
            {formatQuantity(
              ingredient.qtyOnHand,
              ingredient.baseUnit,
              ingredient.purchaseUnit,
              ingredient.unitsPerPurchase,
            )}
          </p>
          <p className="text-caption text-text-secondary">
            Low below{' '}
            {formatQuantity(
              ingredient.reorderLevel,
              ingredient.baseUnit,
              ingredient.purchaseUnit,
              ingredient.unitsPerPurchase,
            )}
          </p>
        </div>
      ),
    },
    {
      key: 'cost',
      header: 'Average cost',
      align: 'right',
      render: (ingredient) => (
        <div>
          <p className="tabular text-text-primary">
            {formatUnitCost(ingredient.avgCostMilli, ingredient.baseUnit)}
          </p>
          {ingredient.lastCostMilli > 0 && (
            <p className="text-caption text-text-secondary">
              last {formatUnitCost(ingredient.lastCostMilli, ingredient.baseUnit)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      render: (ingredient) => (
        <span className="tabular text-text-primary">{formatAmount(ingredient.stockValue)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (ingredient) =>
        ingredient.qtyOnHand <= 0 ? (
          <Badge tone="danger">Out of stock</Badge>
        ) : ingredient.lowStock ? (
          <Badge tone="pending">Low stock</Badge>
        ) : (
          <Badge tone="success">OK</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (ingredient) => (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            aria-label={`History of ${ingredient.name}`}
            onClick={() => setDetailId(ingredient.id)}
            className="rounded-control p-2 text-text-secondary hover:bg-background hover:text-text-primary"
          >
            <ScrollText className="h-4 w-4" />
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                aria-label={`Edit ${ingredient.name}`}
                onClick={() => setIngredientModal(ingredient)}
                className="rounded-control p-2 text-text-secondary hover:bg-background hover:text-text-primary"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${ingredient.name}`}
                onClick={() => setDeleteIngredient(ingredient)}
                className="rounded-control p-2 text-text-secondary hover:bg-background hover:text-status-cancelled"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const purchaseColumns: Column<Purchase>[] = [
    {
      key: 'no',
      header: 'Purchase',
      render: (purchase) => (
        <div>
          <p className="font-medium text-text-primary">{purchase.purchaseNo}</p>
          <p className="text-caption text-text-secondary">
            {formatDate(purchase.purchasedOn)}
            {purchase.billNo ? ` · bill ${purchase.billNo}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (purchase) => (
        <span className="text-text-primary">{purchase.supplierName ?? '—'}</span>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      align: 'center',
      render: (purchase) => (
        <span className="tabular text-text-primary">{purchase.lines.length}</span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (purchase) => (
        <div>
          <p className="tabular font-medium text-text-primary">{formatAmount(purchase.total)}</p>
          {purchase.total - purchase.paidAmount > 0 && purchase.status === 'posted' && (
            <p className="text-caption text-[#8a5b00]">
              {formatAmount(purchase.total - purchase.paidAmount)} on credit
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (purchase) =>
        purchase.status === 'void' ? (
          <Badge tone="danger">Void</Badge>
        ) : (
          <Badge tone="success">Posted</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (purchase) => (
        <div className="flex justify-end gap-1">
          <Button size="md" variant="ghost" onClick={() => setPurchaseDetail(purchase)}>
            View
          </Button>
          {canVoid && purchase.status === 'posted' && (
            <button
              type="button"
              aria-label={`Void ${purchase.purchaseNo}`}
              onClick={() => setVoidTarget(purchase)}
              className="rounded-control p-2 text-text-secondary hover:bg-background hover:text-status-cancelled"
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const supplierColumns: Column<Supplier>[] = [
    {
      key: 'name',
      header: 'Supplier',
      render: (supplier) => (
        <div>
          <p className="font-medium text-text-primary">{supplier.name}</p>
          {supplier.address && (
            <p className="text-caption text-text-secondary">{supplier.address}</p>
          )}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (supplier) => <span className="tabular">{supplier.phone || '—'}</span>,
    },
    {
      key: 'balance',
      header: 'Owed (credit)',
      align: 'right',
      render: (supplier) =>
        supplier.balance > 0 ? (
          <span className="tabular font-medium text-[#8a5b00]">
            {formatAmount(supplier.balance)}
          </span>
        ) : (
          <span className="text-text-secondary">—</span>
        ),
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (supplier) => (
        <span className="text-caption text-text-secondary">{supplier.notes || '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (supplier) =>
        canWrite ? (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              aria-label={`Edit ${supplier.name}`}
              onClick={() => setSupplierModal(supplier)}
              className="rounded-control p-2 text-text-secondary hover:bg-background hover:text-text-primary"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${supplier.name}`}
              onClick={() => setDeleteSupplier(supplier)}
              className="rounded-control p-2 text-text-secondary hover:bg-background hover:text-status-cancelled"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : null,
    },
  ];

  const error = overview.error ?? suppliers.error ?? purchases.error;

  return (
    <div>
      <PageHeader
        title="Stock"
        subtitle="What the kitchen has, what it was bought for, and what is running low."
        actions={
          <>
            {canPurchase && (
              <Button onClick={() => setPurchaseOpen(true)}>
                <PackagePlus aria-hidden className="h-4 w-4" />
                Add purchase
              </Button>
            )}
            {canWrite && (
              <>
                <Button variant="secondary" onClick={() => setStarterOpen(true)}>
                  <Boxes aria-hidden className="h-4 w-4" />
                  Load starter list
                </Button>
                <Button variant="secondary" onClick={() => setOpeningOpen(true)}>
                  <PackageOpen aria-hidden className="h-4 w-4" />
                  Opening stock
                </Button>
                <Button variant="secondary" onClick={() => setIngredientModal('new')}>
                  <Plus aria-hidden className="h-4 w-4" />
                  New ingredient
                </Button>
              </>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Ingredients"
          value={String(overview.data?.ingredientCount ?? 0)}
          icon={Boxes}
          tone="neutral"
        />
        <SummaryCard
          label="Stock value"
          value={`Rs ${formatAmount(overview.data?.totalValue ?? 0)}`}
          icon={CircleDollarSign}
          tone="neutral"
        />
        <SummaryCard
          label="Low stock"
          value={String(overview.data?.lowStockCount ?? 0)}
          icon={AlertTriangle}
          tone={(overview.data?.lowStockCount ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <SummaryCard
          label="Out of stock"
          value={String(overview.data?.outOfStockCount ?? 0)}
          icon={Ban}
          tone={(overview.data?.outOfStockCount ?? 0) > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTab(item.value)}
            className={`-mb-px border-b-2 px-3 py-2 text-button font-medium transition-colors ${
              tab === item.value
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'levels' && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="w-full max-w-xs">
              <Input
                label=""
                placeholder="Search ingredients…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="w-48">
              <select
                aria-label="Filter by category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="h-control w-full rounded-control border border-border bg-surface px-3 text-body text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <Button variant={lowOnly ? 'primary' : 'secondary'} onClick={() => setLowOnly((v) => !v)}>
              <AlertTriangle aria-hidden className="h-4 w-4" />
              Low stock only
            </Button>
          </div>

          <Table
            columns={ingredientColumns}
            rows={visibleIngredients}
            rowKey={(ingredient) => ingredient.id}
            isLoading={overview.isLoading}
            emptyMessage={
              ingredients.length === 0 ? 'No ingredients yet' : 'Nothing matches this filter'
            }
            emptyHint={
              ingredients.length === 0
                ? 'Use "Load starter list" to add the usual fast-food stock in one click.'
                : undefined
            }
          />
        </>
      )}

      {tab === 'purchases' && (
        <Table
          columns={purchaseColumns}
          rows={purchases.data ?? []}
          rowKey={(purchase) => purchase.id}
          isLoading={purchases.isLoading}
          emptyMessage="No purchases yet"
          emptyHint="Press Add purchase after a delivery arrives, so the shelf and the cost stay right."
        />
      )}

      {tab === 'wastage' && (
        <WastageTab
          ingredients={ingredients}
          canWrite={allow('stock:adjust')}
          onChanged={() => {
            void reloadAll();
          }}
        />
      )}

      {tab === 'counts' && (
        <StockCountsTab
          ingredients={ingredients}
          canWrite={allow('stock:adjust')}
          onChanged={() => {
            void reloadAll();
          }}
        />
      )}

      {tab === 'house-made' && (
        <HouseMadeTab
          ingredients={ingredients}
          canWrite={allow('inventory:write')}
          canAdjust={allow('stock:adjust')}
          onChanged={() => {
            void reloadAll();
          }}
        />
      )}

      {tab === 'suppliers' && (
        <>
          <div className="mb-3 flex justify-end">
            {canWrite && (
              <Button variant="secondary" onClick={() => setSupplierModal('new')}>
                <Truck aria-hidden className="h-4 w-4" />
                New supplier
              </Button>
            )}
          </div>
          <Table
            columns={supplierColumns}
            rows={suppliers.data ?? []}
            rowKey={(supplier) => supplier.id}
            isLoading={suppliers.isLoading}
            emptyMessage="No suppliers yet"
            emptyHint="Add the wholesalers you buy from, so every purchase says who it came from."
          />
        </>
      )}

      {/* ------------------------------ modals ------------------------------ */}

      <IngredientModal
        isOpen={ingredientModal !== null}
        ingredient={ingredientModal === 'new' ? null : ingredientModal}
        categories={categories}
        suppliers={suppliers.data ?? []}
        onClose={() => setIngredientModal(null)}
        onSaved={reloadAll}
      />

      <StarterListModal
        isOpen={starterOpen}
        existingNames={existingNames}
        onClose={() => setStarterOpen(false)}
        onSaved={reloadAll}
      />

      <OpeningStockModal
        isOpen={openingOpen}
        ingredients={ingredients}
        onClose={() => setOpeningOpen(false)}
        onSaved={reloadAll}
      />

      <PurchaseModal
        isOpen={purchaseOpen}
        ingredients={ingredients}
        suppliers={suppliers.data ?? []}
        canUseDrawer
        onClose={() => setPurchaseOpen(false)}
        onSaved={reloadAll}
      />

      <SupplierModal
        isOpen={supplierModal !== null}
        supplier={supplierModal === 'new' ? null : supplierModal}
        onClose={() => setSupplierModal(null)}
        onSaved={reloadAll}
      />

      <VoidPurchaseModal
        purchase={voidTarget}
        onClose={() => setVoidTarget(null)}
        onSaved={reloadAll}
      />

      <PurchaseDetailModal purchase={purchaseDetail} onClose={() => setPurchaseDetail(null)} />

      {detailId !== null && (
        <IngredientDetailModal ingredientId={detailId} onClose={() => setDetailId(null)} />
      )}

      <ConfirmDialog
        isOpen={deleteIngredient !== null}
        title="Remove ingredient"
        message={`${deleteIngredient?.name ?? ''} will be removed from the list. Old stock history stays in the books.`}
        confirmLabel="Remove"
        onConfirm={handleDeleteIngredient}
        onClose={() => setDeleteIngredient(null)}
      />

      <ConfirmDialog
        isOpen={deleteSupplier !== null}
        title="Remove supplier"
        message={`${deleteSupplier?.name ?? ''} will be removed. Past purchases keep their records.`}
        confirmLabel="Remove"
        onConfirm={handleDeleteSupplier}
        onClose={() => setDeleteSupplier(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Boxes;
  tone: 'neutral' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'danger'
      ? 'text-status-cancelled'
      : tone === 'warning'
        ? 'text-[#8a5b00]'
        : 'text-text-primary';

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-caption text-text-secondary">{label}</p>
        <Icon aria-hidden className="h-4 w-4 text-text-secondary" />
      </div>
      <p className={`mt-1 text-[22px] font-bold tabular ${toneClass}`}>{value}</p>
    </div>
  );
}
