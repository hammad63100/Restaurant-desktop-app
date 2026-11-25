import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import {
  AlertTriangle,
  Bike,
  Car,
  Fuel,
  History,
  Pencil,
  Plus,
  Trash2,
  Wrench,
} from 'lucide-react';
import { z } from 'zod';
import type { Vehicle, VehicleAssignment, VehicleExpense } from '../../types/api';
import { vehicleExpenseSchema, vehicleSchema } from '../../types/schemas';
import { VEHICLE_EXPENSE_LABELS, VEHICLE_TYPE_LABELS } from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import {
  currentMonth,
  formatAmount,
  formatDate,
  monthStartIso,
  todayIso,
} from '../../utils/format';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { Input } from '../../components/Input';
import { MoneyInput } from '../../components/MoneyInput';
import { Select } from '../../components/Select';
import { Modal } from '../../components/Modal';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { Alert } from '../../components/Alert';

type VehicleFormValues = z.input<typeof vehicleSchema>;
type ExpenseFormValues = z.input<typeof vehicleExpenseSchema>;

/** Days until a document expires, for the coloured reminder badge. */
function expiryState(
  dateText: string | null,
): { label: string; tone: 'success' | 'pending' | 'danger' } | null {
  if (!dateText) return null;
  const target = new Date(`${dateText}T00:00:00`).getTime();
  const today = new Date(`${todayIso()}T00:00:00`).getTime();
  const days = Math.round((target - today) / 86_400_000);

  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, tone: 'danger' };
  if (days <= 30) return { label: `${days}d left`, tone: 'pending' };
  return { label: formatDate(dateText), tone: 'success' };
}

