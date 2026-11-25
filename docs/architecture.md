# architecture.md

## 1. Tech Stack
| Layer | Choice |
|---|---|
| Desktop shell | Electron |
| UI | React + TypeScript |
| Styling | Tailwind CSS |
| Database | SQLite (via `better-sqlite3`) |
| State | Zustand |
| Forms and validation | React Hook Form + Zod |
| Routing | React Router |
| Invoice/PDF | Electron's `webContents.print` / `printToPDF` |
| Packaging | electron-builder (Windows installer) |
| Auth | bcrypt for password hashing |

## 2. App Flow

```
Start App
   |
Login Screen --(wrong)--> error message
   |(success)
Dashboard
   |-- New Order --> select items --> customer/type --> save --> Invoice --> Print/PDF
   |-- Orders List --> view / reprint / change status
   |-- Menu --> categories / items / prices
   |-- Waiters --> list / add-edit / attendance / salary
   |-- Delivery Boys --> list / add-edit / assign vehicle / salary
   |-- Vehicles --> list / add-edit / expenses / assignment
   |-- Reports
   |-- Settings / Backup
```

## 3. Electron Process Architecture
- **Main process:** creates window, opens SQLite database, runs all database queries, handles printing and backup.
- **Preload script:** exposes a safe, limited API (`window.api`) to the UI.
- **Renderer process (React):** only UI. It never touches the database directly. It calls `window.api.*` which uses IPC to the main process.

```
React UI  --(window.api)-->  preload  --(IPC)-->  main process  -->  SQLite
```

## 4. Database Tables
- `users` (id, username, password_hash, role, active)
- `categories` (id, name)
- `items` (id, category_id, name, price, available, image)
- `customers` (id, name, phone, address)
- `orders` (id, order_no, type, customer_id, waiter_id, delivery_boy_id, status, subtotal, discount, tax, total, created_by, created_at)
- `order_items` (id, order_id, item_id, name, price, qty, line_total)
- `invoices` (id, invoice_no, order_id, printed_at)
- `waiters` (id, name, phone, cnic, address, join_date, salary, active)
- `delivery_boys` (id, name, phone, cnic, address, join_date, salary, vehicle_id, active)
- `attendance` (id, person_type, person_id, date, status)
- `advances` (id, person_type, person_id, amount, date, note)
- `salary_payments` (id, person_type, person_id, month, base, deductions, advances, net, paid_on)
- `vehicles` (id, type, plate_no, model, color, registration_expiry, insurance_expiry, active)
- `vehicle_assignments` (id, vehicle_id, delivery_boy_id, from_date, to_date)
- `vehicle_expenses` (id, vehicle_id, type, amount, date, note)
- `settings` (key, value)

Relationships: one order has many order_items and one invoice. An order links to one waiter or one delivery boy. A delivery boy links to one vehicle at a time.

## 5. Folder and File Structure

```
fastfood-app/
├── docs/                      (PRD.md, architecture.md, Rules.md, phases.md, design.md, memory.md)
├── package.json
├── electron-builder.yml
├── tsconfig.json
├── tailwind.config.js
├── electron/
│   ├── main.ts                # app entry, window
│   ├── preload.ts             # exposes window.api
│   ├── ipc/                   # one file per module
│   │   ├── auth.ipc.ts
│   │   ├── menu.ipc.ts
│   │   ├── orders.ipc.ts
│   │   ├── staff.ipc.ts
│   │   ├── vehicles.ipc.ts
│   │   ├── reports.ipc.ts
│   │   └── settings.ipc.ts
│   ├── db/
│   │   ├── connection.ts
│   │   ├── migrations/        # numbered .sql files
│   │   └── repositories/      # queries per table
│   └── services/
│       ├── printService.ts
│       └── backupService.ts
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── routes.tsx
    ├── components/            # shared UI (Button, Input, Table, Modal)
    ├── layouts/               # Sidebar + Topbar layout
    ├── pages/
    │   ├── Login/
    │   ├── Dashboard/
    │   ├── Menu/
    │   ├── Orders/
    │   ├── Invoice/
    │   ├── Waiters/
    │   ├── DeliveryBoys/
    │   ├── Vehicles/
    │   ├── Reports/
    │   └── Settings/
    ├── store/                 # Zustand stores
    ├── hooks/
    ├── utils/                 # formatCurrency, formatDate
    ├── types/
    └── styles/
```

## 6. Technical Tasks (high level)
1. Set up Electron + React + TypeScript + Tailwind project.
2. Set up SQLite connection and a migration system.
3. Build the IPC layer and the preload API.
4. Build the auth system (hashing, session in memory, role guard on routes and IPC).
5. Build the shared UI components.
6. Build each module (page + IPC + repository).
7. Build the invoice template and printing.
8. Build reports queries.
9. Build backup/restore.
10. Package a Windows installer and test on a clean PC.

## 7. Security Notes
- `contextIsolation: true`, `nodeIntegration: false`.
- Passwords are always hashed.
- Role checks happen in the main process, not only in the UI.
