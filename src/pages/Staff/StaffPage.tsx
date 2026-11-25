import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import {
  BadgeCheck,
  Banknote,
  CalendarDays,
  HandCoins,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react';
import { z } from 'zod';
import type {
  AttendanceStatus,
  DeliveryBoy,
  PersonType,
  SalarySlip,
  Vehicle,
  Waiter,
} from '../../types/api';
import { advanceSchema, deliveryBoySchema, waiterSchema } from '../../types/schemas';
import { ATTENDANCE_LABELS, PERSON_TYPE_LABELS, VEHICLE_TYPE_LABELS } from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { currentMonth, formatAmount, formatDate, formatMonth, todayIso } from '../../utils/format';
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

type WaiterFormValues = z.input<typeof waiterSchema>;
type BoyFormValues = z.input<typeof deliveryBoySchema>;
type AdvanceFormValues = z.input<typeof advanceSchema>;

type Tab = 'waiters' | 'delivery';

const ATTENDANCE_TONES: Record<AttendanceStatus, 'success' | 'danger' | 'pending' | 'info'> = {
  present: 'success',
  absent: 'danger',
  half_day: 'pending',
  leave: 'info',
};

interface DetailTarget {
  personType: PersonType;
  personId: number;
  name: string;
}

export function StaffPage() {
  const { allow } = useAuth();
  const canWrite = allow('staff:write');

  const [tab, setTab] = useState<Tab>('waiters');
  const [month, setMonth] = useState(currentMonth());
  const [waiterModal, setWaiterModal] = useState<Waiter | 'new' | null>(null);
  const [boyModal, setBoyModal] = useState<DeliveryBoy | 'new' | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DetailTarget | null>(null);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const waiters = useAsync(async () => unwrap(await getApi().staff.listWaiters()), []);
  const boys = useAsync(async () => unwrap(await getApi().staff.listDeliveryBoys()), []);
  const vehicles = useAsync(async () => unwrap(await getApi().vehicles.list()), []);

  const waiterForm = useForm<WaiterFormValues>({
    resolver: zodResolver(waiterSchema) as unknown as Resolver<WaiterFormValues>,
    defaultValues: {
      name: '',
      phone: '',
      cnic: '',
      address: '',
      joinDate: todayIso(),
      salary: 0,
      active: true,
    },
  });

  const boyForm = useForm<BoyFormValues>({
    resolver: zodResolver(deliveryBoySchema) as unknown as Resolver<BoyFormValues>,
    defaultValues: {
      name: '',
      phone: '',
      cnic: '',
      address: '',
      joinDate: todayIso(),
      salary: 0,
      active: true,
      commission: 0,
      vehicleId: null,
    },
  });

  const advanceForm = useForm<AdvanceFormValues>({
    resolver: zodResolver(advanceSchema) as unknown as Resolver<AdvanceFormValues>,
    defaultValues: {
      personType: 'waiter',
      personId: 0,
      amount: 0,
      date: todayIso(),
      note: '',
    },
  });

  const waiterSalary = waiterForm.watch('salary') ?? 0;
  const boySalary = boyForm.watch('salary') ?? 0;
  const boyCommission = boyForm.watch('commission') ?? 0;

  const openNewWaiter = () => {
    waiterForm.reset({
      name: '',
      phone: '',
      cnic: '',
      address: '',
      joinDate: todayIso(),
      salary: 0,
      active: true,
    });
    setFormError(null);
    setWaiterModal('new');
  };

  const openEditWaiter = (waiter: Waiter) => {
    waiterForm.reset({ ...waiter });
    setFormError(null);
    setWaiterModal(waiter);
  };

  const openNewBoy = () => {
    boyForm.reset({
      name: '',
      phone: '',
      cnic: '',
      address: '',
      joinDate: todayIso(),
      salary: 0,
      active: true,
      commission: 0,
      vehicleId: null,
    });
    setFormError(null);
    setBoyModal('new');
  };

  const openEditBoy = (boy: DeliveryBoy) => {
    boyForm.reset({ ...boy });
    setFormError(null);
    setBoyModal(boy);
  };

  const submitWaiter = waiterForm.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().staff.saveWaiter(waiterSchema.parse(values)));
      toast.success(waiterModal === 'new' ? 'Waiter added' : 'Waiter updated');
      setWaiterModal(null);
      await waiters.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  const submitBoy = boyForm.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().staff.saveDeliveryBoy(deliveryBoySchema.parse(values)));
      toast.success(boyModal === 'new' ? 'Delivery boy added' : 'Delivery boy updated');
      setBoyModal(null);
      await boys.reload();
      await vehicles.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  const removePerson = async () => {
    if (!removeTarget) return;
    try {
      if (removeTarget.personType === 'waiter') {
        unwrap(await getApi().staff.removeWaiter(removeTarget.personId));
      } else {
        unwrap(await getApi().staff.removeDeliveryBoy(removeTarget.personId));
      }
      toast.success(`${removeTarget.name} is no longer on the active list`);
      await waiters.reload();
      await boys.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const submitAdvance = advanceForm.handleSubmit(async (values) => {
    setIsSaving(true);
    setFormError(null);
    try {
      unwrap(await getApi().staff.addAdvance(advanceSchema.parse(values)));
      toast.success('Advance recorded');
      setAdvanceOpen(false);
      await detailRefresh.current?.();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  });

  // Set by the detail modal so saving an advance refreshes its data.
  const detailRefresh = useMemo(() => ({ current: null as null | (() => Promise<void>) }), []);

  const waiterColumns: Column<Waiter>[] = [
    {
      key: 'name',
      header: 'Waiter',
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-caption text-text-secondary">{row.phone || '—'}</p>
        </div>
      ),
    },
    { key: 'cnic', header: 'CNIC', render: (row) => row.cnic || '—' },
    { key: 'join', header: 'Joined', render: (row) => formatDate(row.joinDate) },
    {
      key: 'salary',
      header: 'Monthly salary',
      align: 'right',
      render: (row) => formatAmount(row.salary),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="secondary"
            onClick={() => {
              setDetail({ personType: 'waiter', personId: row.id, name: row.name });
            }}
          >
            <CalendarDays aria-hidden className="h-4 w-4" />
            Attendance and salary
          </Button>
          {canWrite && (
            <>
              <Button variant="ghost" onClick={() => openEditWaiter(row)} title="Edit waiter">
                <Pencil aria-hidden className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                title="Remove from active list"
                onClick={() =>
                  setRemoveTarget({ personType: 'waiter', personId: row.id, name: row.name })
                }
              >
                <Trash2 aria-hidden className="h-4 w-4 text-status-cancelled" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const boyColumns: Column<DeliveryBoy>[] = [
    {
      key: 'name',
      header: 'Delivery boy',
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-caption text-text-secondary">{row.phone || '—'}</p>
        </div>
      ),
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (row) =>
        row.vehiclePlate ? (
          <Badge tone="info">{row.vehiclePlate}</Badge>
        ) : (
          <span className="text-caption text-text-secondary">Not assigned</span>
        ),
    },
    {
      key: 'salary',
      header: 'Salary',
      align: 'right',
      render: (row) => formatAmount(row.salary),
    },
    {
      key: 'commission',
      header: 'Commission',
      align: 'right',
      render: (row) => `${row.commission}%`,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="secondary"
            onClick={() =>
              setDetail({ personType: 'delivery_boy', personId: row.id, name: row.name })
            }
          >
            <CalendarDays aria-hidden className="h-4 w-4" />
            Attendance and salary
          </Button>
          {canWrite && (
            <>
              <Button variant="ghost" onClick={() => openEditBoy(row)} title="Edit delivery boy">
                <Pencil aria-hidden className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                title="Remove from active list"
                onClick={() =>
                  setRemoveTarget({ personType: 'delivery_boy', personId: row.id, name: row.name })
                }
              >
                <Trash2 aria-hidden className="h-4 w-4 text-status-cancelled" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const vehicleOptions = (vehicles.data ?? [])
    .filter((vehicle: Vehicle) => vehicle.active)
    .map((vehicle) => ({
      value: String(vehicle.id),
      label: `${vehicle.plateNo} · ${VEHICLE_TYPE_LABELS[vehicle.type]}`,
    }));

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle="Waiters, delivery boys, attendance, advances and monthly salaries."
        actions={
          canWrite ? (
            tab === 'waiters' ? (
              <Button onClick={openNewWaiter}>
                <Plus aria-hidden className="h-4 w-4" />
                New waiter
              </Button>
            ) : (
              <Button onClick={openNewBoy}>
                <Plus aria-hidden className="h-4 w-4" />
                New delivery boy
              </Button>
            )
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-control border border-border bg-surface p-1">
          {(
            [
              { value: 'waiters', label: `Waiters (${waiters.data?.length ?? 0})` },
              { value: 'delivery', label: `Delivery boys (${boys.data?.length ?? 0})` },
            ] as Array<{ value: Tab; label: string }>
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

        <label className="flex items-center gap-2 text-caption text-text-secondary">
          Salary month
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value || currentMonth())}
            className="h-control rounded-control border border-border bg-surface px-3 text-body text-text-primary"
          />
        </label>
      </div>

      {tab === 'waiters' ? (
        <Table
          columns={waiterColumns}
          rows={waiters.data ?? []}
          rowKey={(row) => row.id}
          isLoading={waiters.isLoading}
          emptyMessage="No waiters yet"
          emptyHint="Add the staff who take dine-in orders."
        />
      ) : (
        <Table
          columns={boyColumns}
          rows={boys.data ?? []}
          rowKey={(row) => row.id}
          isLoading={boys.isLoading}
          emptyMessage="No delivery boys yet"
          emptyHint="Add riders and assign them a vehicle on the Vehicles page."
        />
      )}

      {/* ---------------------------- Waiter modal ---------------------------- */}
      <Modal
        isOpen={waiterModal !== null}
        title={waiterModal === 'new' ? 'New waiter' : 'Edit waiter'}
        onClose={() => setWaiterModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setWaiterModal(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitWaiter()} isLoading={isSaving}>
              Save waiter
            </Button>
          </>
        }
      >
        <form onSubmit={submitWaiter} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          {formError && (
            <div className="sm:col-span-2">
              <Alert tone="error">{formError}</Alert>
            </div>
          )}

          <Input
            label="Full name"
            error={waiterForm.formState.errors.name?.message}
            {...waiterForm.register('name')}
          />
          <Input
            label="Phone"
            error={waiterForm.formState.errors.phone?.message}
            {...waiterForm.register('phone')}
          />
          <Input
            label="CNIC"
            placeholder="61101-1234567-1"
            error={waiterForm.formState.errors.cnic?.message}
            {...waiterForm.register('cnic')}
          />
          <Input
            label="Join date"
            type="date"
            error={waiterForm.formState.errors.joinDate?.message}
            {...waiterForm.register('joinDate')}
          />
          <div className="sm:col-span-2">
            <Input
              label="Address"
              error={waiterForm.formState.errors.address?.message}
              {...waiterForm.register('address')}
            />
          </div>
          <MoneyInput
            label="Monthly salary"
            value={waiterSalary}
            onChange={(paisa) => waiterForm.setValue('salary', paisa, { shouldValidate: true })}
            error={waiterForm.formState.errors.salary?.message}
          />
          <label className="flex items-center gap-2 pt-6 text-body">
            <input type="checkbox" className="h-4 w-4" {...waiterForm.register('active')} />
            On the active list
          </label>
        </form>
      </Modal>

      {/* -------------------------- Delivery boy modal ------------------------- */}
      <Modal
        isOpen={boyModal !== null}
        title={boyModal === 'new' ? 'New delivery boy' : 'Edit delivery boy'}
        description="Assigning a vehicle here also records the change in the vehicle history."
        onClose={() => setBoyModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBoyModal(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitBoy()} isLoading={isSaving}>
              Save delivery boy
            </Button>
          </>
        }
      >
        <form onSubmit={submitBoy} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          {formError && (
            <div className="sm:col-span-2">
              <Alert tone="error">{formError}</Alert>
            </div>
          )}

          <Input
            label="Full name"
            error={boyForm.formState.errors.name?.message}
            {...boyForm.register('name')}
          />
          <Input
            label="Phone"
            error={boyForm.formState.errors.phone?.message}
            {...boyForm.register('phone')}
          />
          <Input
            label="CNIC"
            error={boyForm.formState.errors.cnic?.message}
            {...boyForm.register('cnic')}
          />
          <Input
            label="Join date"
            type="date"
            error={boyForm.formState.errors.joinDate?.message}
            {...boyForm.register('joinDate')}
          />
          <div className="sm:col-span-2">
            <Input
              label="Address"
              error={boyForm.formState.errors.address?.message}
              {...boyForm.register('address')}
            />
          </div>
          <MoneyInput
            label="Monthly salary"
            value={boySalary}
            onChange={(paisa) => boyForm.setValue('salary', paisa, { shouldValidate: true })}
            error={boyForm.formState.errors.salary?.message}
          />
          <Input
            label="Delivery commission %"
            type="number"
            min={0}
            max={100}
            hint={`${boyCommission}% of each delivered order`}
            error={boyForm.formState.errors.commission?.message}
            {...boyForm.register('commission', { valueAsNumber: true })}
          />
          <div className="sm:col-span-2">
            <Select
              label="Assigned vehicle"
              placeholder="No vehicle"
              options={vehicleOptions}
              error={boyForm.formState.errors.vehicleId?.message}
              {...boyForm.register('vehicleId', {
                setValueAs: (value: string) => (value === '' ? null : Number(value)),
              })}
            />
          </div>
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" className="h-4 w-4" {...boyForm.register('active')} />
            On the active list
          </label>
        </form>
      </Modal>

      {/* ---------------------------- Detail drawer --------------------------- */}
      {detail && (
        <StaffDetailModal
          target={detail}
          month={month}
          canWrite={canWrite}
          onClose={() => setDetail(null)}
          onAddAdvance={() => {
            advanceForm.reset({
              personType: detail.personType,
              personId: detail.personId,
              amount: 0,
              date: todayIso(),
              note: '',
            });
            setFormError(null);
            setAdvanceOpen(true);
          }}
          registerRefresh={(fn) => {
            detailRefresh.current = fn;
          }}
        />
      )}

      <Modal
        isOpen={advanceOpen}
        title="Record an advance"
        description={detail ? `Advance for ${detail.name}` : ''}
        onClose={() => setAdvanceOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdvanceOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={() => void submitAdvance()} isLoading={isSaving}>
              <HandCoins aria-hidden className="h-4 w-4" />
              Save advance
            </Button>
          </>
        }
      >
        <form onSubmit={submitAdvance} className="flex flex-col gap-4" noValidate>
          {formError && <Alert tone="error">{formError}</Alert>}
          <MoneyInput
            label="Advance amount"
            value={advanceForm.watch('amount') ?? 0}
            onChange={(paisa) => advanceForm.setValue('amount', paisa, { shouldValidate: true })}
            error={advanceForm.formState.errors.amount?.message}
          />
          <Input
            label="Date"
            type="date"
            max={todayIso()}
            error={advanceForm.formState.errors.date?.message}
            {...advanceForm.register('date')}
          />
          <Input
            label="Note"
            placeholder="Bike repair, family, …"
            error={advanceForm.formState.errors.note?.message}
            {...advanceForm.register('note')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={removeTarget !== null}
        title="Remove from the active list?"
        message={`${removeTarget?.name ?? ''} stays on old orders and salary records, but will not appear in new orders.`}
        confirmLabel="Remove"
        onConfirm={removePerson}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}

/* ------------------------------ Detail modal ------------------------------ */

interface StaffDetailModalProps {
  target: DetailTarget;
  month: string;
  canWrite: boolean;
  onClose: () => void;
  onAddAdvance: () => void;
  registerRefresh: (fn: () => Promise<void>) => void;
}

function StaffDetailModal({
  target,
  month,
  canWrite,
  onClose,
  onAddAdvance,
  registerRefresh,
}: StaffDetailModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [deductions, setDeductions] = useState(0);

  const attendance = useAsync(
    async () =>
      unwrap(await getApi().staff.listAttendance(target.personType, target.personId, month)),
    [target.personId, target.personType, month],
  );
  const advances = useAsync(
    async () =>
      unwrap(await getApi().staff.listAdvances(target.personType, target.personId, month)),
    [target.personId, target.personType, month],
  );
  const slip = useAsync(
    async () => unwrap(await getApi().staff.salarySlip(target.personType, target.personId, month)),
    [target.personId, target.personType, month],
  );

  const reloadAll = async () => {
    await Promise.all([attendance.reload(), advances.reload(), slip.reload()]);
  };

  registerRefresh(reloadAll);

  const attendanceByDate = new Map((attendance.data ?? []).map((row) => [row.date, row.status]));

  const days = useMemo(() => {
    const [yearText, monthText] = month.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText);
    const total = new Date(year, monthIndex, 0).getDate();
    const today = todayIso();

    return Array.from({ length: total }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      const date = `${month}-${day}`;
      return { date, day, isFuture: date > today, isToday: date === today };
    });
  }, [month]);

  const setStatus = async (date: string, status: AttendanceStatus) => {
    setError(null);
    try {
      unwrap(
        await getApi().staff.setAttendance({
          personType: target.personType,
          personId: target.personId,
          date,
          status,
        }),
      );
      await reloadAll();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const paySalary = async () => {
    setPaying(true);
    setError(null);
    try {
      unwrap(
        await getApi().staff.paySalary({
          personType: target.personType,
          personId: target.personId,
          month,
          deductions,
        }),
      );
      toast.success('Salary recorded as paid');
      await reloadAll();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPaying(false);
    }
  };

  const removeAdvance = async (id: number) => {
    try {
      unwrap(await getApi().staff.removeAdvance(id));
      await reloadAll();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const data: SalarySlip | null = slip.data;

  const advanceColumns: Column<{ id: number; amount: number; date: string; note: string }>[] = [
    { key: 'date', header: 'Date', render: (row) => formatDate(row.date) },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => formatAmount(row.amount),
    },
    { key: 'note', header: 'Note', render: (row) => row.note || '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <Button variant="ghost" onClick={() => void removeAdvance(row.id)} title="Delete advance">
          <Trash2 aria-hidden className="h-4 w-4 text-status-cancelled" />
        </Button>
      ),
    },
  ];

  return (
    <Modal
      isOpen
      title={`${target.name} · ${formatMonth(month)}`}
      description={`${PERSON_TYPE_LABELS[target.personType]} · attendance, advances and salary`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canWrite && (
            <>
              <Button variant="secondary" onClick={onAddAdvance}>
                <HandCoins aria-hidden className="h-4 w-4" />
                Add advance
              </Button>
              <Button
                onClick={() => void paySalary()}
                isLoading={paying}
                disabled={
                  Boolean(data?.paidOn) || (data?.daysPresent ?? 0) + (data?.halfDays ?? 0) === 0
                }
              >
                <Banknote aria-hidden className="h-4 w-4" />
                {data?.paidOn ? 'Salary paid' : 'Mark salary as paid'}
              </Button>
            </>
          )}
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeading title="Attendance" subtitle="Tap a day to cycle through the statuses" />

          {attendance.isLoading ? (
            <p className="text-caption text-text-secondary">Loading…</p>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const status = attendanceByDate.get(day.date);
                const order: AttendanceStatus[] = ['present', 'half_day', 'absent', 'leave'];
                const nextStatus = status
                  ? order[(order.indexOf(status) + 1) % order.length]
                  : 'present';

                const toneClass = status
                  ? status === 'present'
                    ? 'bg-status-success/15 text-status-success border-status-success/40'
                    : status === 'absent'
                      ? 'bg-status-cancelled/10 text-status-cancelled border-status-cancelled/40'
                      : status === 'half_day'
                        ? 'bg-secondary/20 text-[#8a6100] border-secondary/50'
                        : 'bg-status-preparing/15 text-status-preparing border-status-preparing/40'
                  : 'border-border bg-surface text-text-secondary hover:bg-background';

                return (
                  <button
                    key={day.date}
                    type="button"
                    disabled={day.isFuture || !canWrite}
                    onClick={() => void setStatus(day.date, nextStatus ?? 'present')}
                    title={`${formatDate(day.date)}${status ? ` — ${ATTENDANCE_LABELS[status]}` : ''}`}
                    className={`flex h-9 flex-col items-center justify-center rounded-control border text-[11px] leading-tight disabled:opacity-40 ${toneClass} ${
                      day.isToday ? 'ring-1 ring-primary' : ''
                    }`}
                  >
                    <span className="font-semibold">{day.day}</span>
                    <span className="text-[9px] uppercase">
                      {status ? ATTENDANCE_LABELS[status].slice(0, 4) : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2 text-caption">
            {(['present', 'half_day', 'absent', 'leave'] as AttendanceStatus[]).map((status) => (
              <Badge key={status} tone={ATTENDANCE_TONES[status]}>
                {ATTENDANCE_LABELS[status]}
              </Badge>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeading
            title="Salary slip"
            subtitle={data?.paidOn ? `Paid on ${formatDate(data.paidOn)}` : 'Not paid yet'}
          />

          {data && (
            <dl className="flex flex-col gap-1 text-body">
              <Row label="Monthly salary" value={formatAmount(data.monthlySalary)} />
              <Row label="Working days" value={String(data.workingDays)} />
              <Row label="Present" value={`${data.daysPresent} day(s)`} />
              <Row label="Half days" value={`${data.halfDays} day(s)`} />
              <Row label="Absent" value={`${data.daysAbsent} day(s)`} />
              <Row label="Leave" value={`${data.leaves} day(s)`} />
              <Row label="Per day" value={formatAmount(data.perDay)} />
              <Row label="Earned salary" value={formatAmount(data.earnedSalary)} />
              {data.commission > 0 && (
                <Row label="Delivery commission" value={formatAmount(data.commission)} />
              )}
              <Row label="Advances this month" value={`-${formatAmount(data.advances)}`} />
              {canWrite && !data.paidOn ? (
                <div className="mt-2">
                  <MoneyInput
                    label="Other deductions"
                    value={deductions}
                    onChange={setDeductions}
                  />
                </div>
              ) : (
                data.deductions > 0 && (
                  <Row label="Deductions" value={formatAmount(data.deductions)} />
                )
              )}
              <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
                <dt className="text-card-title">Net pay</dt>
                <dd className="text-section-title tabular text-primary">
                  {formatAmount(Math.max(0, data.netPay + (data.paidOn ? 0 : -deductions)))}
                </dd>
              </div>
              {data.paidOn && (
                <p className="mt-1 flex items-center gap-1 text-caption text-status-success">
                  <BadgeCheck aria-hidden className="h-3.5 w-3.5" />
                  Salary recorded as paid on {formatDate(data.paidOn)}
                </p>
              )}
            </dl>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <CardHeading title="Advances" subtitle="Money given in advance this month" />
        <Table
          columns={advanceColumns}
          rows={advances.data ?? []}
          rowKey={(row) => row.id}
          isLoading={advances.isLoading}
          emptyMessage="No advances this month"
          emptyHint="Use “Add advance” when staff take money early."
        />
      </div>

      <p className="mt-3 flex items-center gap-1 text-caption text-text-secondary">
        <UserRound aria-hidden className="h-3.5 w-3.5" />
        Staff are never deleted. Removing someone keeps old orders and salary history intact.
      </p>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
