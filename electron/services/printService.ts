import type { BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import type { InvoiceData, KOT, ShiftReport } from '../../src/types/api';
import { formatAmount } from '../utils/money';
import { formatDate, formatDateTime, toSqlDate } from '../utils/datetime';
import { AppError } from '../utils/errors';
import { logError, logInfo } from './logger';

export type PaperSize = '80mm' | 'a4';

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ORDER_TYPE_TEXT: Record<string, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

/**
 * Builds the printable invoice HTML (design.md section 9).
 * The same markup is used for the on-screen preview, thermal printing and PDF,
 * so what the customer sees is what gets printed.
 */
export function renderInvoiceHtml(data: InvoiceData, paper: PaperSize): string {
  const { order, shop, cashierName } = data;
  const isThermal = paper === '80mm';

  const rows = order.items
    .map(
      (item) => `
        <tr>
          <td class="item">
            ${escapeHtml(item.name)}
            ${item.notes ? `<div class="note">${escapeHtml(item.notes)}</div>` : ''}
          </td>
          <td class="qty">${item.qty}</td>
          <td class="amount">${formatAmount(item.price)}</td>
          <td class="amount">${formatAmount(item.lineTotal)}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(order.invoiceNo ?? order.orderNo)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ${isThermal ? "'Consolas', 'Courier New', monospace" : "'Segoe UI', system-ui, sans-serif"};
        font-size: ${isThermal ? '11px' : '13px'};
        color: #1F2937;
        width: ${isThermal ? '302px' : '720px'};
        padding: ${isThermal ? '8px 6px' : '24px'};
      }
      .center { text-align: center; }
      .logo { max-height: 56px; max-width: 120px; object-fit: contain; margin-bottom: 4px; }
      h1 { font-size: ${isThermal ? '15px' : '20px'}; margin: 0 0 2px; }
      .muted { color: #6B7280; font-size: ${isThermal ? '10px' : '12px'}; }
      .meta { margin: 8px 0; font-size: ${isThermal ? '10px' : '12px'}; }
      .meta div { display: flex; justify-content: space-between; }
      hr { border: none; border-top: 1px dashed #9CA3AF; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; font-size: ${isThermal ? '10px' : '11px'}; text-transform: uppercase;
           border-bottom: 1px solid #E5E7EB; padding: 3px 0; color: #6B7280; }
      td { padding: 3px 0; vertical-align: top; }
      .item { width: 46%; }
      .note { color: #6B7280; font-size: ${isThermal ? '9px' : '11px'}; }
      .qty { width: 12%; text-align: center; }
      .amount { width: 21%; text-align: right; font-variant-numeric: tabular-nums; }
      .token-label { font-weight: 700; }
      .token { font-weight: 700; font-size: ${isThermal ? '16px' : '20px'}; }
      .totals { margin-top: 6px; }
      .totals div { display: flex; justify-content: space-between; padding: 1px 0; }
      .grand { font-size: ${isThermal ? '14px' : '17px'}; font-weight: 700; border-top: 1px solid #1F2937;
               margin-top: 4px; padding-top: 4px; }
      .footer { margin-top: 10px; text-align: center; font-size: ${isThermal ? '10px' : '12px'}; }
      @page { size: ${isThermal ? '80mm auto' : 'A4'}; margin: ${isThermal ? '0' : '12mm'}; }
    </style>
  </head>
  <body>
    <div class="center">
      ${shop.shopLogo ? `<img class="logo" src="${escapeHtml(shop.shopLogo)}" alt="" />` : ''}
      <h1>${escapeHtml(shop.shopName)}</h1>
      ${shop.shopAddress ? `<div class="muted">${escapeHtml(shop.shopAddress)}</div>` : ''}
      ${shop.shopPhone ? `<div class="muted">Tel: ${escapeHtml(shop.shopPhone)}</div>` : ''}
    </div>

    <hr />

    <div class="meta">
      <div><span>Invoice</span><span>${escapeHtml(order.invoiceNo ?? order.orderNo)}</span></div>
      <div><span>Order</span><span>${escapeHtml(order.orderNo)}</span></div>
      ${
        order.tokenNo !== null
          ? `<div><span class="token-label">Token</span><span class="token">${order.tokenNo}</span></div>`
          : ''
      }
      <div><span>Date</span><span>${formatDate(order.createdAt)}</span></div>
      <div><span>Time</span><span>${formatDateTime(order.createdAt).split(', ')[1] ?? ''}</span></div>
      <div><span>Cashier</span><span>${escapeHtml(cashierName)}</span></div>
      <div><span>Type</span><span>${ORDER_TYPE_TEXT[order.type] ?? order.type}</span></div>
      ${
        order.splitFromOrderId !== null && order.splitFromOrderId !== undefined
          ? `<div><span>Split from</span><span>order #${order.splitFromOrderId}</span></div>`
          : ''
      }
      ${
        order.amendmentCount > 0
          ? `<div><span>Amended</span><span>${order.amendmentCount} time(s)</span></div>`
          : ''
      }
      ${
        order.customerName || order.customerPhone
          ? `<div><span>Customer</span><span>${escapeHtml(
              [order.customerName, order.customerPhone].filter(Boolean).join(' · '),
            )}</span></div>`
          : ''
      }
      ${
        order.type === 'delivery' && order.customerAddress
          ? `<div><span>Address</span><span>${escapeHtml(order.customerAddress)}</span></div>`
          : ''
      }
      ${
        order.deliveryBoyName
          ? `<div><span>Rider</span><span>${escapeHtml(order.deliveryBoyName)}</span></div>`
          : ''
      }
      ${order.waiterName ? `<div><span>Waiter</span><span>${escapeHtml(order.waiterName)}</span></div>` : ''}
    </div>

    <hr />

    <table>
      <thead>
        <tr>
          <th class="item">Item</th>
          <th class="qty">Qty</th>
          <th class="amount">Price</th>
          <th class="amount">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <div><span>Subtotal</span><span>${formatAmount(order.subtotal)}</span></div>
      ${order.discount > 0 ? `<div><span>Discount</span><span>-${formatAmount(order.discount)}</span></div>` : ''}
      ${order.tax > 0 ? `<div><span>Tax (${order.taxPercent}%)</span><span>${formatAmount(order.tax)}</span></div>` : ''}
      <div class="grand"><span>Grand total</span><span>${shop.currency} ${formatAmount(order.total)}</span></div>
    </div>

    ${order.notes ? `<hr /><div class="muted">Note: ${escapeHtml(order.notes)}</div>` : ''}

    <div class="footer">
      <div>Thank you for visiting!</div>
      <div class="muted">${formatDateTime(order.createdAt)}</div>
    </div>
  </body>
</html>`;
}

const PAYMENT_METHOD_TEXT: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  jazzcash: 'JazzCash',
  easypaisa: 'Easypaisa',
  bank_transfer: 'Bank',
  credit: 'Udhaar',
};

/**
 * Printable X (open shift) / Z (closed shift) report (feature 3.B).
 * Same look as the invoice so one thermal printer serves both.
 */
/**
 * Kitchen order ticket (feature 3.D).
 *
 * Two rules make this different from an invoice:
 *   1. **No prices anywhere.** The kitchen works from quantities, and a ticket
 *      lying on a counter should not advertise the bill.
 *   2. **Large type.** It is read from a distance, in a hurry, often in steam.
 * A reprint says so, so nobody cooks the same order twice by accident.
 */
export function renderKotHtml(kot: KOT, shopName: string): string {
  const isReprint = kot.printCount > 0;

  const rows = kot.items
    .map(
      (item) => `
        <tr>
          <td class="qty">${item.qty}</td>
          <td class="item">
            ${escapeHtml(item.name)}
            ${item.notes ? `<div class="note">>> ${escapeHtml(item.notes)}</div>` : ''}
          </td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>KOT ${escapeHtml(kot.orderNo)}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; color: #111;
         margin: 0; width: 76mm; }
  .center { text-align: center; }
  .token { font-size: 42px; font-weight: 700; line-height: 1; margin: 2px 0; }
  .token-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; }
  .type { font-size: 15px; font-weight: 700; text-transform: uppercase; }
  .reprint { border: 2px solid #111; font-weight: 700; text-align: center; padding: 2px;
             margin: 4px 0; text-transform: uppercase; }
  hr { border: none; border-top: 1px dashed #111; margin: 5px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 10px; text-align: left; text-transform: uppercase; border-bottom: 1px solid #111; }
  td { padding: 3px 0; vertical-align: top; }
  .qty { width: 16%; text-align: center; font-size: 20px; font-weight: 700; }
  .item { width: 84%; font-size: 14px; }
  .note { font-size: 10px; font-style: italic; }
  .meta { font-size: 10px; }
  .meta div { display: flex; justify-content: space-between; }
  .order-note { border: 1px solid #111; padding: 3px; margin-top: 6px; font-size: 11px; }
  .foot { margin-top: 6px; text-align: center; font-size: 9px; }
</style>
</head>
<body>
  <div class="center">
    <div class="token-label">Token</div>
    <div class="token">${kot.tokenNo ?? '&mdash;'}</div>
  </div>

  <hr />

  <div class="center type">${ORDER_TYPE_TEXT[kot.type] ?? kot.type}</div>
  ${isReprint ? '<div class="reprint">Reprint &mdash; do not cook twice</div>' : ''}

  <div class="meta">
    <div><span>Order</span><span>${escapeHtml(kot.orderNo)}</span></div>
    <div><span>Time</span><span>${escapeHtml(kot.createdAt)}</span></div>
    ${kot.waiterName ? `<div><span>Waiter</span><span>${escapeHtml(kot.waiterName)}</span></div>` : ''}
    ${kot.customerName ? `<div><span>Name</span><span>${escapeHtml(kot.customerName)}</span></div>` : ''}
  </div>

  <hr />

  <table>
    <thead><tr><th class="qty">Qty</th><th>Item</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${kot.notes ? `<div class="order-note">Note: ${escapeHtml(kot.notes)}</div>` : ''}

  <div class="foot">${escapeHtml(shopName)}</div>
</body>
</html>`;
}

export function renderShiftReportHtml(data: ShiftReport, paper: PaperSize): string {
  const isThermal = paper === '80mm';
  const { shift } = data;
  const isZ = shift.status === 'closed';

  const methodRows = data.salesByMethod
    .map(
      (row) => `<tr>
        <td>${escapeHtml(PAYMENT_METHOD_TEXT[row.method] ?? row.method)}</td>
        <td class="right">${row.count}</td>
        <td class="right">${formatAmount(row.total)}</td>
      </tr>`,
    )
    .join('');

  const topRows = data.topItems
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.name)}</td>
        <td class="right">${item.qty}</td>
      </tr>`,
    )
    .join('');

  const cashLine = (label: string, value: number, sign = '') =>
    `<tr><td>${label}</td><td class="right">${sign}${formatAmount(value)}</td></tr>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${isZ ? 'Z' : 'X'} report</title>
<style>
  @page { size: ${isThermal ? '80mm auto' : 'A4'}; margin: ${isThermal ? '3mm' : '12mm'}; }
  body { font-family: 'Courier New', monospace; font-size: ${isThermal ? '11px' : '12px'};
         color: #111; margin: 0; }
  h1 { font-size: ${isThermal ? '14px' : '18px'}; text-align: center; margin: 0 0 2px; }
  .center { text-align: center; }
  .muted { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  td, th { padding: 1px 0; vertical-align: top; }
  th { text-align: left; font-size: ${isThermal ? '10px' : '11px'}; border-bottom: 1px dashed #999; }
  .right { text-align: right; }
  .total { font-weight: bold; border-top: 1px solid #111; }
  hr { border: 0; border-top: 1px dashed #999; margin: 5px 0; }
</style>
</head>
<body>
  <h1>${isZ ? 'Z Report (day close)' : 'X Report (mid day)'}</h1>
  <p class="center muted">Gul Khan Fast Food</p>
  <hr />
  <table>
    <tr><td>Shift</td><td class="right">#${shift.id}</td></tr>
    <tr><td>Terminal</td><td class="right">${escapeHtml(shift.terminal)}</td></tr>
    <tr><td>Opened by</td><td class="right">${escapeHtml(shift.openedByName)}</td></tr>
    <tr><td>Opened</td><td class="right">${formatDateTime(shift.openedAt)}</td></tr>
    <tr><td>Closed</td><td class="right">${
      shift.closedAt ? formatDateTime(shift.closedAt) : 'still open'
    }</td></tr>
  </table>

  <hr />
  <h2 style="font-size:${isThermal ? '12px' : '14px'};margin:0">Sales by method</h2>
  <table>
    <tr><th>Method</th><th class="right">Count</th><th class="right">Amount</th></tr>
    ${methodRows || '<tr><td colspan="3" class="muted">No payments in this shift</td></tr>'}
    <tr class="total"><td>Total collected</td><td class="right">${data.orderCount}</td>
      <td class="right">${formatAmount(data.totalSales)}</td></tr>
  </table>

  <hr />
  <h2 style="font-size:${isThermal ? '12px' : '14px'};margin:0">Cash drawer</h2>
  <table>
    ${cashLine('Opening float', shift.openingCash)}
    ${cashLine('Cash sales', data.cashSales)}
    ${cashLine('Cash in', data.cashIn, '+')}
    ${cashLine('Cash out', data.cashOut, '-')}
    ${cashLine('Refunds', data.refunds, '-')}
    ${cashLine('Expenses', data.expenses, '-')}
    <tr class="total"><td>Expected cash</td><td class="right">${formatAmount(
      data.expectedCash,
    )}</td></tr>
    ${
      shift.countedCash !== null
        ? `<tr><td>Counted cash</td><td class="right">${formatAmount(shift.countedCash)}</td></tr>`
        : ''
    }
    ${
      shift.difference !== null
        ? `<tr class="total"><td>Difference</td><td class="right">${
            shift.difference < 0 ? '-' : ''
          }${formatAmount(Math.abs(shift.difference))}</td></tr>`
        : ''
    }
  </table>

  <hr />
  <table>
    <tr><td>Discount given</td><td class="right">${formatAmount(data.discountTotal)}</td></tr>
    <tr><td>Cancelled orders</td><td class="right">${data.cancelledCount}</td></tr>
    <tr><td>Cancelled value</td><td class="right">${formatAmount(data.cancelledValue)}</td></tr>
  </table>

  ${
    topRows
      ? `<hr />
  <h2 style="font-size:${isThermal ? '12px' : '14px'};margin:0">Top items</h2>
  <table>
    <tr><th>Item</th><th class="right">Qty</th></tr>
    ${topRows}
  </table>`
      : ''
  }

  <hr />
  <p class="center muted">Printed ${formatDate(toSqlDate())} · Gul Khan Fast Food</p>
</body>
</html>`;
}

