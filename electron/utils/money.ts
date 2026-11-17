/**
 * Money helpers. The database stores integer paisa only (1 rupee = 100 paisa),
 * so every calculation here rounds explicitly instead of drifting on floats.
 */

export const PAISA_PER_RUPEE = 100;

/** Rounds a raw number to whole paisa. Used once, at the boundary, on every amount. */
export function toPaisa(value: number): number {
  return Math.round(value);
}

/** Percentage of an integer amount, rounded to the nearest paisa. */
export function percentOf(amount: number, percent: number): number {
  return Math.round((amount * percent) / 100);
}

/** Formats integer paisa as a readable amount, e.g. 125050 -> "1,250.50". */
export function formatAmount(paisa: number): string {
  const negative = paisa < 0;
  const absolute = Math.abs(Math.round(paisa));
  const rupees = Math.floor(absolute / PAISA_PER_RUPEE);
  const fraction = String(absolute % PAISA_PER_RUPEE).padStart(2, '0');
  const grouped = rupees.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}
