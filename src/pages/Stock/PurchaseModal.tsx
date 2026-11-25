import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { BaseUnit, Ingredient, Purchase, Supplier } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatAmount, todayIso } from '../../utils/format';
import { parsePurchaseQty, parseRupees } from '../../utils/units';
import { Button } from '../../components/Button';
import { Input, Textarea } from '../../components/Input';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

interface PurchaseModalProps {
  isOpen: boolean;
  ingredients: Ingredient[];
  suppliers: Supplier[];
  /** True when the user may pay from the till (cash) and a shift link is possible. */
  canUseDrawer: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

interface DraftLine {
  key: number;
  ingredientId: number | '';
  /** Quantity typed in purchase units, e.g. "2.5". */
  qtyText: string;
  /** Price per purchase unit typed in rupees, e.g. "710". */
  priceText: string;
}

let nextKey = 1;

const emptyLine = (): DraftLine => ({
  key: nextKey++,
  ingredientId: '',
  qtyText: '',
  priceText: '',
});

const PAYMENT_OPTIONS = [
  { value: 'cash', label: 'Cash from drawer' },
  { value: 'credit', label: 'On credit (pay supplier later)' },
  { value: 'bank_transfer', label: 'Bank / online transfer' },
  { value: 'jazzcash', label: 'JazzCash' },
  { value: 'easypaisa', label: 'Easypaisa' },
];

/**
 * Add purchase (stock-in).
 *
 * The grid is keyboard-first: pick an ingredient, type the quantity in purchase
 * units and the price per purchase unit. The line total and the running bill
 * total are shown live so the owner can check against the supplier's slip before
 * saving (design.md: big controls, tabular numbers).
 */
export function PurchaseModal({
  isOpen,
  ingredients,
  suppliers,
  canUseDrawer,
  onClose,
  onSaved,
}: PurchaseModalProps) {
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [billNo, setBillNo] = useState('');
  const [purchasedOn, setPurchasedOn] = useState(todayIso());
  const [extraChargesText, setExtraChargesText] = useState('');
  const [paidText, setPaidText] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const ingredientById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients],
  );

  const reset = () => {
    setSupplierId(null);
    setBillNo('');
    setPurchasedOn(todayIso());
    setExtraChargesText('');
    setPaidText('');
    setPaymentMethod('cash');
    setNotes('');
    setLines([emptyLine()]);
    setError(null);
  };

  const updateLine = (key: number, patch: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const removeLine = (key: number) => {
    setLines((current) =>
      current.length === 1 ? [emptyLine()] : current.filter((line) => line.key !== key),
    );
  };

  const lineTotal = (line: DraftLine): number => {
    const qty = parsePurchaseQty(line.qtyText);
    const price = parseRupees(line.priceText);
    if (qty === null || price === null) return 0;
    return Math.round((qty * price) / 1000);
  };

  const subtotal = lines.reduce((total, line) => total + lineTotal(line), 0);
  const extraCharges = parseRupees(extraChargesText) ?? 0;
  const total = subtotal + extraCharges;
  const paidAmount = paidText.trim() === '' ? (paymentMethod === 'credit' ? 0 : total) : (parseRupees(paidText) ?? 0);

  const chooseIngredient = (key: number, value: string) => {
    if (value === '') {
      updateLine(key, { ingredientId: '' });
      return;
    }

    const id = Number(value);
    const ingredient = ingredientById.get(id);
    updateLine(key, { ingredientId: id });

    // Last price for this ingredient is a useful starting point, but the owner
    // still types what the supplier actually charged today (prices differ).
    if (ingredient && ingredient.lastCostMilli > 0 && !lines.find((l) => l.key === key)?.priceText) {
      const perPurchaseUnitPaisa = Math.round(
        (ingredient.lastCostMilli * ingredient.unitsPerPurchase) / 1000,
      );
      updateLine(key, { priceText: (perPurchaseUnitPaisa / 100).toFixed(2) });
    }
  };

  const submit = async () => {
    setError(null);

    const prepared = lines
      .filter((line) => line.ingredientId !== '')
      .map((line) => {
        const ingredient = ingredientById.get(Number(line.ingredientId));
        const qtyPurchaseMilli = parsePurchaseQty(line.qtyText) ?? 0;
        const unitPrice = parseRupees(line.priceText) ?? 0;
        return { ingredient, qtyPurchaseMilli, unitPrice };
      });

    if (prepared.length === 0) {
      setError('Add at least one ingredient to the purchase');
      return;
    }

    for (const line of prepared) {
      if (!line.ingredient) {
        setError('One line has no ingredient');
        return;
      }
      if (line.qtyPurchaseMilli <= 0) {
        setError(`Enter a quantity for ${line.ingredient.name}`);
        return;
      }
      if (line.unitPrice <= 0) {
        setError(`Enter the price you paid for ${line.ingredient.name}`);
        return;
      }
    }

    const duplicate = prepared
      .map((line) => line.ingredient!.id)
      .find((id, index, all) => all.indexOf(id) !== index);
    if (duplicate !== undefined) {
      setError(`${ingredientById.get(duplicate)?.name} is on two lines. Use one line per ingredient.`);
      return;
    }

    setIsSaving(true);
    try {
      const purchase = unwrap(
        await getApi().stock.createPurchase({
          supplierId,
          billNo: billNo.trim(),
          purchasedOn,
          extraCharges,
          paidAmount,
          paymentMethod: paymentMethod as Purchase['paymentMethod'],
          notes: notes.trim(),
          lines: prepared.map((line) => ({
            ingredientId: line.ingredient!.id,
            qtyPurchaseMilli: line.qtyPurchaseMilli,
            unitPrice: line.unitPrice,
          })),
        }),
      );

      toast.success(
        `Purchase ${purchase.purchaseNo} saved — stock updated, ${formatAmount(purchase.total)}`,
      );
      await onSaved();
      reset();
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const ingredientOptions = ingredients.map((ingredient) => ({
    value: String(ingredient.id),
    label: `${ingredient.name} (${ingredient.purchaseUnit})`,
  }));

  return (
    <Modal
      isOpen={isOpen}
      title="Add stock (purchase)"
      description="What you bought for the shop. The shelf and the average cost update when you save."
      onClose={() => {
        reset();
        onClose();
      }}
      size="lg"
      footer={
        <>
          <div className="mr-auto text-body">
            <span className="text-text-secondary">Total </span>
            <span className="font-semibold tabular text-text-primary">
              Rs {formatAmount(total)}
            </span>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={submit} isLoading={isSaving}>
            Save purchase
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Supplier"
            options={[
              { value: '', label: 'No supplier' },
              ...suppliers.map((supplier) => ({
                value: String(supplier.id),
                label: supplier.name,
              })),
            ]}
            value={supplierId === null ? '' : String(supplierId)}
            onChange={(event) =>
              setSupplierId(event.target.value === '' ? null : Number(event.target.value))
            }
          />
          <Input
            label="Supplier bill no."
            placeholder="Optional"
            value={billNo}
            onChange={(event) => setBillNo(event.target.value)}
          />
          <Input
            label="Purchase date"
            type="date"
            value={purchasedOn}
            onChange={(event) => setPurchasedOn(event.target.value)}
          />
        </div>

        <div className="rounded-card border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-card-title text-text-primary">Items</h3>
            <Button size="md" variant="secondary" onClick={() => setLines((c) => [...c, emptyLine()])}>
              <Plus aria-hidden className="h-4 w-4" />
              Add line
            </Button>
          </div>

          <div className="flex flex-col divide-y divide-border">
            {lines.map((line) => {
              const ingredient = line.ingredientId === '' ? null : ingredientById.get(Number(line.ingredientId));
              const baseUnit: BaseUnit = ingredient?.baseUnit ?? 'g';

              return (
                <div key={line.key} className="grid grid-cols-12 items-end gap-2 px-3 py-2">
                  <div className="col-span-12 sm:col-span-5">
                    <Select
                      label="Ingredient"
                      options={ingredientOptions}
                      placeholder="Choose…"
                      value={line.ingredientId === '' ? '' : String(line.ingredientId)}
                      onChange={(event) => chooseIngredient(line.key, event.target.value)}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <Input
                      label={`Qty (${ingredient?.purchaseUnit ?? 'unit'})`}
                      inputMode="decimal"
                      placeholder="0"
                      className="tabular"
                      value={line.qtyText}
                      onChange={(event) => {
                        updateLine(line.key, { qtyText: event.target.value });
                      }}
                    />
                  </div>
                  <div className="col-span-5 sm:col-span-3">
                    <Input
                      label={`Price / ${ingredient?.purchaseUnit ?? 'unit'}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="tabular"
                      rightAddon="Rs"
                      value={line.priceText}
                      onChange={(event) => {
                        updateLine(line.key, { priceText: event.target.value });
                      }}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 text-right text-body tabular text-text-primary">
                    {formatAmount(lineTotal(line))}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      aria-label="Remove line"
                      onClick={() => removeLine(line.key)}
                      className="rounded-control p-2 text-text-secondary hover:bg-background hover:text-status-cancelled"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {ingredient && (
                    <p className="col-span-12 text-caption text-text-secondary">
                      {line.qtyText
                        ? `${line.qtyText} ${ingredient.purchaseUnit} = ${(
                            (parsePurchaseQty(line.qtyText) ?? 0) *
                            ingredient.unitsPerPurchase /
                            1000
                          ).toLocaleString()} ${baseUnit}`
                        : `1 ${ingredient.purchaseUnit} = ${ingredient.unitsPerPurchase.toLocaleString()} ${baseUnit}`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
            <div className="flex justify-between text-body text-text-secondary">
              <span>Subtotal</span>
              <span className="tabular text-text-primary">Rs {formatAmount(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-text-secondary">Transport / extra charges</span>
              <div className="w-40">
                <Input
                  label=""
                  inputMode="decimal"
                  placeholder="0.00"
                  className="tabular"
                  rightAddon="Rs"
                  value={extraChargesText}
                  onChange={(event) => setExtraChargesText(event.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-body font-semibold text-text-primary">
              <span>Purchase total</span>
              <span className="tabular">Rs {formatAmount(total)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Payment method"
            options={PAYMENT_OPTIONS}
            value={paymentMethod}
            onChange={(event) => {
              setPaymentMethod(event.target.value);
              setPaidText('');
            }}
            hint={
              canUseDrawer
                ? 'Cash from drawer also reduces the day-close expected cash.'
                : 'No shift is open, so cash will not touch the drawer report.'
            }
          />
          <Input
            label="Amount paid now"
            inputMode="decimal"
            placeholder={paymentMethod === 'credit' ? '0.00' : formatAmount(total)}
            className="tabular"
            rightAddon="Rs"
            hint={
              paymentMethod === 'credit'
                ? 'Leave empty to owe the whole bill'
                : 'Leave empty to pay the full bill'
            }
            value={paidText}
            onChange={(event) => setPaidText(event.target.value)}
          />
        </div>

        <Textarea
          label="Notes"
          placeholder="Optional (vehicle, bill details…)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
    </Modal>
  );
}
