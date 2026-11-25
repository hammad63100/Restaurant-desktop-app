import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { z } from 'zod';
import type { Supplier } from '../../types/api';
import { supplierSchema } from '../../types/schemas';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { Button } from '../../components/Button';
import { Input, Textarea } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

type FormValues = z.input<typeof supplierSchema>;

interface SupplierModalProps {
  isOpen: boolean;
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function SupplierModal(props: SupplierModalProps) {
  // Remounting on a different supplier gives every open a clean form without a
  // setState-in-effect reset (which React's compiler rules reject).
  return <SupplierModalForm key={props.supplier?.id ?? 'new'} {...props} />;
}

function SupplierModalForm({ isOpen, supplier, onClose, onSaved }: SupplierModalProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(supplierSchema) as unknown as Resolver<FormValues>,
    defaultValues: supplier
      ? {
          id: supplier.id,
          name: supplier.name,
          phone: supplier.phone,
          address: supplier.address,
          notes: supplier.notes,
          active: supplier.active,
        }
      : { name: '', phone: '', address: '', notes: '', active: true },
  });

  const submit = form.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().stock.saveSupplier(supplierSchema.parse(values)));
      toast.success(supplier ? 'Supplier updated' : 'Supplier added');
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
      title={supplier ? `Edit ${supplier.name}` : 'New supplier'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={submit} isLoading={isSaving}>
            {supplier ? 'Save changes' : 'Add supplier'}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {formError && <Alert tone="error">{formError}</Alert>}

        <Input
          label="Supplier name"
          placeholder="e.g. Metro Cash & Carry"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Phone"
            placeholder="03xx-xxxxxxx"
            error={form.formState.errors.phone?.message}
            {...form.register('phone')}
          />
          <Input
            label="Address"
            placeholder="Market / area"
            error={form.formState.errors.address?.message}
            {...form.register('address')}
          />
        </div>
        <Textarea
          label="Notes"
          placeholder="Delivery days, contact person…"
          {...form.register('notes')}
        />
      </form>
    </Modal>
  );
}
