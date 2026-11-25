# Gul Khan Fast Food — Fast Food Management Desktop App

Offline Windows desktop app (Electron + React + TypeScript + Tailwind + SQLite) for taking orders,
printing invoices, and keeping staff, vehicle, salary and sales records.

**All six phases in `docs/phases.md` are implemented.** See `docs/memory.md` for current status,
decisions and known gaps.

---

## 1. Requirements

- Windows 10/11 (64-bit)
- Node.js 22 LTS or newer (`node -v`)
- npm 10 or newer

No internet is needed after installation. All data stays on the computer.

## 2. Install

```bash
npm install
```

`better-sqlite3` and `bcrypt` ship prebuilt N-API binaries, so nothing is compiled on a normal
machine. If you ever see a native-binding error:

```bash
npm run rebuild:native
```

## 3. Run the app

```bash
npm run dev        # Vite + Electron window with hot reload
npm run build      # compile main process + production renderer
npm start          # run Electron against the production build
npm run dist:win   # Windows NSIS installer in release/
```

### Commands

| Command             | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | Vite on 5173 + Electron window                          |
| `npm run verify`    | Typecheck + lint + **all phase tests** (90 checks)      |
| `npm run test:all`  | Build main process, then run every phase test           |
| `npm run test:auth` | Phase 1 checks only                                     |
| `npm run typecheck` | Strict TypeScript for renderer, config and main process |
| `npm run lint`      | ESLint                                                  |
| `npm run format`    | Prettier                                                |
| `npm run preview`   | Browser-only UI preview with a throw-away demo database |

## 4. First run and sign-in

1. The app creates `%APPDATA%\gul-khan-fast-food\data\fastfood.db` on first start.
2. Migrations in `electron/db/migrations/` run automatically (numbered, applied once).
3. A default admin is created: **admin / admin123**, and the first login is forced to a
   **Set a new password** screen.
4. To explore with sample data instead: `SEED_DEMO=1 npm run dev` (Windows PowerShell:
   `$env:SEED_DEMO=1; npm run dev`) — adds demo users `manager/manager123`, `cashier/cashier123`,
   a menu, staff and a few orders.

Logs (failed logins, errors): `%APPDATA%\gul-khan-fast-food\logs\app.log`
Backups: `%APPDATA%\gul-khan-fast-food\backups\` (automatic on close, last 7 kept).
PDF/CSV exports: `Documents\Gul Khan Fast Food\`.

## 5. Features

- **Login and roles** — bcrypt passwords, forced password change, 5-attempt lockout, session in
  main-process memory only. Roles: Admin, Manager, Cashier.
- **Dashboard** — today's sales/orders, month to date, pending deliveries, 7-day trend, recent
  orders, vehicle document reminders.
- **Menu** — categories and items, prices in rupees+paisa, sold-out toggle (cashiers may toggle).
- **Orders** — New Order screen (menu grid + cart + totals), Dine-in/Takeaway/Delivery, waiter or
  rider, discount, tax %, order notes, search and filters, status flow, cancel with confirmation.
- **Invoice** — on-screen receipt preview, print to 80mm thermal or A4, save as PDF, reprint.
- **Staff** — waiters and delivery boys, attendance calendar, advances, monthly salary slip with
  per-day maths, commission for riders, salary payment record.
- **Vehicles** — bikes/cars, number plate, assignment history, release, fuel/maintenance expenses,
  registration/insurance expiry reminders.
- **Reports** — daily sales, top items, deliveries, salary summary, vehicle costs, date presets,
  CSV export (opens in Excel).
- **Settings** — shop name/address/phone/logo, currency label, default tax %, receipt paper,
  backup on close, manual backup and restore.
- **Users** — admin creates cashier/manager/admin accounts, resets passwords, disables accounts;
  the last active admin cannot be disabled.

## 6. Project structure

```
electron/            main process: window, SQLite, repositories, services, IPC
  ipc/               one file per module + registry.ts (single dispatch point)
  db/migrations/     numbered .sql files (001 … 007)
  db/repositories/   all SQL, prepared statements only
  db/seed.ts         default admin; db/seedDemo.ts optional demo data
  services/          auth, permissions, catalog, orders, staff, vehicles,
                     reports, csv, print, backup, settings, users, logger
src/                 React renderer (UI only, never touches SQLite)
  components/ layouts/ pages/ hooks/ store/ types/ utils/ styles/
docs/                PRD, architecture, Rules, phases, design, memory, checklists
scripts/             dev launcher, preview server, test harness and phase tests
```

Renderer → `window.api` → preload → IPC → **registry** → service → repository → SQLite.

Every channel declares its role/capability and Zod schema in `electron/ipc/*.ipc.ts`, and
`electron/ipc/registry.ts` enforces: authentication → role → capability → validation → handler.

## 7. Roles

| Page      | Admin | Manager | Cashier                |
| --------- | ----- | ------- | ---------------------- |
| Dashboard | ✓     | ✓       | ✓                      |
| Orders    | ✓     | ✓       | ✓                      |
| Menu      | ✓     | ✓       | read + sold-out toggle |
| Staff     | ✓     | ✓       | —                      |
| Vehicles  | ✓     | ✓       | —                      |
| Reports   | ✓     | ✓       | —                      |
| Users     | ✓     | —       | —                      |
| Settings  | ✓     | —       | —                      |

Cashiers can read the staff lists because order entry needs waiter/rider names, but cannot write.

## 8. Rules honoured

- `contextIsolation: true`, `nodeIntegration: false`; no DB access from React.
- Prepared statements only; no `any`; money is integer **paisa** everywhere.
- Dates stored as `YYYY-MM-DD HH:mm:ss`.
- Every IPC reply is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`; friendly
  messages reach the UI, technical detail goes to `logs/app.log`.
- Zod validation in the form **and** in the main process.
- Transactions for order + items + invoice, and for settings writes.
- Soft delete (`active`) for items, categories, staff and vehicles.
- Order items snapshot name/price, so price changes never alter old invoices.
- Error Boundary plus route error element; confirmation dialogs for destructive actions.
