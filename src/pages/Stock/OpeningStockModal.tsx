import { useMemo, useState } from 'react';
import { PackageOpen } from 'lucide-react';
import type { Ingredient } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatAmount } from '../../utils/format';
import { formatQuantity } from '../../utils/units';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

/**
 * Opening stock — what was on the shelf on day one (plan §15 Q5, 4.B).
 *
 * This is not a purchase and not a count, and the difference matters at go-live:
 *
 *   * a **purchase** creates a bill, a supplier debt and a payment — none of which
 *     happened for food that was already in the fridge,
 *   * a **count** sets the shelf to a number, which says nothing about what that
 *     stock cost,
 *   * **opening stock** adds a quantity at a cost the owner names, so the first
 *     costing of every dish is right from the first sale.
 *
 * So the screen asks for two numbers per ingredient: how much is there, and what
 * did it cost per base unit. The cost defaults to the ingredient's current average
 * when one exists; on a fresh shop it will be empty and the owner types the price
 * he actually paid.
 */
export function OpeningStockModal({
  isOpen,
  ingredients,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [search, setSearch] = useState('');
  /** ingredientId → { qty, cost } as typed strings. */
  const [rows, setRows] = useState<Record<number, { qty: string; cost: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const active = useMemo(
    () => ingredients.filter((item) => item.active !== false),
    [ingredients],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return active;
    return active.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.category.toLowerCase().includes(needle),
    );
  }, [active, search]);

  const setRow = (ingredientId: number, patch: Partial<{ qty: string; cost: string }>) => {
    setRows((current) => {
      const existing = current[ingredientId] ?? { qty: '', cost: '' };
      const next = { ...existing, ...patch };
      // An untouched pair is dropped rather than sent as zeros.
      if (next.qty.trim() === '' && next.cost.trim() === '') {
        const copy = { ...current };
        delete copy[ingredientId];
        return copy;
      }
      return { ...current, [ingredientId]: next };
    });
  };

  /*
   * The typed cost is in RUPEES per base unit, because that is what an owner knows
   * ("chicken is 70 paisa a gram" is not a sentence anyone says, but "Rs 700 a kilo"
   * is). The wire format is milli-paisa per base unit, so the conversion lives here
   * and only here — `paisa × 1000` after rupees → paisa.
   */
  const parsed = useMemo(() => {
    return Object.entries(rows)
      .map(([key, text]) => {
        const ingredient = active.find((item) => item.id === Number(key));
        const qty = Number(text.qty);
        const rupees = Number(text.cost);
        if (!ingredient) return null;
        if (text.qty.trim() === '' || !Number.isInteger(qty) || qty <= 0) return null;
        if (text.cost.trim() === '' || !Number.isFinite(rupees) || rupees < 0) return null;
        return {
          ingredient,
          qtyBase: qty,
          unitCostMilli: Math.round(rupees * 100 * 1000),
          value: Math.round((qty * Math.round(rupees * 100 * 1000)) / 1000),
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null);
  }, [rows, active]);

  const totalValue = parsed.reduce((total, line) => total + line.value, 0);

  const handleSave = async () => {
    setError('');

    if (parsed.length === 0) {
      setError('Enter a quantity and a cost for at least one ingredient.');
      return;
    }
    // A row with a quantity but no cost would value the stock at zero and make the
    // first recipe look free. Refuse rather than quietly distort every margin.
    const incomplete = Object.entries(rows).some(([, text]) => {
      const qty = Number(text.qty);
      const hasQty = text.qty.trim() !== '' && Number.isInteger(qty) && qty > 0;
      return hasQty && (text.cost.trim() === '' || !Number.isFinite(Number(text.cost)));
    });
    if (incomplete) {
      setError('Every quantity needs a cost per base unit — a free shelf distorts every recipe.');
      return;
    }

    setSaving(true);
    try {
      const result = unwrap(
        await getApi().stock.openingStock({
          lines: parsed.map((line) => ({
            ingredientId: line.ingredient.id,
            qtyBase: line.qtyBase,
            unitCostMilli: line.unitCostMilli,
          })),
        }),
      );

      toast.success(
        `Opening stock recorded for ${result.applied} ingredient${
          result.applied === 1 ? '' : 's'
        }.`,
      );
      onSaved();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Opening stock"
      description="What is already in the kitchen today, and what it cost you."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <p className="mr-auto text-caption text-text-secondary">
            {parsed.length === 0
              ? 'Nothing entered yet'
              : `${parsed.length} ingredient${parsed.length === 1 ? '' : 's'} · value Rs ${formatAmount(
                  totalValue,
                )}`}
          </p>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || parsed.length === 0}>
            <PackageOpen aria-hidden className="h-4 w-4" />
            {saving ? 'Saving…' : 'Record opening stock'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Alert tone="info">
          Use this once, when you start using the app. After that, add stock with "Add
          purchase" — this screen does not create a bill and never owes a supplier
          anything.
        </Alert>

        <Input
          label="Find an ingredient"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or category…"
        />

        <div className="max-h-[40vh] overflow-y-auto rounded-card border border-border">
          <table className="w-full text-body">
            <thead className="sticky top-0 bg-background text-caption text-text-secondary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Ingredient</th>
                <th className="px-3 py-2 text-right font-medium">Already on the book</th>
                <th className="px-3 py-2 text-left font-medium">Quantity</th>
                <th className="px-3 py-2 text-left font-medium">Cost per unit</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-text-secondary">
                    Nothing matches “{search}”.
                  </td>
                </tr>
              )}
              {visible.map((item) => {
                const row = rows[item.id] ?? { qty: '', cost: '' };
                return (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-caption text-text-secondary">{item.category}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular text-text-secondary">
                      {formatQuantity(
                        item.qtyOnHand,
                        item.baseUnit,
                        item.purchaseUnit,
                        item.unitsPerPurchase,
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={`Opening quantity of ${item.name}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={row.qty}
                          onChange={(event) => setRow(item.id, { qty: event.target.value })}
                          className="h-9 w-24 rounded-control border border-border bg-surface px-2 text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                        />
                        <span className="text-caption text-text-secondary">{item.baseUnit}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span className="text-caption text-text-secondary">Rs</span>
                        <input
                          aria-label={`Opening cost of ${item.name}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={row.cost}
                          onChange={(event) => setRow(item.id, { cost: event.target.value })}
                          className="h-9 w-24 rounded-control border border-border bg-surface px-2 text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                        />
                        <span className="text-caption text-text-secondary">
                          /{item.baseUnit}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-caption text-text-secondary">
          Quantities are in the base unit shown beside each box (g, ml or pcs). The cost is
          per that same unit — for something bought by the kilo, enter the price of the gram
          (Rs 700 a kilo is 0.70).
        </p>
      </div>
    </Modal>
  );
}
