/**
 * Display helpers. Money always arrives from the main process as integer paisa,
 * so these helpers never take part in calculations — only in rendering/parsing.
 */

export const PAISA_PER_RUPEE = 100;

/** 125050 -> "1,250.50" */
export function formatAmount(paisa: number): string {
  const negative = paisa < 0;
  const absolute = Math.abs(Math.round(paisa));
  const rupees = Math.floor(absolute / PAISA_PER_RUPEE);
  const fraction = String(absolute % PAISA_PER_RUPEE).padStart(2, '0');
  const grouped = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

/** 1250 -> "Rs 1,250.00" (currency label comes from settings). */
export function formatCurrency(paisa: number, currency = 'PKR'): string {
  return `${currency} ${formatAmount(paisa)}`;
}

/**
 * Parses typed rupees ("1250.5", "1,250", "12,50.75") into integer paisa.
 * Returns null when the text is not a valid amount.
 */
export function parseAmountToPaisa(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (cleaned === '' || !/^-?\d*\.?\d{0,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * PAISA_PER_RUPEE);
}

/** Converts integer paisa to a plain editable string: 125050 -> "1250.50". */
export function paisaToInput(paisa: number): string {
  return (paisa / PAISA_PER_RUPEE).toFixed(2);
}

/** "YYYY-MM-DD HH:mm:ss" -> "16 Nov 2026, 7:45 PM" */
export function formatDateTime(value: string): string {
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "YYYY-MM-DD" -> "16 Nov 2026" */
export function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** "2026-11" -> "November 2026" */
export function formatMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function currentMonth(): string {
  return todayIso().slice(0, 7);
}

/** Start of the current month as `YYYY-MM-DD`. */
export function monthStartIso(month = currentMonth()): string {
  return `${month}-01`;
}

/**
 * Last day of the month as `YYYY-MM-DD`. Computed, not assumed to be 31, so
 * February and 30-day months are correct.
 */
export function monthEndIso(month = currentMonth()): string {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
