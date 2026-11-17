import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { BackupFile } from '../../src/types/api';
import { AppError } from '../utils/errors';
import { logError, logInfo } from './logger';

const KEEP_MANUAL_AND_AUTO = 7;

/**
 * Database backups. Copying the SQLite file is safe because the connection uses
 * WAL and the copy is taken with `VACUUM INTO`-like safety: we checkpoint first.
 */
export interface BackupWriter {
  /** Flushes WAL pages into the main file before the file is copied. */
  checkpoint(): void;
  /** Replaces the live database with the given backup copy. */
  replaceWith(sourcePath: string): void;
}

export function createBackupService(
  databaseFile: string,
  backupDirectory: string,
  writer: BackupWriter,
) {
  function ensureDirectory(): void {
    mkdirSync(backupDirectory, { recursive: true });
  }

  /** Milliseconds are included so two backups in the same second cannot overwrite each other. */
  function fileNameFor(reason: 'auto' | 'manual', when: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    const stamp =
      `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-` +
      `${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}` +
      `-${String(when.getMilliseconds()).padStart(3, '0')}`;
    return `fastfood-${reason}-${stamp}.db`;
  }

  function describe(filePath: string): BackupFile {
    const stats = statSync(filePath);
    return {
      fileName: path.basename(filePath),
      path: filePath,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
    };
  }

  function pruneOldAutoBackups(): void {
    const autos = readdirSync(backupDirectory)
      .filter((file) => file.startsWith('fastfood-auto-') && file.endsWith('.db'))
      .map((file) => path.join(backupDirectory, file))
      .sort()
      .reverse();

    for (const file of autos.slice(KEEP_MANUAL_AND_AUTO)) {
      try {
        unlinkSync(file);
        logInfo(`Removed old automatic backup: ${path.basename(file)}`);
      } catch (error) {
        logError(`Could not remove old backup ${file}`, error);
      }
    }
  }

  return {
    list(): BackupFile[] {
      ensureDirectory();
      return readdirSync(backupDirectory)
        .filter((file) => file.endsWith('.db'))
        .map((file) => describe(path.join(backupDirectory, file)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    createBackup(reason: 'auto' | 'manual'): BackupFile | null {
      try {
        ensureDirectory();
        writer.checkpoint();

        // Same-second backups get a counter suffix instead of overwriting each other.
        const baseName = fileNameFor(reason, new Date()).replace(/\.db$/, '');
        let target = path.join(backupDirectory, `${baseName}.db`);
        for (let suffix = 2; existsSync(target); suffix += 1) {
          target = path.join(backupDirectory, `${baseName}-${suffix}.db`);
        }

        copyFileSync(databaseFile, target);

        if (reason === 'auto') pruneOldAutoBackups();
        logInfo(`Backup created (${reason}): ${path.basename(target)}`);
        return describe(target);
      } catch (error) {
        logError('Backup failed', error);
        return null;
      }
    },

    restore(filePath: string): void {
      if (!existsSync(filePath)) {
        throw new AppError('NOT_FOUND', 'That backup file no longer exists');
      }
      if (path.extname(filePath).toLowerCase() !== '.db') {
        throw new AppError('VALIDATION_ERROR', 'Choose a backup file created by this app');
      }

      // Keep a safety copy of the current data before overwriting it.
      this.createBackup('auto');
      writer.replaceWith(filePath);
      logInfo(`Database restored from ${path.basename(filePath)}`);
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
