# Rules.md

## 1. What to Use
- **TypeScript** everywhere (strict mode on).
- **Electron + React + Vite** for the app.
- **Tailwind CSS** for styling.
- **SQLite with `better-sqlite3`**, using prepared statements only.
- **Zustand** for state.
- **React Hook Form + Zod** for forms and validation.
- **bcrypt** for passwords.
- **date-fns** for dates.
- **lucide-react** for icons.
- **ESLint + Prettier** for code style.
- Money is stored as **integers** (whole rupees or paisa), never floats.
- Dates are stored as ISO strings (`YYYY-MM-DD HH:mm:ss`).
- Numbered SQL migrations for every database change.
- Each module has its own page folder, IPC file, and repository file.

## 2. What to Avoid
- Do **not** use `nodeIntegration: true` or disable `contextIsolation`.
- Do **not** access the database from React code. Use `window.api` only.
- Do **not** build SQL with string concatenation (SQL injection risk). Use prepared statements.
- Do **not** store plain-text passwords.
- Do **not** use floats for money.
- Do **not** add heavy or unmaintained libraries. Check weekly downloads and last update before adding any package.
- Do **not** add a library for something that is a few lines of code.
- Do **not** use `any` in TypeScript.
- Do **not** put business logic inside React components. Keep it in services or repositories.
- Do **not** hard-delete records that appear in old invoices (items, staff). Use an `active` flag (soft delete).
- Do **not** change an old order's prices when the menu price changes. Order items store the price at the time of sale.
- Do **not** use `localStorage` for important data.

## 3. Error Handling
- Every IPC handler returns a consistent result:
  ```ts
  { ok: true, data } | { ok: false, error: { code, message } }
  ```
- Wrap all database operations in `try/catch`. Log the technical error to a log file, show a short friendly message to the user.
- Use **transactions** for multi-step writes (for example saving an order plus order items plus invoice). Either everything saves or nothing does.
- Validate input twice: in the form (Zod) and again in the main process.
- Show errors with a toast or inline message, never a blank screen.
- Add a React **Error Boundary** so one broken page does not crash the whole app.
- Confirm before destructive actions (delete, cancel order).
- Automatic backup of the database file on app close (keep the last 7).
- Log errors to `logs/app.log` with timestamp.

## 4. Code Rules
- One component per file, PascalCase file names for components.
- Functions are small and do one thing.
- Use meaningful names (`calculateOrderTotal`, not `calc`).
- No commented-out dead code.
- Commit small and often with clear messages (`feat: add menu item form`).
- Every feature gets a quick manual test checklist before moving on.

## 5. UI Rules
- The New Order screen must work well with keyboard and mouse, and be fast.
- Buttons for daily actions must be large and clear (touch-friendly).
- Always show a loading state and an empty state.
- Use the same components and spacing across all pages (see design.md).

## 6. Working Rules for the AI Assistant / Developer
- Work on **one phase at a time**. Do not start the next phase until the current one is tested.
- Read `memory.md` at the start of every session and update it at the end.
- Do not change the folder structure without updating `architecture.md`.
- Ask before adding a new dependency.
