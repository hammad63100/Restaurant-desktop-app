import type { Category, MenuItem } from '../../src/types/api';
import type { CatalogRepository } from '../db/repositories/catalogRepository';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

export interface SaveCategoryPayload {
  id?: number;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface SaveItemPayload {
  id?: number;
  categoryId: number;
  name: string;
  price: number;
  available: boolean;
  image: string | null;
}

export function createCatalogService(catalog: CatalogRepository) {
  function findCategoryOrFail(id: number): Category {
    const category = catalog.findCategory(id);
    if (!category) throw new AppError('NOT_FOUND', 'That category does not exist');
    return category;
  }

  function findItemOrFail(id: number): MenuItem {
    const item = catalog.findItem(id);
    if (!item) throw new AppError('NOT_FOUND', 'That item does not exist');
    return item;
  }

  function assertUniqueCategoryName(name: string, ignoreId?: number): void {
    const clash = catalog
      .listCategories()
      .find(
        (category) =>
          category.active &&
          category.name.toLowerCase() === name.trim().toLowerCase() &&
          category.id !== ignoreId,
      );

    if (clash) throw new AppError('CONFLICT', 'A category with that name already exists');
  }

  function assertUniqueItemName(categoryId: number, name: string, ignoreId?: number): void {
    const clash = catalog
      .listItems()
      .find(
        (item) =>
          item.categoryId === categoryId &&
          item.name.toLowerCase() === name.trim().toLowerCase() &&
          item.id !== ignoreId,
      );

    if (clash) throw new AppError('CONFLICT', 'That item already exists in this category');
  }

  return {
    listCategories(): Category[] {
      return catalog.listCategories();
    },

    saveCategory(input: SaveCategoryPayload): Category {
      assertUniqueCategoryName(input.name, input.id);

      if (input.id) {
        findCategoryOrFail(input.id);
        catalog.updateCategory(input.id, input.name, input.sortOrder);
        return findCategoryOrFail(input.id);
      }

      const id = catalog.createCategory(input.name, input.sortOrder);
      logInfo(`Category created: ${input.name}`);
      return findCategoryOrFail(id);
    },

    /** Soft delete. Refused while the category still has active items. */
    deleteCategory(id: number): void {
      const category = findCategoryOrFail(id);
      const itemCount = catalog.countItemsInCategory(id);

      if (itemCount > 0) {
        throw new AppError(
          'CONFLICT',
          `${category.name} still has ${itemCount} item(s). Move or delete them first.`,
        );
      }

      catalog.deactivateCategory(id);
      logInfo(`Category deactivated: ${category.name}`);
    },

    listItems(): MenuItem[] {
      return catalog.listItems();
    },

    saveItem(input: SaveItemPayload): MenuItem {
      findCategoryOrFail(input.categoryId);
      assertUniqueItemName(input.categoryId, input.name, input.id);

      if (input.id) {
        findItemOrFail(input.id);
        catalog.updateItem({
          id: input.id,
          categoryId: input.categoryId,
          name: input.name,
          price: input.price,
          available: input.available,
          image: input.image,
        });
        return findItemOrFail(input.id);
      }

      const id = catalog.createItem(input);
      logInfo(`Item created: ${input.name}`);
      return findItemOrFail(id);
    },

    /** Soft delete keeps old invoices readable (Rules.md section 2). */
    deleteItem(id: number): void {
      const item = findItemOrFail(id);
      catalog.deactivateItem(id);
      logInfo(`Item deactivated: ${item.name}`);
    },

    toggleAvailability(id: number, available: boolean): void {
      findItemOrFail(id);
      catalog.setAvailability(id, available);
    },
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;
