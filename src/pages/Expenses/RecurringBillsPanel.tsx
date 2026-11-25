import { useState } from 'react';
import { Bell, CalendarClock, Check, Pencil, Plus, SkipForward, Trash2, Undo2 } from 'lucide-react';
import type { ExpenseCategory, RecurringBill, RecurringBillStatus } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { formatAmount, formatDate } from '../../utils/format';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Table, type Column } from '../../components/Table';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Alert } from '../../components/Alert';
import { Modal } from '../../components/Modal';
import { toast } from '../../components/Toast';

/**
 * Recurring bills (Roadmap 4.E2).
 *
 * The rent, the electricity, the internet: same bill, every month, and the owner is
 * the only one who knows whether this month's has been paid. The screen has one job —
 * say what is due and make recording it two clicks — and one rule: **nothing is
 * booked until he confirms the amount**. A reminder that silently posts Rs 50,000 of
 * rent in a month the landlord forgot to collect would corrupt the profit & loss, so
 * the template holds the expectation and the expense holds the fact.
 *
 * Electricity is why the amount is asked every time: the typical amount pre-fills the
 * form, and he edits it to what the bill actually says.
 */

const STATE_META: Record<
  RecurringBillStatus['state'],
  { label: string; tone: BadgeTone }
> = {
  paid: { label: 'Paid', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  due: { label: 'Due', tone: 'pending' },
  overdue: { label: 'Overdue', tone: 'danger' },
  upcoming: { label: 'Later', tone: 'neutral' },
};

function dueLabel(row: RecurringBillStatus): string {
  if (row.state === 'paid' || row.state === 'skipped') return formatDate(row.dueDate);
  if (row.daysUntilDue === 0) return 'Today';
  if (row.daysUntilDue === 1) return 'Tomorrow';
  if (row.daysUntilDue > 1) return `in ${row.daysUntilDue} days`;
  if (row.daysUntilDue === -1) return 'Yesterday';
  return `${Math.abs(row.daysUntilDue)} days ago`;
}

interface BillFormState {
  id?: number;
  categoryId: string;
  name: string;
  typicalAmount: string;
  dueDay: string;
  remindDays: string;
  payee: string;
  paidFrom: RecurringBill['paidFrom'];
  notes: string;
  active: boolean;
}

function emptyForm(categories: ExpenseCategory[]): BillFormState {
  return {
    categoryId: categories[0] ? String(categories[0].id) : '',
    name: '',
    typicalAmount: '',
    dueDay: '1',
    remindDays: '3',
    payee: '',
    paidFrom: 'bank',
    notes: '',
    active: true,
  };
}

function formFrom(bill: RecurringBill): BillFormState {
  return {
    id: bill.id,
    categoryId: String(bill.categoryId),
    name: bill.name,
    typicalAmount: bill.typicalAmount ? String(bill.typicalAmount / 100) : '',
    dueDay: String(bill.dueDay),
    remindDays: String(bill.remindDays),
    payee: bill.payee,
    paidFrom: bill.paidFrom,
    notes: bill.notes,
    active: bill.active,
  };
}

export function RecurringBillsPanel({
  categories,
  onChanged,
}: {
  categories: ExpenseCategory[];
  /** Called after anything that books money, so the expense list can refresh. */
  onChanged: () => void;
}) {
  const { allow } = useAuth();
  const canWrite = allow('expenses:write');
  const canVoid = allow('expenses:void');

  const [month, setMonth] = useState('');
  const [form, setForm] = useState<BillFormState | null>(null);
  const [settleTarget, setSettleTarget] = useState<RecurringBillStatus | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleNote, setSettleNote] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<RecurringBill | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const bills = useAsync(
    async () => unwrap(await getApi().expenses.recurringBills(month || undefined)),
    [month],
  );

  const rows = bills.data?.rows ?? [];
  const outstanding = rows.filter((row) => row.state === 'due' || row.state === 'overdue');

  const saveBill = async () => {
    if (!form) return;
    setSaving(true);
    setFormError('');

    try {
      unwrap(
        await getApi().expenses.saveRecurringBill({
          id: form.id,
          categoryId: Number(form.categoryId),
          name: form.name,
          typicalAmount: Math.round(Number(form.typicalAmount || 0) * 100),
          dueDay: Number(form.dueDay),
          remindDays: Number(form.remindDays),
          payee: form.payee,
          paidFrom: form.paidFrom,
          notes: form.notes,
          active: form.active,
        }),
      );
      toast.success(form.id ? 'Bill updated.' : 'Bill added to the monthly reminders.');
      setForm(null);
      bills.reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const openSettle = (row: RecurringBillStatus) => {
    setSettleTarget(row);
    setSettleAmount(
      row.bill.typicalAmount ? String(row.bill.typicalAmount / 100) : '',
    );
    setSettleNote('');
    setFormError('');
  };

  const settle = async (as: 'paid' | 'skipped') => {
    if (!settleTarget) return;
    setSaving(true);
    setFormError('');

    try {
      unwrap(
        await getApi().expenses.settleRecurringBill({
          templateId: settleTarget.bill.id,
          period: settleTarget.period,
          status: as,
          amount: as === 'paid' ? Math.round(Number(settleAmount || 0) * 100) : 0,
          note: settleNote,
        }),
      );
      toast.success(
        as === 'paid'
          ? `${settleTarget.bill.name} recorded as an expense.`
          : `${settleTarget.bill.name} marked as skipped this month.`,
      );
      setSettleTarget(null);
      bills.reload();
      if (as === 'paid') onChanged();
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const unsettle = async (row: RecurringBillStatus) => {
    try {
      unwrap(
        await getApi().expenses.unsettleRecurringBill({
          templateId: row.bill.id,
          period: row.period,
        }),
      );
      toast.success('Settlement undone and the expense voided.');
      bills.reload();
      onChanged();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  const removeBill = async () => {
    if (!deleteTarget) return;
    setSaving(true);

    try {
      unwrap(await getApi().expenses.deleteRecurringBill({ id: deleteTarget.id }));
      toast.success('Reminder removed. Past payments stay in the expense list.');
      setDeleteTarget(null);
      bills.reload();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<RecurringBillStatus>[] = [
    {
      key: 'name',
      header: 'Bill',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {row.bill.name}
            {!row.bill.active && (
              <span className="ml-2 text-caption text-text-secondary">(paused)</span>
            )}
          </span>
          <span className="text-caption text-text-secondary">
            {row.bill.categoryName}
            {row.bill.payee ? ` · ${row.bill.payee}` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Typical',
      align: 'right',
      render: (row) => (
        <span className="tabular">
          {row.bill.typicalAmount ? `Rs ${formatAmount(row.bill.typicalAmount)}` : '—'}
        </span>
      ),
    },
    {
      key: 'due',
      header: 'Due',
      render: (row) => (
        <div className="flex flex-col">
          <span className="whitespace-nowrap">{formatDate(row.dueDate)}</span>
          <span className="text-caption text-text-secondary">{dueLabel(row)}</span>
        </div>
      ),
    },
    {
      key: 'state',
      header: 'Status',
      render: (row) => (
        <Badge tone={STATE_META[row.state].tone}>{STATE_META[row.state].label}</Badge>
      ),
    },
    {
      key: 'paid',
      header: 'Recorded',
      align: 'right',
      render: (row) =>
        row.payment?.status === 'paid' ? (
          <span className="tabular">Rs {formatAmount(row.payment.amount)}</span>
        ) : (
          <span className="text-text-secondary">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.payment && (
            <>
              {row.payment.expenseId && (
                <Button
                  variant="ghost"
                  size="md" className="px-2"
                  onClick={() => void unsettle(row)}
                  disabled={!canVoid}
                  title="Undo and void the expense"
                >
                  <Undo2 aria-hidden className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
          {!row.payment && canWrite && row.bill.active && (
            <Button variant="secondary" size="md" className="px-2" onClick={() => openSettle(row)}>
              {row.state === 'due' || row.state === 'overdue' ? 'Pay' : 'Record'}
            </Button>
          )}
          {canWrite && (
            <>
              <Button variant="ghost" size="md" className="px-2" onClick={() => setForm(formFrom(row.bill))}>
                <Pencil aria-hidden className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="md" className="px-2" onClick={() => setDeleteTarget(row.bill)}>
                <Trash2 aria-hidden className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="w-44">
          <Input
            label="Month"
            type="month"
            value={month || (bills.data?.period ?? '')}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>
        {canWrite && (
          <Button onClick={() => setForm(emptyForm(categories))}>
            <Plus aria-hidden className="h-4 w-4" />
            Add a bill
          </Button>
        )}
      </div>

      {bills.error && <Alert tone="error">{errorMessage(bills.error)}</Alert>}

      {outstanding.length > 0 && (
        <Card>
          <div className="flex items-start gap-3">
            <Bell aria-hidden className="mt-0.5 h-5 w-5 text-warning" />
            <div>
              <p className="font-medium">
                {outstanding.length} bill{outstanding.length === 1 ? '' : 's'} need
                {outstanding.length === 1 ? 's' : ''} attention
              </p>
              <p className="text-body text-text-secondary">
                {outstanding
                  .map((row) => `${row.bill.name} (${dueLabel(row)})`)
                  .join(', ')}
                {bills.data && bills.data.outstandingTypical > 0
                  ? ` — about Rs ${formatAmount(bills.data.outstandingTypical)} in total.`
                  : ''}
              </p>
            </div>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CalendarClock aria-hidden className="h-8 w-8 text-text-secondary" />
            <p className="font-medium">No monthly bills yet</p>
            <p className="max-w-md text-body text-text-secondary">
              Add the rent, the electricity bill and the internet here once, and the
              dashboard will tell you when each one is due. Nothing is added to your
              expenses until you confirm what you paid.
            </p>
          </div>
        </Card>
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => `${row.bill.id}-${row.period}`}
        />
      )}

      {/* ------------------------------ add / edit ----------------------------- */}
      {form && (
        <Modal
          isOpen
          title={form.id ? 'Edit bill' : 'Add a monthly bill'}
          description="The reminder is separate from the expense — nothing is booked until you confirm a payment."
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm(null)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={saveBill} disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add bill'}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            {formError && (
              <div className="col-span-2">
                <Alert tone="error">{formError}</Alert>
              </div>
            )}
            <div className="col-span-2">
              <Input
                label="What is it"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="e.g. Electricity bill"
              />
            </div>
            <Select
              label="Category"
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
              options={categories.map((category) => ({
                value: String(category.id),
                label: category.name,
              }))}
            />
            <Input
              label="Paid to"
              value={form.payee}
              onChange={(event) => setForm({ ...form, payee: event.target.value })}
              placeholder="e.g. IESCO"
            />
            <Input
              label="Typical amount (Rs)"
              type="number"
              value={form.typicalAmount}
              onChange={(event) => setForm({ ...form, typicalAmount: event.target.value })}
              hint="Used to pre-fill the payment — never booked on its own."
            />
            <Select
              label="Paid from"
              value={form.paidFrom}
              onChange={(event) =>
                setForm({ ...form, paidFrom: event.target.value as RecurringBill['paidFrom'] })
              }
              options={[
                { value: 'bank', label: 'Bank / online' },
                { value: 'cash', label: 'Drawer cash' },
                { value: 'other', label: 'Other' },
              ]}
              hint="Cash needs an open drawer. Bank is the safe default."
            />
            <Input
              label="Due day of the month"
              type="number"
              min={1}
              max={31}
              value={form.dueDay}
              onChange={(event) => setForm({ ...form, dueDay: event.target.value })}
              hint="Day 31 means the last day of a shorter month."
            />
            <Input
              label="Start reminding (days before)"
              type="number"
              min={0}
              max={30}
              value={form.remindDays}
              onChange={(event) => setForm({ ...form, remindDays: event.target.value })}
            />
            <label className="col-span-2 flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              Keep reminding me every month
            </label>
          </div>
        </Modal>
      )}

      {/* -------------------------------- settle ------------------------------- */}
      {settleTarget && (
        <Modal
          isOpen
          title={`${settleTarget.bill.name} — ${settleTarget.period}`}
          description="Confirm what you actually paid. This posts a real expense in that month."
          onClose={() => setSettleTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSettleTarget(null)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="ghost" onClick={() => void settle('skipped')} disabled={saving}>
                <SkipForward aria-hidden className="h-4 w-4" />
                Skipped this month
              </Button>
              <Button onClick={() => void settle('paid')} disabled={saving}>
                <Check aria-hidden className="h-4 w-4" />
                {saving ? 'Recording…' : 'Record payment'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {formError && <Alert tone="error">{formError}</Alert>}
            <p className="text-body text-text-secondary">
              Due {formatDate(settleTarget.dueDate)} · {settleTarget.bill.categoryName}
              {settleTarget.bill.payee ? ` · ${settleTarget.bill.payee}` : ''}
            </p>
            <Input
              label="Amount actually paid (Rs)"
              type="number"
              value={settleAmount}
              onChange={(event) => setSettleAmount(event.target.value)}
              hint="Change it to what the bill says — electricity is never the same twice."
            />
            <Input
              label="Note"
              value={settleNote}
              onChange={(event) => setSettleNote(event.target.value)}
              placeholder="e.g. extra units this month"
            />
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          isOpen
          title={`Remove ${deleteTarget.name}?`}
          description="The reminders stop, but every expense it already posted stays in your records."
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={saving}>
                Keep it
              </Button>
              <Button variant="danger" onClick={removeBill} disabled={saving}>
                {saving ? 'Removing…' : 'Remove'}
              </Button>
            </>
          }
        >
          <p className="text-body">
            If you only want to stop the reminders for a while, edit it and untick
            “active” instead — that keeps the history.
          </p>
        </Modal>
      )}
    </div>
  );
}
