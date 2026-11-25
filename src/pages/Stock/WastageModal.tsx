import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { WASTAGE_REASON_LABELS, type Ingredient, type WastageReason } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatQuantity, formatUnitCost } from '../../utils/units';
import { formatAmount, todayIso } from '../../utils/format';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

const REASONS: WastageReason[] = ['spoiled', 'dropped', 'expired', 'staff_meal', 'test', 'other'];

/**
 * Throw food away (Roadmap 4.F).
 *
 * The quantity is typed in base units and the service values it at the current
 * average cost, so the shop sees what the loss is worth the moment it is entered.
 * Nothing here lets the owner type more than is on the shelf — that is the app's
 * job to refuse, not the owner's to remember.
 */
export function WastageModal({
  ingredients,
  onClose,
  onSaved,
}: {
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ingredientId, setIngredientId] = useState('');
  const [qtyBase, setQtyBase] = useState('');
  const [reason, setReason] = useState<WastageReason>('spoiled');
  const [notes, setNotes] = useState('');
  const [happenedOn, setHappenedOn] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ingredient = ingredients.find((item) => String(item.id) === ingredientId);
  const qty = Number(qtyBase);
  const validQty = Number.isInteger(qty) && qty > 0;
  // The estimate is a courtesy, not the truth: the service values at the average
  // cost at the moment it writes the row. Rounded to whole rupees for display.
  // avgCostMilli is milli-paisa per base unit, so qty × it ÷ 1000 is paisa.
  const estimatePaisa =
    ingredient && validQty ? Math.round((qty * ingredient.avgCostMilli) / 1000) : 0;

  const handleSave = async () => {
    setError('');

    if (!ingredient) {
      setError('Choose which ingredient was wasted.');
      return;
    }
    if (!validQty) {
      setError('Enter how much was thrown away, in whole base units.');
      return;
    }
    if (qty > ingredient.qtyOnHand) {
      setError(
        `Only ${ingredient.qtyOnHand} ${ingredient.baseUnit} is on the shelf. ` +
          'If the shelf itself is wrong, use a stock count instead.',
      );
      return;
    }

    setSaving(true);
    try {
      await unwrap(
        await getApi().stock.recordWastage({
          ingredientId: ingredient.id,
          qtyBase: qty,
          reason,
          notes,
          happenedOn,
        }),
      );
      toast.success(`${qty} ${ingredient.baseUnit} of ${ingredient.name} written off.`);
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
      title="Record wastage"
      description="Food that left the shelf without being sold."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Trash2 aria-hidden className="h-4 w-4" />
            {saving ? 'Writing off…' : 'Write off'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Select
          label="Ingredient"
          value={ingredientId}
          onChange={(event) => setIngredientId(event.target.value)}
          placeholder="Choose an ingredient…"
          options={ingredients.map((item) => ({
            value: String(item.id),
            label: `${item.name} — ${formatQuantity(
              item.qtyOnHand,
              item.baseUnit,
              item.purchaseUnit,
              item.unitsPerPurchase,
            )} on hand`,
          }))}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={`Quantity (${ingredient?.baseUnit ?? 'base units'})`}
            type="number"
            inputMode="numeric"
            min={1}
            value={qtyBase}
            onChange={(event) => setQtyBase(event.target.value)}
            hint={
              ingredient
                ? `${formatUnitCost(ingredient.avgCostMilli, ingredient.baseUnit)} each`
                : undefined
            }
          />

          <Select
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value as WastageReason)}
            options={REASONS.map((value) => ({ value, label: WASTAGE_REASON_LABELS[value] }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date it happened"
            type="date"
            value={happenedOn}
            max={todayIso()}
            onChange={(event) => setHappenedOn(event.target.value)}
          />
          <Input
            label="Note (optional)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. tray dropped at closing"
          />
        </div>

        {ingredient && validQty && (
          <div className="rounded-card border border-border bg-background p-3 text-body">
            <p className="text-text-secondary">
              Valued at the current average cost, this loss is about{' '}
              <span className="font-semibold tabular text-text-primary">
                Rs {formatAmount(estimatePaisa)}
              </span>
              .
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
