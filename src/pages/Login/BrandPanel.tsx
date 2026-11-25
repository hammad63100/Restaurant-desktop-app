import { UtensilsCrossed } from 'lucide-react';

/** Left half of the login screen: dark panel with the shop identity (design.md section 3). */
export function BrandPanel() {
  return (
    <aside className="relative hidden flex-col justify-between bg-sidebar p-8 text-white lg:flex lg:w-[45%]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-card bg-primary">
          <UtensilsCrossed aria-hidden className="h-5 w-5" />
        </span>
        <div>
          <p className="font-heading text-card-title">Gul Khan Fast Food</p>
          <p className="text-caption text-white/60">Shop Management</p>
        </div>
      </div>

      <div>
        <h1 className="mb-2 font-heading text-[32px] font-bold leading-[1.2]">
          Faster orders.
          <br />
          Cleaner records.
        </h1>
        <p className="max-w-sm text-body text-white/70">
          Take orders, print bills, and keep staff and vehicle records in one place — works fully
          offline on this computer.
        </p>
      </div>

      <p className="text-caption text-white/50">
        Version 0.1.0 · Data is stored only on this computer
      </p>

      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 top-1/3 h-64 w-64 rounded-full bg-primary/20 blur-3xl"
      />
    </aside>
  );
}
