# Plan: Stock, Recipes, Costing, Profit and Shop Expenses

**Project:** Gul Khan Fast Food — offline desktop app (Electron + React + TypeScript + SQLite)
**Where it fits:** Roadmap Phase 4 — "inventory / recipes", broken into **4.A → 4.G**
**Migrations:** 015 → 020 (018 is shared by wastage/count and expenses, see the table in §11)
**Status:** Plan approved for build. Execution status is tracked in §11.

---

## 1. What the client asked for (his words, translated)

| # | Client's requirement (Roman Urdu) | English requirement |
|---|---|---|
| 1 | "Jab stock lao jo fast food may use hota hay, wahi stock add kardy" — and the app should know what a fast food shop uses | **Add stock purchases** with the **usual fast-food ingredients ready to pick** (chicken, bun, mayo, cheese, oil, packaging…), each with full details: unit, price, supplier, low-stock level |
| 2 | "Jab koe item list kardo, jaise Zinger Burger — usi may bun, chicken, mayo, cheese — matlab jo ek burger may lagta hay, wahi add kardy" | **Recipe per menu item:** tell the app exactly what goes into one Zinger Burger |
| 3 | "Jab customer ka order aata hay to mere stock say utna saman minus hojaye taky mujhe pata lagy" | **Automatic stock deduction** when an order is saved, so he always knows what is left |
| 4 | "Add stock may jo jo price hay, woh alag hoga hisab may" | **Every purchase keeps its own price**; the accounts must respect different prices for the same ingredient |
| 5 | "Owner ko choice hay ke woh kitna rakhe ek item ka price, phir usi hisab say profit alag ho" | **The owner sets the selling price.** The app shows the cost to make the item, then **profit and margin** from his chosen price |
| 6 | "Ek aur cheez add karni hay — shop expenses ka section, jo hisab ko rakhay" | **Shop expenses section** (rent, electricity, gas, internet, repairs…) so the books are complete |

The one-sentence summary: **buy stock → define what each item uses → sell → stock and cost update themselves → the owner sees true profit after shop expenses.**

---

## 2. How this fits into the app that already exists

| Already built (reuse it) | Why it matters here |
|---|---|
| Menu with categories, items and `items.price` (selling price in paisa) | The owner already chooses the selling price; we add cost/profit beside it |
| Orders saved in **one SQLite transaction** (order + lines + invoice + token + promo + approval) | Stock deduction joins that same transaction, so stock can never disagree with orders |
| Cancel, amend, merge, split | Each event gets an explicit, documented stock rule (§7) |
| Shifts, cash drawer, X/Z report, `cash_movements` (`expense` kind) | A purchase or expense paid from the drawer must reduce expected cash at day close |
| Salaries, advances, `vehicle_expenses` | The expense report **reads** these; the owner does not type them twice |
| Roles + capabilities, central IPC registry with Zod schemas | New features follow the same pattern: auth → role → capability → Zod → handler |
| Integer-paisa money, numbered migrations (001–014), one test script per phase, `npm run verify` | All of these rules are kept |

Not built yet: ingredients, suppliers, purchases, recipes, stock deduction, cost/profit, shop expenses, variants/combos, Urdu UI.

---

## 3. Plain-words glossary (use these words in the UI)

| Term | Meaning | Example |
|---|---|---|
| **Ingredient / stock item** | Anything bought and used up by the kitchen | Chicken fillet, zinger bun, mayonnaise, burger box |
| **Base unit** | The smallest unit the app counts in | `g`, `ml`, `pcs` |
| **Purchase unit** | The unit the supplier sells in | kg, litre, dozen, packet, carton |
| **Conversion** | How many base units one purchase unit contains | 1 kg = 1000 g, 1 dozen = 12 pcs |
| **Recipe** | What one serving uses | Zinger Burger = 1 bun + 150 g chicken + 20 g mayo |
| **Unit cost** | What one base unit costs the shop | Chicken ≈ 70 paisa per gram |
| **Recipe cost (COGS)** | Ingredients cost of one serving | Zinger Burger ≈ Rs 186 (illustrative) |
| **Profit** | Selling price − recipe cost | Rs 450 − Rs 186 = Rs 264 |
| **Margin %** | Profit ÷ selling price | 264 / 450 = 58.7% |
| **Purchase** | A stock-in event: what was bought, at what price | 20 kg chicken @ Rs 710/kg |
| **Stock movement** | One ledger row for every change in stock | `purchase +20,000 g`, `sale −1,500 g` |

---

## 4. Rules the build must never break

