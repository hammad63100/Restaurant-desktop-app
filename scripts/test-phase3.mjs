/**
 * Phase 3 checks: menu CRUD, order creation (totals, snapshot prices, transaction),
 * status flow, invoice data and printing hooks.
 */
import { createHarness, createRunner } from './test-harness.mjs';

const harness = createHarness({ withDemoData: true });
const runner = createRunner('Phase 3 — Menu, orders and invoice');

await harness.setup();
await harness.loginAs('admin', 'admin123');
await harness.callOk('auth:change-password', {
  currentPassword: 'admin123',
  newPassword: 'OwnerPass123',
});

const menu = await harness.callOk('menu:items');
const burger = menu[0];

let menuCategoryId;
let createdItemId;
let orderId;

await runner.check('categories can be created and renamed', async () => {
  const category = await harness.callOk('menu:category-save', {
    name: 'Wraps',
    sortOrder: 5,
    active: true,
  });
  menuCategoryId = category.id;

  const renamed = await harness.callOk('menu:category-save', {
    id: category.id,
    name: 'Wraps and Rolls',
    sortOrder: 5,
    active: true,
  });

  if (renamed.name !== 'Wraps and Rolls') throw new Error('rename failed');
});

await runner.check('duplicate category names are rejected', async () => {
  await harness.callFail(
    'menu:category-save',
    { name: 'Burgers', sortOrder: 9, active: true },
    'CONFLICT',
  );
});

await runner.check('items can be created with a paisa price', async () => {
  const item = await harness.callOk('menu:item-save', {
    categoryId: menuCategoryId,
    name: 'Chicken Wrap',
    price: 35_050,
    available: true,
    image: null,
  });

  createdItemId = item.id;
  if (item.price !== 35_050) throw new Error('price must be stored as integer paisa');
  if (item.categoryName !== 'Wraps and Rolls') throw new Error('category name missing');
});

await runner.check('negative or fractional prices are rejected', async () => {
  await harness.callFail(
    'menu:item-save',
    { categoryId: menuCategoryId, name: 'Broken', price: -1, available: true, image: null },
    'VALIDATION_ERROR',
  );
  await harness.callFail(
    'menu:item-save',
    { categoryId: menuCategoryId, name: 'Broken', price: 10.5, available: true, image: null },
    'VALIDATION_ERROR',
  );
});

await runner.check('a category with items cannot be deleted', async () => {
  await harness.callFail('menu:category-delete', { id: menuCategoryId }, 'CONFLICT');
});

await runner.check('order totals are computed in integer paisa', async () => {
  const order = await harness.callOk('orders:create', {
    type: 'takeaway',
    status: 'pending',
    customerName: 'Test Customer',
    customerPhone: '03001234567',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: 5_000,
    taxPercent: 5,
    notes: 'no onions',
    items: [
      { itemId: burger.id, qty: 2, notes: '' },
      { itemId: createdItemId, qty: 1, notes: 'extra sauce' },
    ],
  });

  orderId = order.id;

  const expectedSubtotal = burger.price * 2 + 35_050;
  const expectedTax = Math.round(((expectedSubtotal - 5_000) * 5) / 100);
  const expectedTotal = expectedSubtotal - 5_000 + expectedTax;

  if (order.subtotal !== expectedSubtotal) {
    throw new Error(`subtotal ${order.subtotal} != ${expectedSubtotal}`);
  }
  if (order.discount !== 5_000) throw new Error('discount not stored');
  if (order.tax !== expectedTax) throw new Error(`tax ${order.tax} != ${expectedTax}`);
  if (order.total !== expectedTotal) throw new Error(`total ${order.total} != ${expectedTotal}`);
  if (order.items.length !== 2) throw new Error('order items not saved');
  if (order.items[1].notes !== 'extra sauce') throw new Error('item note not saved');
});

await runner.check('order and invoice numbers increment', async () => {
  if (!orderId) throw new Error('previous order missing');

  const order = await harness.callOk('orders:get', { id: orderId });
  if (!/^ORD-\d{5}$/.test(order.orderNo)) throw new Error(`bad order number ${order.orderNo}`);
  if (!/^INV-\d{5}$/.test(order.invoiceNo ?? '')) throw new Error('bad invoice number');

  const second = await harness.callOk('orders:create', {
    type: 'dine_in',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: 1,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
  });

  const firstNumber = Number(order.orderNo.split('-')[1]);
  const secondNumber = Number(second.orderNo.split('-')[1]);
  if (secondNumber !== firstNumber + 1) throw new Error('order numbers must increment by one');
});

await runner.check(
  'prices are snapshotted, later menu changes do not touch old orders',
  async () => {
    const before = await harness.callOk('orders:get', { id: orderId });
    const soldPrice = before.items[0].price;

    await harness.callOk('menu:item-save', {
      id: burger.id,
      categoryId: burger.categoryId,
      name: burger.name,
      price: burger.price + 10_000,
      available: true,
      image: null,
    });

    const after = await harness.callOk('orders:get', { id: orderId });
    if (after.items[0].price !== soldPrice) throw new Error('old order price changed');
    if (after.total !== before.total) throw new Error('old order total changed');

    // Restore the catalogue price for the remaining checks.
    await harness.callOk('menu:item-save', {
      id: burger.id,
      categoryId: burger.categoryId,
      name: burger.name,
      price: burger.price,
      available: true,
      image: null,
    });
  },
);

