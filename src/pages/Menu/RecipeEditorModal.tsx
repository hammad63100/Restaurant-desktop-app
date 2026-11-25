import { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import type { Ingredient, MenuItem, RecipeLine } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatAmount } from '../../utils/format';
import { BASE_UNIT_SHORT, formatQuantity } from '../../utils/units';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { Alert } from '../../components/Alert';
import { MoneyInput } from '../../components/MoneyInput';
import { toast } from '../../components/Toast';

/**
 * The recipe editor: what goes into ONE serving of a menu item.
 *
 * This is the screen the client described — "ek Zinger Burger mein bun, chicken,
 * mayo, cheese aur box" — so the item is fixed at the top and the owner only adds
 * lines underneath. The total moves as he types, but nothing is written until
 * Save, and the main process costs everything again from the live averages so a
 * stale browser number can never become the stored truth.
 */

interface DraftLine {
  /** Stable React key; never sent to the main process. */
  key: string;
  ingredientId: number;
  /** Quantity per serving, in the ingredient's base unit. */
  qtyBase: number;
  /** Trim/cooking loss, percent ×100 (5% = 500). */
  wastePercentX100: number;
  unitCostMilli: number;
}

interface RecipeEditorModalProps {
  isOpen: boolean;
  item: MenuItem | null;
  /** The saved recipe; empty for an item that has none. */
  lines: RecipeLine[];
  /** Every active ingredient, for the picker. */
  ingredients: Ingredient[];
  price: number;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const newKey = () => Math.random().toString(36).slice(2);

/** Rounded cost of one line — mirrors `lineCostPaisa` in the main process. */
function costOfLine(qtyBase: number, wastePercentX100: number, unitCostMilli: number): number {
  const used = Math.round(qtyBase + (qtyBase * wastePercentX100) / 10_000);
  return Math.round((used * unitCostMilli) / 1000);
}

export function RecipeEditorModal({
  isOpen,
  item,
  lines,
  ingredients,
  price,
  onClose,
  onSaved,
}: RecipeEditorModalProps) {
  // The parent re-keys this component on every open, so the draft always starts
  // from what the database says. A lint rule here forbids resetting state from an
  // effect, and keyed remounting is the pattern the rest of the app uses.
  const [draft, setDraft] = useState<DraftLine[]>(() =>
    lines.map((line) => ({
      key: newKey(),
      ingredientId: line.ingredientId,
      qtyBase: line.qtyBase,
      wastePercentX100: line.wastePercentX100,
      unitCostMilli: line.unitCostMilli,
    })),
  );
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => {
    const map = new Map<number, Ingredient>();
    for (const ingredient of ingredients) map.set(ingredient.id, ingredient);
    return map;
  }, [ingredients]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    const chosen = new Set(draft.map((line) => line.ingredientId));

    return ingredients
      .filter((ingredient) => !chosen.has(ingredient.id))
      .filter((ingredient) => !term || ingredient.name.toLowerCase().includes(term))
      .slice(0, 8);
  }, [ingredients, draft, search]);

  const total = draft.reduce(
    (sum, line) => sum + costOfLine(line.qtyBase, line.wastePercentX100, line.unitCostMilli),
    0,
  );
  const margin = price > 0 ? Math.round(((price - total) / price) * 10_000) : null;

  const add = (ingredient: Ingredient) => {
    setDraft((current) => [
      ...current,
      {
        key: newKey(),
        ingredientId: ingredient.id,
        qtyBase: 1,
        wastePercentX100: 0,
        unitCostMilli: ingredient.avgCostMilli,
      },
    ]);
    setSearch('');
  };

  const update = (key: string, patch: Partial<DraftLine>) => {
    setDraft((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const remove = (key: string) => {
    setDraft((current) => current.filter((line) => line.key !== key));
  };

  const save = async () => {
    if (!item) return;
    setError(null);

    const invalid = draft.find((line) => !Number.isFinite(line.qtyBase) || line.qtyBase <= 0);
    if (invalid) {
      setError('Every ingredient needs a quantity of at least 1 of its base unit.');
      return;
    }

    setIsSaving(true);
    try {
      unwrap(
        await getApi().recipes.saveRecipe({
          itemId: item.id,
          lines: draft.map((line) => ({
            ingredientId: line.ingredientId,
            qtyBase: Math.round(line.qtyBase),
            wastePercentX100: Math.round(line.wastePercentX100),
          })),
        }),
      );

      toast.success(
        draft.length === 0 ? `Recipe cleared for ${item.name}` : `Recipe saved for ${item.name}`,
      );
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title={item ? `Recipe — ${item.name}` : 'Recipe'}
      description="What goes into one serving. Stock comes off the shelf every time this item is sold."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} isLoading={isSaving}>
            Save recipe
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        {!error && draft.length === 0 && (
          <Alert tone="info">
            No recipe yet, so the cost of this item is unknown and its profit is not counted.
            Add the ingredients below to make it count.
          </Alert>
        )}

        {draft.length > 0 && (
          <ul className="flex flex-col gap-2">
            {draft.map((line) => {
              const ingredient = byId.get(line.ingredientId);
              const cost = costOfLine(line.qtyBase, line.wastePercentX100, line.unitCostMilli);

              return (
                <li key={line.key} className="rounded-control border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {ingredient?.name ?? 'Unknown ingredient'}
                      </p>
                      <p className="text-caption text-text-secondary">
                        {ingredient
                          ? `Average Rs ${(ingredient.avgCostMilli / 1000).toFixed(2)} per ${
                              BASE_UNIT_SHORT[ingredient.baseUnit]
                            }`
                          : 'This ingredient was removed'}
                      </p>
                    </div>

                    <div className="w-28">
                      <Input
                        label={`Qty (${ingredient ? BASE_UNIT_SHORT[ingredient.baseUnit] : 'unit'})`}
                        type="number"
                        min={1}
                        step={1}
                        value={line.qtyBase}
                        onChange={(event) => update(line.key, { qtyBase: Number(event.target.value) })}
                      />
                    </div>

                    <div className="w-24">
                      <Input
                        label="Waste %"
                        type="number"
                        min={0}
                        max={90}
                        step={1}
                        value={line.wastePercentX100 / 100}
                        onChange={(event) =>
                          update(line.key, {
                            wastePercentX100: Math.round(Number(event.target.value) * 100),
                          })
                        }
                      />
                    </div>

                    <div className="w-24 pb-2 text-right">
                      <p className="font-medium">{formatAmount(cost)}</p>
                    </div>

                    <Button
                      variant="ghost"
                      onClick={() => remove(line.key)}
                      title="Take this ingredient out"
                    >
                      <Trash2 aria-hidden className="h-4 w-4 text-status-cancelled" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="rounded-control bg-surface-muted p-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Add an ingredient…"
              aria-label="Add an ingredient"
              className="h-control w-full rounded-control border border-border bg-surface pl-9 pr-3 text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>

          {matches.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {matches.map((ingredient) => (
                <li key={ingredient.id}>
                  <button
                    type="button"
                    onClick={() => add(ingredient)}
                    className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-surface"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Plus aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate font-medium">{ingredient.name}</span>
                      <span className="shrink-0 text-caption text-text-secondary">
                        {formatQuantity(
                          ingredient.qtyOnHand,
                          ingredient.baseUnit,
                          ingredient.purchaseUnit,
                          ingredient.unitsPerPurchase,
                        )}{' '}
                        in stock
                      </span>
                    </span>
                    <span className="shrink-0 text-caption text-text-secondary">
                      Rs {(ingredient.avgCostMilli / 1000).toFixed(2)}/
                      {BASE_UNIT_SHORT[ingredient.baseUnit]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {ingredients.length === 0 && (
            <p className="mt-2 text-caption text-text-secondary">
              No ingredients yet. Add them on the Stock page first.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-3">
          <div>
            <p className="text-caption text-text-secondary">Cost of one serving</p>
            <p className="text-h3 font-semibold">{formatAmount(total)}</p>
          </div>
          <div className="text-right">
            <p className="text-caption text-text-secondary">Selling price</p>
            <p className="text-h3 font-semibold">{formatAmount(price)}</p>
          </div>
          <div className="text-right">
            <p className="text-caption text-text-secondary">Profit per serving</p>
            <p
              className={`text-h3 font-semibold ${
                price - total < 0 ? 'text-status-cancelled' : 'text-status-success'
              }`}
            >
              {formatAmount(price - total)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-caption text-text-secondary">Margin</p>
            <p className="text-h3 font-semibold">
              {margin === null ? '—' : `${(margin / 100).toFixed(1)}%`}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The price box beside the recipe: the owner chooses the price, the app obeys.
 *
 * "Target 55%" means the margin is 55% OF THE PRICE, so cost is 45% of it:
 * price = cost ÷ (1 − 0.55). That is the number a shopkeeper means by margin, and
 * it is different from cost × 1.55, which would quietly give him 35%.
 */
export function PriceSuggestionBox({
  costTotal,
  price,
  onApply,
}: {
  costTotal: number;
  price: number;
  onApply: (paisa: number) => void;
}) {
  const [target, setTarget] = useState(55);
  const [custom, setCustom] = useState(price);

  const suggested =
    target >= 100 || costTotal <= 0
      ? null
      : Math.round(costTotal / (1 - target / 100) / 100) * 100;

  return (
    <div className="flex flex-col gap-3 rounded-control border border-border bg-surface p-3">
      <div>
        <p className="font-medium">Set the selling price</p>
        <p className="text-caption text-text-secondary">
          One serving costs {formatAmount(costTotal)}. Pick a margin and the app works out the
          price — or type your own.
        </p>
      </div>

      <div className="flex items-end gap-2">
        <div className="w-28">
          <Input
            label="Margin %"
            type="number"
            min={0}
            max={99}
            step={5}
            value={target}
            onChange={(event) => setTarget(Number(event.target.value))}
          />
        </div>
        <div className="flex-1">
          <p className="text-caption text-text-secondary">Would sell at</p>
          <p className="font-semibold">{suggested === null ? '—' : formatAmount(suggested)}</p>
        </div>
        <Button
          variant="secondary"
          disabled={suggested === null}
          onClick={() => {
            if (suggested === null) return;
            setCustom(suggested);
            onApply(suggested);
          }}
        >
          Use this
        </Button>
      </div>

      <MoneyInput
        label="Your price"
        value={custom}
        onChange={(paisa) => {
          setCustom(paisa);
          onApply(paisa);
        }}
      />
    </div>
  );
}
