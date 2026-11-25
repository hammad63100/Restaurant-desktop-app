import { useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Ingredient } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatQuantity } from '../../utils/units';
import { formatAmount, todayIso } from '../../utils/format';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

/**
 * Count the shelf (Roadmap 4.F).
 *
 * Only the ingredients the owner actually counted get a box, so a count of five
 * things does not touch the other hundred. Each typed number is compared with the
 * book quantity there and then, and the variance is shown in red or green — the
 * owner sees the size of the discrepancy before saving anything.
 *
 * On save the shelf is SET to the counted number, not increased by the difference.
 * That is the whole point of a count: the shelf is whatever the person holding the
 * clipboard says it is.
 */
export function StockCountModal({
  ingredients,
  onClose,
  onSaved,
}: {
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [countedOn, setCountedOn] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  /** ingredientId → what was typed. Absent means "not counted". */
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const active = useMemo(
    () => ingredients.filter((item) => item.active !== false),
    [ingredients],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return active;
    return active.filter((item) => item.name.toLowerCase().includes(needle));
  }, [active, search]);

  const lines = useMemo(
    () =>
      Object.entries(counted)
        .map(([id, text]) => {
          const ingredient = active.find((item) => item.id === Number(id));
          const qty = Number(text);
          if (!ingredient || text.trim() === '' || !Number.isInteger(qty) || qty < 0) {
            return null;
          }
          return { ingredient, countedQty: qty, variance: qty - ingredient.qtyOnHand };
        })
        .filter((line): line is NonNullable<typeof line> => line !== null),
    [counted, active],
  );

  // Same arithmetic as the service, so the number the owner reads here is the
  // number that ends up on the saved count.
  const varianceValue = lines.reduce(
    (total, line) =>
      total + Math.round((Math.abs(line.variance) * line.ingredient.avgCostMilli) / 1000),
    0,
  );
  const differing = lines.filter((line) => line.variance !== 0).length;

  const setOne = (ingredientId: number, value: string) => {
    setCounted((current) => {
      const next = { ...current };
      if (value === '') delete next[ingredientId];
      else next[ingredientId] = value;
      return next;
    });
  };

  const handleSave = async () => {
    setError('');

    if (lines.length === 0) {
      setError('Count at least one ingredient before saving.');
      return;
    }
    const incomplete = Object.entries(counted).some(
      ([, text]) => text.trim() === '' || !Number.isInteger(Number(text)) || Number(text) < 0,
    );
    if (incomplete) {
      setError('Every box you filled must hold a whole number — leave untouched rows blank.');
      return;
    }

    setSaving(true);
    try {
      const detail = await unwrap(
        await getApi().stock.saveCount({
          countedOn,
          notes,
          lines: lines.map((line) => ({
            ingredientId: line.ingredient.id,
            countedQty: line.countedQty,
          })),
        }),
      );

      toast.success(
        differing === 0
          ? `Count ${detail.count.countNo} saved — the book was right.`
          : `Count ${detail.count.countNo} saved — ${differing} ${
              differing === 1 ? 'ingredient' : 'ingredients'
            } corrected.`,
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
      isOpen
      title="Count the shelf"
      description="Type only what you counted. Everything else is left as it is."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || lines.length === 0}>
            <ClipboardCheck aria-hidden className="h-4 w-4" />
            {saving ? 'Saving…' : `Save count${lines.length ? ` (${lines.length})` : ''}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Counted on"
            type="date"
            value={countedOn}
            max={todayIso()}
            onChange={(event) => setCountedOn(event.target.value)}
          />
          <Input
            label="Note (optional)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. Sunday night count"
          />
          <Input
            label="Find an ingredient"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search…"
          />
        </div>

        <div className="max-h-[46vh] overflow-y-auto rounded-card border border-border">
          <table className="w-full text-body">
            <thead className="sticky top-0 bg-background text-caption text-text-secondary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Ingredient</th>
                <th className="px-3 py-2 text-right font-medium">On the book</th>
                <th className="px-3 py-2 text-left font-medium">Counted</th>
                <th className="px-3 py-2 text-right font-medium">Difference</th>
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
                const text = counted[item.id] ?? '';
                const qty = Number(text);
                const filled = text.trim() !== '' && Number.isInteger(qty) && qty >= 0;
                const variance = filled ? qty - item.qtyOnHand : 0;

                return (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <span className="font-medium">{item.name}</span>
                      <span className="ml-2 text-caption text-text-secondary">
                        {item.baseUnit}
                      </span>
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
                      <input
                        aria-label={`Counted quantity of ${item.name}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={text}
                        onChange={(event) => setOne(item.id, event.target.value)}
                        className="h-9 w-28 rounded-control border border-border bg-surface px-2 text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                      />
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular ${
                        filled && variance !== 0 ? 'font-semibold' : 'text-text-secondary'
                      }`}
                    >
                      {!filled ? '—' : variance === 0 ? '0' : `${variance > 0 ? '+' : ''}${variance}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-background px-3 py-2">
          <p className="text-caption text-text-secondary">
            {lines.length === 0
              ? 'No ingredient counted yet.'
              : `${lines.length} counted · ${differing} differ from the book`}
          </p>
          <p className="text-body">
            Value of the difference{' '}
            <span className="font-semibold tabular">Rs {formatAmount(varianceValue)}</span>
          </p>
        </div>
      </div>
    </Modal>
  );
}
