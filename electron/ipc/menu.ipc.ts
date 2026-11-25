import { z } from 'zod';
import { CHANNELS } from '../../src/types/api';
import { categorySchema, menuItemSchema } from '../../src/types/schemas';
import type { CatalogService } from '../services/catalogService';
import type { HandlerRegistry } from './registry';

const idSchema = z.object({ id: z.number().int().positive() });
const toggleSchema = z.object({ id: z.number().int().positive(), available: z.boolean() });

export function menuHandlers(catalog: CatalogService): HandlerRegistry {
  return {
    [CHANNELS.categories]: {
      handler: () => catalog.listCategories(),
    },

    [CHANNELS.categorySave]: {
      capability: 'menu:write',
      schema: categorySchema,
      handler: (input: { id?: number; name: string; sortOrder: number; active: boolean }) =>
        catalog.saveCategory(input),
    },

    [CHANNELS.categoryDelete]: {
      capability: 'menu:write',
      schema: idSchema,
      handler: (input: { id: number }) => {
        catalog.deleteCategory(input.id);
        return null;
      },
    },

    [CHANNELS.items]: {
      handler: () => catalog.listItems(),
    },

    [CHANNELS.itemSave]: {
      capability: 'menu:write',
      schema: menuItemSchema,
      handler: (input: Parameters<CatalogService['saveItem']>[0]) => catalog.saveItem(input),
    },

    [CHANNELS.itemDelete]: {
      capability: 'menu:write',
      schema: idSchema,
      handler: (input: { id: number }) => {
        catalog.deleteItem(input.id);
        return null;
      },
    },

    [CHANNELS.itemToggle]: {
      // Cashiers may mark an item sold out mid-shift, so this uses orders:write
      // instead of the stricter menu:write.
      capability: 'orders:write',
      schema: toggleSchema,
      handler: (input: { id: number; available: boolean }) => {
        catalog.toggleAvailability(input.id, input.available);
        return null;
      },
    },
  };
}
