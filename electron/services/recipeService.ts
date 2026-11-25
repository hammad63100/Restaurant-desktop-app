import type {
  MenuCostOverview,
  MenuCostRow,
  Recipe,
  RecipeLine,
  SaveRecipeInput,
  StockSettings,
} from '../../src/types/api';
import type { RecipeRepository } from '../db/repositories/recipeRepository';
import {
  lineCostPaisa,
  marginPercentX100,
  suggestedPrice,
} from '../db/repositories/recipeRepository';
import type { CatalogRepository } from '../db/repositories/catalogRepository';
import type { InventoryRepository } from '../db/repositories/inventoryRepository';
import type { SettingsRepository } from '../db/repositories/settingsRepository';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

/**
 * Recipes, cost, profit and margin (Roadmap 4.C).
 *
 * The owner's rule from the client: "owner ko choice hay ke woh kitna rakhe ek
 * item ka price, phir usi hisab say profit alag ho" — the app never sets a
 * selling price by itself. It shows the cost of making one serving and the profit
 * that follows from the price he chose, plus a suggestion if he asks for one.
 */
export function createRecipeService(deps: {
  recipes: RecipeRepository;
  catalog: CatalogRepository;
  inventory: InventoryRepository;
  settings: SettingsRepository;
}) {
  const { recipes, catalog, inventory, settings } = deps;

  function readStockSettings(): StockSettings {
    return {
      allowNegativeStock: (recipes.setting('allow_negative_stock') ?? '1') === '1',
      autoSoldOut: (recipes.setting('auto_sold_out') ?? '0') === '1',
      marginAlertPercentX100: Number(recipes.setting('margin_alert_percent') ?? '35') * 100,
    };
  }

  /** Builds one recipe from the repository rows, using live average costs. */
  function buildRecipe(itemId: number): Recipe {
    const item = catalog.findItem(itemId);
    if (!item) throw new AppError('NOT_FOUND', 'That menu item does not exist');

    const lines: RecipeLine[] = recipes.linesFor(itemId).map((row) => ({
      id: row.id,
      ingredientId: row.ingredient_id,
      ingredientName: row.ingredient_name,
      baseUnit: row.base_unit,
      qtyBase: row.qty_base,
      wastePercentX100: row.waste_percent_x100,
      unitCostMilli: row.avg_cost_milli,
      lineCost: lineCostPaisa(row.qty_base, row.avg_cost_milli),
    }));

    const costTotal = lines.reduce((total, line) => total + line.lineCost, 0);
    const hasRecipe = lines.length > 0;
    const profit = hasRecipe ? item.price - costTotal : null;

    return {
      itemId: item.id,
      itemName: item.name,
      price: item.price,
      lines,
      costTotal,
      profit,
      marginPercentX100: profit === null ? null : marginPercentX100(profit, item.price),
      hasRecipe,
    };
  }

  /** "Can make N more": the tightest ingredient in the recipe. */
  function canMakeFor(itemId: number): number | null {
    const rows = recipes.linesFor(itemId);
    if (rows.length === 0) return null;

    let smallest = Number.POSITIVE_INFINITY;

    for (const row of rows) {
      const ingredient = inventory.findIngredient(row.ingredient_id);
      if (!ingredient) continue;

      const perServing = Math.max(row.qty_base, 1);
      const possible = Math.floor(ingredient.qtyOnHand / perServing);
      smallest = Math.min(smallest, possible);
    }

    return Number.isFinite(smallest) ? Math.max(smallest, 0) : null;
  }

  return {
    stockSettings(): StockSettings {
      return readStockSettings();
    },

    saveStockSettings(input: StockSettings): StockSettings {
      settings.set('allow_negative_stock', input.allowNegativeStock ? '1' : '0');
      settings.set('auto_sold_out', input.autoSoldOut ? '1' : '0');
      settings.set(
        'margin_alert_percent',
        String(Math.round(input.marginAlertPercentX100 / 100)),
      );
      logInfo('Stock settings updated');
      return readStockSettings();
    },

    menuCosts(): MenuCostOverview {
      const marginFloor = readStockSettings().marginAlertPercentX100;

      const rows: MenuCostRow[] = catalog.listItems().map((item) => {
        const recipe = buildRecipe(item.id);
        const profit = recipe.profit;
        const margin = recipe.marginPercentX100;

        return {
          itemId: item.id,
          itemName: item.name,
          categoryName: item.categoryName,
          price: item.price,
          costTotal: recipe.costTotal,
          profit,
          marginPercentX100: margin,
          hasRecipe: recipe.hasRecipe,
          canMake: canMakeFor(item.id),
          // An item without a recipe is never "below target": its cost is unknown,
          // and flagging it would be a guess dressed up as a number.
          belowTarget: margin !== null && margin < marginFloor,
        };
      });

      return {
        rows,
        marginAlertPercent: marginFloor,
        missingRecipeCount: rows.filter((row) => !row.hasRecipe && row.price > 0).length,
        belowTargetCount: rows.filter((row) => row.belowTarget).length,
      };
    },

    recipe(itemId: number): Recipe {
      return buildRecipe(itemId);
    },

    /** Replaces the whole recipe. Quantities must be positive whole base units. */
    saveRecipe(input: SaveRecipeInput): Recipe {
      const item = catalog.findItem(input.itemId);
      if (!item) throw new AppError('NOT_FOUND', 'That menu item does not exist');

      const seen = new Set<number>();

      for (const line of input.lines) {
        const ingredient = inventory.findIngredient(line.ingredientId);
        if (!ingredient) {
          throw new AppError('NOT_FOUND', `Ingredient ${line.ingredientId} does not exist`);
        }
        if (!ingredient.active) {
          throw new AppError('CONFLICT', `${ingredient.name} is no longer an active ingredient`);
        }
        if (seen.has(line.ingredientId)) {
          throw new AppError('VALIDATION_ERROR', `${ingredient.name} is on two lines`);
        }
        seen.add(line.ingredientId);

        if (!Number.isInteger(line.qtyBase) || line.qtyBase <= 0) {
          throw new AppError(
            'VALIDATION_ERROR',
            `Enter a whole quantity for ${ingredient.name} (grams, ml or pieces)`,
          );
        }
      }

      recipes.transaction(() => {
        recipes.replaceForItem(item.id, input.lines);
      });

      logInfo(`Recipe saved for ${item.name}: ${input.lines.length} line(s)`);

      const saved = buildRecipe(item.id);

      // Optional setting from 4.C: an item that cannot be made at all is marked
      // sold out by the app. The cashier can still switch it back on if the
      // delivery has simply not been entered yet.
      if (readStockSettings().autoSoldOut && saved.hasRecipe) {
        const canMake = canMakeFor(item.id);
        if (canMake !== null && canMake <= 0) catalog.setAvailability(item.id, false);
        else catalog.setAvailability(item.id, true);
      }

      return saved;
    },

    suggestPrice(input: { marginPercentX100: number; costTotal: number }): { price: number } {
      if (input.marginPercentX100 < 0) {
        throw new AppError('VALIDATION_ERROR', 'The margin cannot be negative');
      }
      if (input.marginPercentX100 >= 10_000) {
        throw new AppError('VALIDATION_ERROR', 'The margin must be below 100%');
      }
      return { price: suggestedPrice(input.costTotal, input.marginPercentX100) };
    },

    /**
     * Changing the selling price from the costing screen, with the same rules as
     * the Menu page (menu:write). Kept here so the owner can act on a "check price"
     * flag without leaving the numbers he is looking at.
     */
    setItemPrice(input: { itemId: number; price: number }): MenuCostRow {
      const item = catalog.findItem(input.itemId);
      if (!item) throw new AppError('NOT_FOUND', 'That menu item does not exist');

      catalog.updateItem({
        id: item.id,
        categoryId: item.categoryId,
        name: item.name,
        price: input.price,
        available: item.available,
        image: item.image,
      });

      const row = this.menuCosts().rows.find((candidate) => candidate.itemId === item.id);
      if (!row) throw new AppError('INTERNAL_ERROR', 'The item could not be read back');
      return row;
    },
  };
}

export type RecipeService = ReturnType<typeof createRecipeService>;
