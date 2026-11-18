# memory.md

> Not needed at the beginning. Update this file at the end of every work session.
> Read it at the start of every session.

## Project
Fast Food Management Desktop App (Electron + React + SQLite)

## Current Status
- Current phase: **Roadmap Phase 1 (release blockers) complete — PR open, CI green. Phase 2 not started.**
- Original six phases are code complete and merged; the roadmap below hardens them before new features.
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
- [x] **Roadmap Phase 1 — release blockers** (no migration)
  - 1.A restore now validates, closes, copies, clears `-wal`/`-shm`, shows a dialog and relaunches
    (`app.relaunch()` + `app.exit(0)`) instead of leaving repositories on a dead handle
  - 1.B `validateBackupFile()` runs BEFORE the live DB is touched: read-only open,
    `PRAGMA integrity_check`, requires `schema_migrations` + `orders`, refuses a newer schema version
  - 1.C `orders:status` requires `orders:cancel` for `cancelled`, so a cashier cannot bypass the
    hidden button
  - 1.D sequence allocation moved inside the insert transaction (`ordersRepository.transaction`)
  - 1.E `monthEnd()` in `main.ts` + harness; `monthEndIso()` in the renderer (salary CSV had the same
    `${month}-31` bug); duplicate `markPrinted` removed from the print/pdf handlers; over-subtotal
    discount is a hard error
  - 1.F `.github/workflows/ci.yml` (Node 22, npm cache, four gates) — green

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
Last result: **107 checks passed, 0 failed** (`npm run test:all`), stable across repeated runs.

| Suite | Checks |
| --- | --- |
| Phase 1 (`scripts/auth-smoke-test.mjs`) | 20 |
| Phase 2 (`scripts/test-phase2.mjs`) | 15 |
| Phase 3 (`scripts/test-phase3.mjs`) | 18 |
| Phase 4 (`scripts/test-phase4.mjs`) | 11 |
| Phase 5 (`scripts/test-phase5.mjs`) | 13 |
| Phase 6 (`scripts/test-phase6.mjs`) | 13 |
| Phase 7 (`scripts/test-phase7.mjs`) | 17 |

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

## Roadmap status (post-merge spec)
- Phase 1 (release blockers): **done**, PR open, CI green, no migration used.
- Phase 2: **done** — payments/udhaar (008), shifts + X/Z report (009), discount rules (010),
  kitchen tickets + tokens (011).
- Phase 3: tables/merge/split (012), order amendments (013) and the **hardening block (014) done** —
  the phase is complete.
- Phase 4 (variants/combos, inventory/recipes, Urdu UI): not started.

## Known Issues / Bugs
- **Not launched on Windows yet.** This sandbox has no display and cannot download the Electron
  binary, so the desktop window, printing, PDF saving, native file dialogs and the NSIS installer
  still need a manual test on the shop PC (`docs/phase-1-test-checklist.md` plus the phase tests).
- Thermal 80mm output depends on the installed printer driver — verify on the real receipt printer.
  Silent printing is now the default; if the dialog is needed it can be turned off in Settings.
- No Urdu language support yet (open question from the PRD). Font would be Noto Nastaliq Urdu.
- Expense/salary history is per month; no multi-year archive screen (data is still stored).
- Restoring a backup **relaunches the app**; this is intentional (repositories cannot be swapped
  safely). The relaunch itself is not unit-tested — it needs a live Electron app.
- Phase 4 features still missing: variants/combos, inventory/recipes, Urdu UI.
- ~~Log rotation is not implemented~~ — **fixed**: `app.log` rotates to `app.log.1` at 5 MB and only
  one old file is kept (`electron/services/logger.ts`, covered by a Phase 6 test).

## Next Steps
1. `npm install`, then `npm run verify` on the shop PC (expect 90 checks passed).
2. `npm run dev` (optionally `SEED_DEMO=1` for sample data) and work through the manual checklist.
3. Confirm the thermal printer and the tax question (FBR/PRA) with the owner.
4. `npm run dist:win`, install on a clean PC, re-test login, order + print, backup/restore.
5. Optional polish after owner feedback: Urdu labels, log rotation, dark mode.

