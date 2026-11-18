import type { AppDatabase } from '../connection';
import type { DiningTable } from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';
import { AppError } from '../../utils/errors';

interface TableRow {
  id: number;
  name: string;
  seats: number;
  area: string;
  active: number;
  order_id: number | null;
  order_no: string | null;
  open_total: number;
  lifetime_sales: number;
}

const toTable = (row: TableRow): DiningTable => ({
  id: row.id,
  name: row.name,
  seats: row.seats,
  area: row.area,
  active: row.active === 1,
  orderId: row.order_id,
  orderNo: row.order_no,
  openTotal: row.open_total,
  lifetimeSales: row.lifetime_sales,
});

/**
 * The floor plan: tables, plus which open bill sits where.
 *
 * A table holds at most one *open* dine-in order. That is a fact the shop relies
 * on, so it is derived here rather than trusted from the caller.
 */
export function createTablesRepository(db: AppDatabase) {
  const selectAll = db.prepare<[], TableRow>(`
    SELECT t.id, t.name, t.seats, t.area, t.active,
           o.id   AS order_id,
           o.order_no,
           COALESCE(o.total, 0) AS open_total,
           COALESCE((
             SELECT SUM(past.total) FROM orders past
              WHERE past.table_id = t.id AND past.status <> 'cancelled'
           ), 0) AS lifetime_sales
      FROM tables t
      LEFT JOIN orders o
             ON o.table_id = t.id
            AND o.status NOT IN ('cancelled', 'delivered')
            AND o.merged_into_order_id IS NULL
     ORDER BY t.area, t.name
  `);

  const selectById = db.prepare<[number], TableRow>(`
    SELECT t.id, t.name, t.seats, t.area, t.active,
           o.id AS order_id, o.order_no,
           COALESCE(o.total, 0) AS open_total,
           COALESCE((
             SELECT SUM(past.total) FROM orders past
              WHERE past.table_id = t.id AND past.status <> 'cancelled'
           ), 0) AS lifetime_sales
      FROM tables t
      LEFT JOIN orders o
             ON o.table_id = t.id
            AND o.status NOT IN ('cancelled', 'delivered')
            AND o.merged_into_order_id IS NULL
     WHERE t.id = ?
  `);

  const selectByName = db.prepare<[string], { id: number }>(
    'SELECT id FROM tables WHERE name = ? COLLATE NOCASE',
  );

  const insertTable = db.prepare(`
    INSERT INTO tables (name, seats, area, active, created_at)
    VALUES (@name, @seats, @area, @active, @createdAt)
  `);

  const updateTable = db.prepare(`
    UPDATE tables SET name = @name, seats = @seats, area = @area, active = @active
     WHERE id = @id
  `);

  const deleteTableRow = db.prepare('DELETE FROM tables WHERE id = ?');

  const countOpenOrders = db.prepare<[number], { total: number }>(`
    SELECT COUNT(*) AS total FROM orders
     WHERE table_id = ?
       AND status NOT IN ('cancelled', 'delivered')
       AND merged_into_order_id IS NULL
  `);

  const setOrderTable = db.prepare('UPDATE orders SET table_id = ?, updated_at = ? WHERE id = ?');

  return {
    list(): DiningTable[] {
      return selectAll.all().map(toTable);
    },

    find(id: number): DiningTable | null {
      const row = selectById.get(id);
      return row ? toTable(row) : null;
    },

    save(input: {
      id?: number;
      name: string;
      seats: number;
      area: string;
      active: boolean;
    }): DiningTable {
      const clash = selectByName.get(input.name);
      if (clash && clash.id !== input.id) {
        throw new AppError('CONFLICT', `There is already a table called ${input.name}`);
      }

      if (typeof input.id === 'number') {
        const existing = selectById.get(input.id);
        if (!existing) throw new AppError('NOT_FOUND', 'That table does not exist');

        updateTable.run({
          id: input.id,
          name: input.name,
          seats: input.seats,
          area: input.area,
          active: input.active ? 1 : 0,
        });

        const updated = selectById.get(input.id);
        if (!updated) throw new AppError('INTERNAL_ERROR', 'The table was not saved');
        return toTable(updated);
      }

      const created = insertTable.run({
        name: input.name,
        seats: input.seats,
        area: input.area,
        active: input.active ? 1 : 0,
        createdAt: toSqlDateTime(),
      });

      const createdRow = selectById.get(Number(created.lastInsertRowid));
      if (!createdRow) throw new AppError('INTERNAL_ERROR', 'The table was not saved');
      return toTable(createdRow);
    },

    /**
     * Removes a table. Refused while a bill is open there: deleting the table would
     * leave a live order pointing at nothing.
     */
    remove(id: number): void {
      const existing = selectById.get(id);
      if (!existing) throw new AppError('NOT_FOUND', 'That table does not exist');

      if ((countOpenOrders.get(id)?.total ?? 0) > 0) {
        throw new AppError('CONFLICT', 'Close the bill at this table before removing it');
      }

      deleteTableRow.run(id);
    },

    /** Seats an order at a table, or frees the table when given null. */
    seatOrder(orderId: number, tableId: number | null): void {
      setOrderTable.run(tableId, toSqlDateTime(), orderId);
    },

    isTableFree(tableId: number, exceptOrderId: number | null): boolean {
      const row = selectById.get(tableId);
      if (!row) throw new AppError('NOT_FOUND', 'That table does not exist');
      if (row.order_id === null) return true;
      return row.order_id === exceptOrderId;
    },
  };
}

export type TablesRepository = ReturnType<typeof createTablesRepository>;
