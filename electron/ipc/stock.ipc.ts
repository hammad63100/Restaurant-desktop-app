import { z } from 'zod';
import { CHANNELS } from '../../src/types/api';
import {
  adjustmentSchema,
  ingredientSchema,
  loadStarterListSchema,
  openingStockSchema,
  purchaseFilterSchema,
  purchaseSchema,
  stockCountSchema,
  stockReportRangeSchema,
  subRecipeIngredientSchema,
  subRecipeMakeSchema,
  subRecipeSaveSchema,
  supplierReturnSchema,
  supplierSchema,
  voidPurchaseSchema,
  wastageSchema,
} from '../../src/types/schemas';
import type { InventoryService } from '../services/inventoryService';
import type { SubRecipeService } from '../services/subRecipeService';
import { AppError } from '../utils/errors';
import type { HandlerContext, HandlerRegistry } from './registry';

/* Shape-only schemas; business rules live in inventoryService. */

const ingredientIdSchema = z.object({ id: z.number().int().positive() });
const supplierIdSchema = z.object({ id: z.number().int().positive() });
const purchaseIdSchema = z.object({ id: z.number().int().positive() });
const movementsSchema = z.object({
  ingredientId: z.number().int().positive(),
  limit: z.number().int().min(1).max(500).default(100),
});