## Discount rules and approval (migration 010)
Rules are stored per role as percent **x100** (5.5% = 550), so half-percents survive the round
trip. `discountsService.resolve()` reports `{allowed, needsApproval, amount, errors, promoCode,
promoId}` and **never clamps**: a discount over the ceiling is an error the cashier must see,
never a quiet adjustment. Seeded: cashier 10% ceiling / approval above 5%, manager 50% / 25%,
owner 100% / never.

Decisions that are easy to undo by accident:

- **`discount:approve` is not the capability that guards the channel.** `discount:approve` is
  gated on `orders:write`. The real flow is a manager walking to the cashier's till and typing
  their own password into that session; requiring the approver's capability on the session would
  have made approval impossible without logging the cashier out. The actual gate is the
  approver's password plus `roleHasCapability(role, 'discount:approve')` in
  `discountsService.approve()`, which also refuses self-approval.
- **Approvals are single-use.** The approval is stamped with its order inside the order
  transaction (`consumeApproval`), so one manager approval cannot be replayed across a shift.
- **An approval is looked up by its own id**, not by order id — it exists before the order does.
- **A promo code bypasses the cashier's discretionary ceiling** (the owner authored it) but still
  cannot exceed the subtotal, and it counts its redemption in the order transaction, which is what
  makes `max_uses` mean anything. Promos and manual discounts do not stack.
- **A switched-off rule blocks discounts outright** rather than silently applying old limits.
- The owner's seeded threshold is **0 = never needs approval**; do not express "no limit" by
  deactivating the owner's rule.

Editing rules is admin-only (`roles: ['admin']`); promo codes need `discount:write` (managers).

## Kitchen tickets and tokens (migration 011)
- **Token** = the number called out to the customer. Allocated from `token_counters` per shop
  day, **inside the order transaction**, and only for `dine_in` / `takeaway`. Delivery orders get
  `token_no = NULL`: the rider has an address, and a token would only confuse the counter queue.
- **A cancelled order does not release its token.** A number that has been shouted across the
  shop cannot be re-issued without two customers holding the same one. The per-day counter is
  monotonic by design; do not "fix" the gap.
- **KOT** (`kotRepository.ticketFor` → `KOT`) deliberately has **no price fields at all**, so
  money cannot leak into the kitchen by accident. `scripts/test-phase11.mjs` asserts the shape,
  not just the template. The slip is 80mm, large-type, and a reprint is stamped
  *"Reprint — do not cook twice"*.
- `kot_prints` records each print with the user and the `order_item` ids (JSON, so a later
  "print only the new items" needs no migration). **Only a print that reached the printer is
  recorded**, which keeps the reprint marker honest; the preview throws on print for that reason.
- A cancelled order is refused rather than sent to the kitchen. Everyone who takes an order holds
  `kot:print`; reading a ticket needs only `orders:write`.
- The till prints the slip right after saving. A print failure is reported but never blocks the
  order — it is already saved and paid, and the invoice screen can reprint.

## Tables, merge and split (migration 012)
The invariant: **money never moves between orders.** Everything else follows from it.

- Merging is allowed only while **nothing has been paid** on either bill. A bill with any payment is
  refused with "void the payment first". Re-parenting a payment would make the day-close cash
  report a lie, and there is no reconciliation screen that could put it back.
- After a merge the **source keeps its totals** and is marked `merged_into_order_id` with status
  `delivered`. Its number still leads to the right order, and the day's takings still add up to
  exactly what they did before. Its table is freed.
- A split moves `order_item` rows to a **brand-new order** with its own ORD-/INV- numbers from the
  same sequences, sets `split_from_order_id`, and can seat the new bill at a free table. At least
  one line must stay behind — moving every line is what merge is for.
- Both operations recalculate totals **from the lines, inside one transaction**. The discount is
  re-derived from the percentage it represented and capped at the new subtotal, rather than
  carried across as a fixed amount that no longer relates to anything.
- A table holds **one open bill**. Enforced in `ordersService.create()` (so a second till cannot
  seat two bills at T4 by calling the channel) and again in the repository.
- A `tableId` sent with a takeaway order is **ignored, not silently seated**.
- A table with an open bill cannot be deleted.