await runner.check('an order with no items is rejected', async () => {
  await harness.callFail(
    'orders:create',
    {
      type: 'takeaway',
      status: 'pending',
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      waiterId: null,
      deliveryBoyId: null,
      discount: 0,
      taxPercent: 0,
      notes: '',
      items: [],
    },
    'VALIDATION_ERROR',
  );
});

await runner.check('a sold-out item cannot be ordered', async () => {
  await harness.callOk('menu:item-toggle', { id: createdItemId, available: false });

  await harness.callFail(
    'orders:create',
    {
      type: 'takeaway',
      status: 'pending',
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      waiterId: null,
      deliveryBoyId: null,
      discount: 0,
      taxPercent: 0,
      notes: '',
      items: [{ itemId: createdItemId, qty: 1, notes: '' }],
    },
    'CONFLICT',
  );

  await harness.callOk('menu:item-toggle', { id: createdItemId, available: true });
});

await runner.check('a delivery order needs an address and a rider', async () => {
  const base = {
    type: 'delivery',
    status: 'pending',
    customerName: 'Ali',
    customerPhone: '03009998888',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
  };

  await harness.callFail('orders:create', base, 'VALIDATION_ERROR');
  await harness.callFail('orders:create', { ...base, deliveryBoyId: 1 }, 'VALIDATION_ERROR');
});

await runner.check('order status follows the allowed flow', async () => {
  const ready = await harness.callOk('orders:status', { id: orderId, status: 'ready' });
  if (ready.status !== 'ready') throw new Error('status was not updated');

  // ready -> preparing is not allowed (no going backwards)
  await harness.callFail('orders:status', { id: orderId, status: 'preparing' }, 'CONFLICT');

  const delivered = await harness.callOk('orders:status', { id: orderId, status: 'delivered' });
  if (delivered.status !== 'delivered') throw new Error('delivered status failed');

  await harness.callFail('orders:cancel', { id: orderId }, 'CONFLICT');
});

await runner.check('orders can be filtered and searched by customer phone', async () => {
  const byPhone = await harness.callOk('orders:list', {
    search: '03001234567',
    status: 'all',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 50,
  });

  if (!byPhone.some((order) => order.id === orderId))
    throw new Error('phone search missed the order');

  const delivered = await harness.callOk('orders:list', {
    search: '',
    status: 'delivered',
    type: 'all',
    fromDate: '',
    toDate: '',
    limit: 50,
  });

  if (!delivered.every((order) => order.status === 'delivered')) {
    throw new Error('status filter returned other statuses');
  }
});

await runner.check('invoice data carries shop details and items', async () => {
  const invoice = await harness.callOk('orders:invoice', { id: orderId });

  if (!invoice.shop.shopName) throw new Error('shop name missing from the invoice');
  if (invoice.order.items.length !== 2) throw new Error('invoice items missing');
  if (!invoice.cashierName) throw new Error('cashier name missing');
});

await runner.check('invoice HTML renders money and shop header', async () => {
  const invoice = await harness.callOk('orders:invoice', { id: orderId });
  const html = harness.renderInvoiceHtml(invoice, '80mm');

  if (!html.includes(invoice.shop.shopName)) throw new Error('shop name not in HTML');
  if (!html.includes(invoice.order.invoiceNo)) throw new Error('invoice number not in HTML');
  if (!/Grand total/i.test(html)) throw new Error('grand total missing');
  if (!html.includes('Thank you for visiting!')) throw new Error('footer missing');
  if (html.includes('undefined')) throw new Error('HTML contains undefined');
});

await runner.check('printing marks the invoice as printed', async () => {
  const result = await harness.callOk('orders:print', { id: orderId, paper: '80mm' });
  if (!result.printed) throw new Error('print should report success with the stub');

  const order = await harness.callOk('orders:get', { id: orderId });
  if (!order.printedAt) throw new Error('printed_at was not recorded');
});

await runner.check('cashier can take orders but not change the menu', async () => {
  await harness.loginAs('cashier', 'cashier123');

  const order = await harness.callOk('orders:create', {
    type: 'takeaway',
    status: 'pending',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    waiterId: null,
    deliveryBoyId: null,
    discount: 0,
    taxPercent: 0,
    notes: '',
    items: [{ itemId: burger.id, qty: 1, notes: '' }],
  });

  if (!order.id) throw new Error('cashier should be able to create an order');

  await harness.callFail(
    'menu:item-save',
    { categoryId: menuCategoryId, name: 'Nope', price: 1000, available: true, image: null },
    'FORBIDDEN',
  );
  await harness.callFail('orders:cancel', { id: order.id }, 'FORBIDDEN');

  // ...but marking something sold out mid-shift is allowed.
  await harness.callOk('menu:item-toggle', { id: createdItemId, available: false });
  await harness.callOk('menu:item-toggle', { id: createdItemId, available: true });
});

await runner.check('deleted items stay on old invoices', async () => {
  await harness.loginAs('admin', 'OwnerPass123');
  await harness.callOk('menu:item-delete', { id: createdItemId });

  const order = await harness.callOk('orders:get', { id: orderId });
  if (!order.items.some((item) => item.name === 'Chicken Wrap')) {
    throw new Error('deleted item disappeared from an old order');
  }
});

harness.cleanup();
runner.finish();
