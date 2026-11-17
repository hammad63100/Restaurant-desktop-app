import { z } from 'zod';
import { CHANNELS } from '../../src/types/api';
import {
  advanceSchema,
  attendanceSchema,
  deliveryBoySchema,
  salaryPaySchema,
  waiterSchema,
} from '../../src/types/schemas';
import type {
  SaveDeliveryBoyPayload,
  SaveWaiterPayload,
  StaffService,
} from '../services/staffService';
import type { HandlerRegistry } from './registry';

const idSchema = z.object({ id: z.number().int().positive() });
const personQuerySchema = z.object({
  personType: z.enum(['waiter', 'delivery_boy']),
  personId: z.number().int().positive(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});
const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

export function staffHandlers(staff: StaffService): HandlerRegistry {
  return {
    [CHANNELS.waiters]: {
      handler: () => staff.listWaiters(),
    },

    [CHANNELS.waiterSave]: {
      capability: 'staff:write',
      schema: waiterSchema,
      handler: (input: SaveWaiterPayload) => staff.saveWaiter(input),
    },

    [CHANNELS.waiterDelete]: {
      // Employees are soft deleted; only owners and managers may do it.
      capability: 'staff:write',
      schema: idSchema,
      handler: (input: { id: number }) => {
        staff.removeWaiter(input.id);
        return null;
      },
    },

    [CHANNELS.deliveryBoys]: {
      handler: () => staff.listDeliveryBoys(),
    },

    [CHANNELS.deliveryBoySave]: {
      capability: 'staff:write',
      schema: deliveryBoySchema,
      handler: (input: SaveDeliveryBoyPayload) => staff.saveDeliveryBoy(input),
    },

    [CHANNELS.deliveryBoyDelete]: {
      capability: 'staff:write',
      schema: idSchema,
      handler: (input: { id: number }) => {
        staff.removeDeliveryBoy(input.id);
        return null;
      },
    },

    [CHANNELS.attendance]: {
      capability: 'staff:write',
      schema: personQuerySchema,
      handler: (input: {
        personType: 'waiter' | 'delivery_boy';
        personId: number;
        month: string;
      }) => staff.listAttendance(input.personType, input.personId, input.month),
    },

    [CHANNELS.attendanceSet]: {
      capability: 'staff:write',
      schema: attendanceSchema,
      handler: (input: Parameters<StaffService['setAttendance']>[0]) => staff.setAttendance(input),
    },

    [CHANNELS.advances]: {
      capability: 'staff:write',
      schema: personQuerySchema,
      handler: (input: {
        personType: 'waiter' | 'delivery_boy';
        personId: number;
        month: string;
      }) => staff.listAdvances(input.personType, input.personId, input.month),
    },

    [CHANNELS.advanceAdd]: {
      capability: 'staff:write',
      schema: advanceSchema,
      handler: (input: Parameters<StaffService['addAdvance']>[0]) => staff.addAdvance(input),
    },

    [CHANNELS.advanceDelete]: {
      capability: 'staff:write',
      schema: idSchema,
      handler: (input: { id: number }) => {
        staff.removeAdvance(input.id);
        return null;
      },
    },

    [CHANNELS.salarySlip]: {
      capability: 'staff:write',
      schema: personQuerySchema,
      handler: (input: {
        personType: 'waiter' | 'delivery_boy';
        personId: number;
        month: string;
      }) => staff.salarySlip(input.personType, input.personId, input.month),
    },

    [CHANNELS.salaryPay]: {
      capability: 'staff:write',
      schema: salaryPaySchema,
      handler: (input: Parameters<StaffService['paySalary']>[0]) => staff.paySalary(input),
    },

    [CHANNELS.salaryPayments]: {
      capability: 'staff:write',
      schema: monthSchema,
      handler: (input: { month: string }) => staff.salaryPayments(input.month),
    },
  };
}
