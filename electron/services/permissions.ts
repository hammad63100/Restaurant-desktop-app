import type { Capability, PageKey, RolePermissions, UserRole } from '../../src/types/api';

/**
 * The single source of truth for what each role may do.
 * Lives in the main process on purpose: the renderer asks for it over IPC and
 * never decides permissions on its own (architecture.md section 7).
 *
 * Phase 2 expansion: a cashier runs the counter (orders + menu read-only),
 * a manager handles staff, vehicles and reports but not shop settings or users.
 */
const ROLE_PAGES: Record<UserRole, PageKey[]> = {
  admin: ['home', 'orders', 'menu', 'staff', 'vehicles', 'reports', 'users', 'settings'],
  manager: ['home', 'orders', 'menu', 'staff', 'vehicles', 'reports'],
  cashier: ['home', 'orders', 'menu'],
};

const ROLE_CAPABILITIES: Record<UserRole, Capability[]> = {
  admin: [
    'orders:write',
    'orders:cancel',
    'menu:write',
    'staff:write',
    'vehicles:write',
    'reports:read',
    'users:write',
    'settings:write',
    'backup:write',
  ],
  manager: [
    'orders:write',
    'orders:cancel',
    'menu:write',
    'staff:write',
    'vehicles:write',
    'reports:read',
  ],
  cashier: ['orders:write'],
};

export function getRolePermissions(role: UserRole): RolePermissions {
  return { role, pages: [...ROLE_PAGES[role]], capabilities: [...ROLE_CAPABILITIES[role]] };
}

export function roleHasPage(role: UserRole, page: PageKey): boolean {
  return ROLE_PAGES[role].includes(page);
}

export function roleHasCapability(role: UserRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
