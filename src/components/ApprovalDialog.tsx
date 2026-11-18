import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getApi, unwrap, errorMessage } from '../utils/api';
import { formatAmount } from '../utils/format';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';
import { Alert } from './Alert';

interface ApprovalDialogProps {
  isOpen: boolean;
  /** The discount that was refused, in paisa. */
  amount: number;
  /** Percent x100, so 8% is 800. Sent along for the audit trail. */
  percentX100: number;
  onClose: () => void;
  /** Called with the approval id the order must be saved with, and its reason. */
  onApproved: (approvalId: number, reason: string) => void;
}

/**
 * Manager approval at the till (feature 3.C).
 *
 * The manager walks to the cashier's screen and types **their own** username and
 * password. This dialog never approves anything locally — the main process checks
 * the password, the approver's role, and refuses self-approval. We deliberately do
 * not show who is logged in, because the point is that it is somebody else.
 */
export function ApprovalDialog({
  isOpen,
  amount,
  percentX100,
  onClose,
  onApproved,
}: ApprovalDialogProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUsername('');
    setPassword('');
    setReason('');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const approval = unwrap(
        await getApi().discounts.approve({
          orderId: null,
          percentX100,
          amount,
          reason,
          username,
          password,
        }),
      );

      const savedReason = reason;
      reset();
      onApproved(approval.id, savedReason);
    } catch (approvalError) {
      setError(errorMessage(approvalError, 'The discount could not be approved'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Manager approval needed"
      description={`This discount of ${formatAmount(amount)} is above what your role can give on its own.`}
      onClose={close}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !username || !password || !reason}>
            <ShieldCheck aria-hidden className="h-4 w-4" />
            {busy ? 'Checking…' : 'Approve'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-caption text-text-secondary">
          Call a manager or the owner. They must enter their own username and password — a different
          person from whoever is at the till.
        </p>

        <Input
          label="Manager username"
          value={username}
          autoFocus
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          label="Manager password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && username && password && reason) void submit();
          }}
        />
        <Input
          label="Reason"
          value={reason}
          placeholder="Regular customer, owner approved"
          onChange={(event) => setReason(event.target.value)}
        />

        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
