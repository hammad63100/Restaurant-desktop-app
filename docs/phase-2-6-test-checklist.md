# Manual Test Checklist — Phases 2 to 6

Run `npm run dev` (or install the Windows build) and walk through this list before handover.
Everything below was verified headlessly (90 automated checks), but window, printing, dialogs and
the installer need a real machine.

Sign in as **admin** (default `admin` / `admin123`; the app forces a password change on first run).

## Phase 2 — Dashboard, layout and settings

- [ ] Sidebar shows Dashboard, Orders, Menu, Staff, Vehicles, Reports, Users, Settings; the active
      page is highlighted; the sidebar collapses on a narrow window.
- [ ] Dashboard shows today's sales, today's orders, month to date, pending deliveries, a 7-day
      trend and the recent-orders table.
- [ ] Settings → change shop name, address, phone and currency; save; the sidebar/login footer and
      a new invoice show the new values.
- [ ] Settings → upload a logo (PNG/JPG); the logo appears in the top bar and on invoices.
- [ ] Settings → change default tax %; a New Order starts with the new percentage.
- [ ] Users → create a cashier; sign out and sign in as that cashier; Menu/Orders work, Staff and
      Settings are hidden.
- [ ] Users → disable the cashier; that account can no longer sign in.
- [ ] Settings → Create backup now; the file appears in the backup list with size and date.
- [ ] Sign out and back in as admin with the wrong password 5 times → account locks with a clear
      message, not a crash.

## Phase 3 — Menu, orders and invoices

- [ ] Menu → add a category, then an item with price `350.50`; the list shows `Rs 350.50`.
- [ ] Menu → edit the price; old invoices keep the old price.
- [ ] Menu → try deleting a category that has items → blocked with a friendly message.
- [ ] Menu → toggle an item to sold out; it is marked on the New Order grid and cannot be added.
- [ ] Orders → New Order: add 3 items, change quantities, remove one; subtotal, discount, tax and
      total update correctly.
- [ ] Add a discount and a tax % → total = subtotal − discount + tax.
- [ ] Choose Dine-in → waiter list appears; choose Delivery → address and delivery boy are required.
- [ ] Save → order number continues from the last one (no duplicate error), invoice opens.
- [ ] Invoice → Print (80mm) opens the print dialog; Save PDF writes to Documents.
- [ ] Orders list → search by phone, filter by status and date; counts match the dashboard.
- [ ] Move an order pending → preparing → ready → delivered; going backwards is blocked.
- [ ] Cancel a pending order → status shows Cancelled, it leaves the sales totals.
- [ ] As a cashier, verify the order screen and invoice work but cancelling a *delivered* order is
      not offered.

## Phase 4 — Waiters, delivery boys, attendance and salary

- [ ] Staff → add a waiter with CNIC, address, join date and salary `30000`.
- [ ] Staff → add a delivery boy with commission `5` and assign a vehicle.
- [ ] Open a waiter → tap days on the calendar to cycle Present → Half day → Leave → Absent → clear;
      the count badges update.
- [ ] Add an advance of `5000`; it shows in the advance list and reduces the month's net pay.
- [ ] Salary slip shows per-day amount, present days, half days, earned, commission (riders),
      advances, deductions and net pay — check the arithmetic by hand once.
- [ ] Pay the salary → the slip shows the paid date; paying the same month again is blocked.
- [ ] Try an advance dated in the future → rejected.
- [ ] Remove the waiter from the active list → they disappear from new orders but their salary
      history is still viewable.

## Phase 5 — Vehicles

- [ ] Vehicles → add a bike with plate `ICT-1234`, registration and insurance expiry dates.
- [ ] Add a second vehicle with the same plate → rejected as a duplicate.
- [ ] Assign the bike to rider A → the vehicle row and the rider row both show the pairing.
- [ ] Reassign to rider B → history shows rider A (closed) and rider B (current).
- [ ] Try assigning the same rider a second vehicle → the first vehicle is released automatically.
- [ ] Release a vehicle → both sides show "free".
- [ ] Remove a vehicle that is currently assigned → blocked with a message.
- [ ] Add fuel and maintenance expenses; the period total on the row and in Reports match.
- [ ] Set an expiry date within 30 days and one in the past → the dashboard shows a reminder for
      both (amber and red).

## Phase 6 — Reports, backup and release

- [ ] Reports → preset Today / Last 7 days / This month / Last month; totals change accordingly.
- [ ] Sales tab: daily table, order-type breakdown and trend bars agree with the order list.
- [ ] Top items tab: quantity order descending.
- [ ] Deliveries tab: per-rider count, value and commission.
- [ ] Salaries tab: month picker; rows show Waiter / Delivery boy and net pay.
- [ ] Vehicle costs tab: fuel, maintenance, other, total, entries.
- [ ] Export CSV for each tab → file opens in Excel with correct columns and no broken characters.
- [ ] Settings → Create backup → file appears in `%APPDATA%\gul-khan-fast-food\backups`.
- [ ] Restore an old backup → app asks for confirmation, keeps a safety copy, data returns.
- [ ] Try restoring a `.txt` file → rejected with a friendly message.
- [ ] Close the app → a backup is created automatically (if "backup on close" is enabled).
- [ ] `npm run dist:win` produces `release/Gul Khan Fast Food Setup *.exe`; install on a clean
      machine, sign in, take an order, print, and restore a backup.
- [ ] The installer, Start Menu and desktop shortcut all show the red burger icon, and the window
      and taskbar show it too (not the default Electron logo).
- [ ] After a few weeks of use, `logs` contains only `app.log` and maybe `app.log.1` — it did not
      grow into a huge file.
- [ ] Give `docs/user-guide.md` to the cashier; they can take and reprint an order after 15 minutes
      of reading, without being shown.
- [ ] Uninstall leaves the data folder intact (no accidental data loss).

## Regression sweep

- [ ] Every page loads without a red error screen (Error Boundary not triggered).
- [ ] No `any`/SQL appears in `src/`; all IPC replies are `{ ok, data }` / `{ ok, error }`.
- [ ] Money always displays two decimals; no floating-point artefacts like `0.30000000000004`.
- [ ] Wrong permissions give a clear "you don't have access" message, never a blank page.
- [ ] Currency label change is reflected everywhere (settings, invoice, reports, CSV).
