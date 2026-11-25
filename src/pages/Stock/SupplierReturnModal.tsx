import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import type { Ingredient, Supplier } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatAmount, todayIso } from '../../utils/format';
import { formatQuantity } from '../../utils/units';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

/**
 * Send stock back to the supplier (4.F).
 *
 * Deliberately not "void the purchase": a delivery of twenty crates where two were
 * crushed leaves eighteen crates that are perfectly good and already being sold.
 * Voiding would take all twenty off the shelf and wipe the bill. A return takes the
 * two back, keeps the bill, and gives the owner the paper trail to ask for a credit.
 *
 * The value is computed at the current average cost — the same rule as wastage and
 * sales — so the return never rewrites the cost of what is still on the shelf.
 */
export function SupplierReturnModal({
  ingredient,
  suppliers,
  onClose,
  onSaved,
}: {
  ingredient: Ingredient;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qtyBase, setQtyBase] = useState('');
  const [supplierId, setSupplierId] = useState(
    ingredient.supplierId ? String(ingredient.supplierId) : '',
  );
  const [reason, setReason] = useState('');
  const [happenedOn, setHappenedOn] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const qty = Number(qtyBase);
  const validQty = Number.isInteger(qty) && qty > 0;
  // Same arithmetic as the service, so the figure shown is the figure written.
  const value = validQty
    ? Math.round((qty * ingredient.avgCostMilli) / 1000)
    : 0;

  const handleSave = async () => {
    setError('');

    if (!validQty) {
      setError('Enter how much is going back, in whole base units.');
      return;
    }
    if (qty > ingredient.qtyOnHand) {
      setError(
        `Only ${ingredient.qtyOnHand} ${ingredient.baseUnit} is on the shelf. A return cannot take more than exists.`,
      );
      return;
    }
    if (reason.trim().length < 3) {
      setError('Say why it is going back — you will need that when you ask for the credit.');
      return;
    }

    setSaving(true);
    try {
      await unwrap(
        await getApi().stock.supplierReturn({
          ingredientId: ingredient.id,
          qtyBase: qty,
          supplierId: supplierId === '' ? null : Number(supplierId),
          reason,
          happenedOn,
        }),
      );
      toast.success(
        `${qty} ${ingredient.baseUnit} of ${ingredient.name} returned to the supplier.`,
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
      title={`Return ${ingredient.name} to the supplier`}
      description="The bill stays as it is — this records what went back so you can claim a credit."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Undo2 aria-hidden className="h-4 w-4" />
            {saving ? 'Recording…' : 'Record return'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="rounded-card border border-border bg-background p-3 text-body">
          <p className="text-text-secondary">
            On the shelf:{' '}
            <span className="font-medium text-text-primary">
              {formatQuantity(
                ingredient.qtyOnHand,
                ingredient.baseUnit,
                ingredient.purchaseUnit,
                ingredient.unitsPerPurchase,
              )}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={`Quantity going back (${ingredient.baseUnit})`}
            type="number"
            inputMode="numeric"
            min={1}
            value={qtyBase}
            onChange={(event) => setQtyBase(event.target.value)}
          />

          <Input
            label="Date"
            type="date"
            value={happenedOn}
            max={todayIso()}
            onChange={(event) => setHappenedOn(event.target.value)}
          />
        </div>

        <Select
          label="Supplier"
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
          placeholder="Who is it going back to?"
          options={suppliers.map((supplier) => ({
            value: String(supplier.id),
            label: supplier.name,
          }))}
        />

        <Input
          label="Why is it going back"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. two crates crushed in the van"
          hint="This is saved on the stock ledger, so the reason travels with the stock."
        />

        {validQty && (
          <p className="text-body text-text-secondary">
            Valued at the current average cost, this return is worth about{' '}
            <span className="font-semibold tabular text-text-primary">
              Rs {formatAmount(value)}
            </span>
            .
          </p>
        )}
      </div>
    </Modal>
  );
}
