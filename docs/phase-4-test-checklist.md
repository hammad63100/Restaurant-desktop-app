# Manual Test Checklist — Phase 4 (Stock, recipes, expenses, profit)

Phase 4 is covered by **240 automated checks** (`scripts/test-phase15.mjs` … `test-phase25.mjs`),
but every one of them runs against the database with no screen in front of it. This list is the
part that needs a person: the screens, the buttons, and whether the numbers read the way an owner
would expect.

Run it on the Windows build, signed in as **admin**. Do it in the order below — each section
depends on the one before it, and later sections are how you *prove* the earlier ones were right.

> **Do this on the day you start using the app.** Sections 1–3 set up the numbers the rest of the
> checklist verifies. If you skip opening stock, section 8's profit will look impossibly good and
> you will not know why.

---

## 0. Before you start

- [ ] **Settings → Backups** shows today's automatic backup, and it can be copied to a USB.
- [ ] Sign in as a **cashier** in another window. The sidebar shows no Stock and no Expenses, and
      opening `#/stock` by URL shows a "no access" message rather than a blank screen.

---

## 1. Ingredients and suppliers

- [ ] **Stock → Suppliers → New supplier.** Add a wholesaler with a phone number. It appears in the
      list, and the name is rejected if you add it twice (**case-insensitively**: "Metro Cash" and
      "metro cash" are one supplier).
- [ ] **Stock → Stock levels → Add ingredient.** Add `Chicken with bone`, base unit **g**, purchase
      unit **kg**, 1000 per kg, reorder level 3000.
- [ ] Try adding the same ingredient again — it is refused with a readable message.
- [ ] The **starter list** is offered on first use. Tick a dozen fast-food ingredients, load them,
      and confirm loading it a second time creates no duplicates.
- [ ] Delete an ingredient that no recipe uses — it disappears from the active list.
- [ ] Try to delete one that *is* in a recipe — it is refused, and the message says why.

## 2. Opening stock (do this once, on go-live day)

- [ ] **Stock → Opening stock.** Search for `Chicken with bone`, enter **10 (kg)** and a cost of
      **Rs 300 per kg**.
- [ ] The live total at the bottom of the sheet updates as you type.
- [ ] Enter a quantity but **leave the cost blank** — saving is refused, because a free ingredient
      makes every recipe look profitable.
- [ ] Enter a **negative** quantity — refused.
- [ ] Enter a **zero** quantity — that row is skipped, and the rest still save.
- [ ] Save. Stock levels now show **10 kg on hand** at **Rs 300/kg**.
- [ ] **Supply Chain check:** no purchase row was created and no supplier balance appeared. Opening
      stock is what you *already owned*, not a new debt.

## 3. Purchases

- [ ] **Stock → Purchases → Add purchase.** Pick the supplier, add `Chicken with bone` — 5 kg at
      Rs 340, plus **extra charges** of Rs 100 delivery.
- [ ] The line's cost per kg is **not** Rs 340 — the Rs 100 is spread across the quantity, so the
      real delivered cost is Rs 360/kg. The supplier balance shows exactly what is owed.
- [ ] Save. Stock levels show **15 kg** on hand.
- [ ] Now **record nothing** and open the ingredient detail → **Price history**. Both the Rs 300
      and the Rs 340 purchase are listed.
- [ ] Buy 5 kg more at Rs 400 and check the average cost moved **part of the way**, not all the way
      to Rs 400 — it is a weighted average, not "last price wins".

## 4. Recipes and costing

- [ ] **Menu →** an item **→ Recipe**. Add `150 g` chicken and `1` burger bun. Save.
- [ ] The item's **cost** appears, along with **profit** and **margin %** for the price you set.
- [ ] Change the price — profit recalculates immediately.
- [ ] The **Can make** column shows a sensible number: with 15 kg of chicken and 150 g per burger,
      it must read about **100** (the tightest ingredient wins, not the average).
- [ ] Sell the item until an ingredient runs out: **Can make** goes to **0** and turns red, which is
      the answer to "what is left" the owner actually asks at the counter.
- [ ] Mark an item with no recipe: it is flagged **no recipe**, and its profit reads **unknown** —
      never 100% and never zero.
- [ ] Set the margin floor in Settings to 50%; an item below it is flagged **Check price**.
- [ ] The **suggest price** helper gives a price that, at the recommended margin, rounds to a whole
      rupee *upwards*.

## 5. Automatic deduction

- [ ] Take an order containing that recipe item. **Stock** shows chicken down by 150 g per unit sold.
- [ ] **Orders →** that bill → the line shows its **cost**, and the bill shows its profit.
- [ ] Now **change the chicken purchase price** and reopen the old bill. Its cost has **not**
      moved — a sale is costed at the price on the day it was sold.
- [ ] Turn **allow negative stock** OFF in Settings, then try to sell more than you have. The sale
      is refused, naming the ingredient and the shortfall — and no half-deducted burger is left
      behind.
- [ ] Turn it back ON; the sale now goes through with stock going negative (this is the setting for
      "the delivery has not been entered yet").

## 6. Wastage, counts and supplier returns

- [ ] **Stock → Wastage.** Throw away 500 g of chicken as **Spoiled**. Stock drops by 500 g, and
      the row shows the value lost.
- [ ] **Stock → Stock counts.** Start a count, enter a counted quantity that differs from the book.
      The **variance** is shown before you save, and saving sets the shelf to what you counted.
- [ ] Count a line at **exactly** the book quantity — it saves, but writes no movement (nothing
      changed, so nothing should appear in the ledger).
