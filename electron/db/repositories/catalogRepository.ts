import type { AppDatabase } from '../connection';
import type { Category, MenuItem } from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';

interface CategoryRow {
  id: number;
  name: string;
  sort_order: number;
  active: number;
}

interface ItemRow {
  id: number;
  category_id: number;
  category_name: string;
  name: string;
  price: number;
  available: number;
  image: string | null;
  active: number;
}

const toCategory = (row: CategoryRow): Category => ({
  id: row.id,
  name: row.name,
  sortOrder: row.sort_order,
  active: row.active === 1,
});

const toItem = (row: ItemRow): MenuItem => ({
  id: row.id,
  categoryId: row.category_id,
  categoryName: row.category_name,
  name: row.name,
  price: row.price,
  available: row.available === 1,
  image: row.image,
  active: row.active === 1,
});

export function createCatalogRepository(db: AppDatabase) {
  const selectCategories = db.prepare<[], CategoryRow>(
    'SELECT id, name, sort_order, active FROM categories ORDER BY sort_order, name COLLATE NOCASE',
  );
  const selectCategory = db.prepare<[number], CategoryRow>(
    'SELECT id, name, sort_order, active FROM categories WHERE id = ?',
  );
  const insertCategory = db.prepare(
    'INSERT INTO categories (name, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  const updateCategory = db.prepare(
    'UPDATE categories SET name = ?, sort_order = ?, updated_at = ? WHERE id = ?',
  );
  const deactivateCategory = db.prepare(
    'UPDATE categories SET active = 0, updated_at = ? WHERE id = ?',
  );

  const selectItems = db.prepare<[], ItemRow>(`
    SELECT i.id, i.category_id, c.name AS category_name, i.name, i.price, i.available, i.image, i.active
      FROM items i
      JOIN categories c ON c.id = i.category_id
     WHERE i.active = 1
     ORDER BY c.sort_order, c.name COLLATE NOCASE, i.name COLLATE NOCASE
  `);
  const selectItem = db.prepare<[number], ItemRow>(`
    SELECT i.id, i.category_id, c.name AS category_name, i.name, i.price, i.available, i.image, i.active
      FROM items i
      JOIN categories c ON c.id = i.category_id
     WHERE i.id = ?
  `);
  const insertItem = db.prepare(`
    INSERT INTO items (category_id, name, price, available, image, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const updateItem = db.prepare(`
    UPDATE items
       SET category_id = ?, name = ?, price = ?, available = ?, image = ?, updated_at = ?
     WHERE id = ?
  `);
  const deactivateItem = db.prepare('UPDATE items SET active = 0, updated_at = ? WHERE id = ?');
  const setAvailability = db.prepare('UPDATE items SET available = ?, updated_at = ? WHERE id = ?');
  const countItemsInCategory = db.prepare<[number], { total: number }>(
    'SELECT COUNT(*) AS total FROM items WHERE category_id = ? AND active = 1',
  );
  const countActiveItems = db.prepare<[], { total: number }>(
    'SELECT COUNT(*) AS total FROM items WHERE active = 1',
  );

  return {
    listCategories(): Category[] {
      return selectCategories.all().map(toCategory);
    },

    findCategory(id: number): Category | null {
      const row = selectCategory.get(id);
      return row ? toCategory(row) : null;
    },

    createCategory(name: string, sortOrder: number): number {
      const now = toSqlDateTime();
      const result = insertCategory.run(name.trim(), sortOrder, 1, now, now);
      return Number(result.lastInsertRowid);
    },

    updateCategory(id: number, name: string, sortOrder: number): void {
      updateCategory.run(name.trim(), sortOrder, toSqlDateTime(), id);
    },

    /** Soft delete: old orders still reference the category's items. */
    deactivateCategory(id: number): void {
      deactivateCategory.run(toSqlDateTime(), id);
    },

    listItems(): MenuItem[] {
      return selectItems.all().map(toItem);
    },

    findItem(id: number): MenuItem | null {
      const row = selectItem.get(id);
      return row ? toItem(row) : null;
    },

    createItem(input: {
      categoryId: number;
      name: string;
      price: number;
      available: boolean;
      image: string | null;
    }): number {
      const now = toSqlDateTime();
      const result = insertItem.run(
        input.categoryId,
        input.name.trim(),
        input.price,
        input.available ? 1 : 0,
        input.image,
        now,
        now,
      );
      return Number(result.lastInsertRowid);
    },

    updateItem(input: {
      id: number;
      categoryId: number;
      name: string;
      price: number;
      available: boolean;
      image: string | null;
    }): void {
      updateItem.run(
        input.categoryId,
        input.name.trim(),
        input.price,
        input.available ? 1 : 0,
        input.image,
        toSqlDateTime(),
        input.id,
      );
    },

    deactivateItem(id: number): void {
      deactivateItem.run(toSqlDateTime(), id);
    },

    setAvailability(id: number, available: boolean): void {
      setAvailability.run(available ? 1 : 0, toSqlDateTime(), id);
    },

    countItemsInCategory(categoryId: number): number {
      return countItemsInCategory.get(categoryId)?.total ?? 0;
    },

    countActiveItems(): number {
      return countActiveItems.get()?.total ?? 0;
    },
  };
}

export type CatalogRepository = ReturnType<typeof createCatalogRepository>;
