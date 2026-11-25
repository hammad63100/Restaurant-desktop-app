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
    'stock',
    'expenses',
  ],
  manager: [
    'home',
    'orders',
    'menu',
    'staff',
    'vehicles',
    'reports',
    'udhaar',
    'shifts',
    'tables',
    'stock',
    'expenses',
  ],
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
    // Roadmap Phase 4 — the owner's books.
    'inventory:read',
    'inventory:write',
    'purchases:write',
    'purchases:void',
    'stock:adjust',
    'recipes:write',
    'expenses:read',
    'expenses:write',
    'expenses:void',
    'costs:read',
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
    // A manager runs the shop day to day and sees stock and expenses, but NOT
    // 'costs:read' — cost, margin and profit stay the owner's numbers.
    'inventory:read',
    'inventory:write',
    'purchases:write',
    'purchases:void',
    'stock:adjust',
    'recipes:write',
    'expenses:read',
    'expenses:write',
    'expenses:void',
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
    // A cashier may see stock levels (to answer "is the zinger available?") and
    // the low-stock banner, but cannot change stock, costs or the books.
    'inventory:read',
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