- [ ] **Ingredient → Return to supplier.** Return 2 kg of the bad chicken. The shelf drops by 2 kg,
      the **bill stays posted** (you still owe for the rest), and the ledger shows a
      `Returned to supplier` row.
- [ ] Try to return more than is on the shelf — refused.
- [ ] Try to return with a one-letter reason — refused. The paper trail is the point.

## 7. Expenses and monthly bills

- [ ] **Expenses → Record expense.** Add Rs 5,000 rent, paid from **bank**.
- [ ] Add an expense paid from **drawer cash** with **no drawer open** — refused, with a message
      telling you to open the day or use the bank. This is what stops the till going short.
- [ ] **Void** an expense with a reason. It leaves the total but stays visible when you tick
      **show voided**, with who voided it and why.
- [ ] **Expenses → Monthly bills → Add a bill.** Rent, Rs 50,000, due on the **31st**.
- [ ] Open it for **February** — the due date reads **28 Feb**, not "31 Feb".
- [ ] **Nothing has been added to expenses yet.** Confirm the month's expense total is unchanged.
      A reminder must never book money by itself.
- [ ] **Pay** it, changing the amount to what the bill actually says. It now appears as an expense
      **dated the due date of that month**, not today.
- [ ] Try to pay the same month twice — refused.
- [ ] Mark a month **Skipped** — no expense is created, and the reminder stops nagging.
- [ ] The **dashboard** shows a banner for a bill that is due or late, and the banner disappears
      once it is settled.

## 8. House-made ingredients

- [ ] **Stock → House-made → Make something in-house.** Pick `Mayonnaise` (add it first if needed).
- [ ] Set one batch to make **1000 g**. Add **400 ml oil** and **2 eggs**. Save.
- [ ] The screen shows the **cost per gram**, worked out from your oil and egg prices — you did not
      type a price anywhere.
- [ ] Change the price of oil (buy some at a higher price). Reopen House-made: the **cost per gram
      has moved up by itself**.
- [ ] **Make** 2 batches. Oil drops by 800 ml, eggs by 4, and mayo goes **up by 2000 g**.
- [ ] Make a burger that uses house mayo as a recipe line. Its cost uses the **made** price, not
      zero.
- [ ] Try to put a house-made ingredient **inside another** house-made recipe — refused, with a
      message telling you to add the raw ingredients instead.
- [ ] Try to make a batch of something that is **bought** — refused, because there is no recipe to
      cost it from.
- [ ] **Stop making it** (clear the yield). The ingredient becomes a bought one again; its existing
      stock and price are untouched.

## 9. Reports — the numbers must agree

This is the section that catches real problems. Do it with a full month of data.

- [ ] **Reports → Profit & loss.** Check the arithmetic by hand:
      `net sales − cost of food = gross profit`, then
      `gross profit − (shop expenses + salaries + vehicle costs) = net profit`.
- [ ] **Wastage is not subtracted a second time.** The P&L shows it, but it is already inside the
      cost of food. If the profit looks lower than your own arithmetic, check this first.
- [ ] **Reports → Expenses** total equals the **Expenses** page total for the same dates.
- [ ] **Reports → Purchases → by ingredient** shows a price-trend column. With two different
      purchase prices it shows a percentage; with only one it shows 0%.
- [ ] **Reports → Item profit** for a period reconciles with **Profit & loss** for the same period,
      to the paisa.
- [ ] **Reports → Stock value** equals the sum of the Stock levels page.
- [ ] Every report tab's **Export CSV** opens a save dialog and the file opens in Excel with the
      right columns and two-decimal money.
- [ ] Change a purchase price. Re-run last month's reports: **they do not change**.

## 10. Dashboard cards (admin only)

- [ ] **Today's gross profit** — matches the P&L for today.
- [ ] **Stock on the shelf** — matches Reports → Stock value, and the low/out counts are right.
- [ ] **Spent today** — includes shop expenses *and* today's salaries *and* today's vehicle costs,
      not just the Expenses page.
- [ ] **Items with no recipe** — count matches the Menu flags.
- [ ] Price-rise warnings list ingredients whose price went up in the last 30 days.

## 11. Permissions (sign in as each role)

| What | Cashier | Manager | Admin |
|---|---|---|---|
| See Stock / Expenses in the sidebar | no | yes | yes |
| See P&L, item profit, stock value | no | no | yes |
| Enter a purchase | no | yes | yes |
| Pay a salary | no | yes | yes |
| Void an expense | no | no | yes |
| See the dashboard profit cards | no | no | yes |

- [ ] A cashier can still **sell** — a permission wall on costs must never stop the till.
- [ ] A manager without cost access opening a report URL directly gets a clear message, never a
      blank screen or a stack trace.

## 12. Things to look at, not click

- [ ] Money shows two decimals everywhere. Look for `0.30000000000004` or `Rs 28.799999`.
- [ ] Very small quantities (a gram of spice) show a sensible cost, not `Rs 0.00`.
- [ ] A long ingredient name does not break a table layout.
- [ ] Every button that appears to do nothing is reported — silence is a bug, not a feature.

---

## Known limitations (not bugs)

- **CSV export** needs the desktop app. It does nothing in the browser preview because it uses the
  Windows save dialog.
- **Sub-recipes are one level deep** by design. A house-made sauce cannot go inside another.
- **Old orders** from before recipes existed show "no cost data" and are excluded from COGS rather
  than guessed at. Profit is accurate from go-live onward.
