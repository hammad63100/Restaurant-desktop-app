import { useMemo, useState } from 'react';
import { Ban, Plus, ReceiptText, Search, Tag } from 'lucide-react';
import type { Expense, ExpenseCategory } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import {
  currentMonth,
  formatAmount,
  formatDate,
  monthEndIso,
  monthStartIso,
  todayIso,
} from '../../utils/format';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';
import { ExpenseModal } from './ExpenseModal';
import { RecurringBillsPanel } from './RecurringBillsPanel';

/**
 * Expenses page (Roadmap 4.E).
 *
 * The client: "shop k kharchy bhi add kron" — rent, bills, salaries, repairs. Two
 * tabs: the money that left the shop, and the categories it is filed under. The
 * month total at the top is the number that will appear in the P&L, so it is
 * computed by the main process, not added up in the browser.
 *
 * The "Shop expenses vs purchases" line under the header is deliberate: an owner
 * who files chicken under "Other" would double-count it against the P&L, and this
 * is the cheapest place to say so.
 */
export function ExpensesPage() {
  const { allow } = useAuth();
  const canWrite = allow('expenses:write');
  const canVoid = allow('expenses:void');

  const [tab, setTab] = useState<'list' | 'categories' | 'recurring'>('list');
  const [month, setMonth] = useState(currentMonth());
  const [showVoided, setShowVoided] = useState(false);
  const [search, setSearch] = useState('');
  const [entryOpen, setEntryOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [categoryModal, setCategoryModal] = useState<ExpenseCategory | 'new' | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [deleteCategory, setDeleteCategory] = useState<ExpenseCategory | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const overview = useAsync(
    async () =>
      unwrap(
        await getApi().expenses.overview({
          from: monthStartIso(month),
          to: monthEndIso(month),
          status: showVoided ? 'all' : 'active',
        }),
      ),
    [month, showVoided],
  );

  const expenses = overview.data?.expenses ?? [];
  const categories = overview.data?.categories ?? [];
  const drawerOpen = overview.data?.drawerOpen ?? false;

  const visibleExpenses = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return expenses;

    return expenses.filter(
      (expense) =>
        expense.categoryName.toLowerCase().includes(term) ||
        expense.payee.toLowerCase().includes(term) ||
        expense.notes.toLowerCase().includes(term) ||
        expense.expenseNo.toLowerCase().includes(term),
    );
  }, [expenses, search]);

  const monthTotal = useMemo(
    () => visibleExpenses.filter((e) => e.status === 'active').reduce((sum, e) => sum + e.amount, 0),
    [visibleExpenses],
  );

  const openNewCategory = () => {
    setCategoryName('');
    setFormError(null);
    setCategoryModal('new');
  };

  const openEditCategory = (category: ExpenseCategory) => {
    setCategoryName(category.name);
    setFormError(null);
    setCategoryModal(category);
  };

  const saveCategory = async () => {
    setIsSaving(true);
    setFormError(null);

    try {
      unwrap(
        await getApi().expenses.saveCategory({
          id: categoryModal === 'new' ? undefined : (categoryModal as ExpenseCategory).id,
          name: categoryName,
          sortOrder:
            categoryModal === 'new'
              ? categories.length + 1
              : (categoryModal as ExpenseCategory).sortOrder,
        }),
      );

      toast.success(categoryModal === 'new' ? 'Category added' : 'Category renamed');
      setCategoryModal(null);
      await overview.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const removeCategory = async () => {
    if (!deleteCategory) return;

    try {
      unwrap(await getApi().expenses.deleteCategory({ id: deleteCategory.id }));
      toast.success(`${deleteCategory.name} removed`);
      setDeleteCategory(null);
      await overview.reload();
    } catch (error) {
      toast.error(errorMessage(error));
      setDeleteCategory(null);
    }
  };

  const voidExpense = async () => {
    if (!voidTarget) return;

    try {
      unwrap(await getApi().expenses.void({ id: voidTarget.id, reason: voidReason }));
      toast.success(`${voidTarget.expenseNo} voided`);
      setVoidTarget(null);
      setVoidReason('');
      await overview.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const columns: Column<Expense>[] = [
    {
      key: 'date',
      header: 'Date',
      render: (row) => <span className="whitespace-nowrap">{formatDate(row.spentOn)}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => (
        <div>
          <p className="font-medium">{row.categoryName}</p>
          {row.payee && <p className="text-caption text-text-secondary">{row.payee}</p>}
        </div>
      ),
    },
    {
      key: 'notes',
      header: 'Details',
      render: (row) => (
        <div>
          <p className="text-body">{row.notes || '—'}</p>
          {row.status === 'void' && (
            <p className="text-caption text-status-cancelled">Void: {row.voidReason}</p>
          )}
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Paid from',
      render: (row) => (
        <Badge tone={row.paidFrom === 'cash' ? 'accent' : 'neutral'}>
          {row.paidFrom === 'cash' ? 'Drawer' : row.paidFrom === 'bank' ? 'Bank' : 'Outside'}
        </Badge>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => (
        <span
          className={`font-medium ${row.status === 'void' ? 'text-text-secondary line-through' : ''}`}
        >
          {formatAmount(row.amount)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        canVoid && row.status === 'active' ? (
          <Button
            variant="ghost"
            onClick={() => {
              setVoidReason('');
              setVoidTarget(row);
            }}
            title="Void this expense"
          >
            <Ban aria-hidden className="h-4 w-4 text-status-cancelled" />
          </Button>
        ) : null,
    },
  ];

  const categoryColumns: Column<ExpenseCategory>[] = [
    {
      key: 'name',
      header: 'Category',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {row.isSystem && <Badge tone="neutral">Built in</Badge>}
        </div>
      ),
    },
    {
      key: 'count',
      header: 'Expenses',
      align: 'center',
      render: (row) => row.expenseCount,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (row) => formatAmount(row.totalAmount),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        canWrite ? (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" onClick={() => openEditCategory(row)} title="Rename">
              <Tag aria-hidden className="h-4 w-4" />
            </Button>
            {!row.isSystem && (
              <Button
                variant="ghost"
                onClick={() => setDeleteCategory(row)}
                title="Remove this category"
              >
                <Ban aria-hidden className="h-4 w-4 text-status-cancelled" />
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="The shop's running costs — rent, bills, salaries, repairs. Stock purchases live on the Stock page."
        actions={
          canWrite ? (
            <Button onClick={() => setEntryOpen(true)}>
              <Plus aria-hidden className="h-4 w-4" />
              Record expense
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-control border border-border bg-surface p-1">
          {(
            [
              { value: 'list', label: 'Expenses' },
              { value: 'categories', label: 'Categories' },
              { value: 'recurring', label: 'Monthly bills' },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTab(option.value)}
              className={`h-8 rounded px-3 text-button ${
                tab === option.value
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {tab !== 'recurring' && tab === 'list' && (
          <>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value || currentMonth())}
              aria-label="Month"
              className="h-control rounded-control border border-border bg-surface px-3 text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />

            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search payee, notes…"
                aria-label="Search expenses"
                className="h-control w-56 rounded-control border border-border bg-surface pl-9 pr-3 text-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>

            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={showVoided}
                onChange={(event) => setShowVoided(event.target.checked)}
              />
              Show voided
            </label>

            <div className="ml-auto rounded-control border border-border bg-surface px-3 py-1.5">
              <span className="text-caption text-text-secondary">This month </span>
              <span className="font-semibold">{formatAmount(monthTotal)}</span>
            </div>
          </>
        )}

        {tab === 'categories' && canWrite && (
          <Button variant="secondary" onClick={openNewCategory}>
            <Plus aria-hidden className="h-4 w-4" />
            Category
          </Button>
        )}
      </div>

      {tab === 'recurring' ? (
        <RecurringBillsPanel categories={categories} onChanged={overview.reload} />
      ) : tab === 'list' ? (
        <>
          {overview.data && overview.data.total > 0 && (
            <p className="mb-3 text-caption text-text-secondary">
              {overview.data.summary
                .slice(0, 4)
                .map((row) => `${row.categoryName} ${formatAmount(row.total)}`)
                .join(' · ')}
            </p>
          )}

          <Table
            columns={columns}
            rows={visibleExpenses}
            rowKey={(row) => row.id}
            isLoading={overview.isLoading}
            emptyMessage="No expenses this month"
            emptyHint="Record rent, electricity, salaries or any other cost of running the shop."
          />
        </>
      ) : (
        <Table
          columns={categoryColumns}
          rows={categories}
          rowKey={(row) => row.id}
          isLoading={overview.isLoading}
          emptyMessage="No categories"
          emptyHint="Add a category such as Rent, Gas or Repairs."
        />
      )}

      <p className="mt-4 flex items-start gap-1.5 text-caption text-text-secondary">
        <ReceiptText aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Buying stock is not an expense: it adds value to the shelf and is counted when the
        food is sold. File only the running costs of the shop here, so the profit figure
        stays honest.
      </p>

      {entryOpen && (
        <ExpenseModal
          isOpen
          categories={categories}
          drawerOpen={drawerOpen}
          onClose={() => setEntryOpen(false)}
          onSaved={() => overview.reload()}
        />
      )}

      {/* New / rename category */}
      <Modal
        isOpen={categoryModal !== null}
        title={categoryModal === 'new' ? 'New category' : 'Rename category'}
        onClose={() => setCategoryModal(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCategoryModal(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void saveCategory()} isLoading={isSaving}>
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <Input
            label="Category name"
            placeholder="Rent, Electricity, Salaries…"
            value={categoryName}
            onChange={(event) => setCategoryName(event.target.value)}
          />
        </div>
      </Modal>

      {/* Voiding needs a reason, so it gets a small form of its own rather than a
          plain confirm — the reason is part of the audit trail. */}
      <Modal
        isOpen={voidTarget !== null}
        title="Void this expense?"
        description={`${voidTarget?.expenseNo ?? ''} — ${formatAmount(
          voidTarget?.amount ?? 0,
        )}. The entry stays in the records, marked as void.`}
        onClose={() => setVoidTarget(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setVoidTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void voidExpense()}
              disabled={voidReason.trim().length < 3}
            >
              Void expense
            </Button>
          </>
        }
      >
        <Input
          label="Reason"
          placeholder="Typed the wrong amount"
          value={voidReason}
          onChange={(event) => setVoidReason(event.target.value)}
        />
      </Modal>

      <ConfirmDialog
        isOpen={deleteCategory !== null}
        title="Remove this category?"
        message={
          deleteCategory && deleteCategory.expenseCount > 0
            ? `${deleteCategory.expenseCount} expense(s) use it, so the app will refuse. Rename it instead, or void those expenses first.`
            : 'It will be hidden from the entry form; past expenses keep their name.'
        }
        confirmLabel="Remove category"
        tone="danger"
        onClose={() => setDeleteCategory(null)}
        onConfirm={() => void removeCategory()}
      />

      <p className="mt-2 text-caption text-text-secondary">
        Today is {formatDate(todayIso())}
        {drawerOpen ? ' · a drawer shift is open' : ' · no drawer open'}
      </p>
    </div>
  );
}
