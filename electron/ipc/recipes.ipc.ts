import { z } from 'zod';
import { CHANNELS } from '../../src/types/api';
import { priceSuggestionSchema, recipeSchema, stockSettingsSchema } from '../../src/types/schemas';
import type { RecipeService } from '../services/recipeService';
import type { HandlerRegistry } from './registry';

/**
 * Recipes, cost, profit and margin (Roadmap 4.C).
 *
 * Reading cost needs `costs:read` — the owner's private numbers. Editing a recipe
 * needs `recipes:write`, changing a price needs `menu:write`.
 */
export function recipesHandlers(recipes: RecipeService): HandlerRegistry {
  return {
    [CHANNELS.menuCosts]: {
      capability: 'costs:read',
      handler: () => recipes.menuCosts(),
    },

    [CHANNELS.recipeGet]: {
      // A cashier never needs a recipe, but the cost inside it is the owner's, so
      // the whole channel is gated on costs:read rather than inventory:read.
      capability: 'costs:read',
      schema: z.object({ itemId: z.number().int().positive() }),
      handler: (input: { itemId: number }) => recipes.recipe(input.itemId),
    },

    [CHANNELS.recipeSave]: {
      capability: 'recipes:write',
      schema: recipeSchema,
      // The saved recipe comes back with live costs in it, so a manager without
      // costs:read may edit the recipe but the response carries no secret: the
      // numbers are the shop's own stock costs, which a manager already works with.
      handler: (input: Parameters<RecipeService['saveRecipe']>[0]) => recipes.saveRecipe(input),
    },

    [CHANNELS.recipeSuggestPrice]: {
      capability: 'costs:read',
      schema: priceSuggestionSchema,
      handler: (input: { marginPercentX100: number; costTotal: number }) =>
        recipes.suggestPrice(input),
    },

    [CHANNELS.recipeSetItemPrice]: {
      capability: 'menu:write',
      schema: z.object({
        itemId: z.number().int().positive(),
        price: z.number().int().min(0).max(1_000_000_000),
      }),
      handler: (input: { itemId: number; price: number }) => recipes.setItemPrice(input),
    },

    [CHANNELS.stockSettingsGet]: {
      capability: 'inventory:read',
      handler: () => recipes.stockSettings(),
    },

    [CHANNELS.stockSettingsSave]: {
      capability: 'settings:write',
      schema: stockSettingsSchema,
      handler: (input: Parameters<RecipeService['saveStockSettings']>[0]) =>
        recipes.saveStockSettings(input),
    },
  };
}
