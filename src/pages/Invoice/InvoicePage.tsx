import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ChefHat, FileDown, PencilLine, Printer } from 'lucide-react';
import type { InvoiceData, OrderStatus, Payment, PaymentMethod } from '../../types/api';
import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS } from '../../types/labels';
import { errorMessage, getApi, unwrap } from '../../utils/api';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { formatAmount, formatDate, formatDateTime } from '../../utils/format';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { MoneyInput } from '../../components/MoneyInput';
import { Alert } from '../../components/Alert';
import { toast } from '../../components/Toast';
import { AmendDialog } from './AmendDialog';

const STATUS_OPTIONS: OrderStatus[] = ['pending', 'preparing', 'ready', 'delivered'];

/**
 * Invoice screen: thermal-style preview on the left, actions on the right.
 * The HTML printed by the main process is generated from the same data,
 * so the preview and the paper receipt always match.
 */
export function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { allow } = useAuth();
  const autoPrint = Boolean((location.state as { autoPrint?: boolean } | null)?.autoPrint);
  const didAutoPrint = useRef(false);

  const [paper, setPaper] = useState<'80mm' | 'a4'>('80mm');
  const [isPrinting, setIsPrinting] = useState(false);
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [askPrint, setAskPrint] = useState(false);
  const [isPrintingKot, setIsPrintingKot] = useState(false);
  // Amending a saved bill (Phase 3).
  const [amendOpen, setAmendOpen] = useState(false);

  // Payments for this order (feature 3.A).
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payAmount, setPayAmount] = useState(0);
  const [payTendered, setPayTendered] = useState(0);
  const [payReference, setPayReference] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  const invoice = useAsync(async () => {
    if (!Number.isFinite(orderId)) throw new Error('Invalid order');
    return unwrap(await getApi().orders.invoice(orderId));
  }, [orderId]);

  const data: InvoiceData | null = invoice.data;

  const payments = useAsync(
    async () =>
      Number.isFinite(orderId) ? unwrap(await getApi().payments.listByOrder(orderId)) : [],
    [orderId],
  );

  const canVoid = allow('payments:void');
  const paidTotal = (payments.data ?? [])
    .filter((payment) => !payment.voidedAt)
    .reduce((sum, payment) => sum + payment.amount, 0);
  const outstanding = Math.max((data?.order.total ?? 0) - paidTotal, 0);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      subtotal: data.order.subtotal,
      discount: data.order.discount,
      tax: data.order.tax,
      total: data.order.total,
    };
  }, [data]);

  /**
   * Sends the kitchen ticket. The main process builds the slip from the stored
   * order — this screen never assembles prices or quantities for it.
   */
  const printKot = async () => {
    setIsPrintingKot(true);
    try {
      const result = unwrap(await getApi().kot.print(orderId));
      if (result.printed) {
        toast.success('Kitchen ticket sent');
      } else {
        toast.info('Printing was cancelled');
      }
    } catch (error) {
      toast.error(errorMessage(error, 'The kitchen ticket could not be printed'));
    } finally {
      setIsPrintingKot(false);
    }
  };

  const printNow = async (openDialogFirst = false) => {
    if (!data) return;
    if (openDialogFirst) {
      setAskPrint(true);
      return;
    }

    setIsPrinting(true);
    try {
      const result = unwrap(await getApi().orders.print(orderId, paper));
      if (result.printed) {
        toast.success('Sent to the printer');
        await invoice.reload();
      } else {
        toast.info('Printing was cancelled');
      }
    } catch (error) {
      toast.error(errorMessage(error, 'The invoice could not be printed'));
    } finally {
      setIsPrinting(false);
    }
  };

  // Coming from the New Order screen with "Save and open invoice".
  useEffect(() => {
    if (!autoPrint || !data || didAutoPrint.current) return;
    didAutoPrint.current = true;
    void printNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, data]);

  const savePdf = async () => {
    setIsSavingPdf(true);
    try {
      const result = unwrap(await getApi().orders.savePdf(orderId, paper));
      if (result.path) {
        toast.success(`PDF saved to ${result.path}`);
        await invoice.reload();
      }
    } catch (error) {
      toast.error(errorMessage(error, 'The PDF could not be saved'));
    } finally {
      setIsSavingPdf(false);
    }
  };

  const changeStatus = async (status: OrderStatus) => {
    try {
      unwrap(await getApi().orders.updateStatus(orderId, status));
      toast.success(`Order marked ${ORDER_STATUS_LABELS[status].toLowerCase()}`);
      await invoice.reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (invoice.error) {
    return (
      <div>
        <PageHeader title="Invoice" />
        <Card>
          <p className="text-body text-status-cancelled">{invoice.error}</p>
          <Button variant="secondary" className="mt-3" onClick={() => navigate('/orders')}>
            Back to orders
          </Button>
        </Card>
      </div>
    );
  }

  const openPayment = () => {
    setPayMethod('cash');
    setPayAmount(outstanding);
    setPayTendered(0);
    setPayReference('');
    setPayError(null);
    setPaymentOpen(true);
  };

  const submitPayment = async () => {
    setIsPaying(true);
    setPayError(null);
    try {
      unwrap(
        await getApi().payments.addPayment({
          orderId,
          method: payMethod,
          amount: payAmount,
          tendered: payMethod === 'cash' ? payTendered || payAmount : null,
          changeDue:
            payMethod === 'cash' ? Math.max((payTendered || payAmount) - payAmount, 0) : null,
          reference: payReference,
        }),
      );
      toast.success('Payment recorded');
      setPaymentOpen(false);
      await payments.reload();
      await invoice.reload();
    } catch (error) {
      setPayError(errorMessage(error, 'The payment could not be recorded'));
    } finally {
      setIsPaying(false);
    }
  };

  const submitVoid = async () => {
    if (!voidTarget) return;
    setIsPaying(true);
    setPayError(null);
    try {
      unwrap(await getApi().payments.voidPayment(voidTarget.id, voidReason));
      toast.success('Payment voided');
      setVoidTarget(null);
      setVoidReason('');
      await payments.reload();
      await invoice.reload();
    } catch (error) {
      setPayError(errorMessage(error, 'The payment could not be voided'));
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={data ? `Invoice ${data.order.invoiceNo ?? data.order.orderNo}` : 'Invoice'}
        subtitle={
          data
            ? `${ORDER_TYPE_LABELS[data.order.type]} · ${formatDateTime(data.order.createdAt)}`
            : 'Loading…'
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/orders')}>
              <ArrowLeft aria-hidden className="h-4 w-4" />
              Orders
            </Button>
            <Button variant="secondary" onClick={() => void savePdf()} isLoading={isSavingPdf}>
              <FileDown aria-hidden className="h-4 w-4" />
              Save PDF
            </Button>
            <Button
              variant="secondary"
              onClick={() => setAmendOpen(true)}
              disabled={
                !data || data.order.status === 'cancelled' || data.order.mergedIntoOrderId !== null
              }
            >
              <PencilLine aria-hidden className="h-4 w-4" />
              Edit bill
            </Button>
            <Button
              variant="secondary"
              onClick={() => void printKot()}
              isLoading={isPrintingKot}
              disabled={!data || data.order.status === 'cancelled'}
            >
              <ChefHat aria-hidden className="h-4 w-4" />
              Kitchen ticket
            </Button>
            <Button onClick={() => void printNow()} isLoading={isPrinting} disabled={!data}>
              <Printer aria-hidden className="h-4 w-4" />
              Print
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(340px,420px)_1fr]">
        {/* --------------------------- Receipt preview --------------------------- */}
        <Card className="mx-auto w-full max-w-[420px] bg-white p-4 font-mono text-[12px] text-text-primary">
          <div className="text-center">
            {data?.shop.shopLogo && (
              <img src={data.shop.shopLogo} alt="" className="mx-auto mb-1 h-12 object-contain" />
            )}
            <p className="font-heading text-[15px] font-bold">{data?.shop.shopName ?? '…'}</p>
            {data?.shop.shopAddress && (
              <p className="text-text-secondary">{data.shop.shopAddress}</p>
            )}
            {data?.shop.shopPhone && (
              <p className="text-text-secondary">Tel: {data.shop.shopPhone}</p>
            )}
          </div>

          <hr className="my-2 border-dashed border-border" />

          <div className="flex flex-col gap-0.5">
            <div className="flex justify-between">
              <span>Invoice</span>
              <span>{data?.order.invoiceNo ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>Order</span>
              <span>{data?.order.orderNo ?? '—'}</span>
            </div>
            {data?.order.tokenNo !== null && data?.order.tokenNo !== undefined && (
              <div className="flex items-center justify-between font-bold">
                <span>Token</span>
                <span className="text-[18px]">{data.order.tokenNo}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Date</span>
              <span>{data ? formatDate(data.order.createdAt) : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>Cashier</span>
              <span>{data?.cashierName ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span>Type</span>
              <span>{data ? ORDER_TYPE_LABELS[data.order.type] : '—'}</span>
            </div>
            {data?.order.splitFromOrderId !== null &&
              data?.order.splitFromOrderId !== undefined && (
                <div className="flex justify-between text-caption text-text-secondary">
                  <span>Split from</span>
                  <span>order #{data.order.splitFromOrderId}</span>
                </div>
              )}
            {data?.order.customerName && (
              <div className="flex justify-between">
                <span>Customer</span>
                <span className="text-right">{data.order.customerName}</span>
              </div>
            )}
            {data?.order.deliveryBoyName && (
              <div className="flex justify-between">
                <span>Rider</span>
                <span>{data.order.deliveryBoyName}</span>
              </div>
            )}
            {data?.order.waiterName && (
              <div className="flex justify-between">
                <span>Waiter</span>
                <span>{data.order.waiterName}</span>
              </div>
            )}
          </div>

          <hr className="my-2 border-dashed border-border" />

          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase text-text-secondary">
                <th className="py-1">Item</th>
                <th className="w-8 text-center">Qty</th>
                <th className="w-16 text-right">Price</th>
                <th className="w-16 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(data?.order.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td className="py-0.5 align-top">{item.name}</td>
                  <td className="text-center align-top">{item.qty}</td>
                  <td className="text-right align-top tabular">{formatAmount(item.price)}</td>
                  <td className="text-right align-top tabular">{formatAmount(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <hr className="my-2 border-dashed border-border" />

          {totals && (
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular">{formatAmount(totals.subtotal)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between">
                  <span>Discount</span>
                  <span className="tabular">-{formatAmount(totals.discount)}</span>
                </div>
              )}
              {totals.tax > 0 && (
                <div className="flex justify-between">
                  <span>Tax ({data?.order.taxPercent}%)</span>
                  <span className="tabular">{formatAmount(totals.tax)}</span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-text-primary pt-1 text-[14px] font-bold">
                <span>Grand total</span>
                <span className="tabular">
                  {data?.shop.currency} {formatAmount(totals.total)}
                </span>
              </div>
            </div>
          )}

          <p className="mt-3 text-center">Thank you for visiting!</p>
        </Card>

        {/* ------------------------------ Actions ------------------------------ */}
        <div className="flex flex-col gap-4">
          {/* ----------------------------- Payments ----------------------------- */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-card-title">Payment</h2>
              {outstanding === 0 ? (
                <span className="rounded-full bg-status-delivered/10 px-2 py-0.5 text-caption text-status-delivered">
                  Paid
                </span>
              ) : (
                <span className="rounded-full bg-status-cancelled/10 px-2 py-0.5 text-caption text-status-cancelled">
                  {paidTotal > 0 ? 'Part paid' : 'Unpaid'}
                </span>
              )}
            </div>

            <dl className="mb-3 flex flex-col gap-1 text-body">
              <div className="flex justify-between">
                <dt className="text-text-secondary">Order total</dt>
                <dd className="tabular">{formatAmount(data?.order.total ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">Paid so far</dt>
                <dd className="tabular">{formatAmount(paidTotal)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-1">
                <dt className="font-medium">Outstanding</dt>
                <dd className="font-medium tabular">{formatAmount(outstanding)}</dd>
              </div>
            </dl>

            {(payments.data ?? []).length > 0 && (
              <ul className="mb-3 flex flex-col gap-1">
                {(payments.data ?? []).map((payment) => (
                  <li
                    key={payment.id}
                    className="flex items-center justify-between rounded-control bg-background px-2 py-1 text-caption"
                  >
                    <span className={payment.voidedAt ? 'line-through text-text-secondary' : ''}>
                      {PAYMENT_METHOD_LABELS[payment.method]} · {formatAmount(payment.amount)}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                    </span>
                    {payment.voidedAt ? (
                      <span className="text-status-cancelled">voided</span>
                    ) : canVoid ? (
                      <button
                        type="button"
                        className="text-status-cancelled underline"
                        onClick={() => {
                          setVoidTarget(payment);
                          setVoidReason('');
                          setPayError(null);
                        }}
                      >
                        Void
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {outstanding > 0 && (
              <Button variant="secondary" fullWidth onClick={openPayment}>
                Add payment
              </Button>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-card-title">Paper and printing</h2>

            <Select
              label="Receipt size"
              options={[
                { value: '80mm', label: '80mm thermal' },
                { value: 'a4', label: 'A4 page' },
              ]}
              value={paper}
              onChange={(event) => setPaper(event.target.value === 'a4' ? 'a4' : '80mm')}
              hint="The printer dialog opens after you press Print."
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void savePdf()} isLoading={isSavingPdf}>
                <FileDown aria-hidden className="h-4 w-4" />
                Save as PDF
              </Button>
              <Button onClick={() => void printNow()} isLoading={isPrinting}>
                <Printer aria-hidden className="h-4 w-4" />
                Print invoice
              </Button>
            </div>

            {data?.order.printedAt && (
              <p className="mt-3 flex items-center gap-1 text-caption text-status-success">
                <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                Last printed {formatDateTime(data.order.printedAt)}
              </p>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-card-title">Order status</h2>
            <p className="mb-3 text-caption text-text-secondary">
              Current:{' '}
              <span className="font-semibold">
                {data ? ORDER_STATUS_LABELS[data.order.status] : '—'}
              </span>
            </p>

            {allow('orders:write') && data && data.order.status !== 'cancelled' ? (
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((status) => (
                  <Button
                    key={status}
                    variant={data.order.status === status ? 'primary' : 'secondary'}
                    onClick={() => void changeStatus(status)}
                    disabled={data.order.status === status}
                  >
                    {ORDER_STATUS_LABELS[status]}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-caption text-text-secondary">
                {data?.order.status === 'cancelled'
                  ? 'This order was cancelled and cannot be changed.'
                  : 'Your role cannot change the order status.'}
              </p>
            )}
          </Card>

          {data && (
            <Card>
              <h2 className="mb-2 text-card-title">Details</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
                <dt className="text-text-secondary">Taken by</dt>
                <dd>{data.order.createdByName}</dd>
                <dt className="text-text-secondary">Type</dt>
                <dd>{ORDER_TYPE_LABELS[data.order.type]}</dd>
                {data.order.customerPhone && (
                  <>
                    <dt className="text-text-secondary">Phone</dt>
                    <dd>{data.order.customerPhone}</dd>
                  </>
                )}
                {data.order.customerAddress && (
                  <>
                    <dt className="text-text-secondary">Address</dt>
                    <dd>{data.order.customerAddress}</dd>
                  </>
                )}
                {data.order.notes && (
                  <>
                    <dt className="text-text-secondary">Note</dt>
                    <dd>{data.order.notes}</dd>
                  </>
                )}
              </dl>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={askPrint}
        title="Print this invoice?"
        message={`Send invoice ${data?.order.invoiceNo ?? ''} to the ${paper === '80mm' ? '80mm thermal' : 'A4'} printer.`}
        confirmLabel="Open printer dialog"
        tone="primary"
        onConfirm={async () => {
          await printNow();
        }}
        onClose={() => setAskPrint(false)}
      />

      {/* --------------------------- Add payment --------------------------- */}
      <Modal
        isOpen={paymentOpen}
        title="Add payment"
        description={`Outstanding ${data?.shop.currency ?? ''} ${formatAmount(outstanding)}`}
        onClose={() => setPaymentOpen(false)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPaymentOpen(false)} disabled={isPaying}>
              Cancel
            </Button>
            <Button onClick={() => void submitPayment()} isLoading={isPaying}>
              Record payment
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {payError && <Alert tone="error">{payError}</Alert>}

          <Select
            label="Method"
            value={payMethod}
            onChange={(event) => setPayMethod(event.target.value as PaymentMethod)}
            options={(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((value) => ({
              value,
              label: PAYMENT_METHOD_LABELS[value],
            }))}
          />

          <MoneyInput
            label="Amount"
            value={payAmount}
            onChange={setPayAmount}
            hint="Cannot be more than the outstanding amount"
          />

          {payMethod === 'cash' && (
            <MoneyInput
              label="Cash received"
              value={payTendered}
              onChange={setPayTendered}
              hint="Leave at 0 to take the exact amount"
            />
          )}

          {payMethod === 'credit' && (
            <p className="text-caption text-text-secondary">
              Credit adds this amount to the customer&apos;s udhaar instead of the till.
            </p>
          )}

          <Input
            label="Reference (optional)"
            value={payReference}
            onChange={(event) => setPayReference(event.target.value)}
          />
        </div>
      </Modal>

      {/* ----------------------------- Void ----------------------------- */}
      <Modal
        isOpen={voidTarget !== null}
        title="Void this payment"
        description="The order total goes back to unpaid for that amount. The void is kept in the audit log."
        onClose={() => setVoidTarget(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setVoidTarget(null)} disabled={isPaying}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void submitVoid()} isLoading={isPaying}>
              Void payment
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {payError && <Alert tone="error">{payError}</Alert>}
          <Input
            label="Reason"
            placeholder="Wrong order, customer changed their mind…"
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
          />
        </div>
      </Modal>

      <AmendDialog
        isOpen={amendOpen}
        order={data?.order ?? null}
        onClose={() => setAmendOpen(false)}
        onAmended={() => {
          setAmendOpen(false);
          void invoice.reload();
          void payments.reload();
        }}
      />
    </div>
  );
}
