import { z } from 'zod';

/**
 * Validation schemas shared by the React forms and the main process.
 * Rules.md requires validating twice: the form uses these for inline errors,
 * and the IPC handler parses the same payload again before touching the DB.
 */
const message = { error: 'Please check this field' };

export const usernameSchema = z
  .string(message)
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be 32 characters or fewer')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Username can only use letters, numbers, dot, dash or underscore');

export const passwordSchema = z
  .string(message)
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string(message).min(1, 'Password is required').max(128, 'Password is too long'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string(message).min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string(message).min(1, 'Please confirm the new password'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'New password and confirmation do not match',
    path: ['confirmPassword'],
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });

/* ------------------------------- Catalog ------------------------------- */

const nameField = (label: string) =>
  z.string(message).trim().min(1, `${label} is required`).max(80, `${label} is too long`);

const optionalText = (max: number, label: string) =>
  z.string(message).trim().max(max, `${label} is too long`).default('');

/** Money arrives as integer paisa and must never be negative. */
const paisaField = z
  .number(message)
  .int('Amount must be a whole number of paisa')
  .min(0, 'Amount cannot be negative')
  .max(1_000_000_000, 'Amount is too large');

const idField = z.number(message).int().positive('Please choose a valid record');

export const categorySchema = z.object({
  id: z.number().int().positive().optional(),
  name: nameField('Category name'),
  sortOrder: z.number(message).int().min(0).max(999).default(0),
  active: z.boolean(message).default(true),
});

export const menuItemSchema = z.object({
  id: z.number().int().positive().optional(),
  categoryId: idField,
  name: nameField('Item name'),
  price: paisaField,
  available: z.boolean(message).default(true),
  image: z.string(message).max(2_000_000).nullable().default(null),
});

/* -------------------------------- Orders ------------------------------- */

export const orderTypeSchema = z.enum(['dine_in', 'takeaway', 'delivery']);
export const orderStatusSchema = z.enum([
  'pending',
  'preparing',
  'ready',
  'delivered',
  'cancelled',
]);

export const newOrderSchema = z
  .object({
    type: orderTypeSchema,
    status: orderStatusSchema.default('pending'),
    customerName: optionalText(80, 'Customer name'),
    customerPhone: optionalText(20, 'Phone'),
    customerAddress: optionalText(200, 'Address'),
    waiterId: z.number().int().positive().nullable().default(null),
    deliveryBoyId: z.number().int().positive().nullable().default(null),
    // Dine-in only; ignored for takeaway and delivery (enforced in the service).
    tableId: z.number(message).int().positive().nullable().default(null),
    discount: paisaField.default(0),
    discountReason: optionalText(200, 'Discount reason'),
    promoCode: optionalText(30, 'Promo code'),
    approvedBy: z.number(message).int().positive().nullable().default(null),
    taxPercent: z.number(message).int().min(0, 'Tax cannot be negative').max(100).default(0),
    notes: optionalText(300, 'Notes'),
    items: z
      .array(
        z.object({
          itemId: idField,
          qty: z.number(message).int().min(1, 'Quantity must be at least 1').max(999),
          notes: optionalText(120, 'Item note'),
        }),
      )
      .min(1, 'Add at least one item to the order'),
  })
  .refine((values) => values.type !== 'dine_in' || values.waiterId !== null, {
    message: 'Choose the waiter who took the order',
    path: ['waiterId'],
  })
  .refine((values) => values.type !== 'delivery' || values.deliveryBoyId !== null, {
    message: 'Choose the delivery boy for this delivery',
    path: ['deliveryBoyId'],
  })
  .refine((values) => values.type !== 'delivery' || values.customerAddress.trim() !== '', {
    message: 'Delivery address is required',
    path: ['customerAddress'],
  })
  // The subtotal depends on the menu prices, so this is checked again in
  // ordersService.create; here it catches the obvious case in the form.
  .refine((values) => values.discount >= 0, {
    message: 'Discount cannot be negative',
    path: ['discount'],
  });

export const orderFilterSchema = z.object({
  search: z.string(message).trim().max(80).default(''),
  status: z.union([orderStatusSchema, z.literal('all')]).default('all'),
  type: z.union([orderTypeSchema, z.literal('all')]).default('all'),
  fromDate: z.string(message).max(10).default(''),
  toDate: z.string(message).max(10).default(''),
  limit: z.number(message).int().min(1).max(500).default(100),
  after: z
    .object({
      createdAt: z.string(message).trim().min(1),
      id: z.number(message).int().positive(),
    })
    .nullable()
    .default(null),
});