/** Stock levels, ingredients, suppliers and purchases (Roadmap Phase 4.A / 4.B). */
export function stockHandlers(
  inventory: InventoryService,
  /** Sub-recipes (4.I). Absent on a database that has not run 023. */
  subRecipes?: SubRecipeService,
): HandlerRegistry {
  return {
    /* ----------------------------- stock levels ----------------------------- */

    [CHANNELS.stockOverview]: {
      capability: 'inventory:read',
      handler: () => inventory.overview(),
    },

    [CHANNELS.ingredients]: {
      capability: 'inventory:read',
      handler: () => inventory.ingredients(),
    },

    [CHANNELS.ingredientGet]: {
      capability: 'inventory:read',
      schema: ingredientIdSchema,
      handler: (input: { id: number }) => inventory.ingredient(input.id),
    },

    [CHANNELS.ingredientSave]: {
      capability: 'inventory:write',
      schema: ingredientSchema,
      handler: (input: Parameters<InventoryService['saveIngredient']>[0]) =>
        inventory.saveIngredient(input),
    },

    [CHANNELS.ingredientDelete]: {
      capability: 'inventory:write',
      schema: ingredientIdSchema,
      handler: (input: { id: number }) => {
        inventory.deleteIngredient(input.id);
        return null;
      },
    },

    [CHANNELS.starterCatalogue]: {
      capability: 'inventory:read',
      handler: () => inventory.starterCatalogue(),
    },

    [CHANNELS.starterLoad]: {
      capability: 'inventory:write',
      schema: loadStarterListSchema,
      handler: (input: { names: string[] }) => inventory.loadStarterList(input.names),
    },

    /* ------------------------------- suppliers ------------------------------ */

    [CHANNELS.suppliers]: {
      capability: 'inventory:read',
      handler: () => inventory.suppliers(),
    },

    [CHANNELS.supplierSave]: {
      capability: 'inventory:write',
      schema: supplierSchema,
      handler: (input: Parameters<InventoryService['saveSupplier']>[0]) =>
        inventory.saveSupplier(input),
    },

    [CHANNELS.supplierDelete]: {
      capability: 'inventory:write',
      schema: supplierIdSchema,
      handler: (input: { id: number }) => {
        inventory.deleteSupplier(input.id);
        return null;
      },
    },

    /* ------------------------------- purchases ------------------------------ */

    [CHANNELS.purchases]: {
      capability: 'inventory:read',
      schema: purchaseFilterSchema,
      handler: (input: { fromDate: string; toDate: string; limit: number }) =>
        inventory.purchases(input),
    },

    [CHANNELS.purchaseGet]: {
      capability: 'inventory:read',
      schema: purchaseIdSchema,
      handler: (input: { id: number }) => inventory.purchase(input.id),
    },

    [CHANNELS.purchaseCreate]: {
      capability: 'purchases:write',
      schema: purchaseSchema,
      handler: (
        input: Parameters<InventoryService['createPurchase']>[0],
        context: HandlerContext,
      ) => inventory.createPurchase(input, context.user.id),
    },

    [CHANNELS.purchaseVoid]: {
      capability: 'purchases:void',
      schema: voidPurchaseSchema,
      handler: (input: { id: number; reason: string }, context: HandlerContext) =>
        inventory.voidPurchase(input.id, input.reason, context.user.id),
    },

    [CHANNELS.openingStock]: {
      // Opening stock is a one-time set-up act, not till work: gated on
      // purchases:void (admin/manager) rather than a cashier capability.
      capability: 'purchases:void',
      schema: openingStockSchema,
      handler: (
        input: Parameters<InventoryService['openingStock']>[0],
        context: HandlerContext,
      ) => inventory.openingStock(input, context.user.id),
    },

    [CHANNELS.stockMovements]: {
      capability: 'inventory:read',
      schema: movementsSchema,
      handler: (input: { ingredientId: number; limit: number }) => inventory.movements(input),
    },

    /* ------------------ wastage, adjustments, counts (4.F) ------------------ */

    [CHANNELS.stockWastage]: {
      // Throwing food away is a stock decision, not a till decision: a cashier can
      // read the shelf but cannot write off its value.
      capability: 'stock:adjust',
      schema: wastageSchema,
      handler: (input: Parameters<InventoryService['recordWastage']>[0], context: HandlerContext) =>
        inventory.recordWastage(input, context.user.id),
    },

    [CHANNELS.stockSupplierReturn]: {
      // Sending a delivery back is a claim against the supplier, so it sits with the
      // same people who may write stock off — never a cashier.
      capability: 'stock:adjust',
      schema: supplierReturnSchema,
      handler: (
        input: Parameters<InventoryService['supplierReturn']>[0],
        context: HandlerContext,
      ) => inventory.supplierReturn(input, context.user.id),
    },

    [CHANNELS.stockAdjust]: {
      capability: 'stock:adjust',
      schema: adjustmentSchema,
      handler: (input: Parameters<InventoryService['adjust']>[0], context: HandlerContext) =>
        inventory.adjust(input, context.user.id),
    },

    [CHANNELS.stockWastageReport]: {
      capability: 'inventory:read',
      schema: stockReportRangeSchema,
      handler: (input: { fromDate: string; toDate: string }) => inventory.wastageReport(input),
    },

    [CHANNELS.stockCounts]: {
      capability: 'inventory:read',
      handler: () => inventory.counts(),
    },

    [CHANNELS.stockCountGet]: {
      capability: 'inventory:read',
      schema: z.object({ id: z.number().int().positive() }),
      handler: (input: { id: number }) => inventory.count(input.id),
    },

    [CHANNELS.stockCountSave]: {
      capability: 'stock:adjust',
      schema: stockCountSchema,
      handler: (input: Parameters<InventoryService['saveCount']>[0], context: HandlerContext) =>
        inventory.saveCount(input, context.user.id),
    },

    /* --------------------------- sub-recipes (4.I) --------------------------- */

    [CHANNELS.subRecipes]: {
      // Reading the cost of a house-made sauce is a cost figure, so it is
      // `costs:read` like every other margin in the app — not `inventory:read`.
      capability: 'costs:read',
      schema: z.object({}).optional(),
      handler: () => requireSubRecipes().overview(),
    },

    [CHANNELS.subRecipe]: {
      capability: 'costs:read',
      schema: subRecipeIngredientSchema,
      handler: (input: { ingredientId: number }) => requireSubRecipes().recipe(input.ingredientId),
    },

    [CHANNELS.subRecipeSave]: {
      capability: 'inventory:write',
      schema: subRecipeSaveSchema,
      handler: (input: Parameters<SubRecipeService['saveRecipe']>[0]) =>
        requireSubRecipes().saveRecipe(input),
    },

    [CHANNELS.subRecipeMake]: {
      // Making a batch moves stock, so it needs the same right as an adjustment.
      capability: 'stock:adjust',
      schema: subRecipeMakeSchema,
      handler: (
        input: Parameters<SubRecipeService['makeBatch']>[0],
        context: HandlerContext,
      ) => requireSubRecipes().makeBatch(input, context.user.id),
    },

    [CHANNELS.subRecipeBatches]: {
      capability: 'costs:read',
      schema: subRecipeIngredientSchema,
      handler: (input: { ingredientId: number }) =>
        requireSubRecipes().batchesFor(input.ingredientId),
    },
  };

  function requireSubRecipes(): SubRecipeService {
    if (!subRecipes) {
      throw new AppError(
        'CONFLICT',
        'House-made ingredients are not available in this database. Restart the app.',
      );
    }
    return subRecipes;
  }
}
