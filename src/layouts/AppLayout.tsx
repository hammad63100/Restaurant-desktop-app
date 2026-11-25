import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Car,
  Package,
  ReceiptText,
  ClipboardList,
  HandCoins,
  LayoutDashboard,
  Lock,
  LogOut,
  Settings,
  Table2,
  Utensils,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import type { PageKey } from '../types/api';
import { PAGE_DEFINITIONS } from '../types/user';
import { ROLE_LABELS } from '../types/labels';
import { useAuth } from '../hooks/useAuth';
import { useSettings } from '../store/settingsStore';
import { cn } from '../utils/cn';

const PAGE_ICONS: Record<PageKey, typeof LayoutDashboard> = {
  home: LayoutDashboard,
  orders: ClipboardList,
  menu: Utensils,
  udhaar: HandCoins,
  shifts: Lock,
  tables: Table2,
  stock: Package,
  expenses: ReceiptText,
  staff: Users,
  vehicles: Car,
  reports: BarChart3,
  users: Users,
  settings: Settings,
};

const GROUP_LABELS = {
  main: 'Counter',
  staff: 'Shop',
  admin: 'Admin',
} as const;

/** Dark sidebar (240px) + top bar with shop name, current user and logout (design.md 8). */
export function AppLayout() {
  const { user, permissions, logout } = useAuth();
  const shopName = useSettings((settings) => settings.shopName);
  const shopLogo = useSettings((settings) => settings.shopLogo);
  const navigate = useNavigate();

  const visiblePages = PAGE_DEFINITIONS.filter((page) => permissions.includes(page.key));
  const groups = (['main', 'staff', 'admin'] as const)
    .map((group) => ({
      group,
      pages: visiblePages.filter((page) => page.group === group),
    }))
    .filter((section) => section.pages.length > 0);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-full bg-background">
      <aside className="flex w-[240px] shrink-0 flex-col bg-sidebar p-4 text-white">
        <div className="mb-6 flex items-center gap-3 px-1">
          {shopLogo ? (
            <img
              src={shopLogo}
              alt=""
              className="h-10 w-10 rounded-card bg-white object-contain p-1"
            />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-card bg-primary">
              <UtensilsCrossed aria-hidden className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-heading text-card-title" title={shopName}>
              {shopName}
            </p>
            <p className="text-caption text-white/60">Management</p>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {groups.map((section) => (
            <div key={section.group}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                {GROUP_LABELS[section.group]}
              </p>
              <div className="flex flex-col gap-1">
                {section.pages.map((page) => {
                  const Icon = PAGE_ICONS[page.key];
                  return (
                    <NavLink
                      key={page.key}
                      to={page.path}
                      className={({ isActive }) =>
                        cn(
                          'flex h-control items-center gap-3 rounded-control px-3 text-button transition-colors',
                          isActive
                            ? 'bg-primary text-white'
                            : 'text-white/70 hover:bg-white/10 hover:text-white',
                        )
                      }
                    >
                      <Icon aria-hidden className="h-5 w-5" />
                      {page.label}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <p className="px-1 text-caption text-white/40">Works offline</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
          <div className="min-w-0">
            <p className="truncate font-heading text-card-title text-text-primary">{shopName}</p>
            <p className="text-caption text-text-secondary">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-body font-medium text-text-primary">
                {user?.fullName || user?.username}
              </p>
              <p className="text-caption text-text-secondary">
                {user ? ROLE_LABELS[user.role] : ''}
              </p>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-control items-center gap-2 rounded-control border border-border px-3 text-button text-text-primary hover:bg-background"
            >
              <LogOut aria-hidden className="h-4 w-4" />
              Logout
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-[1200px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
