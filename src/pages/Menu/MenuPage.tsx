import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { ChefHat, CircleOff, Pencil, Plus, Search, Trash2, Utensils } from 'lucide-react';
import { z } from 'zod';
import type { Category, Ingredient, MenuItem, RecipeLine } from '../../types/api';
import { categorySchema, menuItemSchema } from '../../types/schemas';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { formatAmount } from '../../utils/format';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MoneyInput } from '../../components/MoneyInput';
import { toast } from '../../components/Toast';
import { Alert } from '../../components/Alert';
import { RecipeEditorModal } from './RecipeEditorModal';

type CategoryFormValues = z.input<typeof categorySchema>;
type ItemFormValues = z.input<typeof menuItemSchema>;

type Tab = 'items' | 'categories';

export function MenuPage() {
  const { allow } = useAuth();
  const canWrite = allow('menu:write');
  const canToggle = allow('orders:write');

  const [tab, setTab] = useState<Tab>('items');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>('all');
  const [categoryModal, setCategoryModal] = useState<Category | 'new' | null>(null);
  const [itemModal, setItemModal] = useState<MenuItem | 'new' | null>(null);
  const [deleteItem, setDeleteItem] = useState<MenuItem | null>(null);
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Recipes and the cost column. `costs` is only fetched when the role is allowed
  // to see money: a manager may run the menu without seeing what it costs.
  const canCost = allow('costs:read');
  const canRecipe = allow('recipes:write');
  const [recipeItem, setRecipeItem] = useState<MenuItem | null>(null);
  const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([]);
  const [recipeIngredients, setRecipeIngredients] = useState<Ingredient[]>([]);

  const categories = useAsync(async () => unwrap(await getApi().menu.listCategories()), []);
  const items = useAsync(async () => unwrap(await getApi().menu.listItems()), []);
  const costs = useAsync(
    async () => (canCost ? unwrap(await getApi().recipes.menuCosts()) : null),
    [canCost],
  );

  const costOf = (itemId: number) =>
    (costs.data?.rows ?? []).find((row) => row.itemId === itemId) ?? null;

  const categoryForm = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema) as unknown as Resolver<CategoryFormValues>,
    defaultValues: { name: '', sortOrder: 0, active: true },
  });

  const itemForm = useForm<ItemFormValues>({
    resolver: zodResolver(menuItemSchema) as unknown as Resolver<ItemFormValues>,
    defaultValues: { categoryId: 0, name: '', price: 0, available: true, image: null },
  });

  const priceValue = itemForm.watch('price') ?? 0;

  const categoryOptions = useMemo(
    () =>
      (categories.data ?? []).map((category) => ({
        value: String(category.id),
        label: category.name,
      })),
    [categories.data],
  );

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (items.data ?? []).filter((item) => {
      const matchesCategory = categoryFilter === 'all' || item.categoryId === categoryFilter;
      const matchesSearch = !term || item.name.toLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [items.data, categoryFilter, search]);

  const openNewCategory = () => {
    categoryForm.reset({ name: '', sortOrder: (categories.data?.length ?? 0) + 1, active: true });
    setFormError(null);
    setCategoryModal('new');
  };

  const openEditCategory = (category: Category) => {
    categoryForm.reset(category);
    setFormError(null);
    setCategoryModal(category);
  };

  const openNewItem = () => {
    const firstCategory = categories.data?.[0];
    if (!firstCategory) {
      toast.error('Create a category first');
      setTab('categories');
      return;
    }
    itemForm.reset({
      categoryId: firstCategory.id,
      name: '',
      price: 0,
      available: true,
      image: null,
    });
    setFormError(null);
    setItemModal('new');
  };

  const openEditItem = (item: MenuItem) => {
    itemForm.reset({
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      price: item.price,
      available: item.available,
      image: item.image,
    });
    setFormError(null);
    setItemModal(item);
  };

  const openRecipe = async (item: MenuItem) => {
    try {
      const [recipe, ingredients] = await Promise.all([
        getApi().recipes.recipe(item.id),
        getApi().stock.ingredients(),
      ]);

      setRecipeLines(unwrap(recipe).lines);
      // Only active ingredients can join a recipe: a deleted one would cost
      // nothing and quietly understate the dish.
      setRecipeIngredients(unwrap(ingredients).filter((candidate) => candidate.active));
      setRecipeItem(item);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const reloadCosts = async () => {
    await items.reload();
    await costs.reload();
  };

  const submitCategory = categoryForm.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().menu.saveCategory(categorySchema.parse(values)));
      toast.success(categoryModal === 'new' ? 'Category created' : 'Category updated');
      setCategoryModal(null);
      await categories.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  const submitItem = itemForm.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().menu.saveItem(menuItemSchema.parse(values)));
      toast.success(itemModal === 'new' ? 'Item added to the menu' : 'Item updated');
      setItemModal(null);
      await items.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  const removeItem = async () => {
    if (!deleteItem) return;
    try {
      unwrap(await getApi().menu.deleteItem(deleteItem.id));
      toast.success(`${deleteItem.name} removed from the menu`);
      await items.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removeCategory = async () => {
    if (!deleteCategory) return;
    try {
      unwrap(await getApi().menu.deleteCategory(deleteCategory.id));
      toast.success('Category removed');
      await categories.reload();
      await items.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const toggleAvailability = async (item: MenuItem) => {
    try {
      unwrap(await getApi().menu.toggleItem(item.id, !item.available));
      await items.reload();
      toast.success(`${item.name} is now ${item.available ? 'sold out' : 'available'}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const itemColumns: Column<MenuItem>[] = [
    {
      key: 'name',
      header: 'Item',
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-caption text-text-secondary">{row.categoryName}</p>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (row) => <span className="font-medium">{formatAmount(row.price)}</span>,
    },
    {
      key: 'cost',
      header: 'Cost / profit',
      align: 'right',
      // Hidden entirely for roles that may not see money (the capability is
      // enforced in the main process too — this is only the polite version).
      render: (row) => {
        if (!canCost) return <span className="text-text-secondary">—</span>;

        const cost = costOf(row.id);
        if (!cost || !cost.hasRecipe) {
          return (
            <span className="text-caption text-text-secondary">
              Cost unknown — add a recipe
            </span>
          );
        }

        return (
          <div className="flex flex-col items-end">
            <span className="text-caption text-text-secondary">{formatAmount(cost.costTotal)}</span>
            <span
              className={`text-caption font-medium ${
                cost.belowTarget ? 'text-status-cancelled' : 'text-status-success'
              }`}
            >
              {cost.profit === null ? '—' : `${formatAmount(cost.profit)} profit`}
              {cost.marginPercentX100 !== null && ` · ${(cost.marginPercentX100 / 100).toFixed(0)}%`}
            </span>
          </div>
        );
      },
    },
    {
      /*
       * "Can make N" (4.C) — the tightest ingredient in the recipe.
       *
       * The client's reason for the whole stock feature: "taky mujhe pata lagy"
       * so I know what is left. The number already existed in the service; it had
       * simply never been shown, which left the owner with a shelf count and no
       * answer to the question he actually asks at the counter.
       *
       * Deliberately blank for an item with no recipe, and for a role that may not
       * see costs: how many you can sell is a stock fact, but it is derived from a
       * recipe the cashier is not shown.
       */
      key: 'canMake',
      header: 'Can make',
      align: 'right',
      render: (row) => {
        if (!canCost) return <span className="text-text-secondary">—</span>;

        const cost = costOf(row.id);
        if (!cost || !cost.hasRecipe || cost.canMake === null) {
          return <span className="text-text-secondary">—</span>;
        }

        // Zero is the number that matters: it means the kitchen cannot make one
        // more, and it should not be the same grey as "not applicable".
        return (
          <span
            className={
              cost.canMake === 0
                ? 'tabular font-medium text-status-cancelled'
                : 'tabular'
            }
            title={cost.canMake === 0 ? 'An ingredient in this recipe has run out' : undefined}
          >
            {cost.canMake}
          </span>
        );
      },
    },
    {
      key: 'available',
      header: 'Availability',
      render: (row) => (
        <Badge tone={row.available ? 'success' : 'danger'}>
          {row.available ? 'Available' : 'Sold out'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          {canToggle && (
            <Button
              variant="ghost"
              onClick={() => void toggleAvailability(row)}
              title={row.available ? 'Mark as sold out' : 'Mark as available'}
            >
              <CircleOff
                aria-hidden
                className={`h-4 w-4 ${row.available ? 'text-text-secondary' : 'text-status-success'}`}
              />
            </Button>
          )}
          {canRecipe && (
            <Button
              variant="ghost"
              onClick={() => void openRecipe(row)}
              title={costOf(row.id)?.hasRecipe ? 'Edit recipe' : 'Add a recipe'}
            >
              <ChefHat
                aria-hidden
                className={`h-4 w-4 ${
                  costOf(row.id)?.hasRecipe ? 'text-status-success' : 'text-text-secondary'
                }`}
              />
            </Button>
          )}
          {canWrite && (
            <>
              <Button variant="ghost" onClick={() => openEditItem(row)} title="Edit item">
                <Pencil aria-hidden className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={() => setDeleteItem(row)} title="Remove item">
                <Trash2 aria-hidden className="h-4 w-4 text-status-cancelled" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const categoryColumns: Column<Category>[] = [
    {
      key: 'name',
      header: 'Category',
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
    { key: 'order', header: 'Sort order', align: 'center', render: (row) => row.sortOrder },
    {
      key: 'count',
      header: 'Items',
      align: 'center',
      render: (row) => (items.data ?? []).filter((item) => item.categoryId === row.id).length,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" onClick={() => openEditCategory(row)} title="Edit category">
            <Pencil aria-hidden className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={() => setDeleteCategory(row)} title="Remove category">
            <Trash2 aria-hidden className="h-4 w-4 text-status-cancelled" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Menu"
        subtitle="Categories, items and prices. Old invoices keep the price they were sold at."
        actions={
          <>
            <Button variant="secondary" onClick={openNewCategory} disabled={!canWrite}>
              <Plus aria-hidden className="h-4 w-4" />
              Category
            </Button>
            <Button onClick={openNewItem} disabled={!canWrite}>
              <Plus aria-hidden className="h-4 w-4" />
              New item
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-control border border-border bg-surface p-1">
          {(['items', 'categories'] as Tab[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`h-8 rounded px-3 text-button capitalize ${
                tab === value
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        {tab === 'items' && (
          <>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search items"
                aria-label="Search items"
                className="h-control w-56 rounded-control border border-border bg-surface pl-9 pr-3 text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(event) =>
                setCategoryFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))
              }
              aria-label="Filter by category"
              className="h-control rounded-control border border-border bg-surface px-3 text-body"
            >
              <option value="all">All categories</option>
              {(categories.data ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {tab === 'items' ? (
        <Table
          columns={itemColumns}
          rows={visibleItems}
          rowKey={(row) => row.id}
          isLoading={items.isLoading}
          emptyMessage={items.data?.length ? 'No items match this filter' : 'The menu is empty'}
          emptyHint={
            items.data?.length
              ? 'Try another search term or category.'
              : 'Add a category first, then add items with their prices.'
          }
        />
      ) : (
        <Table
          columns={categoryColumns}
          rows={categories.data ?? []}
          rowKey={(row) => row.id}
          isLoading={categories.isLoading}
          emptyMessage="No categories yet"
          emptyHint="Burgers, Pizza or Drinks are typical starting categories."
        />
      )}

      {!canWrite && (
        <p className="mt-3 flex items-center gap-1 text-caption text-text-secondary">
          <Utensils aria-hidden className="h-3.5 w-3.5" />
          Your role can mark items sold out, but not change the menu.
        </p>
      )}

      {recipeItem && (
        <RecipeEditorModal
          // Re-key on open so the draft always starts from the saved recipe.
          key={`${recipeItem.id}-${recipeLines.length}-${recipeLines[0]?.ingredientId ?? 0}`}
          isOpen
          item={recipeItem}
          lines={recipeLines}
          ingredients={recipeIngredients}
          price={recipeItem.price}
          onClose={() => setRecipeItem(null)}
          onSaved={reloadCosts}
        />
      )}

      <Modal
        isOpen={categoryModal !== null}
        title={categoryModal === 'new' ? 'New category' : 'Edit category'}
        onClose={() => setCategoryModal(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCategoryModal(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitCategory()} isLoading={isSaving}>
              Save
            </Button>
          </>
        }
      >
        <form onSubmit={submitCategory} className="flex flex-col gap-4" noValidate>
          {formError && <Alert tone="error">{formError}</Alert>}
          <Input
            label="Category name"
            placeholder="Burgers"
            error={categoryForm.formState.errors.name?.message}
            {...categoryForm.register('name')}
          />
          <Input
            label="Sort order"
            type="number"
            min={0}
            error={categoryForm.formState.errors.sortOrder?.message}
            {...categoryForm.register('sortOrder', { valueAsNumber: true })}
          />
        </form>
      </Modal>

      <Modal
        isOpen={itemModal !== null}
        title={itemModal === 'new' ? 'New item' : 'Edit item'}
        description="Price is stored in rupees and paisa, exactly as typed."
        onClose={() => setItemModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setItemModal(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitItem()} isLoading={isSaving}>
              Save item
            </Button>
          </>
        }
      >
        <form onSubmit={submitItem} className="flex flex-col gap-4" noValidate>
          {formError && <Alert tone="error">{formError}</Alert>}

          <Input
            label="Item name"
            placeholder="Zinger Burger"
            error={itemForm.formState.errors.name?.message}
            {...itemForm.register('name')}
          />

          <Select
            label="Category"
            options={categoryOptions}
            placeholder="Choose a category"
            error={itemForm.formState.errors.categoryId?.message}
            {...itemForm.register('categoryId', { valueAsNumber: true })}
          />

          <MoneyInput
            label="Price"
            value={Number.isFinite(priceValue) ? priceValue : 0}
            onChange={(paisa) => itemForm.setValue('price', paisa, { shouldValidate: true })}
            error={itemForm.formState.errors.price?.message}
          />

          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" className="h-4 w-4" {...itemForm.register('available')} />
            Available right now
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteItem !== null}
        title="Remove this item?"
        message={`${deleteItem?.name ?? ''} will no longer appear on new orders. Past invoices keep their records.`}
        confirmLabel="Remove item"
        onConfirm={removeItem}
        onClose={() => setDeleteItem(null)}
      />

      <ConfirmDialog
        isOpen={deleteCategory !== null}
        title="Remove this category?"
        message={`${deleteCategory?.name ?? ''} can only be removed when it has no items left.`}
        confirmLabel="Remove category"
        onConfirm={removeCategory}
        onClose={() => setDeleteCategory(null)}
      />
    </div>
  );
}