export const orderStatusUpdateSchema = z.object({
  id: idField,
  status: orderStatusSchema,
});

/* -------------------------------- Staff -------------------------------- */

const dateField = z
  .string(message)
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), 'Use a valid date');

const monthField = z
  .string(message)
  .regex(/^\d{4}-\d{2}$/, 'Use a valid month')
  .refine(
    (value) => !Number.isNaN(new Date(`${value}-01T00:00:00`).getTime()),
    'Use a valid month',
  );

export const personTypeSchema = z.enum(['waiter', 'delivery_boy']);
export const attendanceStatusSchema = z.enum(['present', 'absent', 'half_day', 'leave']);
export const vehicleTypeSchema = z.enum(['bike', 'car', 'other']);
export const vehicleExpenseTypeSchema = z.enum(['fuel', 'maintenance', 'repair', 'other']);

const staffCore = {
  name: nameField('Name'),
  phone: optionalText(20, 'Phone'),
  cnic: optionalText(20, 'CNIC'),
  address: optionalText(200, 'Address'),
  joinDate: dateField,
  salary: paisaField,
  active: z.boolean(message).default(true),
};

export const waiterSchema = z.object({
  id: z.number().int().positive().optional(),
  ...staffCore,
});

export const deliveryBoySchema = z.object({
  id: z.number().int().positive().optional(),
  ...staffCore,
  commission: paisaField.default(0),
  vehicleId: z.number().int().positive().nullable().default(null),
});

export const attendanceSchema = z.object({
  personType: personTypeSchema,
  personId: idField,
  date: dateField,
  status: attendanceStatusSchema,
});

export const advanceSchema = z.object({
  personType: personTypeSchema,
  personId: idField,
  amount: z.number(message).int().min(1, 'Advance must be more than zero'),
  date: dateField,
  note: optionalText(200, 'Note'),
});

export const salaryPaySchema = z.object({
  personType: personTypeSchema,
  personId: idField,
  month: monthField,
  deductions: paisaField.default(0),
});

/* ------------------------------- Vehicles ------------------------------ */

export const vehicleSchema = z.object({
  id: z.number().int().positive().optional(),
  type: vehicleTypeSchema,
  plateNo: nameField('Number plate'),
  model: optionalText(60, 'Model'),
  color: optionalText(30, 'Colour'),
  registrationExpiry: dateField.nullable().default(null),
  insuranceExpiry: dateField.nullable().default(null),
  active: z.boolean(message).default(true),
});

export const vehicleAssignSchema = z.object({
  vehicleId: idField,
  deliveryBoyId: z.number().int().positive().nullable(),
  fromDate: dateField,
});

export const vehicleExpenseSchema = z.object({
  vehicleId: idField,
  type: vehicleExpenseTypeSchema,
  amount: z.number(message).int().min(1, 'Amount must be more than zero'),
  date: dateField,
  note: optionalText(200, 'Note'),
});

/* ------------------------- Reports and settings ------------------------ */

export const dateRangeSchema = z
  .object({ fromDate: dateField, toDate: dateField })
  .refine((values) => values.fromDate <= values.toDate, {
    message: 'The start date must be before the end date',
    path: ['toDate'],
  });

export const monthSchema = z.object({ month: monthField });

export const exportReportSchema = z.object({
  report: z.enum(['daily_sales', 'top_items', 'salary', 'delivery', 'vehicle_expenses']),
  range: dateRangeSchema,
});

export const shopSettingsSchema = z.object({
  shopName: nameField('Shop name'),
  shopAddress: optionalText(200, 'Address'),
  shopPhone: optionalText(30, 'Phone'),
  shopLogo: z.string(message).max(2_000_000).nullable().default(null),
  currency: z
    .string(message)
    .trim()
    .min(1, 'Currency is required')
    .max(5, 'Currency code is too long')
    .default('PKR'),
  taxPercent: z
    .number(message)
    .int()
    .min(0, 'Tax cannot be negative')
    .max(100, 'Tax cannot exceed 100%'),
  receiptWidth: z.enum(['80mm', 'a4']).default('80mm'),
  backupOnClose: z.boolean(message).default(true),
  printerSilent: z.boolean(message).default(true),
});

