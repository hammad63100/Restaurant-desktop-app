import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface Column<T> {
  key: string;
  header: string;
  /** Right align numbers (money, counts). */
  align?: 'left' | 'right' | 'center';
  className?: string;
  render: (row: T) => ReactNode;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  emptyMessage?: string;
  emptyHint?: string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
}

/** Striped rows, sticky header, hover highlight (design.md section 7). */
export function Table<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'Nothing to show yet',
  emptyHint,
  onRowClick,
  isLoading = false,
}: TableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full border-collapse text-body">
        <thead className="sticky top-0 bg-background">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'border-b border-border px-3 py-2 text-left text-caption font-semibold uppercase tracking-wide text-text-secondary',
                  column.align === 'right' && 'text-right',
                  column.align === 'center' && 'text-center',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-text-secondary">
                Loading…
              </td>
            </tr>
          )}

          {!isLoading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center">
                <p className="text-body font-medium text-text-primary">{emptyMessage}</p>
                {emptyHint && <p className="mt-1 text-caption text-text-secondary">{emptyHint}</p>}
              </td>
            </tr>
          )}

          {rows.map((row, index) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                index % 2 === 1 && 'bg-background/60',
                onRowClick && 'cursor-pointer hover:bg-primary/5',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'border-b border-border px-3 py-2 text-text-primary',
                    column.align === 'right' && 'text-right tabular',
                    column.align === 'center' && 'text-center',
                    column.className,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
