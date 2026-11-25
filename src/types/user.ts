import type { PageKey } from './api';

export { ROLE_LABELS } from './labels';

/** Every page in sidebar order. `page` is the permission key the main process checks. */
export interface PageDefinition {
  key: PageKey;
  label: string;
  path: string;
  /** Grouping used by the sidebar sections. */
  group: 'main' | 'staff' | 'admin';
}

export const PAGE_DEFINITIONS: PageDefinition[] = [
  { key: 'home', label: 'Dashboard', path: '/dashboard', group: 'main' },
  { key: 'orders', label: 'Orders', path: '/orders', group: 'main' },
  { key: 'menu', label: 'Menu', path: '/menu', group: 'main' },
  { key: 'udhaar', label: 'Udhaar', path: '/udhaar', group: 'main' },
  { key: 'tables', label: 'Tables', path: '/tables', group: 'main' },
  { key: 'shifts', label: 'Day close', path: '/shifts', group: 'main' },
  { key: 'stock', label: 'Stock', path: '/stock', group: 'main' },
  { key: 'expenses', label: 'Expenses', path: '/expenses', group: 'main' },
  { key: 'staff', label: 'Staff', path: '/staff', group: 'staff' },
  { key: 'vehicles', label: 'Vehicles', path: '/vehicles', group: 'staff' },
  { key: 'reports', label: 'Reports', path: '/reports', group: 'admin' },
  { key: 'users', label: 'Users', path: '/users', group: 'admin' },
  { key: 'settings', label: 'Settings', path: '/settings', group: 'admin' },
];

export const ROLE_ORDER = ['admin', 'manager', 'cashier'] as const;
