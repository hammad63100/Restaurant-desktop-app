import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { Ingredient } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatQuantity } from '../../utils/units';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

/**
 * Correct the shelf by a known amount (Roadmap 4.F).
 *
 * Different from a count: the count says "the shelf IS this", an adjustment says
 * "add this" or "take this away". Both require a reason, because a stock figure
 * with no explanation is the thing that makes an owner stop trusting the app.
 */
export function AdjustmentModal({
  ingredients,
  onClose,
  onSaved,
}: {
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ingredientId, setIngredientId] = useState('');
  const [direction, setDirection] = useState<'add' | 'remove'>('remove');
  const [qtyBase, setQtyBase] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ingredient = ingredients.find((item) => String(item.id) === ingredientId);
  const magnitude = Number(qtyBase);
  const validQty = Number.isInteger(magnitude) && magnitude > 0;
  const signed = direction === 'add' ? magnitude : -magnitude;

  const handleSave = async () => {
    setError('');

    if (!ingredient) {
      setError('Choose which ingredient is being corrected.');
      return;
    }
    if (!validQty) {
      setError('Enter how much to add or remove, in whole base units.');
      return;
    }
    if (signed < 0 && magnitude > ingredient.qtyOnHand) {
      setError(`Only ${ingredient.qtyOnHand} ${ingredient.baseUnit} is on hand to remove.`);
      return;
    }
    if (reason.trim().length < 3) {
      setError('Say why the stock is being corrected.');
      return;
    }

    setSaving(true);
    try {
      await unwrap(
        await getApi().stock.adjust({
          ingredientId: ingredient.id,
          qtyBase: signed,
          reason: reason.trim(),
        }),
      );
      toast.success(
        `${ingredient.name} adjusted by ${signed > 0 ? '+' : ''}${signed} ${ingredient.baseUnit}.`,
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
      title="Adjust stock"
      description="A correction you already know about — not a count of the whole shelf."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <SlidersHorizontal aria-hidden className="h-4 w-4" />
            {saving ? 'Saving…' : 'Apply adjustment'}
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
          <Select
            label="Direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as 'add' | 'remove')}
            options={[
              { value: 'remove', label: 'Remove from the shelf' },
              { value: 'add', label: 'Add to the shelf' },
            ]}
          />
          <Input
            label={`Quantity (${ingredient?.baseUnit ?? 'base units'})`}
            type="number"
            inputMode="numeric"
            min={1}
            value={qtyBase}
            onChange={(event) => setQtyBase(event.target.value)}
          />
        </div>

        <Input
          label="Why"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. delivery was two packets short"
          hint="This is written into the stock ledger next to the change."
        />
      </div>
    </Modal>
  );
}
