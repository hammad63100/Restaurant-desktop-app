# PRD: Fast Food Management Desktop App

## 1. Overview
A desktop application for a fast food shop owner to take orders, generate invoices, manage the menu, and keep records of waiters, delivery boys, their salaries, and the vehicles given to delivery boys.

## 2. What to Build
A Windows desktop app that works **offline** (no internet needed) and stores all data locally. It replaces paper registers and manual billing.

### Problems it solves
- Orders are written by hand and are easy to lose.
- Invoices take time and have mistakes.
- Salary and advance records of staff are scattered.
- No record of which vehicle is with which delivery boy.
- The owner cannot easily see daily sales.

## 3. Targeted Users
| User | Description | Main needs |
|---|---|---|
| **Owner / Admin** | Shop owner | Full access, reports, salaries, settings |
| **Cashier** | Works at the counter all day | Fast order entry, invoice printing |
| **Manager** (optional) | Assistant to owner | Staff and vehicle records, no settings access |

## 4. Goals
- Create an order and print an invoice in under 30 seconds.
- Keep accurate staff, salary, and vehicle records.
- Give the owner clear daily and monthly sales numbers.

## 5. Features

### 5.1 Login and Roles
- Username and password login
- Roles: Admin, Cashier, Manager
- Admin can create and disable users

### 5.2 Dashboard
- Today's sales, number of orders, pending deliveries
- Quick buttons: New Order, Orders List, Reports
- Recent orders list

### 5.3 Menu and Items
- Add, edit, delete items
- Categories (Burgers, Pizza, Drinks, etc.)
- Price per item, availability on/off
- Optional item image

### 5.4 Orders
- New order with order type: **Dine-in, Takeaway, Delivery**
- Customer name, phone, address (for delivery)
- Select items and quantities, add notes
- Discount and tax
- Assign waiter (dine-in) or delivery boy (delivery)
- Status: Pending, Preparing, Ready, Delivered, Cancelled
- Search and filter old orders

### 5.5 Invoice
- Auto invoice number
- Shop name, logo, date, time, cashier
- Item list, subtotal, discount, tax, grand total
- Print (80mm thermal or A4) and save as PDF
- Reprint old invoices

### 5.6 Waiters
- Name, phone, CNIC, address, join date, fixed salary
- Attendance
- Advances and deductions
- Monthly salary calculation and salary slip
- Orders taken per waiter

### 5.7 Delivery Boys
- Same details as waiters
- Assigned vehicle
- Number of deliveries, delivery commission (optional)
- Salary and advances

### 5.8 Vehicles
- Type (bike/car), number plate, model, color
- Assigned delivery boy (with history)
- Fuel and maintenance expenses
- Document expiry reminders (registration, insurance)

### 5.9 Reports
- Daily and monthly sales
- Top-selling items
- Salary summary
- Delivery report
- Vehicle expense report
- Export to PDF/Excel

### 5.10 Settings and Backup
- Shop name, logo, address, phone
- Tax percentage
- Printer selection
- Backup and restore database

## 6. Out of Scope (for version 1)
- Online ordering or website
- Mobile app
- Multi-branch sync
- Payment gateway integration

## 7. Open Questions for the Owner
1. Thermal receipt printer (80mm) or normal printer?
2. One computer or several (counter + kitchen)?
3. Should the invoice show tax (FBR/PRA)?
4. App language: English, Urdu, or both?
5. Is salary fixed, or based on attendance and deliveries?

## 8. Success Criteria
- All six core areas work (orders, invoices, menu, waiters, delivery boys, vehicles).
- Works with no internet.
- No data loss; backup works.
- A cashier can use it after 15 minutes of training.