1. **Money is integer paisa** (existing rule). Quantities are **integer base units** (g / ml / pcs). No floats in the database.
2. **Unit cost precision:** costs that are fractions of a paisa per gram are stored as **milli-paisa per base unit** (`paisa × 1000`). A line cost is rounded to whole paisa **once**, when it is written.
3. **Stock only changes through the ledger.** Every change writes a `stock_movements` row in the same transaction; `ingredients.qty_on_hand` is a cached total updated together with it. No screen may edit `qty_on_hand` directly — corrections are `adjustment` movements with a reason.
4. **Purchases are not expenses.** Stock is an asset until the food is sold (then it is COGS). Counting a purchase as an expense too would show a false loss. Purchases appear in the Purchases report and the cash view, never in the expense total.
5. **Old bills never change.** A sale stores a cost snapshot (`order_item_stock`) so editing a recipe or seeing a new chicken price does not rewrite last week's profit.
6. **A sale must not be blocked by stock data-entry delay.** Selling below zero stock is allowed with a visible warning by default; a setting can block it instead.
7. **Every new IPC channel** goes through `electron/ipc/registry.ts` with a capability and a Zod schema; cost/profit channels need `costs:read` (owner only by default).
8. **Soft delete** for ingredients and suppliers that have history (`active = 0`), like staff and vehicles.
9. **No new dependency.** Everything here is a few SQL statements and UI; adding a library is not justified.

---

## 5. Feature A — Stock (ingredients, suppliers, purchases)

### 5.1 Ingredient record

Name, category, **base unit** (`g` / `ml` / `pcs`), **purchase unit** (free text: kg, litre, dozen, packet) + **units per purchase**, **reorder level**, current quantity, **average cost**, **last purchase price**, preferred supplier (optional), active flag.

### 5.2 Starter catalogue (the "usual fast food stock")

On the Stock page the owner taps **"Load starter list"**. The app offers a standard list grouped by category; the owner ticks what he uses, and may rename, change units or add his own. Loading is idempotent (never duplicates by name) and nothing is forced.

| Category | Starter ingredients | Base unit | Typical purchase unit (conversion) |
|---|---|---|---|
| Chicken & meat | Chicken fillet/breast, boneless chicken, wings, legs, nuggets, patties, sausages | g / pcs | kg (1000 g) |
| Bread & dough | Burger bun, zinger bun, pizza base, paratha, wrap/tortilla, bread slices | pcs | packet (6/12 pcs) |
| Sauces | Mayonnaise, ketchup, chilli garlic sauce, hot sauce, BBQ sauce, pizza sauce, mustard, dips | g / ml | kg (1000) / bottle |
| Dairy | Cheese slice, mozzarella, cream, butter, milk | pcs / g / ml | pack / kg / litre |
| Vegetables | Lettuce, tomato, onion, cucumber, jalapeño, pickles, capsicum, cabbage | g | kg (1000) |
| Potato & sides | Frozen fries, potatoes, coleslaw mix, onion rings | g | kg / carton |
| Coating & dry | Flour, breadcrumbs, coating mix, corn flour, spices, salt, sugar, baking powder | g | kg (1000) |
| Eggs | Egg | pcs | dozen (12) / tray (30) |
| Oil & fuel | Cooking oil, gas cylinder | ml / kg | litre (1000) / cylinder |
| Drinks | Cola can/bottle, water bottle, juice, ice | pcs | carton (12/24) |
| Packaging | Burger box, fries pouch, pizza box, nugget box, wrap paper, bag, cup, lid, straw, tissue, foil, sauce sachet | pcs | packet (100) / carton |
| Cleaning | Gloves, cleaning liquid, kitchen roll | pcs / ml | pack |

### 5.3 Suppliers

Name, phone, address, notes, active flag. Supplier balance (udhaar to supplier) is **not** in the first version — purchases record "on credit" and the amount owed per supplier is shown as a report number (§9.3). Full supplier payments ledger is listed as a follow-up (§13, Q5).

### 5.4 Purchase (stock-in) screen — "Add stock"

1. Supplier (optional), date, supplier bill number, notes.
2. Lines: ingredient, quantity **in the purchase unit** (2.5 kg allowed), price per purchase unit, line total. A "quick add" search box with the keyboard-first flow: type, Enter, quantity, price, Enter.
3. Extra charges (transport) that become part of the landed cost.
4. Payment: **cash from drawer** / **cash (outside drawer)** / **bank-online** / **on credit**, plus "amount paid now" for partial credit.
5. **Save (one transaction):** purchase + lines, stock movements, average cost update, ingredient last price, and — only when paid from the drawer and a shift is open — a `cash_movements` row of kind `expense` with reason `Purchase #12`.

**Void:** a posted purchase can be voided with a reason (admin/manager). It writes `purchase_void` movements that reverse exactly what it added, keeps the record in history, and (if it had touched the drawer) writes a compensating `cash_in` movement. Editing a wrong price = void and re-enter.

