import type {
  AttendanceStatus,
  OrderStatus,
  OrderType,
  PersonType,
  UserRole,
  VehicleExpenseType,
  VehicleType,
} from './api';

/** Human labels live in one place so every page shows the same wording. */

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  cashier: 'Cashier',
  manager: 'Manager',
};

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  preparing: 'Preparing',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Tailwind classes per status; the label is always shown too (design.md accessibility). */
export const ORDER_STATUS_CLASSES: Record<OrderStatus, string> = {
  pending: 'bg-secondary/15 text-[#8a6100]',
  preparing: 'bg-status-preparing/15 text-status-preparing',
  ready: 'bg-accent/15 text-[#9a5200]',
  delivered: 'bg-status-success/15 text-status-success',
  cancelled: 'bg-status-cancelled/10 text-status-cancelled',
};

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half day',
  leave: 'Leave',
};

export const PERSON_TYPE_LABELS: Record<PersonType, string> = {
  waiter: 'Waiter',
  delivery_boy: 'Delivery boy',
};

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  bike: 'Bike',
  car: 'Car',
  other: 'Other',
};

export const VEHICLE_EXPENSE_LABELS: Record<VehicleExpenseType, string> = {
  fuel: 'Fuel',
  maintenance: 'Maintenance',
  repair: 'Repair',
  other: 'Other',
};
