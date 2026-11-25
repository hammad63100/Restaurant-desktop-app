import type {
  Vehicle,
  VehicleAssignment,
  VehicleExpense,
  VehicleExpenseInput,
} from '../../src/types/api';
import type { VehiclesRepository } from '../db/repositories/vehiclesRepository';
import type { StaffRepository } from '../db/repositories/staffRepository';
import { todaySqlDate } from '../utils/datetime';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

export interface SaveVehiclePayload {
  id?: number;
  type: Vehicle['type'];
  plateNo: string;
  model: string;
  color: string;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  active: boolean;
}

export function createVehiclesService(deps: {
  vehicles: VehiclesRepository;
  staff: StaffRepository;
}) {
  const { vehicles, staff } = deps;

  function findOrFail(id: number): Vehicle {
    const vehicle = vehicles.find(id);
    if (!vehicle) throw new AppError('NOT_FOUND', 'That vehicle does not exist');
    return vehicle;
  }

  function assertPlateFree(plateNo: string, ignoreId?: number): void {
    const clash = vehicles
      .list()
      .find(
        (vehicle) =>
          vehicle.plateNo.toUpperCase() === plateNo.trim().toUpperCase() && vehicle.id !== ignoreId,
      );
    if (clash) throw new AppError('CONFLICT', 'A vehicle with that number plate already exists');
  }

  return {
    list(): Vehicle[] {
      return vehicles.list();
    },

    save(input: SaveVehiclePayload): Vehicle {
      assertPlateFree(input.plateNo, input.id);

      if (input.id) {
        const existing = findOrFail(input.id);
        vehicles.update({ ...existing, ...input, id: input.id });
        return findOrFail(input.id);
      }

      const id = vehicles.create(input);
      logInfo(`Vehicle added: ${input.plateNo}`);
      return findOrFail(id);
    },

    /** Soft delete; a vehicle that is currently assigned must be released first. */
    remove(id: number): void {
      const vehicle = findOrFail(id);
      const open = vehicles.openAssignment(id);
      if (open) {
        throw new AppError(
          'CONFLICT',
          `${vehicle.plateNo} is still assigned to ${open.deliveryBoyName}. Release it first.`,
        );
      }
      vehicles.deactivate(id);
      logInfo(`Vehicle deactivated: ${vehicle.plateNo}`);
    },

    /**
     * Assigning a vehicle closes the previous open assignment and moves the
     * `delivery_boys.vehicle_id` pointer, so both sides always agree.
     */
    assign(vehicleId: number, deliveryBoyId: number | null, fromDate: string): Vehicle {
      const vehicle = findOrFail(vehicleId);

      if (deliveryBoyId === null) {
        const open = vehicles.openAssignment(vehicleId);
        if (open) {
          vehicles.endAssignment(open.id, fromDate);
          staff.setVehicle(open.deliveryBoyId, null);
          logInfo(`Vehicle ${vehicle.plateNo} released from ${open.deliveryBoyName}`);
        }
        return findOrFail(vehicleId);
      }

      const boy = staff.findDeliveryBoy(deliveryBoyId);
      if (!boy) throw new AppError('NOT_FOUND', 'That delivery boy does not exist');

      const currentOpen = vehicles.openAssignment(vehicleId);
      if (currentOpen?.deliveryBoyId === deliveryBoyId) {
        return findOrFail(vehicleId);
      }

      // Release the vehicle from whoever had it, and the boy from whatever he had.
      if (currentOpen) {
        staff.setVehicle(currentOpen.deliveryBoyId, null);
        vehicles.endAssignment(currentOpen.id, fromDate);
      }

      for (const otherVehicleId of vehicles.vehiclesOfBoy(deliveryBoyId)) {
        if (otherVehicleId === vehicleId) continue;
        const otherOpen = vehicles.openAssignment(otherVehicleId);
        if (otherOpen) vehicles.endAssignment(otherOpen.id, fromDate);
      }

      vehicles.startAssignment(vehicleId, deliveryBoyId, fromDate);
      staff.setVehicle(deliveryBoyId, vehicleId);
      logInfo(`Vehicle ${vehicle.plateNo} assigned to ${boy.name}`);

      return findOrFail(vehicleId);
    },

    assignments(vehicleId: number): VehicleAssignment[] {
      findOrFail(vehicleId);
      return vehicles.assignments(vehicleId);
    },

    expenses(vehicleId: number, fromDate: string, toDate: string): VehicleExpense[] {
      findOrFail(vehicleId);
      return vehicles.expenses(vehicleId, fromDate, toDate);
    },

    addExpense(input: VehicleExpenseInput): VehicleExpense {
      findOrFail(input.vehicleId);
      if (input.date > todaySqlDate()) {
        throw new AppError('VALIDATION_ERROR', 'An expense cannot be dated in the future');
      }
      return vehicles.addExpense(input);
    },

    removeExpense(id: number): void {
      const expense = vehicles.findExpense(id);
      if (!expense) throw new AppError('NOT_FOUND', 'That expense no longer exists');
      vehicles.deleteExpense(id);
    },
  };
}

export type VehiclesService = ReturnType<typeof createVehiclesService>;
