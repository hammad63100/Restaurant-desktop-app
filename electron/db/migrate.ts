import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from './connection';
import { logInfo } from '../services/logger';

interface MigrationFile {
  version: number;
  name: string;
  filePath: string;
}

/**
 * Finds `NNN_name.sql` files and sorts them by their numeric prefix.
 * The number is the migration version — never reuse or renumber one.
 */
function listMigrationFiles(directory: string): MigrationFile[] {
  const files = readdirSync(directory).filter((file) => file.endsWith('.sql'));

  return files
    .map((file) => {
      const match = /^(\d{3,})_.+\.sql$/.exec(file);
      if (!match || !match[1]) {
        throw new Error(`Migration file must be named NNN_description.sql: ${file}`);
      }
      return { version: Number(match[1]), name: file, filePath: path.join(directory, file) };
    })
    .sort((a, b) => a.version - b.version);
}

function ensureMigrationsTable(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedVersions(db: AppDatabase): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  return new Set(rows.map((row) => row.version));
}

/**
 * Applies every pending migration once, each inside its own transaction.
 * If a migration throws, nothing from it is kept and the error bubbles up.
 */
export function runMigrations(db: AppDatabase, directory: string): number {
  ensureMigrationsTable(db);
  const applied = appliedVersions(db);
  const files = listMigrationFiles(directory);

  let pending = 0;
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of files) {
    if (applied.has(migration.version)) continue;

    const sql = readFileSync(migration.filePath, 'utf8');
    const applyMigration = db.transaction(() => {
      db.exec(sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    });

    applyMigration();
    pending += 1;
    logInfo(`Migration applied: ${migration.name}`);
  }

  return pending;
}