### 5.5 Different prices for the same ingredient

Each purchase line keeps its own price **forever** in `purchase_items`. For costing the app uses the **moving weighted average**:

```
new avg = (old qty × old avg + new qty × new price) ÷ (old qty + new qty)
```

Worked example: 10 kg chicken in stock at Rs 650/kg; buy 20 kg at Rs 710/kg:
`(10 × 650 + 20 × 710) ÷ 30 = Rs 690/kg` → `69,000` milli-paisa per gram.

The ingredient detail screen also shows the **price history** (every purchase line, date, supplier, price, and a small trend) and **last purchase price**, so the owner can see a rise immediately and re-price his items.

### 5.6 Low-stock alerts

- Below reorder level → amber on the Stock page and dashboard.
- Zero or negative → red.
- Menu page shows **"Can make: N"** per item = the smallest `stock ÷ recipe qty` across its ingredients.
- Optional setting: automatically mark an item **sold out** when it can no longer be made (off by default — the cashier stays in control).

---

## 6. Feature B — Recipes (what goes into one item)

Opened from the Menu page (**Recipe** button on each item). A list of ingredient + quantity **per one serving**, in base units.

**Zinger Burger (illustrative prices; the owner enters the real ones):**

| Ingredient | Qty per burger | Unit cost | Line cost |
|---|---|---|---|
| Zinger bun | 1 pc | Rs 25.00 | Rs 25.00 |
| Chicken fillet | 150 g | Rs 0.70 / g | Rs 105.00 |
| Mayonnaise | 20 g | Rs 0.50 / g | Rs 10.00 |
| Cheese slice | 1 pc | Rs 18.00 | Rs 18.00 |
| Lettuce | 10 g | Rs 0.30 / g | Rs 3.00 |
| Cooking oil (share) | 12 ml | Rs 0.55 / ml | Rs 6.60 |
| Coating mix | 22 g | Rs 0.29 / g | Rs 6.38 |
| Burger box | 1 pc | Rs 10.00 | Rs 10.00 |
| **Recipe cost** | | | **Rs 183.98** |

Rules:

- Quantities are integers in base units; the editor shows the live cost as the recipe is typed.
- Ready-made resale items (a cola can) get a recipe of **1 can** — then selling one reduces stock automatically.
- **A recipe may be empty** (item not tracked). It still sells normally, is flagged **"No recipe"** on the Menu page and in the setup checklist, and its profit shows **"cost unknown"** — never a fake 100% margin.
- One ingredient can be in many recipes. An ingredient that is used by a recipe cannot be deleted (it is deactivated instead).
- Recipe cost always uses the **current average cost**; the sale snapshot freezes it at sale time (§7).
- **Deferred:** sub-recipes (house-made sauce/marinade) and combos. Variants (small/large pizza) get their own item today, so the recipe table needs no rewrite later.

---

## 7. Feature C — Automatic stock deduction

### 7.1 When an order is saved

Inside the existing order transaction, for every order line:

1. Read the item's recipe (indexed by `item_id`).
2. For each ingredient: `used = recipe qty × line qty`.
3. Write a `sale` stock movement (negative) and reduce `qty_on_hand`.
4. Write an `order_item_stock` snapshot row (`qty`, `unit_cost_milli`, `cost` paisa) and set `order_items.cost_total`.

If any step throws (for example stock is blocked and insufficient), the **whole order** rolls back — no half-saved bill and no half-deducted stock.

### 7.2 Every other event

| Event | Stock rule |
|---|---|
| Order saved (dine-in, takeaway, delivery) | Deduct immediately — the kitchen starts at once |
| Status → preparing / ready / delivered | No stock change (already deducted) |
| **Cancel, food not prepared** (default for pending) | `sale_reversal` movements — stock returns exactly as it was deducted |
| **Cancel, food prepared** (default for preparing/ready) | Stock stays deducted; the used quantity is booked as **wastage cost** so the P&L shows the loss honestly |
| **Amend a saved bill** | Reverse the bill's earlier deductions, then deduct the new lines from the current recipes. Stock stays exact; the amended bill's cost is re-valued at today's average cost (documented, and old un-amended bills are untouched) |
| Merge / split | **No stock change** — lines move with their snapshots; quantities are unchanged |
| Menu recipe edited later | Affects **new** orders only; old bills keep their snapshot |
| Ingredient price changes later | Same — old bills keep their cost |
| Stock would go below zero | **Allowed with a warning** by default (a till must not stop a sale over a data-entry delay); a setting can block it |

