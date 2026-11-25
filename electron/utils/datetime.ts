const pad = (value: number): string => String(value).padStart(2, '0');

/** Formats a date as the app-wide SQLite format: `YYYY-MM-DD HH:mm:ss` (local time). */
export function toSqlDateTime(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** `YYYY-MM-DD` for a given date (local time). */
export function toSqlDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todaySqlDate(): string {
  return toSqlDate();
}

/** First day of the month for `YYYY-MM` (`2026-11` -> `2026-11-01`). */
export function monthStart(month: string): string {
  return `${month}-01`;
}

/** Last day of the month for `YYYY-MM`, handling leap years. */
export function monthEnd(month: string): string {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return `${month}-${pad(lastDay)}`;
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** Inclusive number of days between two `YYYY-MM-DD` values. */
export function daysInRange(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return diff + 1;
}

/** Days between today and a `YYYY-MM-DD` date; negative when already expired. */
export function daysUntil(dateText: string, from: Date = new Date()): number {
  const target = new Date(`${dateText}T00:00:00`);
  const start = new Date(`${toSqlDate(from)}T00:00:00`);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function isValidDateText(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
  );
}

export function isValidMonthText(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

/** Adds `months` months to a `YYYY-MM` value. */
export function addMonths(month: string, months: number): string {
  const [yearText, monthText] = month.split('-');
  const date = new Date(Number(yearText), Number(monthText) - 1 + months, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-16 19:45:00` -> `16 Nov 2026` (used on invoices, so it must be stable). */
export function formatDate(value: string): string {
  const [datePart] = value.split(' ');
  const [year, month, day] = (datePart ?? '').split('-');
  if (!year || !month || !day) return value;
  return `${day} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/** `2026-11-16 19:45:00` -> `16 Nov 2026, 7:45 PM` */
export function formatDateTime(value: string): string {
  const timePart = value.split(' ')[1];
  if (!timePart) return formatDate(value);

  const [hourText = '0', minuteText = '00'] = timePart.split(':');
  const hour24 = Number(hourText);
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return `${formatDate(value)}, ${hour12}:${minuteText} ${suffix}`;
}

/** Current timestamp in the `YYYY-MM-DD HH:mm:ss` format, for file names. */
export function nowForFileName(): string {
  return toSqlDateTime().replace(/[: ]/g, '-');
}
