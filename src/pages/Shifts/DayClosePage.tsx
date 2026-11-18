import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Lock, Printer, Unlock, Wallet } from 'lucide-react';
import type { CashMovementKind, ShiftReport } from '../../types/api';
import { PAYMENT_METHOD_LABELS } from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useSettings } from '../../store/settingsStore';
import { formatAmount, formatDateTime } from '../../utils/format';
import { Button } from '../../components/Button';
import { Card, CardHeading } from '../../components/Card';
import { Input } from '../../components/Input';
import { MoneyInput } from '../../components/MoneyInput';
import { Modal } from '../../components/Modal';
import { Table, type Column } from '../../components/Table';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';
import type { CashMovement } from '../../types/api';

type MovementKind = Exclude<CashMovementKind, 'sale'>;

export function DayClosePage() {
  const currency = useSettings((settings) => settings.currency);

  const [openAmount, setOpenAmount] = useState(0);
  const [counted, setCounted] = useState(0);
  const [notes, setNotes] = useState('');
  const [movementKind, setMovementKind] = useState<MovementKind | null>(null);
  const [movementAmount, setMovementAmount] = useState(0);
  const [movementReason, setMovementReason] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  const current = useAsync(async () => unwrap(await getApi().shifts.current()), []);
  const report = useAsync(
    async () => (current.data ? unwrap(await getApi().shifts.report(current.data.id)) : null),
    [current.data?.id, current.data?.status],
  );
  const history = useAsync(async () => unwrap(await getApi().shifts.list(10)), []);

  const shift = current.data;
  const data: ShiftReport | null = report.data ?? null;

  const refresh = async () => {
    await current.reload();
    await report.reload();
    await history.reload();
  };

  const openShift = async () => {
    setIsBusy(true);
    setFormError(null);
    try {
      unwrap(await getApi().shifts.open(openAmount));
      toast.success('Shift opened');
      await refresh();
    } catch (error) {
      setFormError(errorMessage(error, 'The shift could not be opened'));
    } finally {
      setIsBusy(false);
    }
  };

  const addMovement = async () => {
    if (!movementKind) return;

    setIsBusy(true);
    setFormError(null);
    try {
      unwrap(
        await getApi().shifts.addCashMovement({
          kind: movementKind,
          amount: movementAmount,
          reason: movementReason,
        }),
      );
      toast.success('Cash movement recorded');
      setMovementKind(null);
      setMovementAmount(0);
      setMovementReason('');
      await refresh();
    } catch (error) {
      setFormError(errorMessage(error, 'The cash movement could not be recorded'));
    } finally {
      setIsBusy(false);
    }
  };

  const closeShift = async () => {
    setIsBusy(true);
    setFormError(null);
    try {
      unwrap(await getApi().shifts.close({ countedCash: counted, notes }));
      toast.success('Shift closed');
      setCloseOpen(false);
      setCounted(0);
      setNotes('');
      await refresh();
    } catch (error) {
      setFormError(errorMessage(error, 'The shift could not be closed'));
    } finally {
      setIsBusy(false);
    }
  };

  const printReport = async () => {
    if (!shift) return;
    setIsPrinting(true);
    try {
      const result = unwrap(await getApi().shifts.print(shift.id, '80mm'));
      if (result.printed) toast.success('Report sent to the printer');
    } catch (error) {
      toast.error(errorMessage(error, 'The report could not be printed'));
    } finally {
      setIsPrinting(false);
    }
  };

  const movementColumns: Column<CashMovement>[] = [
    { key: 'when', header: 'When', render: (row) => formatDateTime(row.createdAt) },
    {
      key: 'kind',
      header: 'Type',
      render: (row) => (
        <Badge tone={row.kind === 'cash_in' ? 'success' : 'pending'}>
          {row.kind === 'cash_in'
            ? 'Cash in'
            : row.kind === 'cash_out'
              ? 'Cash out'
              : row.kind === 'refund'
                ? 'Refund'
                : 'Expense'}
        </Badge>
      ),
    },
    { key: 'reason', header: 'Reason', render: (row) => row.reason || '—' },
    { key: 'by', header: 'By', render: (row) => row.createdByName },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => formatAmount(row.amount),
    },
  ];

  const difference = data && data.shift.countedCash !== null ? data.variance : null;

  return (
    <div>
      <PageHeader
        title="Day close"
        subtitle="Open the drawer, record cash movements, print an X report and close the day."
        actions={
          shift ? (
            <>
              <Button variant="secondary" onClick={() => void printReport()} isLoading={isPrinting}>
                <Printer aria-hidden className="h-4 w-4" />
                Print X report
              </Button>
              <Button variant="danger" onClick={() => setCloseOpen(true)}>
                <Lock aria-hidden className="h-4 w-4" />
                Close shift
              </Button>
            </>
          ) : undefined
        }
      />

      {!shift && (
        <Card className="mx-auto max-w-md">
          <CardHeading
            title="Open the shift"
            subtitle="Count the cash already in the drawer and enter it as the opening float."
          />
          <div className="flex flex-col gap-4">
            {formError && <Alert tone="error">{formError}</Alert>}
            <MoneyInput label="Opening cash" value={openAmount} onChange={setOpenAmount} />
            <Button onClick={() => void openShift()} isLoading={isBusy} fullWidth size="lg">
              <Unlock aria-hidden className="h-4 w-4" />
              Open shift
            </Button>
          </div>
        </Card>
      )}

      {shift && data && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-caption text-text-secondary">Shift</p>
              <p className="text-section-title">#{shift.id}</p>
              <p className="text-caption text-text-secondary">
                Opened {formatDateTime(shift.openedAt)} by {shift.openedByName}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-caption text-text-secondary">Collected</p>
              <p className="text-section-title tabular">
                {currency} {formatAmount(data.totalSales)}
              </p>
              <p className="text-caption text-text-secondary">{data.orderCount} orders</p>
            </Card>
            <Card className="p-4">
              <p className="text-caption text-text-secondary">Expected in drawer</p>
              <p className="text-section-title tabular">
                {currency} {formatAmount(data.expectedCash)}
              </p>
              <p className="text-caption text-text-secondary">
                Opening {formatAmount(shift.openingCash)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-caption text-text-secondary">Cash sales</p>
              <p className="text-section-title tabular">{formatAmount(data.cashSales)}</p>
              <p className="text-caption text-text-secondary">
                {data.salesByMethod.length} payment methods used
              </p>
            </Card>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setMovementKind('cash_in');
                setMovementAmount(0);
                setMovementReason('');
                setFormError(null);
              }}
            >
              <ArrowDownCircle aria-hidden className="h-4 w-4" />
              Cash in
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setMovementKind('cash_out');
                setMovementAmount(0);
                setMovementReason('');
                setFormError(null);
              }}
            >
              <ArrowUpCircle aria-hidden className="h-4 w-4" />
              Cash out
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setMovementKind('expense');
                setMovementAmount(0);
                setMovementReason('');
                setFormError(null);
              }}
            >
              <Wallet aria-hidden className="h-4 w-4" />
              Expense from drawer
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeading title="Sales by method" subtitle="Only payments in this shift." />
              <Table
                columns={[
                  {
                    key: 'method',
                    header: 'Method',
                    render: (row) => PAYMENT_METHOD_LABELS[row.method],
                  },
                  { key: 'count', header: 'Count', align: 'center', render: (row) => row.count },
                  {
                    key: 'total',
                    header: 'Amount',
                    align: 'right',
                    render: (row) => formatAmount(row.total),
                  },
                ]}
                rows={data.salesByMethod}
                rowKey={(row) => row.method}
                emptyMessage="No payments yet"
                emptyHint="Take an order and collect payment first."
              />
            </Card>

            <Card>
              <CardHeading
                title="Cash drawer"
                subtitle="Why the drawer should hold what it holds."
              />
              <dl className="flex flex-col gap-1 text-body">
                {[
                  ['Opening float', shift.openingCash],
                  ['Cash sales', data.cashSales],
                  ['Cash in', data.cashIn],
                  ['Cash out', -data.cashOut],
                  ['Refunds', -data.refunds],
                  ['Expenses', -data.expenses],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between">
                    <dt className="text-text-secondary">{label}</dt>
                    <dd className="tabular">{formatAmount(value as number)}</dd>
                  </div>
                ))}
                <div className="mt-1 flex justify-between border-t border-border pt-2">
                  <dt className="font-medium">Expected cash</dt>
                  <dd className="font-medium tabular">{formatAmount(data.expectedCash)}</dd>
                </div>
                {difference !== null && (
                  <div className="mt-1 flex justify-between">
                    <dt
                      className={
                        difference === 0
                          ? 'text-text-secondary'
                          : 'font-medium text-status-cancelled'
                      }
                    >
                      {difference === 0 ? 'Balanced' : 'Variance'}
                    </dt>
                    <dd
                      className={`font-medium tabular ${
                        difference === 0 ? '' : 'text-status-cancelled'
                      }`}
                    >
                      {formatAmount(difference)}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeading title="Cash movements" subtitle="Every cash-in and cash-out this shift." />
            <Table
              columns={movementColumns}
              rows={data.movements}
              rowKey={(row) => row.id}
              emptyMessage="No cash movements"
              emptyHint="Use the buttons above to record one."
            />
          </Card>
        </>
      )}

      {/* -------------------------- Cash movement modal -------------------------- */}
      <Modal
        isOpen={movementKind !== null}
        title={
          movementKind === 'cash_in'
            ? 'Cash in'
            : movementKind === 'cash_out'
              ? 'Cash out'
              : 'Expense from drawer'
        }
        onClose={() => setMovementKind(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMovementKind(null)} disabled={isBusy}>
              Cancel
            </Button>
            <Button onClick={() => void addMovement()} isLoading={isBusy}>
              Record
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <MoneyInput label="Amount" value={movementAmount} onChange={setMovementAmount} />
          <Input
            label="Reason"
            placeholder="Bought ice, owner took cash…"
            value={movementReason}
            onChange={(event) => setMovementReason(event.target.value)}
          />
        </div>
      </Modal>

      {/* ---------------------------- Close shift modal ---------------------------- */}
      <Modal
        isOpen={closeOpen}
        title="Close the shift"
        description="Count the drawer, enter the amount and confirm. The Z report is produced automatically."
        onClose={() => setCloseOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseOpen(false)} disabled={isBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void closeShift()} isLoading={isBusy}>
              Close shift
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && <Alert tone="error">{formError}</Alert>}

          <p className="text-body">
            Expected in the drawer:{' '}
            <span className="font-medium">
              {currency} {formatAmount(data?.expectedCash ?? 0)}
            </span>
          </p>

          <MoneyInput
            label="Cash counted"
            value={counted}
            onChange={setCounted}
            hint="Enter the real amount you counted, not the expected one"
          />

          {counted > 0 && data && counted !== data.expectedCash && (
            <Alert tone="warning">
              {`Difference of ${currency} ${formatAmount(
                Math.abs(counted - data.expectedCash),
              )} ${counted > data.expectedCash ? '(over)' : '(short)'} — check before closing.`}
            </Alert>
          )}

          <Input
            label="Notes (optional)"
            placeholder="Drawer short, till jam…"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </Modal>

      <Card className="mt-4">
        <CardHeading title="Recent shifts" subtitle="The last ten days at this counter." />
        <Table
          columns={[
            { key: 'id', header: 'Shift', render: (row) => `#${row.id}` },
            {
              key: 'opened',
              header: 'Opened',
              render: (row) => `${formatDateTime(row.openedAt)} · ${row.openedByName}`,
            },
            {
              key: 'closed',
              header: 'Closed',
              render: (row) =>
                row.closedAt ? `${formatDateTime(row.closedAt)} · ${row.closedByName ?? ''}` : '—',
            },
            {
              key: 'expected',
              header: 'Expected',
              align: 'right',
              render: (row) => (row.expectedCash === null ? '—' : formatAmount(row.expectedCash)),
            },
            {
              key: 'counted',
              header: 'Counted',
              align: 'right',
              render: (row) => (row.countedCash === null ? '—' : formatAmount(row.countedCash)),
            },
            {
              key: 'diff',
              header: 'Difference',
              align: 'right',
              render: (row) =>
                row.difference === null ? (
                  '—'
                ) : row.difference === 0 ? (
                  <Badge tone="success">Balanced</Badge>
                ) : (
                  <span className="text-status-cancelled">{formatAmount(row.difference)}</span>
                ),
            },
          ]}
          rows={history.data ?? []}
          rowKey={(row) => row.id}
          isLoading={history.isLoading}
          emptyMessage="No shifts yet"
          emptyHint="Open a shift to start the day."
        />
      </Card>
    </div>
  );
}