/* -------------------------------- Users -------------------------------- */

export const appUserSchema = z.object({
  id: z.number().int().positive().optional(),
  username: usernameSchema,
  fullName: nameField('Full name'),
  role: z.enum(['admin', 'cashier', 'manager']),
  active: z.boolean(message).default(true),
  password: passwordSchema.optional(),
});

export const resetUserPasswordSchema = z.object({
  id: idField,
  newPassword: passwordSchema,
});

/**
 * IPC variant of the change-password payload: the confirmation field is checked
 * in the form only, so the wire format stays { currentPassword, newPassword }.
 * The "must differ" rule is enforced on both sides.
 */
export const changePasswordIpcSchema = z
  .object({
    currentPassword: z.string(message).min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });

export type LoginPayload = z.infer<typeof loginSchema>;
export type ChangePasswordPayload = z.infer<typeof changePasswordSchema>;

/** Returns the first human readable issue, which is enough for one-field forms. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'The submitted data is not valid';
}

/* ------------------------------------------------------------------ *
 * Payments (Phase 2, feature 3.A)
 * ------------------------------------------------------------------ */

export const paymentMethodSchema = z.enum([
  'cash',
  'card',
  'jazzcash',
  'easypaisa',
  'bank_transfer',
  'credit',
]);

/**
 * Cash is the only method that takes more money than owed (and gives change), so
 * `tendered`/`changeDue` are validated against the amount and rejected elsewhere.
 */
export const paymentSchema = z
  .object({
    orderId: idField,
    method: paymentMethodSchema,
    amount: paisaField.refine((value) => value > 0, {
      message: 'Payment must be more than zero',
    }),
    tendered: paisaField.nullable().default(null),
    changeDue: paisaField.nullable().default(null),
    reference: optionalText(80, 'Reference'),
  })
  .refine((values) => values.method === 'cash' || values.tendered === null, {
    message: 'Only a cash payment can record cash tendered',
    path: ['tendered'],
  })
  .refine((values) => values.method === 'cash' || values.changeDue === null, {
    message: 'Only a cash payment can give change',
    path: ['changeDue'],
  })
  .refine((values) => values.tendered === null || values.tendered >= values.amount, {
    message: 'Cash tendered cannot be less than the amount',
    path: ['tendered'],
  })
  .refine(
    (values) =>
      values.tendered === null ||
      values.changeDue === null ||
      values.changeDue === values.tendered - values.amount,
    {
      message: 'Change must equal the cash tendered minus the amount',
      path: ['changeDue'],
    },
  );

export const paymentVoidSchema = z.object({
  id: idField,
  reason: z.string(message).trim().min(3, 'Give a reason for voiding this payment').max(200),
});

export const udhaarSettleSchema = z.object({
  customerId: idField,
  method: paymentMethodSchema.refine((method) => method !== 'credit', {
    message: 'Choose how the customer paid',
  }),
  amount: paisaField.refine((value) => value > 0, { message: 'Amount must be more than zero' }),
  reference: optionalText(80, 'Reference'),
  orderId: idField.nullable().default(null),
});

export const ledgerQuerySchema = z.object({ customerId: idField });

/** CSV export names that map to the udhaar page. */
export const UDHAAR_EXPORT = 'udhaar' as const;

/* ------------------------------------------------------------------ *
 * Shifts / day close (Phase 2, feature 3.B)
 * ------------------------------------------------------------------ */

export const cashMovementSchema = z.object({
  kind: z.enum(['cash_in', 'cash_out', 'refund', 'expense']),
  amount: paisaField.refine((value) => value > 0, { message: 'Amount must be more than zero' }),
  reason: z.string(message).trim().min(3, 'Give a reason for this cash movement').max(200),
});

export const shiftOpenSchema = z.object({ openingCash: paisaField });

export const shiftCloseSchema = z.object({
  countedCash: paisaField,
  notes: optionalText(300, 'Notes'),
});

export const shiftIdSchema = z.object({ shiftId: idField });
export const shiftReportSchema = z.object({ shiftId: idField.optional() });
export const shiftListSchema = z.object({
  limit: z.number(message).int().min(1).max(200).default(20),
});
export const shiftPrintSchema = z.object({ shiftId: idField, paper: z.enum(['80mm', 'a4']) });

