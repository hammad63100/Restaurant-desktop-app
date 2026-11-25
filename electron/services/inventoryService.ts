import type {
  AdjustmentInput,
  CountLineInput,
  Ingredient,
  IngredientDetail,
  IngredientInput,
  LoadStarterListResult,
  NewPurchaseInput,
  OpeningStockInput,
  Purchase,
  StarterCatalogueGroup,
  StockMovement,
  StockOverview,
  StockCount,
  StockCountDetail,
  StockCountInput,
  Supplier,
  SupplierInput,
  SupplierReturnInput,
  WastageInput,
  WastageOverview,
} from '../../src/types/api';
import type { InventoryRepository } from '../db/repositories/inventoryRepository';
import { nextAverageCost } from '../db/repositories/inventoryRepository';
import type { ShiftsRepository } from '../db/repositories/shiftsRepository';
import type { StockOpsRepository } from '../db/repositories/stockOpsRepository';
import { toSqlDate } from '../utils/datetime';
import { AppError } from '../utils/errors';
import { flattenStarterCatalogue, STARTER_CATALOGUE } from './starterCatalogue';
import { logInfo } from './logger';

/**
 * Stock, suppliers and purchases (Roadmap 4.A / 4.B).
 *
 * Every quantity that leaves or enters the shelf goes through
 * `inventory.applyMovement`, inside one transaction. Nothing here writes
 * `qty_on_hand` directly except `setIngredientTotals`, which is only used by the
 * opening-stock path after the movements have been written.
 */
/** The ledger's `reason` when the owner does not type anything. */
const WASTAGE_TEXT: Record<string, string> = {
  spoiled: 'Spoiled',
  dropped: 'Dropped or spilled',
  expired: 'Expired',
  staff_meal: 'Staff meal',
  test: 'Test batch',
  other: 'Wastage',
};