Ledger integrity: a unique index on `(ref_order_item_id, ingredient_id)` for `kind = 'sale'` makes double deduction of the same line impossible.

---

## 8. Feature D — Pricing and profit (owner's numbers)

- Menu page gains columns: **Cost**, **Selling price**, **Profit**, **Margin %**, and a **Can make** count. Visible only with `costs:read` (admin by default).
- The selling price is **always the owner's choice** (`items.price`); the app never changes it.
- **Price helper:** type a target margin (e.g. 55%) → suggested price `cost ÷ (1 − margin)` → e.g. Rs 183.98 ÷ 0.45 = Rs 408.84; he may round it or ignore it.
- **Margin alert:** a settings value (e.g. 35%). Any item below it is flagged **"Check price"** on the Menu page and dashboard — this is how a chicken price rise gets noticed the same day.
- **Order profit** = net sales (after discount, **excluding tax**, because tax is collected for the government) − the cost snapshot of the lines.
- Discounts lower profit automatically: revenue falls, cost does not.

---

## 9. Feature E — Wastage, stock count and shop expenses

### 9.1 Wastage
Ingredient, quantity, reason (expired / spoiled / burnt / spilled / staff meal / other), note. Writes a `wastage` movement (stock down), valued at average cost, and appears as its own line in the P&L.

### 9.2 Stock count (stocktake)
The owner/manager counts the shelf. The app shows **expected vs counted**, the difference and its value. On confirm it posts `adjustment` movements (with reason "Stock count #N"). Daily/weekly/monthly is his choice. The **variance report** shows ingredients that are repeatedly short — the honest way to spot over-portioning, theft or unrecorded waste.

### 9.3 Shop expenses ("hisab" section)
| Field | Notes |
|---|---|
| Date | Defaults to today |
| Category | Rent, Electricity, Gas, Water, Internet & phone, Repairs, Cleaning, Marketing & printing, Licenses & fees, Bank charges, Transport, Miscellaneous (owner can add/rename/hide) |
| Amount | Integer paisa |
| Paid to | Free text (landlord, WAPDA, …) |
| Payment method | Cash from drawer / cash (outside drawer) / bank-online |
| Reference / note | Optional (bill number, meter reading) |
| Entered by | Automatic |

- **Drawer link:** an expense paid from the drawer during an open shift also writes a `cash_movements` row of kind `expense` in the same transaction, so day-close expected cash stays correct.
- **Void, never delete**, with a reason and an audit trail; admin/manager only. A drawer-paid void writes a compensating `cash_in`.
- **No double counting:** the Expenses report also lists, as separate read-only lines, **salaries** (`salary_payments`), **vehicle fuel/maintenance** (`vehicle_expenses`) and **wastage cost** (from stock). They are read from existing tables, not retyped.
- **Purchases are not expenses** (rule §4.4); they show in the Purchases report and the cash view.
- **Recurring bills** (rent, internet, gas) with a due-day reminder: planned as 4.F2, only after the core expenses are tested.

---

## 10. Reports and dashboard

| Report | Shows |
|---|---|
| **Profit & Loss** (any date range) | Net sales (ex-tax) − COGS = **gross profit**; − operating expenses (shop, salaries, vehicles, wastage) = **net profit** |
| **Item profitability** | Per item: qty sold, sales, cost, profit, margin %; best and worst items |
| **Stock valuation** | qty × average cost per ingredient, and the total value on the shelf |
| **Purchases** | By supplier and ingredient, price trend, amount owed (credit purchases) |
| **Wastage** | By reason/ingredient, with value |
| **Expenses** | By category and month; drawer vs outside; voids excluded and listed separately |

Dashboard additions: **Low stock** count/list, **Today's expenses**, **Today's gross profit** (owner only), **Recipes missing**, **Price-check flags**. All reports use the existing date presets and CSV export.

---

## 11. Execution plan (sub-phases)

Each sub-phase has its own migration, test script, `npm run verify` gate and a `memory.md` update. Do not start the next one until the current one is green. This table is the live status board.

