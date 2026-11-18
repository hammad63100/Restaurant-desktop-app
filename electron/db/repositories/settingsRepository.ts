import type { AppDatabase } from '../connection';
import type { ShopSettings } from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

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

const toNumber = (value: string | null, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Settings are stored as text; this repository converts to the typed shape. */
/** What to put in the settings row for a logo value handed to us. */
function toStoredLogo(
  value: string | null,
  adoptDataUrl: (dataUrl: string) => string,
): string {
  if (!value) return '';
  // Already a file name written by the newer build.
  if (!value.startsWith('data:')) return value;
  // A data URL from an older database, or straight from the picker: move it to a
  // file so the settings row never grows to megabytes again.
  return adoptDataUrl(value);
}

export function createSettingsRepository(
  db: AppDatabase,
  /**
   * Turns the stored logo value into something printable. Injected so the
   * repository stays free of fs/paths and the rest of the app does not care
   * whether the logo is still inline (old database) or a file (new).
   */
  resolveLogo: (stored: string | null) => string | null = (stored) => stored,
  /** Moves an inline data URL into the logo directory and returns the file name. */
  adoptLogoDataUrl: (dataUrl: string) => string = (dataUrl) => dataUrl,
) {
  const selectOne = db.prepare<[string], SettingRow>(
    'SELECT key, value, updated_at FROM settings WHERE key = ? LIMIT 1',
  );
  const selectAll = db.prepare<[], SettingRow>('SELECT key, value, updated_at FROM settings');
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  return {
    get(key: string): string | null {
      return selectOne.get(key)?.value ?? null;
    },

    getAll(): Record<string, string> {
      return selectAll.all().reduce<Record<string, string>>((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
    },

    set(key: string, value: string): void {
      upsert.run(key, value, toSqlDateTime());
    },

    readShopSettings(): ShopSettings {
      const values = this.getAll();
      const width = values.receipt_width === 'a4' ? 'a4' : '80mm';

      return {
        shopName: values.shop_name ?? DEFAULTS.shopName,
        shopAddress: values.shop_address ?? DEFAULTS.shopAddress,
        shopPhone: values.shop_phone ?? DEFAULTS.shopPhone,
        // No logo stays null rather than an empty string; the UI checks for truthiness
        // and every caller types it as `string | null`.
        shopLogo: values.shop_logo ? resolveLogo(values.shop_logo) : null,
        currency: values.currency ?? DEFAULTS.currency,
        taxPercent: toNumber(values.tax_percent ?? null, DEFAULTS.taxPercent),
        receiptWidth: width,
        backupOnClose: (values.backup_on_close ?? '1') === '1',
        printerSilent: (values.printer_silent ?? '1') === '1',
      };
    },

    writeShopSettings(settings: ShopSettings): void {
      const write = db.transaction((input: ShopSettings) => {
        this.set('shop_name', input.shopName);
        this.set('shop_address', input.shopAddress);
        this.set('shop_phone', input.shopPhone);
        // The read path turns a file back into a data URL, so writing the value
        // straight back would re-inline it. Keep the file name instead.
        this.set('shop_logo', toStoredLogo(input.shopLogo, adoptLogoDataUrl));
        this.set('currency', input.currency);
        this.set('tax_percent', String(input.taxPercent));
        this.set('receipt_width', input.receiptWidth);
        this.set('backup_on_close', input.backupOnClose ? '1' : '0');
        this.set('printer_silent', input.printerSilent ? '1' : '0');
      });

      write(settings);
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
