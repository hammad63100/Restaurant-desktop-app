import { useMemo, useState } from 'react';
import { Beaker, ChefHat, Plus, Settings2, Trash2 } from 'lucide-react';
import type { BatchRecipe, Ingredient, MadeIngredientRow } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatAmount, formatDate } from '../../utils/format';
import { formatQuantity, formatUnitCost } from '../../utils/units';
import { useAsync } from '../../hooks/useAsync';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

/**
 * House-made ingredients (Roadmap 4.I).
 *
 * The client: some things the kitchen makes itself — mayo, marinade, a coating
 * mix. Before this screen the only way to price a house sauce was to type a guessed
 * purchase price, which would then be wrong forever and would never notice when the
 * price of oil went up.
 *
 * The screen keeps three ideas apart, because mixing them is what makes inventory
 * software lie:
 *
 *   * the **recipe** is a plan — writing it moves no stock,
 *   * the **cost** is derived — Σ(components) ÷ batch yield, never typed,
 *   * the **batch** is a real event — it empties the pantry and fills the jar.
 */
export function HouseMadeTab({
  ingredients,
  canWrite,
  canAdjust,
  onChanged,
}: {
  ingredients: Ingredient[];
  canWrite: boolean;
  canAdjust: boolean;
  onChanged: () => void;
}) {
  const overview = useAsync(async () => unwrap(await getApi().stock.subRecipes()), []);

  const [editorFor, setEditorFor] = useState<Ingredient | null>(null);
  const [makeFor, setMakeFor] = useState<MadeIngredientRow | null>(null);
  const [pickOpen, setPickOpen] = useState(false);

  const rows = overview.data?.rows ?? [];

  /** Ingredients that are bought (not made) and active — valid components. */
  const components = useMemo(
    () => ingredients.filter((ingredient) => ingredient.active && ingredient.batchYieldBase === 0),
    [ingredients],
  );

  const columns: Column<MadeIngredientRow>[] = [
    {
      key: 'name',
      header: 'Made in-house',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-caption text-text-secondary">
            {row.lineCount === 0
              ? 'No recipe yet — its cost cannot be worked out'
              : `${row.lineCount} component${row.lineCount === 1 ? '' : 's'} per batch of ${row.batchYieldBase} ${row.baseUnit}`}
          </span>
        </div>
      ),
    },
    {
      key: 'onHand',
      header: 'On hand',
      align: 'right',
      render: (row) => <span className="tabular">{formatQuantity(row.qtyOnHand, row.baseUnit, row.baseUnit, 1)}</span>,
    },
    {
      key: 'cost',
      header: 'Cost to make',
      align: 'right',
      render: (row) =>
        row.lineCount === 0 ? (
          <span className="text-text-secondary">—</span>
        ) : (
          <div className="flex flex-col">
            <span className="tabular">{formatUnitCost(row.madeUnitCostMilli, row.baseUnit)}</span>
            <span className="text-caption text-text-secondary">
              batch: Rs {formatAmount(row.batchCost)}
            </span>
          </div>
        ),
    },
    {
      key: 'compare',
      header: 'vs bought',
      align: 'right',
      render: (row) => {
        if (row.comparedToBoughtMilli === null) {
          return <span className="text-caption text-text-secondary">never bought</span>;
        }
        const cheaper = row.comparedToBoughtMilli > 0;
        // A made ingredient is usually cheaper; when it is not, the owner needs to
        // see it plainly rather than discover it in the month's sums.
        return (
          <Badge tone={cheaper ? 'success' : 'danger'}>
            {cheaper ? 'saves ' : 'costs '}
            {formatUnitCost(Math.abs(row.comparedToBoughtMilli), row.baseUnit)}
          </Badge>
        );
      },
    },
    {
      key: 'canMake',
      header: 'Batches possible',
      align: 'right',
      render: (row) => (
        <span className={row.canMakeBatches === 0 ? 'tabular text-danger' : 'tabular'}>
          {row.lineCount === 0 ? '—' : row.canMakeBatches}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const ingredient = ingredients.find((entry) => entry.id === row.ingredientId);
        return (
          <div className="flex justify-end gap-1">
            {canAdjust && row.lineCount > 0 && ingredient && (
              <Button variant="secondary" className="px-2" onClick={() => setMakeFor(row)}>
                <ChefHat aria-hidden className="h-4 w-4" />
                Make
              </Button>
            )}
            {canWrite && ingredient && (
              <Button
                variant="ghost"
                className="px-2"
                onClick={() => setEditorFor(ingredient)}
                title="Edit the batch recipe"
              >
                <Settings2 aria-hidden className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  /** Ingredients that could be turned into a house-made one but are not yet. */
  const candidates = ingredients.filter(
    (ingredient) => ingredient.active && ingredient.batchYieldBase === 0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-body text-text-secondary">
          Things the kitchen makes itself. The cost is worked out from what goes into
          a batch — never typed — so it follows the price of oil and eggs by itself.
          Making a batch takes those components off the shelf and puts the finished
          sauce on.
        </p>
        {canWrite && (
          <Button onClick={() => setPickOpen(true)}>
            <Plus aria-hidden className="h-4 w-4" />
            Make something in-house
          </Button>
        )}
      </div>

      {overview.error && <Alert tone="error">{errorMessage(overview.error)}</Alert>}

      {rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Beaker aria-hidden className="h-8 w-8 text-text-secondary" />
            <p className="font-medium">Nothing is made in-house yet</p>
            <p className="max-w-md text-body text-text-secondary">
              If the kitchen mixes its own sauce or marinade, add it here. Buying it
              from a supplier instead? Leave it as it is — this screen is only for
              things you make.
            </p>
          </div>
        </Card>
      ) : (
        <Table columns={columns} rows={rows} rowKey={(row) => row.ingredientId} />
      )}

      {(overview.data?.recentBatches.length ?? 0) > 0 && (
        <Card>
          <h3 className="mb-3 font-semibold">Recent batches</h3>
          <div className="flex flex-col divide-y divide-border">
            {overview.data!.recentBatches.map((batch) => (
              <div key={batch.id} className="flex items-center justify-between gap-3 py-2 text-body">
                <div className="flex flex-col">
                  <span className="font-medium">
                    {batch.batchNo} · {batch.ingredientName}
                  </span>
                  <span className="text-caption text-text-secondary">
                    {formatDate(batch.madeOn)} · by {batch.createdByName}
                  </span>
                </div>
                <div className="text-right">
                  <div className="tabular">
                    {formatQuantity(batch.qtyBase, batch.baseUnit, batch.baseUnit, 1)}
                  </div>
                  <div className="text-caption text-text-secondary tabular">
                    Rs {formatAmount(batch.totalCost)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {pickOpen && (
        <Modal
          isOpen
          title="Which ingredient do you make yourself?"
          description="Pick the finished thing — the mayo, the marinade — then say what goes into a batch."
          onClose={() => setPickOpen(false)}
          footer={
            <Button variant="secondary" onClick={() => setPickOpen(false)}>
              Cancel
            </Button>
          }
        >
          <div className="flex max-h-80 flex-col gap-1 overflow-auto">
            {candidates.length === 0 && (
              <p className="text-body text-text-secondary">
                Every ingredient is already marked as made in-house. Add a new
                ingredient first if you make something that is not on the list.
              </p>
            )}
            {candidates.map((ingredient) => (
              <button
                key={ingredient.id}
                type="button"
                onClick={() => {
                  setPickOpen(false);
                  setEditorFor(ingredient);
                }}
                className="flex items-center justify-between rounded-control px-3 py-2 text-left hover:bg-surface"
              >
                <span className="font-medium">{ingredient.name}</span>
                <span className="text-caption text-text-secondary">{ingredient.baseUnit}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {editorFor && (
        <BatchRecipeEditor
          ingredient={editorFor}
          components={components}
          onClose={() => setEditorFor(null)}
          onSaved={() => {
            setEditorFor(null);
            overview.reload();
            onChanged();
          }}
        />
      )}

      {makeFor && (
        <MakeBatchModal
          row={makeFor}
          onClose={() => setMakeFor(null)}
          onMade={() => {
            setMakeFor(null);
            overview.reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------- recipe editor ---------------------------- */

interface DraftLine {
  componentId: string;
  qtyBase: string;
  wastePercentX100: string;
}

function BatchRecipeEditor({
  ingredient,
  components,
  onClose,
  onSaved,
}: {
  ingredient: Ingredient;
  components: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = useAsync(
    async () => unwrap(await getApi().stock.subRecipe({ ingredientId: ingredient.id })),
    [ingredient.id],
  );

  const [yieldBase, setYieldBase] = useState(
    ingredient.batchYieldBase > 0 ? String(ingredient.batchYieldBase) : '',
  );
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Seed the draft once, from whatever is already saved.
  const recipe: BatchRecipe | null = existing.data ?? null;
  if (recipe && !loaded) {
    setLines(
      recipe.lines.map((line) => ({
        componentId: String(line.componentId),
        qtyBase: String(line.qtyBase),
        wastePercentX100: String(line.wastePercentX100),
      })),
    );
    setLoaded(true);
  }

  // Memoised so the estimate below does not recompute on every unrelated render.
  const draft = useMemo(() => lines ?? [], [lines]);

  const addLine = () => {
    const free = components.find(
      (component) => !draft.some((line) => line.componentId === String(component.id)),
    );
    if (!free) return;
    setLines([...draft, { componentId: String(free.id), qtyBase: '', wastePercentX100: '0' }]);
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines(draft.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  };

  const removeLine = (index: number) => {
    setLines(draft.filter((_, at) => at !== index));
  };

  /* A live estimate, computed the same way the service does, so the figure on
     screen is the figure that gets saved. */
  const estimate = useMemo(() => {
    let total = 0;
    for (const line of draft) {
      const component = components.find((entry) => String(entry.id) === line.componentId);
      const qty = Number(line.qtyBase);
      if (!component || !Number.isInteger(qty) || qty <= 0) continue;
      total += Math.round((qty * component.avgCostMilli) / 1000);
    }
    const yieldQty = Number(yieldBase);
    const perUnit =
      total > 0 && Number.isInteger(yieldQty) && yieldQty > 0
        ? Math.round((total * 1000) / yieldQty)
        : null;
    return { total, perUnit };
  }, [draft, components, yieldBase]);

  const save = async () => {
    setSaving(true);
    setError('');

    try {
      const yieldQty = Number(yieldBase);

      unwrap(
        await getApi().stock.saveSubRecipe({
          ingredientId: ingredient.id,
          batchYieldBase: Number.isInteger(yieldQty) && yieldQty > 0 ? yieldQty : 0,
          lines: draft
            .filter((line) => line.qtyBase !== '')
            .map((line) => ({
              componentId: Number(line.componentId),
              qtyBase: Number(line.qtyBase),
              wastePercentX100: Number(line.wastePercentX100 || 0),
            })),
        }),
      );

      toast.success(`${ingredient.name} is now made in-house.`);
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const clearRecipe = async () => {
    setSaving(true);
    setError('');

    try {
      unwrap(
        await getApi().stock.saveSubRecipe({
          ingredientId: ingredient.id,
          batchYieldBase: 0,
          lines: [],
        }),
      );
      toast.success(`${ingredient.name} is bought from a supplier again.`);
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      title={`How ${ingredient.name} is made`}
      description="One batch, and how much it produces. The cost is worked out from these components — you never type a price."
      onClose={onClose}
      size="lg"
      footer={
        <>
          {ingredient.batchYieldBase > 0 && (
            <Button variant="ghost" onClick={clearRecipe} disabled={saving}>
              <Trash2 aria-hidden className="h-4 w-4" />
              Stop making it
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save recipe'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        {existing.error && <Alert tone="error">{errorMessage(existing.error)}</Alert>}

        <Input
          label={`One batch makes (${ingredient.baseUnit})`}
          type="number"
          min={1}
          value={yieldBase}
          onChange={(event) => setYieldBase(event.target.value)}
          hint="For example, one batch of mayo makes 1000 g. Setting this to 0 turns the ingredient back into a bought one."
        />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-label font-medium">What goes into one batch</span>
            <Button variant="secondary" className="px-2" onClick={addLine}>
              <Plus aria-hidden className="h-4 w-4" />
              Add component
            </Button>
          </div>

          {draft.length === 0 && (
            <p className="rounded-control border border-border bg-background p-3 text-body text-text-secondary">
              Nothing added yet. Add the oil, the egg, the spices — whatever the kitchen
              actually puts in.
            </p>
          )}

          {draft.map((line, index) => {
            const component = components.find((entry) => String(entry.id) === line.componentId);
            return (
              <div key={index} className="grid grid-cols-12 items-end gap-2">
                <div className="col-span-6">
                  <Select
                    label={index === 0 ? 'Component' : ' '}
                    value={line.componentId}
                    onChange={(event) => updateLine(index, { componentId: event.target.value })}
                    options={components.map((entry) => ({
                      value: String(entry.id),
                      label: `${entry.name} (${entry.baseUnit})`,
                    }))}
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    label={index === 0 ? 'Quantity' : ' '}
                    type="number"
                    min={1}
                    value={line.qtyBase}
                    onChange={(event) => updateLine(index, { qtyBase: event.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    label={index === 0 ? 'Trim %' : ' '}
                    type="number"
                    min={0}
                    max={50}
                    value={line.wastePercentX100 === '0' ? '' : line.wastePercentX100}
                    placeholder="0"
                    onChange={(event) =>
                      updateLine(index, { wastePercentX100: event.target.value || '0' })
                    }
                  />
                </div>
                <div className="col-span-1 pb-2">
                  <Button
                    variant="ghost"
                    className="px-2"
                    onClick={() => removeLine(index)}
                    title={`Remove ${component?.name ?? 'this component'}`}
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {estimate.total > 0 && (
          <div className="rounded-card border border-border bg-background p-3 text-body">
            <p>
              One batch costs{' '}
              <span className="font-semibold tabular text-text-primary">
                Rs {formatAmount(estimate.total)}
              </span>
              {estimate.perUnit !== null && (
                <>
                  {' '}
                  — that is{' '}
                  <span className="font-semibold tabular text-text-primary">
                    {formatUnitCost(estimate.perUnit, ingredient.baseUnit)}
                  </span>{' '}
                  per {ingredient.baseUnit}.
                </>
              )}
            </p>
            <p className="mt-1 text-caption text-text-secondary">
              Worked out from today&apos;s prices for the components. It moves by itself
              when oil or eggs get dearer.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------ make a batch ---------------------------- */

function MakeBatchModal({
  row,
  onClose,
  onMade,
}: {
  row: MadeIngredientRow;
  onClose: () => void;
  onMade: () => void;
}) {
  const [batches, setBatches] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const count = Number(batches);
  const validCount = Number.isInteger(count) && count > 0;
  const produced = validCount ? count * row.batchYieldBase : 0;
  const cost = validCount ? count * row.batchCost : 0;

  const make = async () => {
    setSaving(true);
    setError('');

    try {
      const batch = unwrap(
        await getApi().stock.makeSubRecipeBatch({
          ingredientId: row.ingredientId,
          batches: count,
          notes,
        }),
      );

      toast.success(
        `${batch.batchNo}: ${produced} ${row.baseUnit} of ${row.name} added to stock.`,
      );
      onMade();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      title={`Make ${row.name}`}
      description="The components come off the shelf and the finished batch goes on, at what it cost to make."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={make} disabled={saving || !validCount}>
            <ChefHat aria-hidden className="h-4 w-4" />
            {saving ? 'Making…' : 'Make it'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Input
          label="How many batches"
          type="number"
          min={1}
          value={batches}
          onChange={(event) => setBatches(event.target.value)}
          hint={`The shelf can supply ${row.canMakeBatches} batch${row.canMakeBatches === 1 ? '' : 'es'} right now.`}
        />

        <Input
          label="Note"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="e.g. Sunday prep"
        />

        {validCount && (
          <div className="rounded-card border border-border bg-background p-3 text-body">
            <p>
              This will put{' '}
              <span className="font-semibold tabular text-text-primary">
                {formatQuantity(produced, row.baseUnit, row.baseUnit, 1)}
              </span>{' '}
              of {row.name} on the shelf, worth{' '}
              <span className="font-semibold tabular text-text-primary">
                Rs {formatAmount(cost)}
              </span>
              .
            </p>
            {count > row.canMakeBatches && (
              <p className="mt-2 text-caption text-danger">
                The shelf only has enough components for {row.canMakeBatches} batch
                {row.canMakeBatches === 1 ? '' : 'es'}. The stock will go negative
                unless the purchases are entered first.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
