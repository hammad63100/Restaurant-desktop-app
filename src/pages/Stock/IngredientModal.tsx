import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { z } from 'zod';
import type { BaseUnit, Ingredient, Supplier } from '../../types/api';
import { ingredientSchema } from '../../types/schemas';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { BASE_UNIT_LABELS } from '../../utils/units';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

type FormValues = z.input<typeof ingredientSchema>;

interface IngredientModalProps {
  isOpen: boolean;
  /** null = create a new ingredient. */
  ingredient: Ingredient | null;
  /** Category to pre-select when creating from a filtered list. */
  defaultCategory?: string;
  categories: string[];
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

/** Common fast-food categories, offered but never forced (the owner can type one). */
const SUGGESTED_CATEGORIES = [
  'Chicken & meat',
  'Bread & dough',
  'Sauces',
  'Dairy',
  'Vegetables',
  'Potato & sides',
  'Coating & dry goods',
  'Eggs',
  'Oil & fuel',
  'Drinks',
  'Packaging',
  'Cleaning',
  'Other',
];

/** Sensible conversions per base unit, so the owner rarely has to think. */
const UNIT_PRESETS: Record<BaseUnit, Array<{ label: string; purchaseUnit: string; units: number }>> = {
  g: [
    { label: 'kg (1000 g)', purchaseUnit: 'kg', units: 1000 },
    { label: 'packet', purchaseUnit: 'packet', units: 500 },
    { label: 'gram', purchaseUnit: 'g', units: 1 },
  ],
  ml: [
    { label: 'litre (1000 ml)', purchaseUnit: 'litre', units: 1000 },
    { label: 'bottle', purchaseUnit: 'bottle', units: 1000 },
    { label: 'ml', purchaseUnit: 'ml', units: 1 },
  ],
  pcs: [
    { label: 'piece', purchaseUnit: 'pc', units: 1 },
    { label: 'dozen (12)', purchaseUnit: 'dozen', units: 12 },
    { label: 'tray (30)', purchaseUnit: 'tray', units: 30 },
    { label: 'packet (6)', purchaseUnit: 'packet', units: 6 },
    { label: 'packet (10)', purchaseUnit: 'packet', units: 10 },
    { label: 'packet (100)', purchaseUnit: 'packet', units: 100 },
    { label: 'carton (24)', purchaseUnit: 'carton', units: 24 },
  ],
};

export function IngredientModal({
  isOpen,
  ingredient,
  defaultCategory,
  categories,
  suppliers,
  onClose,
  onSaved,
}: IngredientModalProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(ingredientSchema) as unknown as Resolver<FormValues>,
    defaultValues: {
      name: '',
      category: 'Other',
      baseUnit: 'g',
      purchaseUnit: 'kg',
      unitsPerPurchase: 1000,
      reorderLevel: 0,
      supplierId: null,
      active: true,
    },
  });

  const baseUnit = form.watch('baseUnit') ?? 'g';

  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);

    if (ingredient) {
      form.reset({
        id: ingredient.id,
        name: ingredient.name,
        category: ingredient.category,
        baseUnit: ingredient.baseUnit,
        purchaseUnit: ingredient.purchaseUnit,
        unitsPerPurchase: ingredient.unitsPerPurchase,
        reorderLevel: ingredient.reorderLevel,
        supplierId: ingredient.supplierId,
        active: ingredient.active,
      });
    } else {
      form.reset({
        name: '',
        category: defaultCategory ?? 'Other',
        baseUnit: 'g',
        purchaseUnit: 'kg',
        unitsPerPurchase: 1000,
        reorderLevel: 0,
        supplierId: null,
        active: true,
      });
    }
    // `form` is stable; depending on it would reset the form on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ingredient, defaultCategory]);

  const applyPreset = (value: string) => {
    const preset = UNIT_PRESETS[baseUnit][Number(value)];
    if (!preset) return;
    form.setValue('purchaseUnit', preset.purchaseUnit);
    form.setValue('unitsPerPurchase', preset.units);
  };

  const currentPresetIndex = UNIT_PRESETS[baseUnit].findIndex(
    (preset) =>
      preset.purchaseUnit === form.watch('purchaseUnit') &&
      preset.units === form.watch('unitsPerPurchase'),
  );

  const submit = form.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      const parsed = ingredientSchema.parse(values);
      unwrap(await getApi().stock.saveIngredient(parsed));
      toast.success(ingredient ? 'Ingredient updated' : 'Ingredient added');
      await onSaved();
      onClose();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  const categoryOptions = Array.from(new Set([...SUGGESTED_CATEGORIES, ...categories])).map(
    (category) => ({ value: category, label: category }),
  );

  return (
    <Modal
      isOpen={isOpen}
      title={ingredient ? `Edit ${ingredient.name}` : 'New ingredient'}
      description="Anything the kitchen buys and uses up: chicken, buns, mayo, boxes…"
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={submit} isLoading={isSaving}>
            {ingredient ? 'Save changes' : 'Add ingredient'}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {formError && <Alert tone="error">{formError}</Alert>}

        <Input
          label="Ingredient name"
          placeholder="e.g. Chicken fillet"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />

        <Select
          label="Category"
          options={categoryOptions}
          error={form.formState.errors.category?.message}
          {...form.register('category')}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Counted in"
            hint="The smallest unit the app tracks"
            options={[
              { value: 'g', label: 'gram (g)' },
              { value: 'ml', label: 'millilitre (ml)' },
              { value: 'pcs', label: 'pieces (pcs)' },
            ]}
            disabled={Boolean(ingredient && ingredient.qtyOnHand !== 0)}
            {...form.register('baseUnit')}
          />

          <Select
            label="Bought in"
            hint="How it arrives from the supplier"
            value={currentPresetIndex >= 0 ? String(currentPresetIndex) : ''}
            placeholder="Custom…"
            options={UNIT_PRESETS[baseUnit].map((preset, index) => ({
              value: String(index),
              label: preset.label,
            }))}
            onChange={(event) => applyPreset(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Purchase unit name"
            placeholder="kg, litre, dozen, packet"
            error={form.formState.errors.purchaseUnit?.message}
            {...form.register('purchaseUnit')}
          />
          <Input
            label={`${BASE_UNIT_LABELS[baseUnit]} per purchase unit`}
            type="number"
            min={1}
            inputMode="numeric"
            error={form.formState.errors.unitsPerPurchase?.message}
            {...form.register('unitsPerPurchase', { valueAsNumber: true })}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label={`Low-stock alert (${baseUnit})`}
            hint="The app warns you below this"
            type="number"
            min={0}
            inputMode="numeric"
            error={form.formState.errors.reorderLevel?.message}
            {...form.register('reorderLevel', { valueAsNumber: true })}
          />
          <Select
            label="Usual supplier (optional)"
            options={[
              { value: '', label: 'No supplier yet' },
              ...suppliers.map((supplier) => ({
                value: String(supplier.id),
                label: supplier.name,
              })),
            ]}
            value={form.watch('supplierId') === null ? '' : String(form.watch('supplierId'))}
            onChange={(event) =>
              form.setValue(
                'supplierId',
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
          />
        </div>

        {ingredient && ingredient.qtyOnHand !== 0 && (
          <Alert tone="info">
            This ingredient already has stock, so its unit cannot be changed.
          </Alert>
        )}
      </form>
    </Modal>
  );
}
