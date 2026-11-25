import type { AppDatabase } from '../connection';

export type SequenceName = 'order' | 'invoice';

/**
 * Document numbers come from a table row updated inside the caller's transaction.
 * If the transaction rolls back, the number is released instead of being skipped.
 */
export function createSequenceRepository(db: AppDatabase) {
  const read = db.prepare<[string], { next_value: number }>(
    'SELECT next_value FROM number_sequences WHERE name = ?',
  );
  const bump = db.prepare('UPDATE number_sequences SET next_value = ? WHERE name = ?');
  const ensure = db.prepare(
    'INSERT OR IGNORE INTO number_sequences (name, next_value) VALUES (?, 1)',
  );

  return {
    next(name: SequenceName): number {
      ensure.run(name);
      const row = read.get(name);
      const value = row?.next_value ?? 1;
      bump.run(value + 1, name);
      return value;
    },
  };
}

export type SequenceRepository = ReturnType<typeof createSequenceRepository>;
