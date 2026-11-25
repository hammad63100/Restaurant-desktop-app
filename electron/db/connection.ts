import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type AppDatabase = Database.Database;

let database: AppDatabase | null = null;
let databasePath: string | null = null;

/**
 * Opens (or creates) the SQLite file and applies safe defaults.
 * Only ever called from the main process — the renderer never sees this module.
 */
export function openDatabase(filePath: string): AppDatabase {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });

  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  database = db;
  databasePath = filePath;
  return db;
}

export function getDatabase(): AppDatabase {
  if (!database) {
    throw new Error('Database is not open. openDatabase() must run before any query.');
  }
  return database;
}

export function getDatabasePath(): string {
  if (!databasePath) {
    throw new Error('Database is not open.');
  }
  return databasePath;
}

export function closeDatabase(): void {
  if (database) {
    database.close();
    database = null;
    databasePath = null;
  }
}
