import type { OrderDetail } from '../../src/types/api';
import type { InventoryRepository } from '../db/repositories/inventoryRepository';
import type { OrdersRepository } from '../db/repositories/ordersRepository';
import type { RecipeRepository } from '../db/repositories/recipeRepository';
import { deductQty, lineCostPaisa } from '../db/repositories/recipeRepository';
import type { CatalogRepository } from '../db/repositories/catalogRepository';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

/**
 * Automatic stock deduction (Roadmap 4.D).
 *
 * The client: "jab koe customer ka order ata hay to mere stock say utna saman
 * minus hojaye taky mujhe pata lagy" — when an order comes in, take that much
 * out of my stock so I know what is left.
 *
 * How it stays honest:
 *   * everything runs inside the caller's order transaction, so a failed save
 *     leaves no half-deducted shelf,
 *   * every deduction writes a ledger row naming the order line, and a unique
 *     index in migration 016 makes a second deduction of the same line impossible,
 *   * the cost of each line is FROZEN in order_item_stock. A later price rise or
 *     recipe edit therefore cannot rewrite what last week's bill actually cost.
 *
 * Called by ordersService.create() and amend(), and by cancel.
 */
export function createStockDeductionService(deps: {
  inventory: InventoryRepository;
  orders: OrdersRepository;
  recipes: RecipeRepository;
  catalog: CatalogRepository;
}) {
  const { inventory, orders, recipes, catalog } = deps;

  const allowNegativeStock = (): boolean => (recipes.setting('allow_negative_stock') ?? '1') === '1';
  const autoSoldOut = (): boolean => (recipes.setting('auto_sold_out') ?? '0') === '1';

  /** The recipe rows of an item, or an empty list when the item has none. */
  function recipeFor(itemId: number) {
    return recipes.linesFor(itemId);
  }

  /**
   * Deducts every ingredient of one saved order line and freezes its cost.
   * Returns the line's cost in paisa, or null when the item has no recipe.
   */
  function deductLine(input: {
    orderId: number;
    orderItemId: number;
    itemId: number;
    qty: number;
    createdBy: number;
  }): number | null {
    const lines = recipeFor(input.itemId);
    if (lines.length === 0) {
      orders.setItemCostTotal(input.orderItemId, null);
      return null;
    }

    // One pass to check availability, so a blocked sale cannot deduct half a
    // burger before failing on the last ingredient.
    if (!allowNegativeStock()) {
      const shortages: string[] = [];

      for (const line of lines) {
        const ingredient = inventory.findIngredient(line.ingredient_id);
        if (!ingredient) continue;

        const needed = deductQty(line.qty_base, line.waste_percent_x100) * input.qty;
        if (ingredient.qtyOnHand < needed) {
          shortages.push(
            `${ingredient.name} (need ${needed}, have ${Math.max(ingredient.qtyOnHand, 0)})`,
          );
        }
      }

      if (shortages.length > 0) {
        throw new AppError(
          'CONFLICT',
          `Not enough stock: ${shortages.join(', ')}. Record the purchase or allow negative stock in Settings.`,
        );
      }
    }

    let costTotal = 0;

    for (const line of lines) {
      const ingredient = inventory.findIngredient(line.ingredient_id);
      if (!ingredient) {
        throw new AppError(
          'CONFLICT',
          'An ingredient in this recipe no longer exists. Fix the recipe on the Menu page.',
        );
      }

      const perServing = deductQty(line.qty_base, line.waste_percent_x100);
      const qtyBase = perServing * input.qty;
      const unitCostMilli = ingredient.avgCostMilli;
      const cost = lineCostPaisa(qtyBase, unitCostMilli);

      inventory.applyMovement({
        ingredientId: ingredient.id,
        kind: 'sale',
        qty: -qtyBase,
        unitCostMilli,
        reason: `Sale on order ${input.orderId}`,
        refOrderId: input.orderId,
        refOrderItemId: input.orderItemId,
        createdBy: input.createdBy,
      });

      orders.addItemStock({
        orderItemId: input.orderItemId,
        ingredientId: ingredient.id,
        qtyBase,
        unitCostMilli,
        cost,
      });

      costTotal += cost;
    }

    orders.setItemCostTotal(input.orderItemId, costTotal);
    return costTotal;
  }

  /** Deducts every line of a freshly saved order. Runs inside its transaction. */
  function deductOrder(input: {
    order: OrderDetail;
    createdBy: number;
  }): number | null {
    let costTotal = 0;
    let anyCost = false;

    for (const line of input.order.items) {
      const lineCost = deductLine({
        orderId: input.order.id,
        orderItemId: line.id,
        itemId: line.itemId,
        qty: line.qty,
        createdBy: input.createdBy,
      });

      if (lineCost === null) {
        // A single line without a recipe makes the bill's cost unknown. Reporting
        // a partial cost as the whole cost would overstate the profit.
        costTotal = 0;
        anyCost = false;
        break;
      }

      costTotal += lineCost;
      anyCost = true;
    }

    if (!anyCost && input.order.items.length > 0) return null;
    if (input.order.items.length === 0) return null;

    // The cached total on the line rows is already written; the order-level figure
    // is read from the aggregate in ORDER_SELECT, so nothing else to store here.
    logInfo(`Order ${input.order.orderNo}: stock deducted, cost ${costTotal} paisa`);
    return costTotal;
  }

  /**
   * Cancels the stock side of a bill.
   *
   * `prepared = false`: the food was never cooked, so every sale movement is
   * reversed exactly and the ingredients are back on the shelf. The snapshot rows
   * stay behind as history.
   *
   * `prepared = true`: the kitchen cooked it and the customer walked away. The
   * stock is NOT silently put back — nobody can sell that food again — so the
   * ingredients are first returned and then immediately written off as wastage.
   *
   * The two-step dance matters: the sale already took the stock out. Writing a
   * wastage row on top of the untouched sale row would remove it a second time and
   * the shelf would go negative for food that was only ever made once. Return then
   * write-off leaves the quantity at zero net change (correct: it was bought, it
   * was used, it earned nothing) and leaves a `wastage` row the P&L can total.
   */
  function reverseOrder(input: {
    order: OrderDetail;
    prepared: boolean;
    createdBy: number;
  }): void {
    for (const item of input.order.items) {
      const snapshots = orders.stockForItem(item.id);

      for (const snapshot of snapshots) {
        // Step 1: undo the sale, exactly as it was recorded.
        inventory.applyMovement({
          ingredientId: snapshot.ingredientId,
          kind: 'sale_reversal',
          qty: snapshot.qtyBase,
          unitCostMilli: snapshot.unitCostMilli,
          reason: `Cancelled (order ${input.order.orderNo})`,
          refOrderId: input.order.id,
          refOrderItemId: item.id,
          createdBy: input.createdBy,
        });

        // Step 2: cooked food is a loss, so book it as one.
        if (input.prepared) {
          inventory.applyMovement({
            ingredientId: snapshot.ingredientId,
            kind: 'wastage',
            qty: -snapshot.qtyBase,
            unitCostMilli: snapshot.unitCostMilli,
            reason: `Cancelled after cooking (order ${input.order.orderNo})`,
            refOrderId: input.order.id,
            createdBy: input.createdBy,
          });
        }
      }
    }

    logInfo(
      `Order ${input.order.orderNo} cancelled: ${
        input.prepared ? 'cooked food booked as wastage' : 'stock returned'
      }`,
    );
  }

  /**
   * Releases the stock an existing bill holds, before its lines are rewritten.
   *
   * Amendment is split in two on purpose. `releaseOrder` has to run while the old
   * lines still exist, because `order_item_stock` hangs off them by foreign key;
   * the deduction then has to run after the new lines are saved, because a ledger
   * row must name the line that owns it. `amend()` therefore calls this, rewrites
   * the lines, and calls `deductOrder` on the saved bill.
   *
   * The old cost snapshot is deleted here. It is not history worth keeping: the
   * amendment replaces the bill, and the audit trail lives in `order_amendments`
   * and in the ledger's sale and sale_reversal rows.
   */
  function releaseOrder(input: { order: OrderDetail; createdBy: number }): void {
    for (const item of input.order.items) {
      for (const snapshot of orders.stockForItem(item.id)) {
        inventory.applyMovement({
          ingredientId: snapshot.ingredientId,
          kind: 'sale_reversal',
          qty: snapshot.qtyBase,
          unitCostMilli: snapshot.unitCostMilli,
          reason: `Bill amended (order ${input.order.orderNo})`,
          refOrderId: input.order.id,
          refOrderItemId: item.id,
          createdBy: input.createdBy,
        });
      }

      // The lines are about to be deleted by the amendment, so their ledger rows
      // must let go of them first (older databases have a RESTRICT foreign key).
      orders.detachItemMovementRefs(item.id);
      orders.clearItemStock(item.id);
      orders.setItemCostTotal(item.id, null);
    }
  }

  /**
   * Keeps sold-out flags honest after a sale or a purchase, when the owner asked
   * for automatic sold-out. Off by default: a cashier must stay able to override.
   */
  function refreshAvailability(): void {
    if (!autoSoldOut()) return;

    for (const item of catalog.listItems()) {
      const lines = recipeFor(item.id);
      if (lines.length === 0) continue;

      let canMake = Number.POSITIVE_INFINITY;
      for (const line of lines) {
        const ingredient = inventory.findIngredient(line.ingredient_id);
        if (!ingredient) continue;
        canMake = Math.min(canMake, Math.floor(ingredient.qtyOnHand / line.qty_base));
      }

      if (!Number.isFinite(canMake)) continue;

      const available = canMake > 0;
      if (available !== item.available) catalog.setAvailability(item.id, available);
    }
  }

  return {
    deductLine,
    deductOrder,
    reverseOrder,
    releaseOrder,
    refreshAvailability,
    allowNegativeStock,
  };
}

export type StockDeductionService = ReturnType<typeof createStockDeductionService>;
