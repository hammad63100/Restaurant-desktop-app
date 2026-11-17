import { z } from 'zod';
import { CHANNELS } from '../../src/types/api';
import { vehicleAssignSchema, vehicleExpenseSchema, vehicleSchema } from '../../src/types/schemas';
import type { SaveVehiclePayload, VehiclesService } from '../services/vehiclesService';
import type { HandlerRegistry } from './registry';

const idSchema = z.object({ id: z.number().int().positive() });

export function vehiclesHandlers(vehicles: VehiclesService): HandlerRegistry {
  return {
    [CHANNELS.vehicles]: {
      handler: () => vehicles.list(),
    },

    [CHANNELS.vehicleSave]: {
      capability: 'vehicles:write',
      schema: vehicleSchema,
      handler: (input: SaveVehiclePayload) => vehicles.save(input),
    },

    [CHANNELS.vehicleDelete]: {
      capability: 'vehicles:write',
      schema: idSchema,
      handler: (input: { id: number }) => {
        vehicles.remove(input.id);
        return null;
      },
    },

    [CHANNELS.vehicleAssign]: {
      capability: 'vehicles:write',
      schema: vehicleAssignSchema,
      handler: (input: { vehicleId: number; deliveryBoyId: number | null; fromDate: string }) =>
        vehicles.assign(input.vehicleId, input.deliveryBoyId, input.fromDate),
    },

    [CHANNELS.vehicleAssignments]: {
      schema: idSchema,
      handler: (input: { id: number }) => vehicles.assignments(input.id),
    },

    [CHANNELS.vehicleExpenses]: {
      schema: z.object({
        vehicleId: z.number().int().positive(),
        fromDate: z.string().min(10),
        toDate: z.string().min(10),
      }),
      handler: (input: { vehicleId: number; fromDate: string; toDate: string }) =>
        vehicles.expenses(input.vehicleId, input.fromDate, input.toDate),
    },

    [CHANNELS.vehicleExpenseAdd]: {
      capability: 'vehicles:write',
      schema: vehicleExpenseSchema,
      handler: (input: Parameters<VehiclesService['addExpense']>[0]) => vehicles.addExpense(input),
    },

    [CHANNELS.vehicleExpenseDelete]: {
      capability: 'vehicles:write',
      schema: idSchema,
      handler: (input: { id: number }) => {
        vehicles.removeExpense(input.id);
        return null;
      },
    },
  };
}
