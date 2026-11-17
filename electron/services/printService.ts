import type { BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import type { InvoiceData } from '../../src/types/api';
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
      <div><span>Date</span><span>${formatDate(order.createdAt)}</span></div>
      <div><span>Time</span><span>${formatDateTime(order.createdAt).split(', ')[1] ?? ''}</span></div>
      <div><span>Cashier</span><span>${escapeHtml(cashierName)}</span></div>
      <div><span>Type</span><span>${ORDER_TYPE_TEXT[order.type] ?? order.type}</span></div>
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

export interface PrintServiceDeps {
  /** Returns the window that should host the print job (the app window). */
  getWindow: () => BrowserWindow | null;
  /** Where PDF files are written when the user chooses "save as PDF". */
  pdfDirectory: () => string;
  /** Record that the invoice was printed (sets invoices.printed_at). */
  markPrinted: (orderId: number) => void;
}

export function createPrintService(deps: PrintServiceDeps) {
  async function withInvoiceWindow<T>(
    data: InvoiceData,
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
      const html = renderInvoiceHtml(data, paper);
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return await task(printWindow);
    } finally {
      printWindow.destroy();
    }
  }

  return {
    async printInvoice(orderId: number, data: InvoiceData, paper: PaperSize): Promise<boolean> {
      try {
        return await withInvoiceWindow(data, paper, async (printWindow) => {
          const printed = await new Promise<boolean>((resolve) => {
            printWindow.webContents.print(
              {
                silent: false,
                printBackground: true,
                margins: { marginType: 'none' },
                pageSize: paper === '80mm' ? { width: 80_000, height: 297_000 } : 'A4',
              },
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
  };
}

export type PrintService = ReturnType<typeof createPrintService>;
