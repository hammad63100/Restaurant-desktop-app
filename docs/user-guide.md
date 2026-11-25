# Gul Khan Fast Food — User Guide

A short guide for the owner and the counter staff. No computer knowledge needed.

---

## 1. Starting the app

Double-click the **Gul Khan Fast Food** icon on the desktop.

- The first time, it asks you to sign in with **admin / admin123**, then makes you choose a new
  password. Choose something you will remember — write it down somewhere safe.
- If the app is already open, clicking the icon brings the open window back instead of opening a
  second copy.
- If the window does not appear, wait 10 seconds and try again. The app is starting.

To close the app, click the **✕** in the top-right corner, or **Sign out** first and then close it.
Closing normally is important: the app makes a **backup** every time it closes.

---

## 2. Signing in

1. Type your **username** and **password**.
2. Click **Sign in**.

Three kinds of account:

| Account | Who it is for | What they can open |
| --- | --- | --- |
| **Admin** | The owner | Everything, including Settings and Users |
| **Manager** | Shift in-charge | Dashboard, Orders, Menu, Staff, Vehicles, Reports |
| **Cashier** | Counter staff | Dashboard, Orders, Menu (can mark items sold out) |

A cashier **cannot** see salaries, vehicle costs, reports, settings or other users' accounts.

**If you forget your password**, the admin can reset it from **Users**. If the admin forgets theirs,
call the technician — do not reinstall the app.

**After 5 wrong passwords** the account is locked for 15 minutes. Wait, then try again.

---

## 3. Dashboard (the first screen)

Shows how the shop is doing today:

- **Today's sales** and **today's orders**
- **Month to date** sales
- **Pending deliveries** — orders that have not gone out yet
- A **7-day trend** so you can see busy and quiet days
- **Recent orders** — click one to open its invoice
- **Vehicle reminders** in amber/red when a bike's registration or insurance is expiring

---

## 4. Taking an order (the cashier's main job)

1. Click **New Order** (left sidebar, or the dashboard button).
2. Click the items the customer wants. Each click adds one. Use **+ / −** in the cart to change
   quantity, or the bin icon to remove a line.
3. Choose the order type:
   - **Dine-in** → pick the waiter's name
   - **Takeaway** → nothing else needed
   - **Delivery** → type the **phone number and address**, and pick the **delivery boy**
4. If the shop gives a discount, type it in **Discount**.
5. Check the **Total** at the bottom, then click **Save order**.

The invoice opens automatically. Hotkeys: **Enter** saves the order, **Esc** closes a popup.

### Printing the invoice

On the invoice screen:

- **Print** — choose the receipt printer. Use the **80mm** option for the thermal roll printer and
  **A4** for a normal sheet.
- **Save PDF** — saves a copy in `Documents\Gul Khan Fast Food`. Useful to send on WhatsApp.
- **Reprint** — print an old invoice again from the Orders list.

> If the printer prints on the wrong paper size, change **Receipt paper** in **Settings**.

### Finding an old order

Go to **Orders**. You can:

- Type a **phone number** or order number in the search box
- Filter by **status** (Pending, Preparing, Ready, Delivered, Cancelled)
- Filter by **date**

Click an order to open it, change its status, print it again, or cancel it.

**Order status:** `Pending → Preparing → Ready → Delivered`. You cannot go backwards. An order can
be cancelled until it is delivered — the app asks you to confirm first.

---

## 5. Menu and prices (admin / manager)

Go to **Menu**.

- **Add category** — Burgers, Pizza, Drinks, etc.
- **Add item** — name, price, category, optional photo.
- **Edit** — change the name or price.
- **Sold out** — switch an item off. It stays on old invoices but cannot be added to new orders.
- **Delete** — only for items you created by mistake. A category that still has items cannot be
  deleted; move or delete the items first.

> Changing a price **does not** change old invoices. They keep the price at the time of sale. This
> is correct and intentional.

Prices are typed in rupees and paisa, e.g. `350.50`.

---

## 6. Staff, attendance and salaries (admin / manager)

Go to **Staff**. There are two tabs: **Waiters** and **Delivery boys**.

### Adding a person

Click **Add waiter** / **Add delivery boy** and fill in the name, phone, CNIC, address, join date
and **monthly salary**. For delivery boys also set the **commission %** they earn on deliveries.

### Marking attendance

Open a person and tap a day on the calendar. Each tap changes the day:

`Present → Half day → Leave → Absent → clear`

Mark attendance **every day** — the salary is calculated from it.

### Advances

If a staff member takes money early in the month, click **Add advance** and record the amount and
date. It is subtracted from the month's salary automatically. A future date is not allowed.

### Salary slip

Open a person and pick the month. The slip shows:

- **Per day** amount (monthly salary ÷ days in the month)
- **Present** days, **half days**, leaves and absences
- **Earned salary** — present × per day, plus half of per day for each half day
- **Commission** — the delivery boy's share of the deliveries he made
- **Advances** and any **deductions** you type in
- **Net pay** — the amount to hand over

