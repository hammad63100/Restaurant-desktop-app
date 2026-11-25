import type { StarterCatalogueGroup } from '../../src/types/api';

/**
 * The standard fast-food stock list.
 *
 * The owner does not have to know what to type. He opens the starter list, ticks
 * what his kitchen actually uses, and the app creates exactly those ingredients —
 * with a sensible base unit and purchase unit already filled in. Nothing is
 * forced and nothing is created until he presses the button.
 *
 * `unitsPerPurchase` is the conversion from the purchase unit to the base unit:
 * 1 kg = 1000 g, 1 litre = 1000 ml, 1 dozen = 12 pcs, 1 tray = 30 eggs.
 * `reorderLevel` is a starting low-stock hint (one purchase unit's worth by
 * default); the owner can change every value afterwards.
 */
export const STARTER_CATALOGUE: StarterCatalogueGroup[] = [
  {
    category: 'Chicken & meat',
    items: [
      { name: 'Chicken fillet (breast)', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 3000 },
      { name: 'Chicken boneless', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 3000 },
      { name: 'Chicken with bone', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 3000 },
      { name: 'Chicken wings', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Chicken leg piece', baseUnit: 'pcs', purchaseUnit: 'dozen', unitsPerPurchase: 12, reorderLevel: 12 },
      { name: 'Chicken nuggets', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 20, reorderLevel: 20 },
      { name: 'Chicken patty', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 10, reorderLevel: 10 },
      { name: 'Chicken sausage', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 10, reorderLevel: 10 },
      { name: 'Beef mince', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
    ],
  },
  {
    category: 'Bread & dough',
    items: [
      { name: 'Burger bun', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 6, reorderLevel: 24 },
      { name: 'Zinger bun', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 6, reorderLevel: 24 },
      { name: 'Pizza base', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 6, reorderLevel: 12 },
      { name: 'Paratha', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 10, reorderLevel: 20 },
      { name: 'Tortilla / wrap', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 10, reorderLevel: 20 },
      { name: 'Bread slice', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 20, reorderLevel: 20 },
      { name: 'Hot dog bun', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 6, reorderLevel: 12 },
    ],
  },
  {
    category: 'Sauces',
    items: [
      { name: 'Mayonnaise', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Ketchup', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Chilli garlic sauce', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Hot sauce', baseUnit: 'ml', purchaseUnit: 'bottle', unitsPerPurchase: 300, reorderLevel: 600 },
      { name: 'BBQ sauce', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Pizza sauce', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Mustard sauce', baseUnit: 'g', purchaseUnit: 'bottle', unitsPerPurchase: 250, reorderLevel: 250 },
      { name: 'Garlic dip sachet', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 200 },
      { name: 'Chilli sachet', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 200 },
    ],
  },
  {
    category: 'Dairy',
    items: [
      { name: 'Cheese slice', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 12, reorderLevel: 24 },
      { name: 'Mozzarella cheese', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Cream', baseUnit: 'ml', purchaseUnit: 'litre', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Butter', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 500 },
      { name: 'Milk', baseUnit: 'ml', purchaseUnit: 'litre', unitsPerPurchase: 1000, reorderLevel: 3000 },
    ],
  },
  {
    category: 'Vegetables',
    items: [
      { name: 'Lettuce', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Tomato', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Onion', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Cucumber', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Jalapeño', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 500 },
      { name: 'Pickles', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 500 },
      { name: 'Capsicum', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Cabbage', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Green chilli', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 250 },
      { name: 'Mushroom', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 500 },
    ],
  },
  {
    category: 'Potato & sides',
    items: [
      { name: 'Frozen fries', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 5000 },
      { name: 'Potato', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 5000 },
      { name: 'Coleslaw mix', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Onion rings (frozen)', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Nugget / fries masala', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 250 },
    ],
  },
  {
    category: 'Coating & dry goods',
    items: [
      { name: 'Flour (maida)', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 5000 },
      { name: 'Breadcrumbs', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Zinger coating mix', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Corn flour', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Rice', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
      { name: 'Salt', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Sugar', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Black pepper', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 250 },
      { name: 'Red chilli powder', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 500 },
      { name: 'Baking powder', baseUnit: 'g', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 200 },
    ],
  },
  {
    category: 'Eggs',
    items: [{ name: 'Egg', baseUnit: 'pcs', purchaseUnit: 'tray', unitsPerPurchase: 30, reorderLevel: 30 }],
  },
  {
    category: 'Oil & fuel',
    items: [
      { name: 'Cooking oil', baseUnit: 'ml', purchaseUnit: 'litre', unitsPerPurchase: 1000, reorderLevel: 5000 },
      // A cylinder is counted in pieces; the kg on it is a fill size, not a stock unit.
      { name: 'Gas cylinder', baseUnit: 'pcs', purchaseUnit: 'cylinder', unitsPerPurchase: 1, reorderLevel: 1 },
    ],
  },
  {
    category: 'Drinks',
    items: [
      { name: 'Cola can 250 ml', baseUnit: 'pcs', purchaseUnit: 'carton', unitsPerPurchase: 24, reorderLevel: 24 },
      { name: 'Cola bottle 500 ml', baseUnit: 'pcs', purchaseUnit: 'carton', unitsPerPurchase: 12, reorderLevel: 12 },
      { name: 'Cola bottle 1.5 litre', baseUnit: 'pcs', purchaseUnit: 'carton', unitsPerPurchase: 6, reorderLevel: 6 },
      { name: 'Mineral water bottle', baseUnit: 'pcs', purchaseUnit: 'carton', unitsPerPurchase: 12, reorderLevel: 24 },
      { name: 'Juice tetra pack', baseUnit: 'pcs', purchaseUnit: 'carton', unitsPerPurchase: 12, reorderLevel: 12 },
      { name: 'Ice', baseUnit: 'g', purchaseUnit: 'kg', unitsPerPurchase: 1000, reorderLevel: 2000 },
    ],
  },
  {
    category: 'Packaging',
    items: [
      { name: 'Burger box', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 200 },
      { name: 'Fries pouch', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 200 },
      { name: 'Pizza box', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 50, reorderLevel: 50 },
      { name: 'Nugget box', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 100 },
      { name: 'Wrap paper', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 200 },
      { name: 'Shopping bag', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 50, reorderLevel: 100 },
      { name: 'Paper cup', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 50, reorderLevel: 100 },
      { name: 'Cup lid', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 50, reorderLevel: 100 },
      { name: 'Straw', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 200 },
      { name: 'Tissue paper', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 200 },
      { name: 'Aluminium foil', baseUnit: 'g', purchaseUnit: 'roll', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Kitchen roll', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 6, reorderLevel: 6 },
    ],
  },
  {
    category: 'Cleaning',
    items: [
      { name: 'Hand gloves', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 100, reorderLevel: 100 },
      { name: 'Cleaning liquid', baseUnit: 'ml', purchaseUnit: 'bottle', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Dish washing soap', baseUnit: 'ml', purchaseUnit: 'bottle', unitsPerPurchase: 1000, reorderLevel: 1000 },
      { name: 'Garbage bag', baseUnit: 'pcs', purchaseUnit: 'packet', unitsPerPurchase: 50, reorderLevel: 100 },
    ],
  },
];

/** Flat view of the catalogue, used when the owner ticks individual names. */
export function flattenStarterCatalogue(): Array<{
  name: string;
  category: string;
  baseUnit: 'g' | 'ml' | 'pcs';
  purchaseUnit: string;
  unitsPerPurchase: number;
  reorderLevel: number;
}> {
  return STARTER_CATALOGUE.flatMap((group) =>
    group.items.map((item) => ({ ...item, category: group.category })),
  );
}
