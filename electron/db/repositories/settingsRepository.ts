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
};

const toNumber = (value: string | null, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Settings are stored as text; this repository converts to the typed shape. */
export function createSettingsRepository(db: AppDatabase) {
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
        shopLogo: values.shop_logo ? values.shop_logo : null,
        currency: values.currency ?? DEFAULTS.currency,
        taxPercent: toNumber(values.tax_percent ?? null, DEFAULTS.taxPercent),
        receiptWidth: width,
        backupOnClose: (values.backup_on_close ?? '1') === '1',
      };
    },

    writeShopSettings(settings: ShopSettings): void {
      const write = db.transaction((input: ShopSettings) => {
        this.set('shop_name', input.shopName);
        this.set('shop_address', input.shopAddress);
        this.set('shop_phone', input.shopPhone);
        this.set('shop_logo', input.shopLogo ?? '');
        this.set('currency', input.currency);
        this.set('tax_percent', String(input.taxPercent));
        this.set('receipt_width', input.receiptWidth);
        this.set('backup_on_close', input.backupOnClose ? '1' : '0');
      });

      write(settings);
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