export function VehiclesPage() {
  const { allow } = useAuth();
  const canWrite = allow('vehicles:write');

  const [vehicleModal, setVehicleModal] = useState<Vehicle | 'new' | null>(null);
  const [assignTarget, setAssignTarget] = useState<Vehicle | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Vehicle | null>(null);
  const [expenseTarget, setExpenseTarget] = useState<Vehicle | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Vehicle | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [range, setRange] = useState({ fromDate: monthStartIso(), toDate: todayIso() });

  const vehicles = useAsync(async () => unwrap(await getApi().vehicles.list()), []);
  const riders = useAsync(async () => unwrap(await getApi().staff.listDeliveryBoys()), []);

  const expenseSummary = useAsync(
    async () => unwrap(await getApi().reports.vehicleExpenses(range)),
    [range.fromDate, range.toDate],
  );

  const vehicleForm = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleSchema) as unknown as Resolver<VehicleFormValues>,
    defaultValues: {
      type: 'bike',
      plateNo: '',
      model: '',
      color: '',
      registrationExpiry: null,
      insuranceExpiry: null,
      active: true,
    },
  });

  const expenseForm = useForm<ExpenseFormValues>({
    resolver: zodResolver(vehicleExpenseSchema) as unknown as Resolver<ExpenseFormValues>,
    defaultValues: { vehicleId: 0, type: 'fuel', amount: 0, date: todayIso(), note: '' },
  });

  const summaryByVehicle = useMemo(() => {
    const map = new Map<
      number,
      { fuel: number; maintenance: number; other: number; total: number; entries: number }
    >();
    for (const row of expenseSummary.data ?? []) {
      map.set(row.vehicleId, {
        fuel: row.fuel,
        maintenance: row.maintenance,
        other: row.other,
        total: row.total,
        entries: row.entries,
      });
    }
    return map;
  }, [expenseSummary.data]);

  const openNew = () => {
    vehicleForm.reset({
      type: 'bike',
      plateNo: '',
      model: '',
      color: '',
      registrationExpiry: null,
      insuranceExpiry: null,
      active: true,
    });
    setFormError(null);
    setVehicleModal('new');
  };

  const openEdit = (vehicle: Vehicle) => {
    vehicleForm.reset({
      id: vehicle.id,
      type: vehicle.type,
      plateNo: vehicle.plateNo,
      model: vehicle.model,
      color: vehicle.color,
      registrationExpiry: vehicle.registrationExpiry,
      insuranceExpiry: vehicle.insuranceExpiry,
      active: vehicle.active,
    });
    setFormError(null);
    setVehicleModal(vehicle);
  };

  const submitVehicle = vehicleForm.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().vehicles.save(vehicleSchema.parse(values)));
      toast.success(vehicleModal === 'new' ? 'Vehicle added' : 'Vehicle updated');
      setVehicleModal(null);
      await vehicles.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  const submitExpense = expenseForm.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().vehicles.addExpense(vehicleExpenseSchema.parse(values)));
      toast.success('Expense recorded');
      setExpenseTarget(null);
      await expenseSummary.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  const assignVehicle = async (deliveryBoyId: number | null) => {
    if (!assignTarget) return;
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().vehicles.assign(assignTarget.id, deliveryBoyId, todayIso()));
      toast.success(deliveryBoyId ? 'Vehicle assigned' : 'Vehicle released');
      setAssignTarget(null);
      await vehicles.reload();
      await riders.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const removeVehicle = async () => {
    if (!removeTarget) return;
    try {
      unwrap(await getApi().vehicles.remove(removeTarget.id));
      toast.success('Vehicle removed from the active list');
      await vehicles.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const columns: Column<Vehicle>[] = [
    {
      key: 'plate',
      header: 'Vehicle',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-control ${
              row.type === 'bike'
                ? 'bg-accent/10 text-accent'
                : 'bg-status-preparing/10 text-status-preparing'
            }`}
          >
            {row.type === 'bike' ? (
              <Bike aria-hidden className="h-4 w-4" />
            ) : (
              <Car aria-hidden className="h-4 w-4" />
            )}
          </span>
          <div>
            <p className="font-medium">{row.plateNo}</p>
            <p className="text-caption text-text-secondary">
              {VEHICLE_TYPE_LABELS[row.type]}
              {row.model ? ` · ${row.model}` : ''}
              {row.color ? ` · ${row.color}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'rider',
      header: 'Assigned to',
      render: (row) =>
        row.assignedToName ? (
          <Badge tone="info">{row.assignedToName}</Badge>
        ) : (
          <span className="text-caption text-text-secondary">Free</span>
        ),
    },
    {
      key: 'registration',
      header: 'Registration',
      render: (row) => {
        const state = expiryState(row.registrationExpiry);
        return state ? (
          <Badge tone={state.tone}>{state.label}</Badge>
        ) : (
          <span className="text-caption">—</span>
        );
      },
    },
    {
      key: 'insurance',
      header: 'Insurance',
      render: (row) => {
        const state = expiryState(row.insuranceExpiry);
        return state ? (
          <Badge tone={state.tone}>{state.label}</Badge>
        ) : (
          <span className="text-caption">—</span>
        );
      },
    },
    {
      key: 'spend',
      header: 'Spend (period)',
      align: 'right',
      render: (row) => {
        const summary = summaryByVehicle.get(row.id);
        return (
          <div>
            <p className="font-medium tabular">{formatAmount(summary?.total ?? 0)}</p>
            <p className="text-caption text-text-secondary">{summary?.entries ?? 0} entries</p>
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="secondary" onClick={() => setAssignTarget(row)} disabled={!canWrite}>
            {row.assignedToName ? 'Reassign' : 'Assign'}
          </Button>
          <Button variant="ghost" onClick={() => setHistoryTarget(row)} title="Assignment history">
            <History aria-hidden className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              expenseForm.reset({
                vehicleId: row.id,
                type: 'fuel',
                amount: 0,
                date: todayIso(),
                note: '',
              });
              setFormError(null);
              setExpenseTarget(row);
            }}
            title="Add expense"
          >
            <Fuel aria-hidden className="h-4 w-4" />
          </Button>
          {canWrite && (
            <>
              <Button variant="ghost" onClick={() => openEdit(row)} title="Edit vehicle">
                <Pencil aria-hidden className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={() => setRemoveTarget(row)} title="Remove vehicle">
                <Trash2 aria-hidden className="h-4 w-4 text-status-cancelled" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const expiring = (vehicles.data ?? []).filter((vehicle) => {
    const reg = expiryState(vehicle.registrationExpiry);
    const ins = expiryState(vehicle.insuranceExpiry);
    return [reg, ins].some((state) => state && state.tone !== 'success');
  });

  return (
    <div>
      <PageHeader
        title="Vehicles"
        subtitle="Bikes and cars, who has them, and what they cost."
        actions={
          canWrite ? (
            <Button onClick={openNew}>
              <Plus aria-hidden className="h-4 w-4" />
              New vehicle
            </Button>
          ) : undefined
        }
      />

      {expiring.length > 0 && (
        <Card className="mb-4 border-secondary/40 bg-secondary/5">
          <div className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 text-secondary" />
            <div>
              <p className="text-body font-medium">Document reminders</p>
              <ul className="mt-1 text-caption text-text-secondary">
                {expiring.map((vehicle) => (
                  <li key={vehicle.id}>
                    {vehicle.plateNo}: registration{' '}
                    {expiryState(vehicle.registrationExpiry)?.label ?? '—'}, insurance{' '}
                    {expiryState(vehicle.insuranceExpiry)?.label ?? '—'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-caption text-text-secondary">
          Expenses from
          <input
            type="date"
            value={range.fromDate}
            onChange={(event) => setRange({ ...range, fromDate: event.target.value })}
            className="h-control rounded-control border border-border bg-surface px-3 text-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-caption text-text-secondary">
          to
          <input
            type="date"
            value={range.toDate}
            onChange={(event) => setRange({ ...range, toDate: event.target.value })}
            className="h-control rounded-control border border-border bg-surface px-3 text-body"
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => setRange({ fromDate: `${currentMonth()}-01`, toDate: todayIso() })}
        >
          This month
        </Button>
      </div>

      <Table
        columns={columns}
        rows={vehicles.data ?? []}
        rowKey={(row) => row.id}
        isLoading={vehicles.isLoading}
        emptyMessage="No vehicles yet"
        emptyHint="Add the bikes and cars the shop owns."
      />

      {/* ----------------------------- Vehicle form ---------------------------- */}
      <Modal
        isOpen={vehicleModal !== null}
        title={vehicleModal === 'new' ? 'New vehicle' : 'Edit vehicle'}
        onClose={() => setVehicleModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVehicleModal(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitVehicle()} isLoading={isSaving}>
              Save vehicle
            </Button>
          </>
        }
      >
        <form onSubmit={submitVehicle} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          {formError && (
            <div className="sm:col-span-2">
              <Alert tone="error">{formError}</Alert>
            </div>
          )}

          <Select
            label="Type"
            options={[
              { value: 'bike', label: 'Bike' },
              { value: 'car', label: 'Car' },
              { value: 'other', label: 'Other' },
            ]}
            error={vehicleForm.formState.errors.type?.message}
            {...vehicleForm.register('type')}
          />
          <Input
            label="Number plate"
            placeholder="ICT-1234"
            error={vehicleForm.formState.errors.plateNo?.message}
            {...vehicleForm.register('plateNo')}
          />
          <Input
            label="Model"
            placeholder="Honda CG 125"
            error={vehicleForm.formState.errors.model?.message}
            {...vehicleForm.register('model')}
          />
          <Input
            label="Colour"
            error={vehicleForm.formState.errors.color?.message}
            {...vehicleForm.register('color')}
          />
          <Input
            label="Registration expiry"
            type="date"
            error={vehicleForm.formState.errors.registrationExpiry?.message}
            {...vehicleForm.register('registrationExpiry', {
              setValueAs: (value: string) => (value === '' ? null : value),
            })}
          />
          <Input
            label="Insurance expiry"
            type="date"
            error={vehicleForm.formState.errors.insuranceExpiry?.message}
            {...vehicleForm.register('insuranceExpiry', {
              setValueAs: (value: string) => (value === '' ? null : value),
            })}
          />
          <label className="flex items-center gap-2 text-body sm:col-span-2">
            <input type="checkbox" className="h-4 w-4" {...vehicleForm.register('active')} />
            In use
          </label>
        </form>
      </Modal>

      {/* ----------------------------- Assign modal ---------------------------- */}
      <Modal
        isOpen={assignTarget !== null}
        title={`Assign ${assignTarget?.plateNo ?? ''}`}
        description="Picking a rider closes the previous assignment and moves the vehicle."
        onClose={() => setAssignTarget(null)}
        size="sm"
      >
        {formError && (
          <div className="mb-3">
            <Alert tone="error">{formError}</Alert>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {(riders.data ?? []).map((rider) => {
            const isCurrent = assignTarget?.assignedToId === rider.id;
            return (
              <button
                key={rider.id}
                type="button"
                disabled={isSaving}
                onClick={() => void assignVehicle(rider.id)}
                className={`flex items-center justify-between rounded-control border p-3 text-left ${
                  isCurrent ? 'border-primary bg-primary/5' : 'border-border hover:bg-background'
                }`}
              >
                <div>
                  <p className="text-body font-medium">{rider.name}</p>
                  <p className="text-caption text-text-secondary">
                    {rider.vehiclePlate ? `Currently ${rider.vehiclePlate}` : 'No vehicle'}
                  </p>
                </div>
                {isCurrent && <Badge tone="success">Assigned</Badge>}
              </button>
            );
          })}

          <Button
            variant="secondary"
            onClick={() => void assignVehicle(null)}
            isLoading={isSaving && !assignTarget?.assignedToId}
          >
            Release vehicle (no rider)
          </Button>
        </div>
      </Modal>

      {/* ---------------------------- History modal ---------------------------- */}
      {historyTarget && (
        <AssignmentHistoryModal vehicle={historyTarget} onClose={() => setHistoryTarget(null)} />
      )}

      {/* ---------------------------- Expense modal --------------------------- */}
      <Modal
        isOpen={expenseTarget !== null}
        title={`Expense for ${expenseTarget?.plateNo ?? ''}`}
        onClose={() => setExpenseTarget(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExpenseTarget(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitExpense()} isLoading={isSaving}>
              <Wrench aria-hidden className="h-4 w-4" />
              Save expense
            </Button>
          </>
        }
      >
        <form onSubmit={submitExpense} className="flex flex-col gap-4" noValidate>
          {formError && <Alert tone="error">{formError}</Alert>}

          <Select
            label="Type"
            options={(
              Object.keys(VEHICLE_EXPENSE_LABELS) as Array<keyof typeof VEHICLE_EXPENSE_LABELS>
            ).map((key) => ({ value: key, label: VEHICLE_EXPENSE_LABELS[key] }))}
            error={expenseForm.formState.errors.type?.message}
            {...expenseForm.register('type')}
          />
          <MoneyInput
            label="Amount"
            value={expenseForm.watch('amount') ?? 0}
            onChange={(paisa) => expenseForm.setValue('amount', paisa, { shouldValidate: true })}
            error={expenseForm.formState.errors.amount?.message}
          />
          <Input
            label="Date"
            type="date"
            max={todayIso()}
            error={expenseForm.formState.errors.date?.message}
            {...expenseForm.register('date')}
          />
          <Input
            label="Note"
            placeholder="Petrol, oil change, tyres…"
            error={expenseForm.formState.errors.note?.message}
            {...expenseForm.register('note')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={removeTarget !== null}
        title="Remove this vehicle?"
        message={`${removeTarget?.plateNo ?? ''} will be hidden from new assignments. Old assignments and expenses are kept.`}
        confirmLabel="Remove vehicle"
        onConfirm={removeVehicle}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}

/* --------------------------- Assignment history --------------------------- */

function AssignmentHistoryModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const assignments = useAsync(
    async () => unwrap(await getApi().vehicles.assignments(vehicle.id)),
    [vehicle.id],
  );
  const expenses = useAsync(
    async () =>
      unwrap(await getApi().vehicles.expenses(vehicle.id, `${currentMonth()}-01`, todayIso())),
    [vehicle.id],
  );

  const assignmentColumns: Column<VehicleAssignment>[] = [
    { key: 'rider', header: 'Delivery boy', render: (row) => row.deliveryBoyName },
    { key: 'from', header: 'From', render: (row) => formatDate(row.fromDate) },
    {
      key: 'to',
      header: 'Until',
      render: (row) =>
        row.toDate ? formatDate(row.toDate) : <Badge tone="success">Current</Badge>,
    },
  ];

  const expenseColumns: Column<VehicleExpense>[] = [
    { key: 'date', header: 'Date', render: (row) => formatDate(row.date) },
    { key: 'type', header: 'Type', render: (row) => VEHICLE_EXPENSE_LABELS[row.type] },
    { key: 'note', header: 'Note', render: (row) => row.note || '—' },
    { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatAmount(row.amount) },
  ];

  return (
    <Modal
      isOpen
      title={`${vehicle.plateNo} history`}
      description="Who had this vehicle, and what it cost this month."
      onClose={onClose}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <CardHeading title="Assignment history" />
      <Table
        columns={assignmentColumns}
        rows={assignments.data ?? []}
        rowKey={(row) => row.id}
        isLoading={assignments.isLoading}
        emptyMessage="Never assigned"
        emptyHint="Assign this vehicle to a delivery boy from the list."
      />

      <div className="mt-4">
        <CardHeading title="This month's expenses" />
        <Table
          columns={expenseColumns}
          rows={expenses.data ?? []}
          rowKey={(row) => row.id}
          isLoading={expenses.isLoading}
          emptyMessage="No expenses this month"
          emptyHint="Record fuel or maintenance from the vehicle list."
        />
      </div>
    </Modal>
  );
}