/* ------------------------------------------------------------------ *
 * Discount rules and approvals (Phase 2, feature 3.C)
 * ------------------------------------------------------------------ */

export const discountRuleSchema = z.object({
  id: z.number(message).int().positive(),
  role: z.enum(['cashier', 'manager', 'admin']),
  maxPercentX100: z.number(message).int().min(0).max(10_000),
  maxAmount: paisaField.nullable().default(null),
  requiresApprovalAbovePercentX100: z.number(message).int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});

export const discountValidateSchema = z.object({
  subtotal: paisaField,
  percentX100: z.number(message).int().min(0).max(10_000).default(0),
  amount: paisaField.default(0),
  promoCode: optionalText(30, 'Promo code'),
});

export const discountApproveSchema = z.object({
  orderId: idField.nullable().default(null),
  percentX100: z.number(message).int().min(0).max(10_000).default(0),
  amount: paisaField,
  reason: z.string(message).trim().min(3, 'Give a reason for this discount').max(200),
  username: z.string(message).trim().min(1, 'Manager username is required'),
  password: z.string(message).min(1, 'Manager password is required'),
});

export const promoSchema = z
  .object({
    id: z.number(message).int().positive().optional(),
    code: z
      .string(message)
      .trim()
      .min(2, 'The code needs at least 2 characters')
      .max(20, 'The code is too long')
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters and numbers only'),
    kind: z.enum(['percent', 'fixed']),
    value: z.number(message).int().min(1, 'The value must be more than zero'),
    minOrder: paisaField.default(0),
    validFrom: z.string(message).trim().nullable().default(null),
    validTo: z.string(message).trim().nullable().default(null),
    maxUses: z.number(message).int().positive().nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((values) => values.kind !== 'percent' || values.value <= 10_000, {
    message: 'A promo percentage cannot exceed 100%',
    path: ['value'],
  });

/** Kitchen ticket lookup and print, both addressed by order id. */
export const kotPrintSchema = z.object({
  orderId: idField,
});

/* --------------------- tables, merge and split (Phase 3) --------------------- */

export const tableSchema = z.object({
  id: z.number(message).int().positive().optional(),
  name: z
    .string(message)
    .trim()
    .min(1, 'Give the table a name')
    .max(12, 'Keep the table name short')
    .regex(/^[A-Za-z0-9 -]+$/, 'Use letters and numbers only'),
  seats: z.number(message).int().min(1, 'A table needs at least one seat').max(40),
  area: optionalText(40, 'Area'),
  active: z.boolean().default(true),
});

export const tableDeleteSchema = z.object({ id: idField });

export const mergeSchema = z
  .object({
    sourceId: idField,
    targetId: idField,
  })
  .refine((values) => values.sourceId !== values.targetId, {
    message: 'Choose two different bills',
    path: ['targetId'],
  });

export const splitSchema = z
  .object({
    orderId: idField,
    itemIds: z.array(idField).min(1, 'Choose at least one line to move').max(100),
    /** Send the moved lines to a new table (true) or leave the new bill unseated. */
    moveTable: z.boolean().default(false),
  })
  // Duplicated ids would move the same line twice.
  .refine((values) => new Set(values.itemIds).size === values.itemIds.length, {
    message: 'The same line was selected twice',
    path: ['itemIds'],
  });

export const amendOrderSchema = z.object({
  id: idField,
  reason: z
    .string(message)
    .trim()
    .min(3, 'Say why the bill is being changed')
    .max(200, 'Keep the reason short'),
  items: z
    .array(
      z.object({
        itemId: idField,
        qty: z.number(message).int().min(1, 'Quantity must be at least 1').max(999),
        notes: optionalText(120, 'Item note'),
      }),
    )
    .min(1, 'A bill needs at least one line. Cancel it instead.'),
  discount: paisaField.default(0),
  approvedBy: z.number(message).int().positive().nullable().default(null),
  customerName: optionalText(80, 'Customer name'),
  customerPhone: optionalText(20, 'Phone'),
  customerAddress: optionalText(200, 'Address'),
  waiterId: z.number(message).int().positive().nullable().default(null),
  notes: optionalText(300, 'Notes'),
});
