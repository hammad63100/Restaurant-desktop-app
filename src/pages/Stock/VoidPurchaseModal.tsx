import { useState } from 'react';
import type { Purchase } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatAmount } from '../../utils/format';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

interface VoidPurchaseModalProps {
  purchase: Purchase | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

/**
 * Void a purchase with a reason (Rules.md: confirm + audit for destructive acts).
 * The stock it added is taken back out and a drawer-paid purchase returns its
 * cash to the till; the row itself is kept, never deleted.
 */
export function VoidPurchaseModal(props: VoidPurchaseModalProps) {
  // A different purchase gets its own empty reason box (key = remount).
  return <VoidPurchaseForm key={props.purchase?.id ?? 'none'} {...props} />;
}

function VoidPurchaseForm({ purchase, onClose, onSaved }: VoidPurchaseModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    if (!purchase) return;
    setError(null);

    if (reason.trim().length < 3) {
      setError('Write why this purchase is being voided');
      return;
    }

    setIsSaving(true);
    try {
      unwrap(await getApi().stock.voidPurchase({ id: purchase.id, reason: reason.trim() }));
      toast.success(`Purchase ${purchase.purchaseNo} voided — stock reversed`);
      await onSaved();
      onClose();
    } catch (voidError) {
      setError(errorMessage(voidError));
    } finally {
      setIsSaving(false);
    }
  };

  if (!purchase) return null;

  return (
    <Modal
      isOpen
      title={`Void purchase ${purchase.purchaseNo}`}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Keep purchase
          </Button>
          <Button variant="danger" onClick={submit} isLoading={isSaving}>
            Void purchase
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Alert tone="warning">
          {`The stock from this purchase (${formatAmount(purchase.total)}) will be taken back out of the shelf. The record stays in the purchases list.`}
        </Alert>

        {error && <Alert tone="error">{error}</Alert>}

        <Input
          label="Reason"
          placeholder="e.g. wrong price on the bill"
          value={reason}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Modal>
  );
}
