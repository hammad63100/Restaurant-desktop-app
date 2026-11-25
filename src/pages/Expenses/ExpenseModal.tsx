import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { z } from 'zod';
import type { ExpenseCategory, ExpensePaidFrom, ExpenseInput } from '../../types/api';
import { expenseSchema } from '../../types/schemas';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { todayIso } from '../../utils/format';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { Alert } from '../../components/Alert';
import { MoneyInput } from '../../components/MoneyInput';
import { toast } from '../../components/Toast';

type FormValues = z.input<typeof expenseSchema>;

interface ExpenseModalProps {
  isOpen: boolean;
  categories: ExpenseCategory[];
  /** True when a drawer shift is open; cash expenses need one. */
  drawerOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const PAID_FROM_OPTIONS: Array<{ value: ExpensePaidFrom; label: string }> = [
  { value: 'cash', label: 'Cash from the drawer' },
  { value: 'bank', label: 'Bank / card' },
  { value: 'other', label: "Outside money (owner's pocket)" },
];

/**
 * One shop expense: rent, the electricity bill, a plumber, tea for the staff.
 *
 * The only thing the cashier-owner has to get right is where the money came from,
 * so "cash from the drawer" is the default and says plainly when no drawer is
 * open. Everything else is a normal form.
 */
export function ExpenseModal({
  isOpen,
  categories,
  drawerOpen,
  onClose,
  onSaved,
}: ExpenseModalProps) {
  const activeCategories = categories.filter((category) => category.active);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(expenseSchema) as unknown as Resolver<FormValues>,
    defaultValues: {
      categoryId: activeCategories[0]?.id ?? 0,
      spentOn: todayIso(),
      amount: 0,
      paidFrom: drawerOpen ? 'cash' : 'other',
      payee: '',
      notes: '',
    },
  });

  const amount = form.watch('amount') ?? 0;
  const paidFrom = form.watch('paidFrom');

  useEffect(() => {
    const firstCategory = activeCategories[0];
    if (firstCategory && !form.getValues('categoryId')) {
      form.setValue('categoryId', firstCategory.id);
    }
  }, [activeCategories, form]);

  const submit = form.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);

    try {
      const input: ExpenseInput = {
        categoryId: Number(values.categoryId),
        spentOn: values.spentOn,
        amount: Number(values.amount),
        paidFrom: values.paidFrom,
        payee: values.payee ?? '',
        notes: values.notes ?? '',
      };

      unwrap(await getApi().expenses.save(input));
      toast.success('Expense recorded');
      await onSaved();
      onClose();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  return (
    <Modal
      isOpen={isOpen}
      title="Record an expense"
      description="Money the shop spends. This is not a purchase: nothing comes onto the shelf."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            isLoading={isSaving}
            disabled={isSaving || activeCategories.length === 0}
          >
            Save expense
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}

        {activeCategories.length === 0 && (
          <Alert tone="warning">
            No active categories found. Please add an expense category first from the Categories tab.
          </Alert>
        )}

        {!drawerOpen && (
          <Alert tone="info">
            No drawer is open, so this cannot be paid in cash from the till. Record it as
            bank or outside money, or open the day first.
          </Alert>
        )}

        <Select
          label="Category"
          options={activeCategories.map((category) => ({
            value: String(category.id),
            label: category.name,
          }))}
          error={form.formState.errors.categoryId?.message}
          {...form.register('categoryId', { valueAsNumber: true })}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date"
            type="date"
            max={todayIso()}
            error={form.formState.errors.spentOn?.message}
            {...form.register('spentOn')}
          />

          <MoneyInput
            label="Amount"
            value={amount}
            onChange={(paisa) => form.setValue('amount', paisa, { shouldValidate: true })}
            error={form.formState.errors.amount?.message}
          />
        </div>

        <Select
          label="Paid from"
          options={PAID_FROM_OPTIONS.filter(
            (option) => option.value !== 'cash' || drawerOpen,
          ).map((option) => ({ value: option.value, label: option.label }))}
          error={form.formState.errors.paidFrom?.message}
          {...form.register('paidFrom')}
        />

        <p className="text-caption text-text-secondary">
          {paidFrom === 'cash'
            ? 'This will be taken out of the open drawer, so the day close stays correct.'
            : 'No cash leaves the drawer, so the day close is untouched.'}
        </p>

        <Input
          label="Paid to (optional)"
          placeholder="K-Electric, landlord, plumber…"
          error={form.formState.errors.payee?.message}
          {...form.register('payee')}
        />

        <Input
          label="Notes (optional)"
          placeholder="What was it for?"
          error={form.formState.errors.notes?.message}
          {...form.register('notes')}
        />
      </form>
    </Modal>
  );
}
