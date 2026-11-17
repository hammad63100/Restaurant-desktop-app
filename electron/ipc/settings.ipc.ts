import { z } from 'zod';
import { CHANNELS, type ShopSettings } from '../../src/types/api';
import { shopSettingsSchema } from '../../src/types/schemas';
import type { SettingsService } from '../services/settingsService';
import type { BackupService } from '../services/backupService';
import type { HandlerRegistry } from './registry';

const restoreSchema = z.object({ filePath: z.string().min(1) });

export function settingsHandlers(
  settings: SettingsService,
  backups: BackupService,
): HandlerRegistry {
  return {
    [CHANNELS.settingsGet]: {
      handler: () => settings.get(),
    },

    [CHANNELS.settingsSave]: {
      capability: 'settings:write',
      schema: shopSettingsSchema,
      handler: (input: ShopSettings) => settings.save(input),
    },

    [CHANNELS.backupList]: {
      capability: 'backup:write',
      handler: () => backups.list(),
    },

    [CHANNELS.backupCreate]: {
      capability: 'backup:write',
      handler: () => backups.createBackup('manual'),
    },

    // Restore replaces the live database file, so it is admin-only and confirmed in the UI.
    [CHANNELS.backupRestore]: {
      capability: 'backup:write',
      schema: restoreSchema,
      handler: (input: { filePath: string }) => {
        backups.restore(input.filePath);
        return null;
      },
    },
  };
}