export function createInventoryService(deps: {
  inventory: InventoryRepository;
  shifts: ShiftsRepository;
  /** Counts and the wastage report (4.F). Optional so an older harness still works. */
  stockOps?: StockOpsRepository;
}) {
  const { inventory, shifts, stockOps } = deps;

  function ingredientOrFail(id: number): Ingredient {
    const ingredient = inventory.findIngredient(id);
    if (!ingredient) throw new AppError('NOT_FOUND', 'That ingredient does not exist');
    return ingredient;
  }

  function supplierOrFail(id: number): Supplier {
    const supplier = inventory.findSupplier(id);
    if (!supplier) throw new AppError('NOT_FOUND', 'That supplier does not exist');
    return supplier;
  }

  /**
   * Puts a purchase's money into the cash drawer when it was paid from it and a
   * shift is open. Without a shift there is nothing to reconcile, so nothing is
   * written — the day-close report must never absorb money from a shift that was
   * already closed.
   */
  function recordDrawerOutflow(input: {
    amount: number;
    reason: string;
    purchaseId: number;
    createdBy: number;
  }): void {
    if (input.amount <= 0) return;
    const shift = shifts.current();
    if (!shift) return;

    shifts.addMovement({
      shiftId: shift.id,
      kind: 'expense',
      amount: input.amount,
      reason: input.reason,
      refOrderId: null,
      refPurchaseId: input.purchaseId,
      createdBy: input.createdBy,
    });
  }

  return {
    /* ---------------------------- stock levels ---------------------------- */

    overview(): StockOverview {
      const ingredients = inventory.listIngredients();
      return {
        ingredients,
        totalValue: inventory.stockValueTotal(),
        lowStockCount: inventory.lowStockCount(),
        outOfStockCount: inventory.outOfStockCount(),
        ingredientCount: ingredients.length,
      };
    },

    ingredients(): Ingredient[] {
      return inventory.listIngredients();
    },

    ingredient(id: number): IngredientDetail {
      const ingredient = ingredientOrFail(id);
      return {
        ingredient,
        movements: inventory.movementsFor(id, 100),
        priceHistory: inventory.priceHistory(id),
        usedInItems: inventory.usedInItems(id),
      };
    },

    /* --------------------------- ingredients CRUD -------------------------- */

    saveIngredient(input: IngredientInput): Ingredient {
      const name = input.name.trim();

      // Uniqueness is case-insensitive (see migration 015); checking here gives a
      // friendly message instead of a raw UNIQUE constraint error.
      const clash = inventory.findIngredientByName(name);
      if (clash && clash.id !== input.id) {
        throw new AppError('CONFLICT', `"${name}" is already in your stock list`);
      }

      if (input.supplierId !== null) supplierOrFail(input.supplierId);

      if (input.id) {
        const existing = ingredientOrFail(input.id);

        // Changing the base unit of an ingredient that already has stock would
        // silently reinterpret every stored quantity. Refuse it and ask for a new
        // ingredient instead — honest, and no data is ever guessed at.
        if (existing.qtyOnHand !== 0 && existing.baseUnit !== input.baseUnit) {
          throw new AppError(
            'CONFLICT',
            `${existing.name} already has stock. Its unit cannot be changed — create a new ingredient instead.`,
          );
        }

        inventory.updateIngredient({ ...input, id: input.id, name });
        logInfo(`Ingredient updated: ${name}`);
        return ingredientOrFail(input.id);
      }

      const id = inventory.createIngredient({ ...input, name });
      logInfo(`Ingredient created: ${name}`);
      return ingredientOrFail(id);
    },

    /** Soft delete. Refused while a recipe uses it (wastage history stays readable). */
    deleteIngredient(id: number): void {
      const ingredient = ingredientOrFail(id);

      if (ingredient.usedInRecipes > 0) {
        throw new AppError(
          'CONFLICT',
          `${ingredient.name} is used in ${ingredient.usedInRecipes} recipe(s). Remove it from the recipes first.`,
        );
      }

      inventory.deactivateIngredient(id);
      logInfo(`Ingredient deactivated: ${ingredient.name}`);
    },

    /* --------------------------- starter catalogue ------------------------- */

    starterCatalogue(): StarterCatalogueGroup[] {
      return STARTER_CATALOGUE;
    },

    /**
     * Creates the starter ingredients the owner ticked.
     *
     * Idempotent by name: running it twice (or after adding items by hand) never
     * creates a duplicate, and the result says how many were skipped so the UI
     * can be honest about it.
     */
    loadStarterList(names: string[]): LoadStarterListResult {
      const wanted = new Set(names.map((name) => name.trim().toLowerCase()));
      const catalogue = flattenStarterCatalogue().filter((item) =>
        wanted.has(item.name.toLowerCase()),
      );

      if (catalogue.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'Tick at least one ingredient to add');
      }

      let created = 0;
      let skipped = 0;

      inventory.transaction(() => {
        for (const item of catalogue) {
          if (inventory.findIngredientByName(item.name)) {
            skipped += 1;
            continue;
          }

          inventory.createIngredient({
            name: item.name,
            category: item.category,
            baseUnit: item.baseUnit,
            purchaseUnit: item.purchaseUnit,
            unitsPerPurchase: item.unitsPerPurchase,
            reorderLevel: item.reorderLevel,
            supplierId: null,
            active: true,
          });
          created += 1;
        }
      });

      logInfo(`Starter list loaded: ${created} created, ${skipped} already present`);
      return { created, skipped };
    },

    /* ------------------------------ suppliers ----------------------------- */

    suppliers(): Supplier[] {
      return inventory.listSuppliers();
    },

    saveSupplier(input: SupplierInput): Supplier {
      const name = input.name.trim();
      const clash = inventory
        .listSuppliers()
        .find(
          (supplier) =>
            supplier.id !== input.id && supplier.name.toLowerCase() === name.toLowerCase(),
        );

      if (clash) throw new AppError('CONFLICT', `"${name}" is already a supplier`);

      if (input.id) {
        supplierOrFail(input.id);
        inventory.updateSupplier({ ...input, id: input.id, name });
        return supplierOrFail(input.id);
      }

      const id = inventory.createSupplier({ ...input, name });
      logInfo(`Supplier created: ${name}`);
      return supplierOrFail(id);
    },

    deleteSupplier(id: number): void {
      const supplier = supplierOrFail(id);
      const using = inventory.countIngredientsForSupplier(id);

      if (using > 0) {
        throw new AppError(
          'CONFLICT',
          `${using} ingredient(s) still prefer ${supplier.name}. Change them first.`,
        );
      }

      inventory.deactivateSupplier(id);
      logInfo(`Supplier deactivated: ${supplier.name}`);
    },

    /* ------------------------------ purchases ----------------------------- */

    purchases(input: { fromDate: string; toDate: string; limit: number }): Purchase[] {
      return inventory.listPurchases(input.fromDate, input.toDate, input.limit);
    },

    purchase(id: number): Purchase {
      const purchase = inventory.findPurchase(id);
      if (!purchase) throw new AppError('NOT_FOUND', 'That purchase does not exist');
      return purchase;
    },

    /**
     * Saves a purchase and puts the stock on the shelf, in ONE transaction:
     * the purchase, its lines, the stock movements and the average-cost update
     * either all happen or none do.
     *
     * Landed cost: transport and other extra charges are spread over the lines by
     * value, so a bag of buns really costs what it cost to get it into the shop.
     * The average cost therefore uses the landed unit cost, not the invoice price.
     */
    createPurchase(input: NewPurchaseInput, createdBy: number): Purchase {
      if (input.lines.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'Add at least one ingredient to the purchase');
      }
      if (input.supplierId !== null) supplierOrFail(input.supplierId);

      const prepared = input.lines.map((line) => {
        const ingredient = ingredientOrFail(line.ingredientId);

        if (line.qtyPurchaseMilli <= 0) {
          throw new AppError('VALIDATION_ERROR', `Enter a quantity for ${ingredient.name}`);
        }
        if (line.unitPrice < 0) {
          throw new AppError('VALIDATION_ERROR', `Enter a price for ${ingredient.name}`);
        }

        // Quantity in base units, rounded once (2.5 kg × 1000 g/kg = 2500 g).
        const qtyBase = Math.round((line.qtyPurchaseMilli * ingredient.unitsPerPurchase) / 1000);

        if (qtyBase <= 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            `The quantity for ${ingredient.name} is too small for its unit`,
          );
        }

        /*
         * unitPrice is per PURCHASE unit in paisa. Landed cost per base unit in
         * milli-paisa = price × 1000 ÷ unitsPerPurchase.
         *
         * Integer division here rounds away the small units and the loss is real:
         * a packet of 100 buns at Rs 250 gives 2,500,000 milli (exact), but Rs 70
         * per kg of chicken gives 70,000/1000 = 70, which is fine, while Rs 1.75
         * per gram would round to 2 and overstate every recipe. Multiplying first
         * and rounding once keeps the average accurate to a thousandth of a paisa,
         * which is the precision this app trades in. A recipe costing 150 g of a
         * 70,000-milli ingredient therefore costs exactly Rs 105, never Rs 104.93.
         */
        const baseCostMilli = Math.round((line.unitPrice * 1000) / ingredient.unitsPerPurchase);

        return {
          ingredient,
          qtyPurchaseMilli: line.qtyPurchaseMilli,
          qtyBase,
          unitPrice: line.unitPrice,
          baseCostMilli,
          lineTotal: Math.round((line.qtyPurchaseMilli * line.unitPrice) / 1000),
        };
      });

      const subtotal = prepared.reduce((total, line) => total + line.lineTotal, 0);
      const extraCharges = input.extraCharges;
      const total = subtotal + extraCharges;

      if (input.paidAmount > total) {
        throw new AppError(
          'VALIDATION_ERROR',
          'The amount paid is more than the purchase total. Check the figures.',
        );
      }

      // Spread the extra charges by line value. The last line absorbs the
      // rounding remainder, so the landed costs always add up to the total.
      let allocated = 0;

      const landed = prepared.map((line, index) => {
        const isLast = index === prepared.length - 1;
        const share =
          subtotal > 0
            ? isLast
              ? extraCharges - allocated
              : Math.round((line.lineTotal * extraCharges) / subtotal)
            : 0;

        if (!isLast) allocated += share;

        const landedLineTotal = line.lineTotal + share;
        const landedCostMilli =
          line.qtyBase > 0 ? Math.round((landedLineTotal * 1000) / line.qtyBase) : 0;

        return { ...line, landedCostMilli, landedLineTotal };
      });

      const purchaseNo = inventory.nextPurchaseNo();
      let purchaseId = 0;

      inventory.transaction(() => {
        purchaseId = inventory.createPurchase({
          purchaseNo,
          supplierId: input.supplierId,
          billNo: input.billNo,
          purchasedOn: input.purchasedOn,
          subtotal,
          extraCharges,
          total,
          paidAmount: input.paidAmount,
          paymentMethod: input.paymentMethod,
          notes: input.notes,
          createdBy,
          lines: landed.map((line) => ({
            ingredientId: line.ingredient.id,
            qtyPurchaseMilli: line.qtyPurchaseMilli,
            qtyBase: line.qtyBase,
            unitPrice: line.unitPrice,
            landedCostMilli: line.landedCostMilli,
            lineTotal: line.lineTotal,
          })),
        });

        for (const line of landed) {
          inventory.applyMovement({
            ingredientId: line.ingredient.id,
            kind: 'purchase',
            qty: line.qtyBase,
            unitCostMilli: line.landedCostMilli,
            reason: `Purchase ${purchaseNo}`,
            refPurchaseId: purchaseId,
            createdBy,
          });
        }

        // Drawer link: only cash actually paid from the till reduces expected cash.
        if (input.paymentMethod === 'cash' && input.paidAmount > 0) {
          recordDrawerOutflow({
            amount: input.paidAmount,
            reason: `Purchase ${purchaseNo}`,
            purchaseId,
            createdBy,
          });
        }
      });

      logInfo(`Purchase ${purchaseNo} saved: total ${total} paisa, ${landed.length} line(s)`);
      return this.purchase(purchaseId);
    },

    /**
     * Reverses a posted purchase exactly: every line's quantity is taken back out
     * at the landed cost it came in at, and a drawer-paid purchase gives its money
     * back to the till. The row is kept and marked void.
     */
    voidPurchase(id: number, reason: string, voidedBy: number): Purchase {
      const purchase = this.purchase(id);

      if (purchase.status === 'void') {
        throw new AppError('CONFLICT', 'This purchase is already void');
      }
      if (!reason.trim()) {
        throw new AppError('VALIDATION_ERROR', 'Write why this purchase is being voided');
      }

      inventory.transaction(() => {
        // Reverse in the order they were added; the average cost is recalculated
        // by the same ledger arithmetic, so the shelf value follows honestly.
        const undo = [...purchase.lines].reverse();
        for (const line of undo) {
          inventory.applyMovement({
            ingredientId: line.ingredientId,
            kind: 'purchase_void',
            qty: -line.qtyBase,
            unitCostMilli: line.landedCostMilli,
            reason: `Void purchase ${purchase.purchaseNo}: ${reason.trim()}`,
            refPurchaseId: purchase.id,
            createdBy: voidedBy,
          });
        }

        /*
         * Giving the cash back.
         *
         * If the shift that paid is still open, the reversal goes into that same
         * shift — the cleanest case, and the day-close report nets to zero.
         *
         * If that shift is already closed, its printed numbers stay exactly as
         * they were (a closed report is never rewritten: the owner may have
         * signed the slip). The money is in today's till instead, so the reversal
         * is posted to the open shift, with a reason that names the original
         * purchase so the books still explain themselves.
         */
        const paidRow = shifts.purchaseMovement(purchase.id, 'expense');
        const alreadyReversed = shifts.purchaseMovement(purchase.id, 'cash_in');

        if (paidRow && !alreadyReversed) {
          const open = shifts.current();
          const target =
            open && open.id === paidRow.shiftId
              ? open
              : open ?? null;

          if (target) {
            const sameShift = target.id === paidRow.shiftId;
            shifts.addMovement({
              shiftId: target.id,
              kind: 'cash_in',
              amount: paidRow.amount,
              reason: sameShift
                ? `Void purchase ${purchase.purchaseNo}: ${reason.trim()}`
                : `Void purchase ${purchase.purchaseNo} (paid in an earlier shift): ${reason.trim()}`,
              refOrderId: null,
              refPurchaseId: purchase.id,
              createdBy: voidedBy,
            });
          }
        }

        inventory.markPurchaseVoid(purchase.id, reason.trim(), voidedBy);
      });

      logInfo(`Purchase ${purchase.purchaseNo} voided: ${reason.trim()}`);
      return this.purchase(id);
    },

    /**
     * Opening stock on go-live day: what is already on the shelf, at the cost the
     * owner says. Writes `opening` movements, so from then on the ledger explains
     * every gram in the shop.
     */
    openingStock(input: OpeningStockInput, createdBy: number): { applied: number } {
      const lines = input.lines.filter((line) => line.qtyBase > 0);
      if (lines.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'Enter at least one quantity');
      }

      let applied = 0;

      inventory.transaction(() => {
        for (const line of lines) {
          const ingredient = ingredientOrFail(line.ingredientId);
          if (line.unitCostMilli < 0) {
            throw new AppError(
              'VALIDATION_ERROR',
              `The cost for ${ingredient.name} cannot be negative`,
            );
          }

          inventory.applyMovement({
            ingredientId: line.ingredientId,
            kind: 'opening',
            qty: line.qtyBase,
            unitCostMilli: line.unitCostMilli,
            reason: 'Opening stock',
            createdBy,
          });
          applied += 1;
        }
      });

      logInfo(`Opening stock applied to ${applied} ingredient(s)`);
      return { applied };
    },

    movements(input: { ingredientId: number; limit: number }): StockMovement[] {
      ingredientOrFail(input.ingredientId);
      return inventory.movementsFor(input.ingredientId, input.limit);
    },

    /* ------------------- wastage, adjustments, counts (4.F) ------------------- */

    /**
     * Throws stock away and records why.
     *
     * The loss is valued at the ingredient's current average cost and written as a
     * `wastage` movement, so it leaves the shelf the same way a sale does and lands
     * in the P&L as a real cost. The quantity is taken POSITIVE from the caller and
     * negated here: "I threw away 500 g" is how a person thinks, and a sign error in
     * a wastage entry would silently add stock.
     */
    recordWastage(input: WastageInput, createdBy: number): StockMovement {
      const ingredient = ingredientOrFail(input.ingredientId);

      if (!Number.isInteger(input.qtyBase) || input.qtyBase <= 0) {
        throw new AppError('VALIDATION_ERROR', 'The quantity must be a whole number above zero');
      }
      if (input.qtyBase > ingredient.qtyOnHand) {
        throw new AppError(
          'CONFLICT',
          `Only ${ingredient.qtyOnHand} in stock, so ${input.qtyBase} cannot be wasted. Use a stock count if the shelf is wrong.`,
        );
      }

      const happenedOn = input.happenedOn || toSqlDate();
      if (happenedOn > toSqlDate()) {
        throw new AppError('VALIDATION_ERROR', 'Wastage cannot be dated in the future');
      }

      inventory.applyMovement({
        ingredientId: ingredient.id,
        kind: 'wastage',
        qty: -input.qtyBase,
        unitCostMilli: ingredient.avgCostMilli,
        reason: input.notes.trim() || WASTAGE_TEXT[input.reason] || 'Wastage',
        wastageReason: input.reason,
        createdBy,
      });

      logInfo(
        `Wastage: ${input.qtyBase} ${ingredient.baseUnit} of ${ingredient.name} (${input.reason})`,
      );

      // The ledger row is the answer; read it back so the caller sees what was written.
      const movements = inventory.movementsFor(ingredient.id, 1);
      const written = movements[0];
      if (!written) throw new AppError('INTERNAL_ERROR', 'The wastage could not be recorded');
      return written;
    },

    /**
     * A signed correction with a reason, for when the shelf is wrong but nobody
     * counted it: a delivery short by two boxes, a bag split in the store room.
     *
     * Deliberately NOT a stock count. A count says "I counted 47 and the book says
     * 50"; an adjustment says "I know exactly what happened". The audit trail keeps
     * them apart so the variance report is not polluted by explained corrections.
     */
    /**
     * Send stock back to the supplier (4.F).
     *
     * The bill is NOT voided — the rest of the delivery was kept and is being sold —
     * so this is a separate `supplier_return` movement at the current average cost.
     * The owner takes the printout to the supplier and claims the credit; the app's
     * job is to make sure the shelf and the ledger agree that the food is gone.
     */
    supplierReturn(input: SupplierReturnInput, createdBy: number): StockMovement {
      const ingredient = ingredientOrFail(input.ingredientId);

      if (!Number.isInteger(input.qtyBase) || input.qtyBase <= 0) {
        throw new AppError('VALIDATION_ERROR', 'The quantity must be a whole number above zero');
      }
      if (input.qtyBase > ingredient.qtyOnHand) {
        throw new AppError(
          'CONFLICT',
          `Only ${ingredient.qtyOnHand} ${ingredient.baseUnit} of ${ingredient.name} is on the shelf, so ${input.qtyBase} cannot go back.`,
        );
      }

      const supplierName = input.supplierId
        ? (inventory.findSupplier(input.supplierId)?.name ?? 'the supplier')
        : 'the supplier';

      inventory.transaction(() => {
        inventory.applyMovement({
          ingredientId: ingredient.id,
          kind: 'supplier_return',
          qty: -input.qtyBase,
          unitCostMilli: ingredient.avgCostMilli,
          reason: `Returned to ${supplierName}: ${input.reason.trim()}`,
          createdBy,
        });
      });

      logInfo(
        `Supplier return: ${input.qtyBase} ${ingredient.baseUnit} of ${ingredient.name} to ${supplierName}`,
      );

      const movement = inventory
        .movementsFor(ingredient.id, 5)
        .find((row) => row.kind === 'supplier_return');
      if (!movement) throw new AppError('INTERNAL_ERROR', 'The return could not be read back');
      return movement;
    },

    adjust(input: AdjustmentInput, createdBy: number): StockMovement {
      const ingredient = ingredientOrFail(input.ingredientId);

      if (!Number.isInteger(input.qtyBase) || input.qtyBase === 0) {
        throw new AppError('VALIDATION_ERROR', 'The quantity must be a whole number, not zero');
      }
      if (input.reason.trim().length < 3) {
        throw new AppError('VALIDATION_ERROR', 'Say why the stock is being corrected');
      }
      if (input.qtyBase < 0 && Math.abs(input.qtyBase) > ingredient.qtyOnHand) {
        throw new AppError(
          'CONFLICT',
          `Only ${ingredient.qtyOnHand} in stock, so ${Math.abs(input.qtyBase)} cannot be removed.`,
        );
      }

      inventory.applyMovement({
        ingredientId: ingredient.id,
        kind: 'adjustment',
        qty: input.qtyBase,
        unitCostMilli: ingredient.avgCostMilli,
        reason: input.reason.trim(),
        createdBy,
      });

      logInfo(
        `Adjustment: ${input.qtyBase} ${ingredient.baseUnit} of ${ingredient.name} (${input.reason})`,
      );

      const movements = inventory.movementsFor(ingredient.id, 1);
      const written = movements[0];
      if (!written) throw new AppError('INTERNAL_ERROR', 'The adjustment could not be recorded');
      return written;
    },

    wastageReport(input: { fromDate: string; toDate: string }): WastageOverview {
      if (!stockOps) {
        throw new AppError(
          'CONFLICT',
          'The wastage report is not available in this database yet. Restart the app.',
        );
      }

      const report = stockOps.wastageReport(input.fromDate, input.toDate);
      return {
        from: input.fromDate,
        to: input.toDate,
        rows: report.rows,
        total: report.total,
        qty: report.qty,
      };
    },

    /**
     * Applies a stock count: the shelf is SET to the counted number, and the
     * difference is written as one `stock_count` movement per ingredient.
     *
     * Setting rather than adding is the point — the owner counted what is there,
     * so the book must agree with him afterwards. Lines where book and count agree
     * produce no movement (a row of zeros in the ledger is noise) but the count
     * still records them, so "I checked and it was right" is provable.
     */
    saveCount(input: StockCountInput, createdBy: number): StockCountDetail {
      if (!stockOps) {
        throw new AppError(
          'CONFLICT',
          'Stock counts are not available in this database yet. Restart the app.',
        );
      }

      const countedOn = input.countedOn || toSqlDate();
      if (countedOn > toSqlDate()) {
        throw new AppError('VALIDATION_ERROR', 'A count cannot be dated in the future');
      }
      if (input.lines.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'Count at least one ingredient');
      }

      const seen = new Set<number>();
      for (const line of input.lines) {
        if (seen.has(line.ingredientId)) {
          throw new AppError('VALIDATION_ERROR', 'The same ingredient is on two lines');
        }
        seen.add(line.ingredientId);

        if (!Number.isInteger(line.countedQty) || line.countedQty < 0) {
          throw new AppError('VALIDATION_ERROR', 'A counted quantity cannot be negative');
        }
      }

      const prepared = input.lines.map((line: CountLineInput) => {
        const ingredient = ingredientOrFail(line.ingredientId);
        const variance = line.countedQty - ingredient.qtyOnHand;

        return {
          ingredient,
          countedQty: line.countedQty,
          variance,
          unitCostMilli: ingredient.avgCostMilli,
          varianceValue: Math.round((Math.abs(variance) * ingredient.avgCostMilli) / 1000),
        };
      });

      const varianceValue = prepared.reduce((total, line) => total + line.varianceValue, 0);
      const countNo = stockOps.nextCountNo();

      const countId = stockOps.transaction(() => {
        const id = stockOps.createCount({
          countNo,
          countedOn,
          varianceValue,
          notes: input.notes.trim(),
          createdBy,
          lines: prepared.map((line) => ({
            ingredientId: line.ingredient.id,
            bookQty: line.ingredient.qtyOnHand,
            countedQty: line.countedQty,
            variance: line.variance,
            unitCostMilli: line.unitCostMilli,
            varianceValue: line.varianceValue,
          })),
        });

        for (const line of prepared) {
          if (line.variance === 0) continue;

          inventory.applyMovement({
            ingredientId: line.ingredient.id,
            kind: 'stock_count',
            qty: line.variance,
            unitCostMilli: line.unitCostMilli,
            reason: `Stock count ${countNo}`,
            createdBy,
          });
        }

        return id;
      });

      logInfo(`Stock count ${countNo}: ${prepared.length} line(s), variance ${varianceValue} paisa`);

      const detail = stockOps.findCount(countId);
      if (!detail) throw new AppError('INTERNAL_ERROR', 'The count could not be read back');
      return detail;
    },

    counts(): StockCount[] {
      return stockOps?.listCounts() ?? [];
    },

    count(id: number): StockCountDetail {
      if (!stockOps) {
        throw new AppError('CONFLICT', 'Stock counts are not available in this database yet.');
      }
      const detail = stockOps.findCount(id);
      if (!detail) throw new AppError('NOT_FOUND', 'That stock count does not exist');
      return detail;
    },

    /** Exposed for the recipe service (Roadmap 4.C) and its tests. */
    nextAverageCost,
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;
