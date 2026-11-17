import type { UserRepository } from './repositories/userRepository';
import type { CatalogRepository } from './repositories/catalogRepository';
import type { OrdersRepository } from './repositories/ordersRepository';
import type { StaffRepository } from './repositories/staffRepository';
import type { VehiclesRepository } from './repositories/vehiclesRepository';
import type { SequenceRepository } from './repositories/sequenceRepository';
import { hashPassword } from '../utils/password';
import { toSqlDate } from '../utils/datetime';
import { logInfo } from '../services/logger';

/**
 * Optional demo data (SEED_DEMO=1).
 * Never runs unless explicitly requested, so a real shop starts with an empty menu.
 */
export async function seedDemoData(deps: {
  users: UserRepository;
  catalog: CatalogRepository;
  orders: OrdersRepository;
  staff: StaffRepository;
  vehicles: VehiclesRepository;
  sequences: SequenceRepository;
}): Promise<void> {
  const { users, catalog, orders, staff, vehicles, sequences } = deps;

  if (catalog.listItems().length > 0) {
    logInfo('Demo data skipped: the menu already has items');
    return;
  }

  // Demo colleagues. The real admin keeps its own password.
  const cashierHash = await hashPassword('cashier123');
  const managerHash = await hashPassword('manager123');

  if (!users.findByUsername('cashier')) {
    users.create({
      username: 'cashier',
      passwordHash: cashierHash,
      fullName: 'Counter Staff',
      role: 'cashier',
      active: true,
      mustChangePassword: false,
    });
  }

  if (!users.findByUsername('manager')) {
    users.create({
      username: 'manager',
      passwordHash: managerHash,
      fullName: 'Shift Manager',
      role: 'manager',
      active: true,
      mustChangePassword: false,
    });
  }

  const burgers = catalog.createCategory('Burgers', 1);
  const pizza = catalog.createCategory('Pizza', 2);
  const drinks = catalog.createCategory('Drinks', 3);
  const sides = catalog.createCategory('Sides', 4);

  const items = [
    { categoryId: burgers, name: 'Zinger Burger', price: 45_000 },
    { categoryId: burgers, name: 'Beef Cheese Burger', price: 55_000 },
    { categoryId: burgers, name: 'Chicken Burger', price: 40_000 },
    { categoryId: pizza, name: 'Chicken Tikka Pizza (Small)', price: 90_000 },
    { categoryId: pizza, name: 'Chicken Fajita Pizza (Medium)', price: 150_000 },
    { categoryId: drinks, name: 'Cola 500ml', price: 12_000 },
    { categoryId: drinks, name: 'Mineral Water 1.5L', price: 8_000 },
    { categoryId: sides, name: 'French Fries', price: 25_000 },
    { categoryId: sides, name: 'Chicken Wings (6 pcs)', price: 60_000 },
  ].map((item) => ({ ...item, available: true, image: null }));

  const itemIds = items.map((item) => {
    const id = catalog.createItem(item);
    return { id, name: item.name, price: item.price };
  });

  const waiterId = staff.createWaiter({
    name: 'Ali Raza',
    phone: '0300-1234567',
    cnic: '61101-1234567-1',
    address: 'Street 4, Islamabad',
    joinDate: toSqlDate(new Date(Date.now() - 120 * 86_400_000)),
    salary: 3_500_000,
    active: true,
  });

  staff.createWaiter({
    name: 'Bilal Ahmed',
    phone: '0301-7654321',
    cnic: '61101-7654321-3',
    address: 'Street 9, Islamabad',
    joinDate: toSqlDate(new Date(Date.now() - 60 * 86_400_000)),
    salary: 3_000_000,
    active: true,
  });

  const riderId = staff.createDeliveryBoy({
    name: 'Usman Khan',
    phone: '0333-1112233',
    cnic: '61101-1112233-9',
    address: 'Sector G-11, Islamabad',
    joinDate: toSqlDate(new Date(Date.now() - 45 * 86_400_000)),
    salary: 2_800_000,
    commission: 5,
    vehicleId: null,
    active: true,
  });

  // Two bikes with realistic document dates: one expiring soon, one already expired.
  const bikeId = vehicles.create({
    type: 'bike',
    plateNo: 'ICT-1234',
    model: 'Honda CG 125',
    color: 'Red',
    registrationExpiry: toSqlDate(new Date(Date.now() + 14 * 86_400_000)),
    insuranceExpiry: toSqlDate(new Date(Date.now() - 3 * 86_400_000)),
    active: true,
  });

  vehicles.startAssignment(bikeId, riderId, toSqlDate(new Date(Date.now() - 40 * 86_400_000)));
  staff.setVehicle(riderId, bikeId);

  vehicles.create({
    type: 'car',
    plateNo: 'ICT-7788',
    model: 'Suzuki Alto',
    color: 'White',
    registrationExpiry: toSqlDate(new Date(Date.now() + 240 * 86_400_000)),
    insuranceExpiry: toSqlDate(new Date(Date.now() + 120 * 86_400_000)),
    active: true,
  });

  // This month's attendance and a couple of expenses so staff/report pages look real.
  const thisMonth = toSqlDate(new Date()).slice(0, 7);
  const daysSoFar = Number(toSqlDate(new Date()).slice(8, 10));

  for (let day = 1; day <= daysSoFar; day += 1) {
    const date = `${thisMonth}-${String(day).padStart(2, '0')}`;
    const status = day % 7 === 0 ? 'leave' : day % 5 === 0 ? 'half_day' : 'present';
    staff.setAttendance({ personType: 'waiter', personId: waiterId, date, status });
    staff.setAttendance({ personType: 'delivery_boy', personId: riderId, date, status: 'present' });
  }

  staff.addAdvance({
    personType: 'waiter',
    personId: waiterId,
    amount: 500_000,
    date: `${thisMonth}-05`,
    note: 'Bike repair',
  });

  vehicles.addExpense({
    vehicleId: bikeId,
    type: 'fuel',
    amount: 180_000,
    date: `${thisMonth}-0${Math.min(daysSoFar, 3)}`,
    note: 'Petrol',
  });

  vehicles.addExpense({
    vehicleId: bikeId,
    type: 'maintenance',
    amount: 350_000,
    date: `${thisMonth}-0${Math.min(daysSoFar, 6)}`,
    note: 'Chain and engine oil',
  });

  const admin = users.findByUsername('admin');
  const createdBy = admin?.id ?? 1;

  // A handful of orders so the dashboard and reports are not empty.
  const today = new Date();
  const plan = [
    { daysAgo: 0, type: 'dine_in' as const, picks: [0, 5, 7], qty: 2 },
    { daysAgo: 0, type: 'takeaway' as const, picks: [1, 6], qty: 1 },
    { daysAgo: 1, type: 'delivery' as const, picks: [3, 5, 7], qty: 1 },
    { daysAgo: 2, type: 'dine_in' as const, picks: [2, 4], qty: 1 },
    { daysAgo: 3, type: 'takeaway' as const, picks: [0, 8], qty: 3 },
    { daysAgo: 5, type: 'delivery' as const, picks: [1, 5], qty: 2 },
  ];

  for (const entry of plan) {
    const picked = entry.picks
      .map((index) => itemIds[index])
      .filter((item): item is { id: number; name: string; price: number } => item !== undefined);

    const lines = picked.map((item) => ({
      itemId: item.id,
      name: item.name,
      price: item.price,
      qty: entry.qty,
      lineTotal: item.price * entry.qty,
      notes: '',
    }));

    const subtotal = lines.reduce((total, line) => total + line.lineTotal, 0);
    const tax = Math.round(subtotal * 0.05);
    const date = new Date(today);
    date.setDate(today.getDate() - entry.daysAgo);

    // Numbers come from the same sequence the real app uses, so live orders
    // never collide with demo orders.
    const orderNumber = sequences.next('order');
    const invoiceNumber = sequences.next('invoice');

    orders.create({
      orderNo: `ORD-${String(orderNumber).padStart(5, '0')}`,
      invoiceNo: `INV-${String(invoiceNumber).padStart(5, '0')}`,
      type: entry.type,
      status: entry.daysAgo === 0 ? 'preparing' : 'delivered',
      customerName: entry.type === 'dine_in' ? '' : 'Walk-in Customer',
      customerPhone: '',
      customerAddress: entry.type === 'delivery' ? 'House 12, Street 3, Islamabad' : '',
      waiterId: entry.type === 'dine_in' ? waiterId : null,
      deliveryBoyId: entry.type === 'delivery' ? riderId : null,
      subtotal,
      discount: 0,
      taxPercent: 5,
      tax,
      total: subtotal + tax,
      notes: '',
      createdBy,
      items: lines,
    });
  }

  logInfo(
    'Demo data seeded: 4 categories, 9 items, 2 waiters, 1 rider, 2 vehicles, attendance, 6 orders',
  );
}
