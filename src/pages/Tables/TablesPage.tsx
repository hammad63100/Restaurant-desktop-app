import { useState } from 'react';
import {
  ArrowRightLeft,
  GitMerge,
  Plus,
  Scissors,
  Table2,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import type { DiningTable, OrderDetail } from '../../types/api';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../store/settingsStore';
import { formatAmount } from '../../utils/format';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { Input } from '../../components/Input';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';
import { cn } from '../../utils/cn';

/**
 * The floor plan (Phase 3): which tables are free, which have a bill, and the two
 * operations a busy shop actually needs — merge two bills and split one.
 *
 * Everything here asks the main process; this screen never decides whether a
 * merge is legal. The dangerous rules (no money may move) live in the service.
 */
export function TablesPage() {
  const currency = useSettings((settings) => settings.currency);
  const { can } = useAuth();
  const canEditPlan = can('tables');

  const tables = useAsync(async () => unwrap(await getApi().tables.list()), []);

  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Merge: pick the bill to absorb, then the bill to keep.
  const [mergeSource, setMergeSource] = useState<DiningTable | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null);

  // Split: choose lines off one bill.
  const [splitBill, setSplitBill] = useState<OrderDetail | null>(null);
  const [splitSelection, setSplitSelection] = useState<number[]>([]);
  const [splitMoveTable, setSplitMoveTable] = useState(false);

  // Floor plan editor.
  const [editing, setEditing] = useState<DiningTable | 'new' | null>(null);
  const [formName, setFormName] = useState('');
  const [formSeats, setFormSeats] = useState(4);
  const [formArea, setFormArea] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DiningTable | null>(null);

  const rows = tables.data ?? [];
  const occupied = rows.filter((table) => table.orderId !== null);
  const free = rows.filter((table) => table.orderId === null && table.active);

  const reload = async () => {
    await tables.reload();
  };

  const run = async (action: () => Promise<void>, fallback: string) => {
    setError(null);
    setIsBusy(true);
    try {
      await action();
    } catch (actionError) {
      setError(errorMessage(actionError, fallback));
    } finally {
      setIsBusy(false);
    }
  };

  /* ------------------------------ merge ------------------------------ */

  const merge = () =>
    run(async () => {
      if (!mergeSource || mergeTargetId === null) return;

      const result = unwrap(
        await getApi().tables.merge({ sourceId: mergeSource.id, targetId: mergeTargetId }),
      );

      setMergeSource(null);
      setMergeTargetId(null);
      toast.success(`Merged ${result.mergedOrderNos.join(', ')} into ${result.order.orderNo}`);
      await reload();
    }, 'The bills could not be merged');

  /* ------------------------------ split ------------------------------ */

  const openSplit = (table: DiningTable) =>
    run(async () => {
      if (table.orderId === null) return;
      const order = unwrap(await getApi().orders.get(table.orderId));
      setSplitBill(order);
      setSplitSelection([]);
      setSplitMoveTable(false);
    }, 'That bill could not be loaded');

  const toggleLine = (itemId: number) => {
    setSplitSelection((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    );
  };

  const splitSelectedTotal = (splitBill?.items ?? [])
    .filter((line) => splitSelection.includes(line.id))
    .reduce((total, line) => total + line.lineTotal, 0);

  const split = () =>
    run(async () => {
      if (!splitBill) return;

      const result = unwrap(
        await getApi().tables.split({
          orderId: splitBill.id,
          itemIds: splitSelection,
          moveTable: splitMoveTable,
        }),
      );

      setSplitBill(null);
      setSplitSelection([]);
      toast.success(`${result.target.orderNo} created from the split`);
      await reload();
    }, 'The bill could not be split');

  /* --------------------------- floor plan --------------------------- */

  const openEditor = (table: DiningTable | 'new') => {
    setEditing(table);
    setFormName(table === 'new' ? '' : table.name);
    setFormSeats(table === 'new' ? 4 : table.seats);
    setFormArea(table === 'new' ? '' : table.area);
  };

  const saveTable = () =>
    run(async () => {
      unwrap(
        await getApi().tables.save({
          id: editing && editing !== 'new' ? editing.id : undefined,
          name: formName,
          seats: formSeats,
          area: formArea,
          active: true,
        }),
      );

      setEditing(null);
      toast.success('Floor plan updated');
      await reload();
    }, 'The table could not be saved');

  const removeTable = () =>
    run(async () => {
      if (!deleteTarget) return;
      unwrap(await getApi().tables.remove(deleteTarget.id));
      setDeleteTarget(null);
      toast.success(`${deleteTarget.name} removed`);
      await reload();
    }, 'The table could not be removed');

  return (
    <div>
      <PageHeader
        title="Tables"
        subtitle="Who is sitting where, merging two bills, and splitting one."
        actions={
          canEditPlan ? (
            <Button variant="secondary" onClick={() => openEditor('new')}>
              <Plus aria-hidden className="h-4 w-4" />
              Add table
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <p className="text-caption text-text-secondary">Tables</p>
          <p className="text-section-title tabular">{rows.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-caption text-text-secondary">Occupied</p>
          <p className="text-section-title tabular text-primary">{occupied.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-caption text-text-secondary">Free</p>
          <p className="text-section-title tabular">{free.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-caption text-text-secondary">Open bills</p>
          <p className="text-section-title tabular">
            {formatAmount(occupied.reduce((total, table) => total + table.openTotal, 0))}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((table) => {
          const isOpen = table.orderId !== null;

          return (
            <div
              key={table.id}
              className={cn(
                'flex flex-col gap-2 rounded-card border p-3 transition-colors',
                isOpen ? 'border-primary bg-primary/5' : 'border-border bg-surface',
                !table.active && 'opacity-50',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-card-title">
                    <Table2 aria-hidden className="h-4 w-4 text-text-secondary" />
                    {table.name}
                  </p>
                  <p className="flex items-center gap-1 text-caption text-text-secondary">
                    <UsersIcon aria-hidden className="h-3 w-3" />
                    {table.seats} seats{table.area ? ` · ${table.area}` : ''}
                  </p>
                </div>

                {canEditPlan && !isOpen && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => openEditor(table)}
                      className="rounded-control p-1 text-caption text-text-secondary hover:bg-background"
                      aria-label={`Edit ${table.name}`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(table)}
                      className="rounded-control p-1 text-text-secondary hover:bg-background hover:text-status-cancelled"
                      aria-label={`Remove ${table.name}`}
                    >
                      <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {isOpen ? (
                <>
                  <p className="text-body font-medium">{table.orderNo}</p>
                  <p className="text-caption text-text-secondary">
                    {currency} {formatAmount(table.openTotal)}
                  </p>

                  <div className="mt-auto flex gap-1.5">
                    <Button
                      variant="ghost"
                      className="flex-1"
                      onClick={() => setMergeSource(table)}
                      disabled={isBusy}
                    >
                      <GitMerge aria-hidden className="h-3.5 w-3.5" />
                      Merge
                    </Button>
                    <Button
                      variant="ghost"
                      className="flex-1"
                      onClick={() => void openSplit(table)}
                      disabled={isBusy}
                    >
                      <Scissors aria-hidden className="h-3.5 w-3.5" />
                      Split
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-caption text-text-secondary">Free</p>
                  <p className="text-[11px] text-text-secondary">
                    Sold today: {formatAmount(table.lifetimeSales)}
                  </p>
                  <a
                    href="#/orders/new"
                    className="mt-auto inline-flex items-center justify-center gap-1 rounded-control border border-border px-3 py-1.5 text-button text-text-primary hover:bg-background"
                  >
                    <Plus aria-hidden className="h-3.5 w-3.5" />
                    New bill
                  </a>
                </>
              )}
            </div>
          );
        })}
      </div>

      {rows.length === 0 && (
        <Card>
          <CardHeading
            title="No tables yet"
            subtitle="Add your tables so the counter knows which ones are free."
          />
        </Card>
      )}

      {/* ------------------------------ merge dialog ------------------------------ */}
      <Modal
        isOpen={mergeSource !== null}
        title={mergeSource ? `Merge ${mergeSource.orderNo} into…` : 'Merge bills'}
        description="The bill you pick here stays; this one is closed and its lines move across. No payment may exist on either bill."
        onClose={() => {
          setMergeSource(null);
          setMergeTargetId(null);
        }}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setMergeSource(null);
                setMergeTargetId(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void merge()} disabled={mergeTargetId === null || isBusy}>
              <ArrowRightLeft aria-hidden className="h-4 w-4" />
              Merge
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {occupied
            .filter((table) => table.id !== mergeSource?.id)
            .map((table) => (
              <label
                key={table.id}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-control border p-2',
                  mergeTargetId === table.id ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    className="h-4 w-4"
                    name="merge-target"
                    checked={mergeTargetId === table.id}
                    onChange={() => setMergeTargetId(table.id)}
                  />
                  <span className="text-button">{table.name}</span>
                  <span className="text-caption text-text-secondary">{table.orderNo}</span>
                </span>
                <span className="tabular text-caption">{formatAmount(table.openTotal)}</span>
              </label>
            ))}

          {occupied.filter((table) => table.id !== mergeSource?.id).length === 0 && (
            <p className="text-caption text-text-secondary">
              There is no other open bill to merge into.
            </p>
          )}
        </div>
      </Modal>

      {/* ------------------------------ split dialog ------------------------------ */}
      <Modal
        isOpen={splitBill !== null}
        title={splitBill ? `Split ${splitBill.orderNo}` : 'Split a bill'}
        description="Tick the lines that belong on a separate bill. At least one line must stay behind."
        onClose={() => setSplitBill(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSplitBill(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void split()}
              disabled={splitSelection.length === 0 || isBusy}
              isLoading={isBusy}
            >
              <Scissors aria-hidden className="h-4 w-4" />
              Move {splitSelection.length} line(s)
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {(splitBill?.items ?? []).map((line) => (
            <label
              key={line.id}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 rounded-control border p-2',
                splitSelection.includes(line.id) ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={splitSelection.includes(line.id)}
                  onChange={() => toggleLine(line.id)}
                />
                <span>
                  <span className="text-button">
                    {line.qty} × {line.name}
                  </span>
                  {line.notes && (
                    <span className="block text-caption text-text-secondary">{line.notes}</span>
                  )}
                </span>
              </span>
              <span className="tabular text-caption">{formatAmount(line.lineTotal)}</span>
            </label>
          ))}

          <label className="mt-2 flex items-center gap-2 text-caption text-text-secondary">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={splitMoveTable}
              onChange={(event) => setSplitMoveTable(event.target.checked)}
              disabled={free.length === 0}
            />
            Seat the new bill at a free table ({free.length} free)
          </label>

          <p className="text-caption text-text-secondary">
            Moving {formatAmount(splitSelectedTotal)} of {formatAmount(splitBill?.total ?? 0)}. The
            new bill gets its own order and invoice number.
          </p>
        </div>
      </Modal>

      {/* ------------------------------ table editor ------------------------------ */}
      <Modal
        isOpen={editing !== null}
        title={editing === 'new' ? 'Add a table' : 'Edit table'}
        onClose={() => setEditing(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveTable()} disabled={!formName.trim() || isBusy}>
              Save table
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Name"
            value={formName}
            placeholder="T9"
            onChange={(event) => setFormName(event.target.value.toUpperCase())}
          />
          <Input
            label="Seats"
            type="number"
            min={1}
            max={40}
            value={formSeats}
            onChange={(event) => setFormSeats(Math.max(1, Number(event.target.value) || 1))}
          />
          <Input
            label="Area"
            value={formArea}
            placeholder="Family hall"
            onChange={(event) => setFormArea(event.target.value)}
          />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Remove this table?"
        message={
          deleteTarget
            ? `${deleteTarget.name} will disappear from the floor plan. Past sales stay in the reports.`
            : ''
        }
        confirmLabel="Remove table"
        onConfirm={removeTable}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