| Step | Name | Delivers | Migration | Test | Status |
|---|---|---|---|---|---|
| **4.A** | Ingredients, suppliers, starter list | `suppliers`, `ingredients`, stock page shell (levels + suppliers tabs), ingredient/supplier CRUD, starter catalogue loader, stock value, permissions | `015_inventory.sql` | `test-phase15.mjs` | **done** |
| **4.B** | Purchases and stock ledger | Add Purchase screen, `purchases`/`purchase_items`/`stock_movements`, weighted average, landed cost, void purchase, opening stock, low-stock alerts, drawer link | `016_purchases.sql` | `test-phase16.mjs` | **done** |
| **4.C** | Recipes and costing | Recipe editor on Menu, `recipe_items`, cost / profit / margin columns, price helper, "Can make N", no-recipe flags, margin alerts | `018_recipes.sql` | `test-phase17.mjs` | **done** (backend + Menu UI) |
| **4.D** | Automatic deduction | Deduct on order save, `order_item_stock` snapshot, `order_items.cost_total`, cancel rules (prepared / not prepared), amend re-valuation, negative-stock setting, per-order profit | `019_deduction.sql` | `test-phase18.mjs` | **done** |
| **4.E** | Shop expenses | Categories, entry, drawer link, void with audit, recurring bills (4.E2), drawings (4.E2) | `020_expenses.sql` | `test-phase19.mjs` | **done** |
| **4.F** | Wastage, adjustments, stock count | Wastage entry (reason codes + notes + dated at average cost), stock count with frozen variance (the shelf is SET to the counted qty), adjustment ledger, supplier return via the existing `supplier_return` kind, wastage report by ingredient+reason, Wastage + Stock counts tabs | `021_stock_ops.sql` | `test-phase21.mjs` | **done** (15 checks) |
| **4.G** | Profit and reports | P&L (`reports:profit`), item profitability, stock valuation, purchases / wastage / expenses report tabs, four dashboard cards, CSV export for all six | none | `test-phase20.mjs` + `test-phase22.mjs` | **done** |
| **4.I** | House-made ingredients | Batch recipe per ingredient (`ingredient_recipe_items`), batch yield, derived cost, make-a-batch stock document, one-level rule | `023_sub_recipes.sql` | `test-phase25.mjs` | **done** (10 checks) |
| **4.H** | Follow-up round | Salaries + vehicle costs as P&L lines, opening-stock screen, purchases by ingredient with price trend, supplier return action, recurring bills (4.E2) | `022_recurring_bills.sql` | `test-phase23.mjs` + `test-phase24.mjs` | **done** (24 checks) |

**Status: Phase 4 is complete, including 4.H and 4.I.** All six client requirements
are delivered (1 stock entry 4.A, 2 recipes 4.C, 3 automatic deduction 4.D, 4 purchase prices +
history 4.B, 5 cost vs price vs profit 4.C + 4.G, 6 shop expenses 4.E) and every extra the plan
added along the way — wastage, adjustments and stock counts (4.F), the full reporting set (4.G),
and the follow-up round 4.H — are finished as well.

**A UI gap found after 4.I and closed:** the service computed `canMake` for every menu item — how
many more the kitchen can still make from what is on the shelf — and no screen ever showed it. It
now does, as a **Can make** column on the Menu page (red at 0). That number is the client's own
stated reason for the whole stock feature ("taky mujhe pata lagy"), so having it invisible was the
one remaining place where the app had the answer and did not say it.

**Sub-recipes are built (4.I)**, so no client answer is holding anything back any more. §15 Q4 was
the last build question; the rest are shop-policy questions the client answers by *using* the app
(what to put in opening stock, which bills to add, how often to count).

Migration numbering (authoritative): 015 inventory, 016 purchases, 017 cash↔purchase link, 018 recipes, 019 deduction, 020 expenses, 021 stock ops, **022 recurring bills**.

Scope note: 4.E (expenses) is built before 4.F (wastage/count) because expenses is the client's sixth requirement and wastage was not asked for; the P&L in 4.G needs both, so the order only changes the schedule, not the result.

Order of work: **4.A → 4.D is the heart of the client's request.** 4.E and 4.F are independent and small; 4.G last because it needs their data.

### 4.G contract, as built

Five report channels, all behind `costs:read` (the owner's private numbers, never a manager's):
`reports:item-profit`, `reports:stock-valuation`, `reports:purchases`, `reports:wastage`,
`reports:expenses`. CSV covers all six reports including the P&L (`exportReportSchema`).

- **Item profit** groups by the frozen line snapshot, so it reconciles with the P&L of the same
  period to the paisa (the test asserts exactly that). An unpriced line reports
  `marginX100: null` — never 100% — and `unpricedReason` distinguishes *no recipe* (fix it: add
  one) from *sold before the recipe existed* (fixed already; only an amendment can price the
  old bill). Those are different problems and the owner should not be sent hunting for a
  problem that no longer exists.
- **Stock valuation** reads through the same list the Stock page uses, so the two totals can
  never disagree, and adds `lowStockValue` — how much money is tied up in things about to run out.
- **Purchases** counts posted bills only; a voided delivery is reported in `voidedCount` /
  `voidedValue` and never as money. `outstanding` is credit-only, because a cash bill is settled
  at the counter.
- **Wastage** reuses the 4.F read model untouched (so the Stock tab and the Reports tab cannot
  disagree) and adds a per-day trend plus the worst reason.