/** Prints the shift report through a hidden window, like the invoice. */
export interface PrintServiceDeps {
  /** Returns the window that should host the print job (the app window). */
  getWindow: () => BrowserWindow | null;
  /** Where PDF files are written when the user chooses "save as PDF". */
  pdfDirectory: () => string;
  /** Record that the invoice was printed (sets invoices.printed_at). */
  markPrinted: (orderId: number) => void;
  /**
   * Whether to print without the system dialog. Read at print time, not at startup,
   * so the owner can change it in Settings and see the effect immediately.
   */
  silentPrinting: () => boolean;
}

export function createPrintService(deps: PrintServiceDeps) {
  /** Shared hidden-window helper: load HTML, run the task, always destroy the window. */
  async function withHtmlWindow<T>(
    html: string,
    paper: PaperSize,
    task: (window: BrowserWindow) => Promise<T>,
  ): Promise<T> {
    const { BrowserWindow: ElectronWindow } = await import('electron');

    const printWindow = new ElectronWindow({
      show: false,
      width: paper === '80mm' ? 360 : 900,
      height: 900,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });

    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return await task(printWindow);
    } finally {
      printWindow.destroy();
    }
  }

  /**
   * Print options shared by every slip. `silent` comes from the shop setting: a
   * busy counter should not see the system dialog on every sale, but a shop that
   * changes printers likes having it. When silent, a failure is reported through
   * the boolean the caller already handles — the cashier never sees a dialog.
   */
  function printOptions(paper: PaperSize) {
    return {
      silent: deps.silentPrinting(),
      printBackground: true,
      margins: { marginType: 'none' as const },
      pageSize: paper === '80mm' ? { width: 80_000, height: 297_000 } : ('A4' as const),
    };
  }

  async function withInvoiceWindow<T>(
    data: InvoiceData,
    paper: PaperSize,
    task: (window: BrowserWindow) => Promise<T>,
  ): Promise<T> {
    return withHtmlWindow(renderInvoiceHtml(data, paper), paper, task);
  }

  /** Opens a hidden window with the X/Z report HTML and closes it afterwards. */
  async function withReportWindow<T>(
    data: ShiftReport,
    paper: PaperSize,
    task: (printWindow: BrowserWindow) => Promise<T>,
  ): Promise<T> {
    return withHtmlWindow(renderShiftReportHtml(data, paper), paper, task);
  }

  return {
    async printInvoice(orderId: number, data: InvoiceData, paper: PaperSize): Promise<boolean> {
      try {
        return await withInvoiceWindow(data, paper, async (printWindow) => {
          const printed = await new Promise<boolean>((resolve) => {
            printWindow.webContents.print(
              printOptions(paper),
              (success) => resolve(success),
            );
          });

          if (printed) deps.markPrinted(orderId);
          return printed;
        });
      } catch (error) {
        logError('Printing the invoice failed', error);
        throw new AppError('PRINT_ERROR', 'The invoice could not be printed. Check the printer.');
      }
    },

    /**
     * Prints a kitchen ticket on the thermal roll, without a prices column.
     * Which printer receives it is decided by the Windows default printer, so a
     * shop with a separate kitchen printer sets that one as default.
     */
    async printKot(kot: KOT, shopName: string): Promise<boolean> {
      try {
        return await withHtmlWindow(renderKotHtml(kot, shopName), '80mm', async (printWindow) => {
          const printed = await new Promise<boolean>((resolve) => {
            printWindow.webContents.print(
              printOptions('80mm'),
              (success) => resolve(success),
            );
          });
          return printed;
        });
      } catch (error) {
        logError('Printing the kitchen ticket failed', error);
        throw new AppError('PRINT_ERROR', 'The kitchen ticket could not be printed.');
      }
    },

    /** Prints an X/Z report through the same hidden-window pattern as invoices. */
    async printShiftReport(data: ShiftReport, paper: PaperSize): Promise<boolean> {
      try {
        return await withReportWindow(data, paper, async (printWindow) => {
          const printed = await new Promise<boolean>((resolve) => {
            printWindow.webContents.print(
              printOptions(paper),
              (success) => resolve(success),
            );
          });
          return printed;
        });
      } catch (error) {
        logError('Printing the shift report failed', error);
        throw new AppError('PRINT_ERROR', 'The report could not be printed. Check the printer.');
      }
    },

    async savePdf(orderId: number, data: InvoiceData, paper: PaperSize): Promise<string | null> {
      const { dialog } = await import('electron');
      const defaultName = `${data.order.invoiceNo ?? data.order.orderNo}-${toSqlDate()}.pdf`;

      const result = await dialog.showSaveDialog({
        title: 'Save invoice as PDF',
        defaultPath: `${deps.pdfDirectory()}/${defaultName}`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (result.canceled || !result.filePath) return null;

      try {
        const buffer = await withInvoiceWindow(data, paper, (printWindow) =>
          printWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: paper === '80mm' ? { width: 80_000, height: 297_000 } : 'A4',
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
          }),
        );

        writeFileSync(result.filePath, buffer);
        deps.markPrinted(orderId);
        logInfo(`Invoice PDF saved: ${result.filePath}`);
        return result.filePath;
      } catch (error) {
        logError('Saving the invoice PDF failed', error);
        throw new AppError('PRINT_ERROR', 'The PDF could not be saved. Try another folder.');
      }
    },

    /** Used by the invoice preview in the renderer. */
    renderHtml: renderInvoiceHtml,
    /** Renderers use this for an on-screen kitchen ticket preview. */
    renderKotHtml,
  };
}

export type PrintService = ReturnType<typeof createPrintService>;
