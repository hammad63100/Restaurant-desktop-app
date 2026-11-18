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
  admin: [
    'home',
    'orders',
    'menu',
    'staff',
    'vehicles',
    'reports',
    'users',
    'settings',
    'udhaar',
    'shifts',
    'tables',
  ],
  manager: ['home', 'orders', 'menu', 'staff', 'vehicles', 'reports', 'udhaar', 'shifts', 'tables'],
  cashier: ['home', 'orders', 'menu', 'udhaar', 'shifts', 'tables'],
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
    'payments:write',
    'payments:void',
    'udhaar:read',
    'udhaar:settle',
    'shifts:read',
    'shifts:write',
    'discount:write',
    'discount:approve',
    'kot:print',
    'tables:write',
  ],
  manager: [
    'orders:write',
    'orders:cancel',
    'menu:write',
    'staff:write',
    'vehicles:write',
    'reports:read',
    'payments:write',
    'payments:void',
    'udhaar:read',
    'udhaar:settle',
    'shifts:read',
    'shifts:write',
    'discount:write',
    'discount:approve',
    'kot:print',
    'tables:write',
  ],
  // A cashier takes payments and may look at udhaar, but cannot void money or settle
  // a customer account — that is a manager decision.
  // A cashier may give a small discount (`discount:write`) but cannot approve an
  // above-limit one — that needs a manager's own password.
  cashier: [
    'orders:write',
    'payments:write',
    'udhaar:read',
    'shifts:read',
    'shifts:write',
    'discount:write',
    'kot:print',
    // NOTE: a cashier deliberately has **no** 'tables:write'. They merge and split
    // bills all day (both channels are gated on 'orders:write'), but the floor plan
    // itself — table names, seat counts, removing tables — is a manager decision.
  ],
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
