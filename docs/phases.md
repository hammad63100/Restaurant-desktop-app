# phases.md

The project is split into phases. Finish and test each phase before starting the next.

---

## Phase 1: Project Setup and Login
**Goal:** A running app where a user can log in.
- Create Electron + React + TypeScript + Tailwind project
- Set up SQLite connection and migration system
- Create `users` and `settings` tables
- Create the default admin user on first run
- Build the Login page
- Password hashing and login check through IPC
- Role-based route protection (Admin, Cashier, Manager)
- Logout

**Done when:** Admin can log in and out, wrong password shows an error, and cashier cannot open admin-only pages.

---

## Phase 2: Dashboard and Layout
**Goal:** The main app shell.
- Sidebar and top bar layout
- Navigation to all modules (empty pages for now)
- Dashboard cards: today's sales, today's orders, pending deliveries
- Recent orders list (empty until Phase 3 is done)
- Shop name and logo from settings
- Settings page (shop name, tax %, logo)

**Done when:** After login the user sees the dashboard, can move between pages, and can save shop settings.

---

## Phase 3: Menu, Orders and Invoice (Core)
**Goal:** The shop can take orders and print bills.
- Categories and items CRUD with price
- New Order screen (order type, customer, items, quantity, discount, tax)
- Save order with transaction
- Orders List with search, filter, and status change
- Invoice template, print (80mm and A4), save as PDF, reprint
- Connect dashboard cards to real data

**Done when:** A cashier can create an order and print an invoice in under 30 seconds.

---

## Phase 4: Waiters and Delivery Boys
**Goal:** Staff records and salaries.
- Waiters CRUD
- Delivery boys CRUD
- Attendance
- Advances and deductions
- Monthly salary calculation and salary slip
- Assign waiter to dine-in orders and delivery boy to delivery orders
- Deliveries per rider count

**Done when:** The owner can see each staff member's monthly salary, advances, and net pay.

---

## Phase 5: Vehicles
**Goal:** Vehicle records and assignment.
- Vehicles CRUD
- Assign vehicle to delivery boy (with history)
- Fuel and maintenance expenses
- Document expiry reminders on the dashboard

**Done when:** The owner can see which vehicle is with which rider and the total expenses per vehicle.

---

## Phase 6: Reports, Backup and Release
**Goal:** Finish and ship.
- Daily and monthly sales report
- Top-selling items
- Salary summary, delivery report, vehicle expense report
- Export to PDF/Excel
- Backup and restore
- Bug fixing, performance check, UI polish
- Build Windows installer and test on a clean computer
- Short user guide for the owner and cashier

**Done when:** The installer works on a fresh PC and the owner approves.

---

*Note: if you prefer exactly 4 phases, merge them as: (1) Login + Dashboard, (2) Menu + Orders + Invoice, (3) Staff + Vehicles, (4) Reports + Release.*