- **Expenses** groups by category, by wallet (drawer / bank / outside) and by day; a voided
  expense leaves the total but stays visible in `voidedCount`.
- **Dashboard cards** (only for `costs:read`): today's gross profit, stock on the shelf, money
  spent today, items with no recipe, plus ingredient price rises over 30 days.

### 4.H contract, as built (follow-up round)

Four gaps found by re-reading the plan against the finished app, plus the deferred 4.E2.

**Salaries and vehicle costs are now P&L lines of their own.** Before this, `operatingExpenses`
counted only the rows typed on the Expenses page, so paying wages left the profit reading high:
the money had left the drawer but the report said it had not. The contract is now

```
operatingExpenses = shopExpenses + salaries + vehicleCosts
netProfit         = grossProfit − operatingExpenses
```

Three properties are deliberate and pinned by `test-phase23.mjs`:

- `shopExpenses` still means *the rows on the Expenses page*, unchanged, so the report total and
  the Expenses page total can never disagree.
- `salaries` filters on `paid_on`, not on the month the wage is *for* — a salary paid on 3
  December for November is December's cost, because that is when the cash left.
- **wastage is never added here.** Spoiled stock is already in `cogs` at the moment it spoils;
  adding `wastageValue` as a second operating cost would double-count it. The number is
  reported on its own so the owner can see it without it moving the profit.

The Expenses *report* tab lists salaries, vehicles and wastage as read-only `otherCosts` lines
with a `source` and a count, never summed into its own `total` — the same numbers, one owner.

**Opening stock (4.B, the go-live screen).** `stock:opening` takes a quantity *and* a cost per
base unit, writes an `opening` movement and sets the weighted average. It deliberately creates
**no purchase row and no supplier balance** — the food was bought before the shop had a ledger,
and inventing a bill would invent a debt. A line with no cost is refused by the UI (a free
ingredient makes every recipe look profitable); a quantity of zero is skipped, and a negative
quantity is refused outright, because opening stock can only ever add.

**Purchases by ingredient with a price trend.** `reports:purchases` gained `byIngredient`:
per ingredient, the bill count, quantity, spend, cheapest and dearest price, and
`changeX100 = (last − first) × 10 000 / first` — *"chicken has gone up 12%"* is the number that
makes a menu repricing decision obvious. Only posted bills count; a voided delivery is not a
price. Exported as `purchases_by_ingredient`.

**Supplier return.** `stock:supplier-return` (capability `stock:adjust`) sends stock back. It is
not "void the purchase": of twenty crates delivered, two may be crushed while the other
eighteen are perfectly good and already being sold — voiding would take all twenty off the
shelf and wipe a bill the shop still owes. A return takes the two back, values them at the
current average (so the shelf is never repriced), names the supplier in the reason, and leaves
the bill `posted` for the owner to claim a credit against. It refuses when the quantity exceeds
what is on the shelf, and refuses a reason shorter than three characters — the paper trail is
the whole point.

**Recurring bills (4.E2).** `expenses:recurring` and friends.

- A template (`recurring_bills`) holds what the bill is, the category, the due day, how many
  days ahead to warn, and a *typical* amount used only to pre-fill the form.
- A payment (`recurring_bill_payments`) holds one month: `paid` or `skipped`, with a
  `UNIQUE (template_id, period)` — a month cannot be paid twice.
- **Reading never books anything.** The dashboard banner and the Expenses tab are read-only; the
  expense is created only when the owner confirms what he actually paid, and it goes through
  the normal `save()` path so the drawer link, the void rule and the P&L behave exactly as if he
  had typed it by hand.
- The expense is dated the **due date of that month**, not the day he confirmed it, so rent
  confirmed late still lands in the month it belongs to.
- `dueDay` is capped at the month's real length: the 31st means 28 February, 29 in a leap year.
  A string-concatenated `2027-02-31` would be a date no report could ever match.
- Un-settling **voids** the expense rather than deleting it, and a deactivated template stops
  nagging while keeping all its history.

### 4.I contract, as built — house-made ingredients

The client's answer to §15 Q4. An ingredient can now be **made** instead of bought.

- **`ingredients.batch_yield_base`** is the switch: `0` means bought, `> 0` means one batch
  produces that many base units (1000 g of mayo). It lives on the ingredient because every screen
  that lists ingredients already reads that row.
- **`ingredient_recipe_items`** is the batch recipe — component, quantity, trim allowance — with
  one line per component, exactly like a menu recipe.
- **The cost is derived, never typed.** `unit cost = Σ(component qty × live average) ÷ batch
  yield`. Ask "what does a kilo of my mayo cost today?" and it moves with the price of oil,
  because it should. A typed price would be a guess that stays wrong forever.
