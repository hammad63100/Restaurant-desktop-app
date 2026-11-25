import type { ShopSettings } from '../../src/types/api';
import type { SettingsRepository } from '../db/repositories/settingsRepository';
import { logInfo } from './logger';

export function createSettingsService(settings: SettingsRepository) {
  return {
    get(): ShopSettings {
      return settings.readShopSettings();
    },

    save(input: ShopSettings): ShopSettings {
      settings.writeShopSettings(input);
      logInfo('Shop settings updated');
      return settings.readShopSettings();
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