Click **Pay salary** when you have paid. This records the date and **blocks paying the same month
twice**, so you cannot pay twice by mistake.

> Removing a person from the list does not delete their history. Old orders, attendance and salary
> slips still show their name.

---

## 7. Vehicles (admin / manager)

Go to **Vehicles**.

- **Add vehicle** — bike or car, number plate, model, colour, and the **registration** and
  **insurance expiry dates**.
- **Assign** — pick the delivery boy who takes the bike. Only one rider per vehicle, and one vehicle
  per rider; assigning the rider a second vehicle releases the first.
- **Release** — when a rider leaves or the bike goes to the workshop.
- **History** — see who had the vehicle and when, plus this month's costs.
- **Add expense** — record **fuel**, **maintenance** (oil, tyres, chain) or other costs.

The **Dashboard** warns you in amber when a document expires within 30 days, and in red when it has
already expired. Renew on time — the police do not care that the app beeped.

---

## 8. Reports (admin / manager)

Go to **Reports**. Pick a date range with the buttons: **Today**, **Last 7 days**, **This month**,
**Last month**, or type your own dates.

| Tab | Shows |
| --- | --- |
| **Profit & loss** | Net sales, cost of the food sold, gross profit, shop expenses, salaries, vehicle costs, net profit |
| **Item profit** | Which items make money and which do not, with margin per item |
| **Stock value** | What the food on the shelf is worth, and how much is tied up in low stock |
| **Purchases** | Bills by supplier, and **by ingredient with a price trend** — "chicken went up 12%" at a glance |
| **Wastage** | What was thrown away, why, and what it cost |
| **Expenses** | Shop spending by category, by wallet (drawer / bank) and by day |
| **Sales** | Daily sales table, totals, discount given, cancelled count, split by order type |
| **Top items** | What sells the most, by quantity and revenue |
| **Deliveries** | Deliveries per rider and their commission |
| **Salaries** | Net pay for every staff member for a chosen month, and whether it is paid |
| **Vehicle costs** | Fuel, maintenance and total per vehicle |

The first six tabs are the owner's private numbers and are hidden from a cashier.

**Reading the profit & loss.** Two rules explain most of the questions it raises:

- **Wastage is already inside the cost of food.** It is not subtracted a second time, or the
  profit would be understated twice for the same spoiled packet.
- **A sale is costed at the price on the day it was sold.** If chicken gets dearer next week,
  last week's profit does not change.

Click **Export CSV** to save the open tab and open it in Excel. Files go to
`Documents\Gul Khan Fast Food`.

> The export button does nothing in the browser preview. It needs the desktop app, where it
> opens the normal Windows save dialog.

---

## 8a. Stock (admin / manager)

Go to **Stock**. This is where the app learns what is in the kitchen.

| Tab | What you do there |
| --- | --- |
| **Stock levels** | Every ingredient, what is left, and what it is worth. Red means below the reorder level |
| **Purchases** | Enter a supplier bill. Do this **when the delivery arrives**, not at month end |
| **Wastage** | Record food thrown away — spoiled, dropped, expired, staff meal |
| **Stock counts** | Count the shelf and correct the app to match. Count weekly at first |
| **House-made** | Things the kitchen makes itself — see below |
| **Suppliers** | Who you buy from |

**Opening stock — do this once, on the day you start.** Click **Opening stock** on the Stock
levels tab. For each thing already on the shelf, enter how much there is and what it cost you per
kilo/litre/piece. This is what makes the first day's profit correct instead of impossibly high.
It does **not** create a supplier bill, because you are not buying it now — you already own it.

**Recording a purchase.** Click **Purchases → Add purchase**, pick the supplier, and add each
ingredient with the quantity and price on the bill. If the extra charges (delivery, loading) are
on the bill, put them in **Extra charges** — the app spreads them across the lines so the cost per
kilo is the real delivered cost.

**Supplier return.** Open the ingredient, then **Return to supplier**. Use this when part of a
delivery was bad. The bill stays as it is — you still owe for the rest — and the returned quantity
comes back off your shelf. It is not the same as voiding a bill.

### House-made ingredients

If the kitchen makes its own mayo, marinade or coating mix, tell the app and it will work out the
cost for you.

1. **Stock → House-made → Make something in-house**, and pick the ingredient.
2. Say **how much one batch makes** — for example, 1,000 g of mayo.
3. Add **what goes into one batch** — 400 ml oil, 2 eggs.
4. Save. The cost is now worked out from the oil and egg prices by itself.

When the kitchen actually makes a batch, click **Make** on that row and say how many batches. The
oil and eggs come off the shelf and the mayo goes on, at what it cost to make.

> You never type the price of a house-made ingredient. That is the point — if oil gets dearer, the
> mayo cost follows it automatically instead of quietly going stale.

---

## 8b. Expenses and monthly bills (admin / manager)