- **Making a batch is a stock document** (`sub_recipe_batches` + lines + `BAT-00001`). Components
  come off the shelf as `sub_recipe_make` movements and the product goes on at the computed cost,
  so its weighted average follows the real prices of what it is made of.
- **A batch is frozen once made.** The line costs are snapshotted onto the batch; a price rise
  tomorrow never rewrites what last week's batch cost.
- **The batch is value-neutral.** The value that leaves as components equals the value that
  arrives as product — `test-phase25.mjs` asserts the signed sum of every `sub_recipe_make`
  movement is zero. That is the check that catches a rounding rule applied on one side only.
- **One level only.** A house-made ingredient cannot go into another house-made one; the service
  refuses with a message telling the owner to add the raw ingredients instead. A fast-food kitchen
  has one level, and refusing the second keeps the cost a single pass with no recursion to get
  subtly wrong.

**Migration 023 note.** SQLite cannot alter a CHECK constraint, so the ledger had to be rebuilt to
accept the two new kinds. With `foreign_keys = ON`, `DROP TABLE stock_movements` runs an implicit
DELETE that fails while rows still reference the ingredients it points at. The migration therefore
renames the table, creates the new one, copies the history (keeping every id), swaps the write path
via `ALTER TABLE ... RENAME`, and leaves the emptied original as `stock_movements_legacy_016`.
The rebuild is verified against a fully populated database: 42 movements, identical count and
quantity sum, zero foreign-key violations.

### 4.F contract, as built

`stock:wastage` · `stock:adjust` · `stock:wastage-report` · `stock:counts` · `stock:count` ·
`stock:count-save`, all behind `stock:adjust` for writes (owner + manager; a cashier may read
the reports but never writes off stock) and `inventory:read` for reads.

- **Wastage** takes a POSITIVE `qtyBase` and negates it internally, values it at the current
  average cost, and stores a reason code (`spoiled`, `dropped`, `expired`, `staff_meal`,
  `test`, `other`) plus optional notes. It refuses zero/negative quantities, a future date,
  and — importantly — more than is on the shelf, because the answer to a wrong shelf is a
  stock count, not a wastage row. Wastage never moves the average cost.
- **Adjustment** is signed (`+` adds, `−` removes), needs a reason of at least three
  characters, and cannot remove more than exists. Kind is `adjustment`.
- **Stock count** SETS the shelf to the counted quantity with one `stock_count` movement per
  differing line; a zero-variance line is still stored on the count but writes no movement.
  Each line freezes `book_qty`, `counted_qty`, `variance`, `unit_cost_milli` and
  `variance_value`, and the count's `varianceValue` is Σ|variance| × average cost at the
  moment of saving — a later price change never rewrites history. Numbers are `CNT-00001`.
- **Supplier return** needed no new table: the ledger already has a `supplier_return` kind,
  so a return is a movement of that kind with a reason.
- The wastage report groups by ingredient + reason over a date range and returns
  `{from,to,rows,total,qty}`; the same numbers feed `reports:profit.wastageValue`.

Verification: `scripts/test-phase21.mjs` (15 checks) — quantities and values, the three
refusals, average-cost stability, count semantics (set, not add), zero-variance handling,
frozen variance value, ledger/cache/service agreement, the P&L tie-in, and the permission
split between cashier and manager.

---

## 12. Screens to add / change

| Screen | Contents |
|---|---|
| **Stock** (new sidebar page) | Tabs: **Stock levels** (search, low-stock filter, value, Add purchase), **Purchases** (list, void), **Suppliers**, **Wastage**, **Stock count** |
| **Add purchase** (modal / page) | Keyboard-first grid, supplier, lines, extra charges, payment, live total |
| **Ingredient detail** (modal) | Details, price history, movements, used-in recipes, adjust/wastage shortcuts |
| **Menu (extended)** | Recipe button, cost, profit, margin, can-make, flags |
| **Recipe editor** (modal) | Ingredient picker, qty per serving, live cost + margin, target-price helper |
| **Expenses** (new sidebar page) | Entry form, list with filters, categories, monthly summary, void |
| **Reports (extended)** | New tabs: Profit & loss, Item profit, Stock value, Purchases, Wastage, Expenses |
| **Settings (extended)** | Allow negative stock, auto sold-out, margin alert %, starter list button |
| **Dashboard (extended)** | Low stock, today's expenses, today's gross profit, missing recipes, price checks |

UI follows `docs/design.md` (red/yellow/orange, Poppins/Inter, 40–48px controls, tabular numbers for money).

---

## 13. Permissions

