import type { BaseUnit } from '../types/api';

/**
 * Display helpers for stock quantities and unit costs.
 *
 * Quantities arrive as whole base units (g / ml / pcs) and unit costs as
 * MILLI-PAISA per base unit (paisa × 1000). Nothing here takes part in a
 * calculation that is written back — the main process owns every number.
 */

export const BASE_UNIT_LABELS: Record<BaseUnit, string> = {
  g: 'gram',
  ml: 'ml',
  pcs: 'piece',
};

export const BASE_UNIT_SHORT: Record<BaseUnit, string> = {
  g: 'g',
  ml: 'ml',
  pcs: 'pcs',
};

const PAISA_PER_RUPEE = 100;

/**
 * 2500 g → "2.5 kg" when the ingredient is bought by the kg; otherwise the base
 * unit is shown. Keeps the stock page readable for a shopkeeper.
 */
export function formatQuantity(
  qtyBase: number,
  baseUnit: BaseUnit,
  purchaseUnit = '',
  unitsPerPurchase = 0,
): string {
  const unit = purchaseUnit.trim().toLowerCase();
  const bigUnitMatches =
    (baseUnit === 'g' && (unit === 'kg' || unit === 'kilogram')) ||
    (baseUnit === 'ml' && (unit === 'l' || unit === 'litre' || unit === 'liter'));

  if (bigUnitMatches && unitsPerPurchase >= 100) {
    const value = qtyBase / unitsPerPurchase;
    const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
    return `${text} ${purchaseUnit}`;
  }

  return `${qtyBase.toLocaleString()} ${BASE_UNIT_SHORT[baseUnit]}`;
}

/** milli-paisa per base unit → "Rs 0.70 / g", the way a shopkeeper reads a price. */
export function formatUnitCost(unitCostMilli: number, baseUnit: BaseUnit): string {
  const rupees = unitCostMilli / 1000 / PAISA_PER_RUPEE;
  const decimals = rupees >= 10 ? 2 : rupees >= 1 ? 2 : 3;
  const text = rupees.toFixed(decimals);
  return `Rs ${text} / ${BASE_UNIT_SHORT[baseUnit]}`;
}

/** Rupees typed by a person ("710", "12.5") → integer paisa. Null when invalid. */
export function parseRupees(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (cleaned === '' || !/^-?\d*\.?\d{0,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * PAISA_PER_RUPEE);
}

/**
 * A purchase quantity typed in purchase units ("2.5" kg) → milli-units (2500).
 * Three decimals are allowed so 250 g can be typed as "0.25".
 */
export function parsePurchaseQty(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (cleaned === '' || !/^\d*\.?\d{0,3}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000);
}

/** 2500 → "2.5" for an input box. */
export function purchaseQtyToInput(qtyPurchaseMilli: number): string {
  return (qtyPurchaseMilli / 1000).toString();
}