Permissions: **merge/split are gated on `orders:write`** — it is till work done with the customer
present. `tables:write` is the floor plan itself (names, seats, removal) and is manager/admin only.
A careless `.replace()` once gave cashiers `tables:write`; the phase-12 test now pins the boundary.

## Order amendments (migration 013)
A saved bill can be edited. Three rules make that safe at a till:

1. **What is already paid is untouchable.** If the new total would fall below the money collected,
   the amendment is refused — there is no refund path that could put the difference back, so
   refusing is the only honest option. Adding food is always allowed.
2. **The discount is re-checked against the role of the person editing**, through the same
   `resolve()` the till uses, manager approval included. Otherwise a cashier could amend their way
   past a ceiling they could not pass on `create()`.
3. **Both versions are snapshotted.** `order_amendments` keeps the full before and after (totals and
   lines), the reason, and the user, in the same transaction as the change.
   `orders.amendment_count` is a cheap marker for lists and receipts.

Other decisions:
- An amendment states the **complete new set of lines**, not a delta. That makes the snapshot exact
  and the recalculation obvious; deltas would need replaying to know what a bill said.
- Tax is recomputed at the order's **own stored `tax_percent`**, never the current shop default, so
  changing tax in settings cannot retroactively alter an old bill.
- A cancelled bill, or one absorbed by a merge, cannot be amended.
- The receipt and the orders list both say the bill was edited, so a reprinted slip cannot pass
  itself off as the original.
- Channel names are singular: `order:amend` / `order:amendments` (not `orders:...`). Two test
  runs were wasted on that; the registry key list is the quickest way to check.

## Hardening (migration 014)

The five things that were fine in a demo and wrong in a shop. Each has a test in
`scripts/test-phase14.mjs` (17 checks), and each test was mutation-checked: revert the fix in
`dist-electron` and the test goes red.

- **Login lockout is persisted, not in memory.** `users.failed_attempts` + `users.locked_until`
  (partial index `idx_users_locked_until`). Five wrong passwords set the counter to 5 and stamp a
  5-minute lock; the row survives a restart, so quitting the app no longer resets the count. An
  *expired* lock lets the next attempt through and restarts the count at 1 instead of re-locking on
  one more typo. A good password clears both columns. An unknown username has no row to count
  against, but still pays the 200 ms delay so 'does this user exist?' cannot be timed.
  **The repository must *set* the absolute count**, never `failed_attempts + 1` — the service
  recomputes its base on every call, so an incrementing repository never reaches the threshold.
- **Silent printing.** `settings.printer_silent` (default on). `printService` reads it from
  `deps.silentPrinting()` at print time, so changing it in Settings takes effect without a restart.
  All three slips (invoice, X/Z report, KOT) share one `printOptions()` builder — previously the
  `silent: false` literal was copied three times and would have drifted.
- **Renderer sandbox.** `sandbox: true` alongside `contextIsolation: true` /
  `nodeIntegration: false`. This only works because the preload is now **bundled** into a single
  file by `scripts/copy-electron-assets.mjs`: under sandbox a preload gets a stub `require()`, so
  the old `require('../src/types/api')` would have thrown and `window.api` would never have existed
  — a blank, unclickable window. The copy script fails the build if a relative require survives.
- **Logo out of the settings blob.** It used to be a base64 data URL inside one settings value, up
  to 2 MB read out of SQLite on every invoice and duplicated into every backup. It is now a file in
  `userData/branding/` and the settings row holds a 13-character file name. `logoService` resolves a
  file name back to a data URL on read (what `<img src>` and the print window need) and refuses
  anything over 512 KB with a readable message. A logo stored inline by an older build is adopted
  into a file the next time settings are saved, so no database is stranded.
- **Keyset pagination.** `orders:list` takes `after: { createdAt, id }` and pages with
  `(o.created_at < ? OR (o.created_at = ? AND o.id < ?))` — spelled out because SQLite before 3.15
  cannot compare a row tuple. Offset paging got slower the deeper the cashier scrolled and could
  repeat a row when a new order arrived mid-scroll. `OrdersPage` loads 50 at a time with a
  **Load older orders** button and discards accumulated pages when a filter changes (in the filter
  setter, not an effect — the React compiler rejects `setState` inside `useEffect`).

## Last Updated
- Date: 2026-11-16
- By: Arena Agent (Phase 3 — hardening)
