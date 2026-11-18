import { create } from 'zustand';
import type { ShopSettings } from '../types/api';
import { getApi, unwrap } from '../utils/api';

const DEFAULTS: ShopSettings = {
  shopName: 'Gul Khan Fast Food',
  shopAddress: '',
  shopPhone: '',
  shopLogo: null,
  currency: 'PKR',
  taxPercent: 0,
  receiptWidth: '80mm',
  backupOnClose: true,
  printerSilent: true,
};

interface SettingsState {
  settings: ShopSettings;
  isLoaded: boolean;
  load: () => Promise<void>;
  save: (input: ShopSettings) => Promise<ShopSettings>;
}

/** Shop identity (name, logo, tax) is needed in the shell, the invoice and Settings. */
export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULTS,
  isLoaded: false,

  async load() {
    try {
      const settings = unwrap(await getApi().settings.get());
      set({ settings, isLoaded: true });
    } catch {
      // Fall back to defaults so the shell still renders; Settings page shows the error.
      set({ isLoaded: true });
    }
  },

  async save(input) {
    const settings = unwrap(await getApi().settings.save(input));
    set({ settings });
    return settings;
  },
}));

/** Narrow selector used by the layout and forms. */
export function useSettings<T>(selector: (settings: ShopSettings) => T): T {
  return useSettingsStore((state) => selector(state.settings));
}
