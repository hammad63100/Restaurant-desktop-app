# memory.md

> Not needed at the beginning. Update this file at the end of every work session.
> Read it at the start of every session.

## Project
Fast Food Management Desktop App (Electron + React + SQLite)

## Current Status
- Current phase: **All six phases implemented (code complete, awaiting manual testing on Windows)**
- File currently being worked on: `docs/memory.md` (last code file: `src/pages/Reports/ReportsPage.tsx`)
- App runs offline; data file: `%APPDATA%\gul-khan-fast-food\data\fastfood.db`
- Logs: `%APPDATA%\gul-khan-fast-food\logs\app.log`
- Backups: `%APPDATA%\gul-khan-fast-food\backups\` (auto on close, keeps last 7)
- Exports: `Documents\Gul Khan Fast Food\` (invoice PDF, report CSV)

## Completed
- [x] Planning and documents (PRD, architecture, Rules, phases, design)
- [x] Phase 1 — setup, SQLite + numbered migrations, `users`/`settings`, default admin, login,
      forced password change, IPC auth, role guards, logout
- [x] Phase 2 — app shell (dark sidebar + top bar), dashboard cards and 7-day trend, recent orders,
      vehicle reminders, shop settings (name, address, phone, logo, currency, tax, paper, backup
      on close), Users page (create/edit/disable/reset password), backup list/create/restore
- [x] Phase 3 — categories and items CRUD, sold-out toggle, New Order screen (menu grid + cart +
      totals), order type/waiter/rider/customer/discount/tax/notes, order + items + invoice in one
      transaction, orders list with search and filters, status flow, cancel, invoice preview,
      print (80mm/A4), save PDF, reprint
- [x] Phase 4 — waiters, delivery boys (commission + vehicle), attendance calendar, advances,
      monthly salary slip (per-day maths, half days, commission, advances, deductions), salary
      payment record, waiter/rider links on orders
- [x] Phase 5 — vehicles CRUD, assign/reassign/release with history, fuel/maintenance/other
      expenses, registration/insurance expiry reminders
- [x] Phase 6 — reports (sales, top items, deliveries, salaries, vehicle costs), date presets, CSV
      export, backup/restore, README, phase test suites
- [x] Release polish — app icon (`build/icon.ico` + `build/icon.png`, wired into NSIS and the
      window), `docs/user-guide.md` for owner/cashier, log rotation, installer config validated by
      electron-builder's own schema in a test

PR #2 (`arena/7b07c844-gul-khan-fast-food` → `main`) carries phases 2–6; all checks green.

## Phase Progress
- [x] Phase 1: Setup and Login
- [x] Phase 2: Dashboard and Layout
- [x] Phase 3: Menu, Orders and Invoice
- [x] Phase 4: Waiters and Delivery Boys
- [x] Phase 5: Vehicles
- [x] Phase 6: Reports, Backup and Release

## Verification (headless)
`npm run verify` runs typecheck + lint + all phase tests.
Last result: **90 checks passed, 0 failed** (`npm run test:all`), stable across repeated runs.

| Suite | Checks |
| --- | --- |
| Phase 1 (`scripts/auth-smoke-test.mjs`) | 20 |
| Phase 2 (`scripts/test-phase2.mjs`) | 15 |
| Phase 3 (`scripts/test-phase3.mjs`) | 18 |
| Phase 4 (`scripts/test-phase4.mjs`) | 11 |
| Phase 5 (`scripts/test-phase5.mjs`) | 13 |
| Phase 6 (`scripts/test-phase6.mjs`) | 13 |

## Decisions Made
- Electron 45, React 19, Vite 7, TypeScript 5.9, Tailwind 3, Zustand 5, React Router 7 (hash
  router because the packaged app loads from `file://`).
- `bcrypt` (native) as listed in Rules.md; `@fontsource/poppins` + `@fontsource/inter` bundled.
- `better-sqlite3` 13 and `bcrypt` 6 ship N-API prebuilds → `npmRebuild: false`, no compile step.
- **Money is integer paisa** everywhere (1 rupee = 100 paisa). The UI converts with
  `src/utils/format.ts`; the main process uses `electron/utils/money.ts`.
- `full_name` added to `users`; `tax_percent` stored as an integer percentage.
- **IPC registry** (`electron/ipc/registry.ts`): one place declares every channel with its schema,
  allowed roles and capability. The Electron main process and the dev preview server both dispatch
  through it, so rules cannot drift. Order of checks: auth → role → capability → zod → handler.
- Capabilities are separate from pages: a cashier may *read* staff lists (order entry needs
  waiter/rider names) and toggle sold-out items, but cannot write staff, menu, vehicles or settings.
- Number sequences table (`number_sequences`) allocates `ORD-00001` / `INV-00001` inside the order
  transaction; demo seeding uses the same sequence.
- Salary rules: `perDay = salary / days in month`; `earned = present*perDay + halfDays*perDay/2`;
  `net = earned + commission - advances - deductions`. Commission is `order.total * commission%`
  for delivered delivery orders that month. Salary can only be paid once a month per person, and
  only after attendance exists.
- Staff and vehicles are soft deleted (`active = 0`); the UI hides them from active lists but old
  orders, salary slips and vehicle history keep working.
- Vehicle assignment enforces one open assignment per vehicle and one rider per vehicle; the rider
  row (`delivery_boys.vehicle_id`) and the history table are updated together.
- Backups: `wal_checkpoint(TRUNCATE)` then file copy, filename includes milliseconds plus a numeric
  suffix so two backups in the same second cannot overwrite each other. Restore keeps a safety
  copy first and only accepts `.db` files.
- CSV export is hand-written (no extra library, Rules.md "don't add a library for a few lines"),
  with UTF-8 BOM so Excel opens it correctly.
- Dev-only browser preview: `npm run preview` serves the built UI with the real registry over HTTP
  and a throw-away demo database (`scripts/preview-server.mjs`, `preview-bridge.js`). Never
  shipped; `npm run dev` and the Windows build do not use it.
- `scripts/` and `docs/phase-1-test-checklist.md` are not in architecture.md; no app code lives
  there. `electron/ipc/registry.ts` was added next to the documented per-module `.ipc.ts` files.

## Known Issues / Bugs
- **Not launched on Windows yet.** This sandbox has no display and cannot download the Electron
  binary, so the desktop window, printing, PDF saving, native file dialogs and the NSIS installer
  still need a manual test on the shop PC (`docs/phase-1-test-checklist.md` plus the phase tests).
- Printing uses the system print dialog (`webContents.print`); thermal 80mm output depends on the
  installed printer driver — verify on the real receipt printer.
- No Urdu language support yet (open question from the PRD). Font would be Noto Nastaliq Urdu.
- Expense/salary history is per month; no multi-year archive screen (data is still stored).
- ~~Log rotation is not implemented~~ — **fixed**: `app.log` rotates to `app.log.1` at 5 MB and only
  one old file is kept (`electron/services/logger.ts`, covered by a Phase 6 test).

## Next Steps
1. `npm install`, then `npm run verify` on the shop PC (expect 90 checks passed).
2. `npm run dev` (optionally `SEED_DEMO=1` for sample data) and work through the manual checklist.
3. Confirm the thermal printer and the tax question (FBR/PRA) with the owner.
4. `npm run dist:win`, install on a clean PC, re-test login, order + print, backup/restore.
5. Optional polish after owner feedback: Urdu labels, log rotation, dark mode.

## Last Updated
- Date: 2026-11-16
- By: Arena Agent (Phases 2–6)
