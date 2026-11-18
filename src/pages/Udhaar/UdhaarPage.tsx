import { useState } from 'react';
import { BookOpen, HandCoins, Phone, Wallet } from 'lucide-react';
import type { CustomerLedgerEntry, PaymentMethod, UdhaarAccount } from '../../types/api';
import { PAYMENT_METHOD_LABELS } from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../store/settingsStore';
import { formatAmount, formatDateTime } from '../../utils/format';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { Input } from '../../components/Input';
import { MoneyInput } from '../../components/MoneyInput';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';

const SETTLE_METHODS: PaymentMethod[] = ['cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer'];

export function UdhaarPage() {
  const { allow } = useAuth();
  const currency = useSettings((settings) => settings.currency);
  const canSettle = allow('udhaar:settle');

  const [selected, setSelected] = useState<UdhaarAccount | null>(null);
  const [search, setSearch] = useState('');
  const [settleTarget, setSettleTarget] = useState<UdhaarAccount | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const accounts = useAsync(async () => unwrap(await getApi().payments.udhaarList()), []);
  const ledger = useAsync(
    async () => (selected ? unwrap(await getApi().payments.udhaarLedger(selected.customerId)) : []),
    [selected?.customerId],
  );

  const visible = (accounts.data ?? []).filter((account) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return account.name.toLowerCase().includes(term) || account.phone.toLowerCase().includes(term);
  });

  const totalOutstanding = (accounts.data ?? []).reduce((sum, row) => sum + row.balance, 0);

  const openSettle = (account: UdhaarAccount) => {
    setSettleTarget(account);
    setMethod('cash');
    setAmount(account.balance);
    setReference('');
    setFormError(null);
  };

  const submitSettle = async () => {
    if (!settleTarget) return;

    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(
        await getApi().payments.settleUdhaar({
          customerId: settleTarget.customerId,
          method,
          amount,
          reference,
          orderId: null,
        }),
      );
      toast.success('Udhaar settled');
      setSettleTarget(null);
      await accounts.reload();
      if (selected?.customerId === settleTarget.customerId) await ledger.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const accountColumns: Column<UdhaarAccount>[] = [
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-caption text-text-secondary">{row.phone}</p>
        </div>
      ),
    },
    {
      key: 'balance',
      header: 'Outstanding',
      align: 'right',
      render: (row) => (
        <span className="font-medium tabular text-status-cancelled">
          {currency} {formatAmount(row.balance)}
        </span>
      ),
    },
    {
      key: 'last',
      header: 'Last activity',
      render: (row) => (row.lastActivity ? formatDateTime(row.lastActivity) : '—'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="secondary" onClick={() => setSelected(row)}>
            <BookOpen aria-hidden className="h-4 w-4" />
            Ledger
          </Button>
          {canSettle && (
            <Button onClick={() => openSettle(row)}>
              <HandCoins aria-hidden className="h-4 w-4" />
              Settle
            </Button>
          )}
        </div>
      ),
    },
  ];

  const ledgerColumns: Column<CustomerLedgerEntry>[] = [
    {
      key: 'date',
      header: 'When',
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) =>
        row.entryType === 'charge' ? (
          <Badge tone="danger">Udhaar taken</Badge>
        ) : (
          <Badge tone="success">Paid</Badge>
        ),
    },
    { key: 'note', header: 'Note', render: (row) => row.note || '—' },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => `${row.entryType === 'charge' ? '+' : '−'} ${formatAmount(row.amount)}`,
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      render: (row) => (
        <span className="font-medium tabular">{formatAmount(row.balanceAfter)}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Udhaar"
        subtitle="Customers who owe money, and every charge and payment against them."
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-caption text-text-secondary">Customers with udhaar</p>
          <p className="text-section-title tabular">{(accounts.data ?? []).length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-caption text-text-secondary">Total outstanding</p>
          <p className="text-section-title tabular text-status-cancelled">
            {currency} {formatAmount(totalOutstanding)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-caption text-text-secondary">Largest single balance</p>
          <p className="text-section-title tabular">
            {formatAmount(Math.max(...(accounts.data ?? []).map((row) => row.balance), 0))}
          </p>
        </Card>
      </div>

      <div className="mb-3 max-w-sm">
        <Input
          label="Search"
          placeholder="Name or phone number"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <Table
        columns={accountColumns}
        rows={visible}
        rowKey={(row) => row.customerId}
        isLoading={accounts.isLoading}
        emptyMessage="Nobody owes money"
        emptyHint="A credit payment on an order appears here automatically."
      />

      {selected && (
        <Card className="mt-6">
          <CardHeading
            title={`${selected.name} — ledger`}
            subtitle={`${selected.phone} · outstanding ${currency} ${formatAmount(selected.balance)}`}
            action={
              <Button variant="secondary" onClick={() => setSelected(null)}>
                Close
              </Button>
            }
          />

          <Table
            columns={ledgerColumns}
            rows={ledger.data ?? []}
            rowKey={(row) => row.id}
            isLoading={ledger.isLoading}
            emptyMessage="No entries"
            emptyHint="Charges and payments appear here."
          />

          <p className="mt-2 flex items-center gap-1 text-caption text-text-secondary">
            <Wallet aria-hidden className="h-3.5 w-3.5" />
            Balance is charges minus payments. Settling here never changes an old order total.
          </p>
        </Card>
      )}

      <Modal
        isOpen={settleTarget !== null}
        title="Settle udhaar"
        description={`${settleTarget?.name ?? ''} owes ${currency} ${formatAmount(settleTarget?.balance ?? 0)}`}
        onClose={() => setSettleTarget(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSettleTarget(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitSettle()} isLoading={isSaving}>
              Record payment
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && <Alert tone="error">{formError}</Alert>}

          <Select
            label="How did they pay?"
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            options={SETTLE_METHODS.map((value) => ({
              value,
              label: PAYMENT_METHOD_LABELS[value],
            }))}
          />

          <MoneyInput
            label="Amount"
            value={amount}
            onChange={setAmount}
            hint="Cannot be more than the outstanding balance"
          />

          <Input
            label="Reference (optional)"
            placeholder="Receipt number, note…"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />

          <p className="flex items-center gap-1 text-caption text-text-secondary">
            <Phone aria-hidden className="h-3.5 w-3.5" />
            This records a customer payment only; it does not alter the original order.
          </p>
        </div>
      </Modal>
    </div>
  );
}
