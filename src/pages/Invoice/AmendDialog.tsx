import { useMemo, useState } from 'react';
import { History, Minus, Plus, Save } from 'lucide-react';
import type { MenuItem, OrderAmendment, OrderDetail } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { formatAmount, formatDateTime } from '../../utils/format';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { MoneyInput } from '../../components/MoneyInput';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { Alert } from '../../components/Alert';
import { ApprovalDialog } from '../../components/ApprovalDialog';
import { toast } from '../../components/Toast';

interface AmendDialogProps {
  isOpen: boolean;
  order: OrderDetail | null;
  onClose: () => void;
  onAmended: (order: OrderDetail) => void;
}

interface DraftLine {
  itemId: number;
  name: string;
  price: number;
  qty: number;
  notes: string;
}

/**
 * Editing a saved bill (Phase 3 amendments).
 *
 * The screen sends the **complete** new set of lines, not a delta, because that is
 * what the service stores and snapshots. It deliberately does not decide whether
 * the edit is permitted: the paid-total rule and the discount ceiling are enforced
 * in the main process, and this dialog merely reports what it is told.
 */
export function AmendDialog({ isOpen, order, onClose, onAmended }: AmendDialogProps) {
  const menu = useAsync(async () => unwrap(await getApi().menu.listItems()), []);
  const history = useAsync(
    async () => (order ? unwrap(await getApi().orders.amendments(order.id)) : []),
    [order?.id, isOpen],
  );

  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [reason, setReason] = useState('');
  const [discount, setDiscount] = useState(0);
  const [addItemId, setAddItemId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [approvalId, setApprovalId] = useState<number | null>(null);
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Seed the draft from the saved bill the first time the dialog opens for it.
  const draft = useMemo<DraftLine[]>(() => {
    if (lines) return lines;
    if (!order) return [];

    return order.items.map((line) => ({
      itemId: line.itemId,
      name: line.name,
      price: line.price,
      qty: line.qty,
      notes: line.notes,
    }));
  }, [lines, order]);

  const subtotal = draft.reduce((total, line) => total + line.price * line.qty, 0);
  const safeDiscount = Math.min(discount, subtotal);
  const total = subtotal - safeDiscount;
  const discountTooLarge = discount > subtotal;

  const changeQty = (itemId: number, delta: number) => {
    setLines(
      draft
        .map((line) =>
          line.itemId === itemId ? { ...line, qty: Math.max(0, line.qty + delta) } : line,
        )
        .filter((line) => line.qty > 0),
    );
  };

  const addLine = (itemId: number) => {
    const item = (menu.data ?? []).find((candidate: MenuItem) => candidate.id === itemId);
    if (!item) return;

    const existing = draft.find((line) => line.itemId === itemId);
    setLines(
      existing
        ? draft.map((line) => (line.itemId === itemId ? { ...line, qty: line.qty + 1 } : line))
        : [...draft, { itemId: item.id, name: item.name, price: item.price, qty: 1, notes: '' }],
    );
  };

  const reset = () => {
    setLines(null);
    setReason('');
    setDiscount(0);
    setAddItemId('');
    setError(null);
    setApprovalId(null);
    setShowHistory(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const save = async (approval: number | null = approvalId) => {
    if (!order) return;

    setError(null);

    if (draft.length === 0) {
      setError('A bill needs at least one line. Cancel the bill instead.');
      return;
    }
    if (discountTooLarge) {
      setError('Discount subtotal se zyada nahi ho sakta.');
      return;
    }

    setIsSaving(true);
    try {
      const amended = unwrap(
        await getApi().orders.amend({
          id: order.id,
          reason,
          items: draft.map((line) => ({ itemId: line.itemId, qty: line.qty, notes: line.notes })),
          discount: safeDiscount,
          approvedBy: approval,
          notes: order.notes,
        }),
      );

      toast.success(`Bill updated · total ${formatAmount(amended.total)}`);
      reset();
      onAmended(amended);
    } catch (saveError) {
      const message = errorMessage(saveError, 'The bill could not be changed');

      // A discount above this role's ceiling needs a manager at the till, exactly
      // as it would when the bill was first rung up.
      if (message.toLowerCase().includes('approval')) {
        setIsApprovalOpen(true);
        return;
      }

      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        title={order ? `Edit ${order.orderNo}` : 'Edit bill'}
        description="The change is saved with a full copy of what the bill said before."
        onClose={close}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowHistory((value) => !value)}>
              <History aria-hidden className="h-4 w-4" />
              {showHistory ? 'Hide history' : `History (${history.data?.length ?? 0})`}
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => void save()} isLoading={isSaving} disabled={!reason.trim()}>
              <Save aria-hidden className="h-4 w-4" />
              Save changes
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {error && <Alert tone="error">{error}</Alert>}

          <div className="flex flex-col gap-2">
            {draft.map((line) => (
              <div
                key={line.itemId}
                className="flex items-center justify-between gap-2 rounded-control border border-border p-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-button">{line.name}</p>
                  <p className="text-caption text-text-secondary">
                    {formatAmount(line.price)} each
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => changeQty(line.itemId, -1)}
                    className="flex h-8 w-8 items-center justify-center rounded-control border border-border hover:bg-background"
                    aria-label={`One less ${line.name}`}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-8 text-center tabular">{line.qty}</span>
                  <button
                    type="button"
                    onClick={() => changeQty(line.itemId, 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-control border border-border hover:bg-background"
                    aria-label={`One more ${line.name}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-20 text-right tabular font-medium">
                    {formatAmount(line.price * line.qty)}
                  </span>
                </div>
              </div>
            ))}

            {draft.length === 0 && (
              <p className="text-caption text-text-secondary">
                Every line is gone. Add one back, or cancel the bill instead.
              </p>
            )}
          </div>

          <div className="flex items-end gap-2">
            <Select
              label="Add an item"
              value={addItemId}
              placeholder="Choose an item"
              options={(menu.data ?? [])
                .filter((item: MenuItem) => item.available)
                .map((item: MenuItem) => ({
                  value: String(item.id),
                  label: `${item.name} · ${formatAmount(item.price)}`,
                }))}
              onChange={(event) => {
                const id = Number(event.target.value);
                setAddItemId('');
                if (id) addLine(id);
              }}
              className="flex-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
            <MoneyInput label="Discount" value={discount} onChange={setDiscount} />
            <Input
              label="Reason for the change"
              value={reason}
              placeholder="Customer added a drink"
              onChange={(event) => setReason(event.target.value)}
              error={reason.trim() === '' ? 'Required: this is the audit trail' : undefined}
            />
          </div>

          <dl className="flex flex-col gap-1 text-body">
            <div className="flex justify-between">
              <dt className="text-text-secondary">Subtotal</dt>
              <dd className="tabular">{formatAmount(subtotal)}</dd>
            </div>
            {safeDiscount > 0 && (
              <div className="flex justify-between">
                <dt className="text-text-secondary">Discount</dt>
                <dd className="tabular text-status-cancelled">-{formatAmount(safeDiscount)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1">
              <dt className="text-card-title">New total</dt>
              <dd className="text-card-title tabular text-primary">{formatAmount(total)}</dd>
            </div>
            <div className="flex justify-between text-caption text-text-secondary">
              <dt>On the bill now</dt>
              <dd className="tabular">{formatAmount(order?.total ?? 0)}</dd>
            </div>
          </dl>

          {showHistory && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-card-title">Edit history</p>

              {(history.data ?? []).length === 0 && (
                <p className="text-caption text-text-secondary">This bill has never been edited.</p>
              )}

              <ol className="flex flex-col gap-2">
                {(history.data ?? []).map((edit: OrderAmendment) => (
                  <li key={edit.version} className="rounded-control border border-border p-2">
                    <p className="text-button">
                      v{edit.version} · {edit.reason}
                    </p>
                    <p className="text-caption text-text-secondary">
                      {edit.changedByName} · {formatDateTime(edit.createdAt)}
                    </p>
                    <p className="text-caption">
                      {formatAmount(edit.before.total)} → {formatAmount(edit.after.total)}
                      {' · '}
                      {edit.before.items.length} → {edit.after.items.length} line(s)
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </Modal>

      <ApprovalDialog
        isOpen={isApprovalOpen}
        amount={safeDiscount}
        percentX100={subtotal > 0 ? Math.round((safeDiscount / subtotal) * 10_000) : 0}
        onClose={() => setIsApprovalOpen(false)}
        onApproved={(id) => {
          setApprovalId(id);
          setIsApprovalOpen(false);
          void save(id);
        }}
      />
    </>
  );
}