New capabilities in `src/types/api.ts` + `electron/services/permissions.ts`:
`inventory:read`, `inventory:write`, `purchases:write`, `purchases:void`, `stock:adjust`, `recipes:write`, `expenses:read`, `expenses:write`, `expenses:void`, `costs:read`.

| Capability | Admin | Manager | Cashier |
|---|---|---|---|
| See stock levels / low-stock alerts | Yes | Yes | Alerts only (dashboard) |
| Ingredients, suppliers, starter list | Yes | Yes | No |
| Add purchases | Yes | Yes | No |
| Void purchase, adjustment, wastage, stock count | Yes | Yes (reason required) | No |
| Edit recipes | Yes | Yes | No |
| **See cost, margin, profit** (`costs:read`) | Yes | **No** | No |
| Enter expenses | Yes | Yes | No |
| Void expense | Yes | Yes | No |

Cost and profit are the owner's private numbers and are hidden from everyone else by default. Every channel is declared in the registry with its schema and capability, and the boundary is pinned by a test (like the existing `tables:write` boundary test).

---

## 14. Testing plan (per the project's habits)

- **Migration gate:** every migration applies on a fresh database and the schema version matches.
- **Costing maths:** weighted average across three purchases at different prices; landed cost with transport; milli-paisa rounding at the paisa boundary.
- **Deduction:** one order, many lines, many ingredients, exact quantities; no double deduction on replay.
- **Atomicity:** force a failure mid-order → order, stock and ledger unchanged.
- **Cancel/amend:** pending cancel restores; prepared cancel books wastage; amend reverse + re-deduct is exact.
- **Snapshots:** change a recipe and a price, then old bills and old profit are unchanged.
- **Negative stock:** warns by default, blocks when the setting says so.
- **Expenses:** drawer link, void, no double counting with purchases, P&L reconciliation to the paisa.
- **Permissions:** cashier/manager cannot reach cost, purchase or expense channels they should not.
- **Performance:** order save stays fast with a 10-line, 8-ingredient order (indexed lookups, one transaction).

---

## 15. Open questions for the client

1. **Portions:** are they fixed (150 g chicken per burger) or "andaaza" (by eye)? The recipe is only as good as the portions.
2. **Who sees profit?** Recommended: owner only. Managers can be allowed later.
3. **Do you buy on credit (udhaar) from suppliers?** In v1 the app shows "owed to supplier" from credit purchases; a full supplier-payment ledger can be added after.
4. **Do you make your own sauces / marinate chicken in-house?** — **built (4.I):** Stock → *House-made*. Any ingredient can be given a batch recipe and a batch yield; its cost is then worked out from its components instead of being typed. Nothing needs answering before it can be used.
5. **Opening stock:** on go-live day, what is on the shelf and at what cost? — **screen built (4.B/4.H):** Stock → *Opening stock*. The question is now for the client to *fill in* on go-live day, not for us to build.
6. **Recurring bills:** which monthly bills should the app remind you about (rent, internet, gas)? — **screen built (4.E2/4.H):** Expenses → *Monthly bills*. The client answers by adding the bills himself; any bill can be added or paused.
7. **Stock count frequency:** daily, weekly or monthly? — **not a build question:** Stock counts can be taken as often as wanted (4.F); the frequency is a shop routine, not a setting.
8. **Old orders** have no cost data. Profit is shown **from go-live onward**; older bills show "no cost data". Acceptable?

---

## 16. Risks and how this plan handles them

| Risk | Handling |
|---|---|
| Owner forgets to enter purchases → stock drifts | Stock count + variance report, low-stock cards, "Can make" counts |
| Missing recipes make profit look too good | "No recipe" flags; profit shows "cost unknown", never zero |
| Slow entry at the till | Deduction inside the order save with indexed lookups; purchase entry keyboard-first |
| Double counting purchases and cost | Purchases are never expenses; P&L uses sold-cost only |
| Old reports changing when prices change | Cost snapshot on every sale |
| Cashier seeing the owner's margins | `costs:read` is admin-only by default |
| Wrong edit of a purchase price | Void + re-enter, never silent edit |
| Scope creep | Strict sub-phases; sub-recipes, variants and supplier ledger deferred |

---

## 17. Documents to update with this work

| File | Update |
|---|---|
| `docs/PRD.md` | New features: stock, recipes, costing, profit, expenses |
| `docs/architecture.md` | New tables, repositories, services, IPC files, pages |
| `docs/Rules.md` | Integer quantities, milli-paisa unit cost, ledger-only stock, snapshots, no double counting |
| `docs/phases.md` | Add 4.A → 4.G |
| `docs/memory.md` | Decisions, current step, test counts |
| `docs/user-guide.md` | How to add stock, set a recipe, read profit, enter expenses |