Go to **Expenses** for the shop's own spending: rent, electricity, tea for the staff, repairs.
This is separate from purchases — buying chicken puts stock on the shelf; paying the electricity
bill does not.

**Monthly bills.** Most of these repeat every month. Add them once under **Monthly bills** and the
dashboard will tell you when one is due:

1. **Expenses → Monthly bills → Add a bill**.
2. Give it a name, a category, the day of the month it is due, and roughly what it costs.
3. The amount is only a hint to fill the form faster. **Nothing is ever added to your expenses
   until you confirm it.** When the bill arrives, click **Pay**, check the amount, and it is
   recorded in that month.

The dashboard shows a reminder when a bill is due soon or already late. If you did not pay one
month, mark it **Skipped** and the reminder stops without inventing an expense.

> Day 31 means "the last day" — so in February it is due on the 28th, which is what you want.

---

## 9. Users (admin only)

Go to **Users** to:

- **Add** a cashier, manager or another admin
- **Reset password** when someone forgets theirs
- **Disable** a person who has left — they can no longer sign in, but their old orders keep their
  name
- **Change role**

The app will not let you disable or demote the **last active admin** — otherwise nobody could open
Settings again.

---

## 10. Settings (admin only)

- **Shop details** — name, address, phone. These print on the invoice.
- **Logo** — appears in the app and on invoices. Use a square PNG or JPG.
- **Currency label** — usually `Rs`.
- **Default tax %** — starts every new order at this percentage. Set `0` if you do not charge tax.
- **Receipt paper** — 80mm thermal or A4.
- **Backup on close** — leave this **on**.
- **Backups** — see the list, click **Create backup now**, or **Restore** an older backup.

---

## 11. Backups — the most important habit

The app keeps your data in one file on this computer. If the computer's hard disk dies, that data is
gone unless you have a backup.

The app already:

- Makes a backup **every time it closes**
- Keeps the last **7** backups in `%APPDATA%\gul-khan-fast-food\backups`

**What you must do:** once a week, copy the newest backup file to a **USB drive** (or Google
Drive / WhatsApp to yourself). A backup on the same computer does not survive a theft, a fire or a
dead disk.

### Restoring a backup

1. **Settings → Backups**
2. Find the right date, click **Restore**, and confirm.
3. The app keeps a safety copy of the current data first, then restarts with the old data.

Only files ending in `.db` from the backups folder can be restored.

---

## 12. Common problems

| Problem | What to do |
| --- | --- |
| **"Username or password is not correct"** | Check Caps Lock. After 5 tries the account locks for 15 minutes. The admin can reset the password. |
| **"You don't have access to this page"** | That account's role does not include the page. Ask the admin. |
| **Item is greyed out on New Order** | It is marked **sold out**. Turn it back on in **Menu**. |
| **"Delivery needs a phone number and address"** | Fill in both before saving. |
| **"This month's salary is already paid"** | Correct — it was recorded earlier. Check the paid date on the slip. |
| **Printer prints on the wrong size** | Change **Receipt paper** in Settings, then print again. |
| **Window is blank / white** | Close the app completely and start it again. |
| **App says the database cannot be opened** | Another copy is probably already running. Close it (check the taskbar) and try again. |
| **A bike reminder will not go away** | It clears only after you enter the new expiry date in **Vehicles**. |

If something else goes wrong, note the time and what you were doing, then open
`%APPDATA%\gul-khan-fast-food\logs\app.log` — the technician will need it. The log rotates
automatically, so it never grows without limit.

---

## 13. Good daily habits

**Morning:** start the app, check the dashboard loads, check today's date.
**During the day:** mark attendance, take orders, print invoices, update statuses.
**Evening:** close any pending deliveries, count the cash against the day's sales report,
then **close the app** so it backs up.
**Weekly:** copy the newest backup to a USB drive.

---

## 14. Quick reference

| I want to… | Go to |
| --- | --- |
| Take an order | **New Order** |
| Reprint an invoice | **Orders** → click the order → **Print** |
| Change a price | **Menu** → item → **Edit** |
| Mark someone absent | **Staff** → person → tap the day |
| See what a rider earned | **Staff** → rider → month → salary slip |
| Know today's sales | **Dashboard**, or **Reports** → **Today** |
| Know today's profit | **Dashboard** → *Today's gross profit*, or **Reports → Profit & loss** |
| Enter a delivery that arrived | **Stock → Purchases → Add purchase** |
| Record food that spoiled | **Stock → Wastage** |
| Correct the shelf after counting | **Stock → Stock counts** |
| Say what the kitchen makes itself | **Stock → House-made** |
| Add rent or the electricity bill | **Expenses → Record expense** |
| Stop forgetting a monthly bill | **Expenses → Monthly bills → Add a bill** |
| Set the stock you already had on day one | **Stock → Opening stock** |
| Give the accountant numbers | **Reports** → pick the tab → **Export CSV** |
| Reset a forgotten password | **Users** → **Reset password** |
| Back up to USB | **Settings** → Backups → copy the newest file |
