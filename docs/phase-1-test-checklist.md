# Phase 1 — Manual Test Checklist (Setup and Login)

Run these on the Windows machine that will be used at the shop.
Phase 1 is "done" when every box below is ticked.

```bash
npm install
npm run dev
```

## A. First run and database

- [ ] The window opens showing the **Sign in** screen (dark panel on the left, red accents).
- [ ] The file `%APPDATA%\gul-khan-fast-food\data\fastfood.db` exists after the window opens.
- [ ] The file `%APPDATA%\gul-khan-fast-food\logs\app.log` exists and mentions the migrations.
- [ ] Closing and reopening the app does **not** re-create the admin or lose data.

Optional check with a SQLite viewer (DB Browser for SQLite):

- [ ] Tables `users`, `settings`, `schema_migrations` exist.
- [ ] `schema_migrations` has rows 1 and 2.
- [ ] `users` has one row: `admin`, role `admin`, `must_change_password = 1`.
- [ ] `password_hash` starts with `$2b$` (bcrypt) and is **not** the text `admin123`.
- [ ] `settings` contains `shop_name`, `tax_percent`, `currency`, `receipt_width`.

## B. Wrong credentials

- [ ] Username `admin`, password `wrong` → red inline message "Wrong username or password", no crash.
- [ ] Unknown user `nobody` / `admin123` → same generic message (it must not reveal which part was wrong).
- [ ] Empty username or password → field-level validation message, no request sent.
- [ ] 5 wrong attempts in a row → "Too many wrong attempts. Please wait 5 minutes and try again."
- [ ] Wrong attempts appear in `logs/app.log` as `WARN` lines.

## C. First login and forced password change

- [ ] `admin` / `admin123` signs in and lands on **Set a new password** (not the dashboard).
- [ ] Navigating to `#/dashboard` or `#/settings` manually keeps returning to that screen.
- [ ] New password shorter than 8 characters → inline validation error.
- [ ] Confirmation that does not match → inline validation error.
- [ ] Current password typed wrong → "Current password is not correct".
- [ ] Same password as the old one → rejected with a clear message.
- [ ] Saving a valid password (e.g. `OwnerPass123`) opens the Dashboard.
- [ ] After logout, `admin` / `admin123` no longer works and `admin` / `OwnerPass123` does.
- [ ] After reload (Ctrl+R) the session is restored without asking for credentials again.

## D. Roles and route protection

Create test accounts (until the Users page exists in a later phase, use a SQLite viewer or ask
the assistant for a seed script):

| Username  | Password     | Role    |
| --------- | ------------ | ------- |
| cashier1  | Cashier123   | cashier |
| manager1  | Manager123   | manager |

- [ ] **Cashier** sees only *Dashboard* in the sidebar.
- [ ] Cashier opening `#/users`, `#/reports` or `#/settings` manually → "Not allowed" page, not the data.
- [ ] Cashier cannot see the Settings/Users items in the navigation at all.
- [ ] **Manager** sees *Dashboard* and *Reports*, but opening `#/settings` or `#/users` → "Not allowed".
- [ ] **Admin** sees all four pages and can open each of them.
- [ ] Disabled account (`active = 0`) → "This account is disabled. Contact the owner."

## E. Logout

- [ ] The **Logout** button in the top bar returns to the Sign in screen.
- [ ] Pressing Back in the window does not return to the dashboard (session is gone).
- [ ] Reloading after logout stays on Sign in.
- [ ] `logs/app.log` contains a `Logout for "admin"` line.

## F. Robustness

- [ ] A page that throws (temporarily break one component) shows the Error Boundary card with a
      **Reload the screen** button instead of a blank white window.
- [ ] Running the app twice (second copy) focuses the first window instead of opening a second one.
- [ ] `npm run typecheck`, `npm run lint` and `npm run test:auth` all pass on the shop PC
      (`npm run test:auth` prints `20 checks passed`).
- [ ] No internet connection: the app still starts, signs in and shows correct fonts.

## G. Production build (optional in Phase 1)

```bash
npm run build
npm start
npm run dist:win
```

- [ ] The built app opens from `dist/` (no dev server) and login still works.
- [ ] The NSIS installer in `release/` installs and the installed app signs in.
