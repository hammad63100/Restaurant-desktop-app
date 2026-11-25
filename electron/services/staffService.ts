import type {
  AdvanceInput,
  AdvanceRecord,
  AttendanceRecord,
  AttendanceStatus,
  DeliveryBoy,
  PersonType,
  SalaryPaymentRecord,
  SalarySlip,
  Waiter,
} from '../../src/types/api';
import type { StaffRepository } from '../db/repositories/staffRepository';
import type { VehiclesRepository } from '../db/repositories/vehiclesRepository';
import { daysInRange, monthEnd, monthStart, todaySqlDate } from '../utils/datetime';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

export interface SaveWaiterPayload {
  id?: number;
  name: string;
  phone: string;
  cnic: string;
  address: string;
  joinDate: string;
  salary: number;
  active: boolean;
}

export interface SaveDeliveryBoyPayload extends SaveWaiterPayload {
  commission: number;
  vehicleId: number | null;
}

/**
 * Staff records plus the monthly salary calculation.
 * Salary rules (documented in docs/memory.md):
 *   perDay      = monthly salary / days in month
 *   earned      = present * perDay + halfDays * (perDay / 2)
 *   commission  = delivery commission earned that month (delivery boys only)
 *   advances    = sum of advances taken in that month
 *   net         = earned + commission - advances - deductions
 * All money is integer paisa.
 */
export function createStaffService(deps: {
  staff: StaffRepository;
  vehicles: VehiclesRepository;
  commissionForMonth: (deliveryBoyId: number, month: string) => number;
}) {
  const { staff, vehicles, commissionForMonth } = deps;

  function findWaiterOrFail(id: number): Waiter {
    const waiter = staff.findWaiter(id);
    if (!waiter) throw new AppError('NOT_FOUND', 'That waiter does not exist');
    return waiter;
  }

  function findBoyOrFail(id: number): DeliveryBoy {
    const boy = staff.findDeliveryBoy(id);
    if (!boy) throw new AppError('NOT_FOUND', 'That delivery boy does not exist');
    return boy;
  }

  function personName(personType: PersonType, personId: number): string {
    return personType === 'waiter' ? findWaiterOrFail(personId).name : findBoyOrFail(personId).name;
  }

  return {
    listWaiters(): Waiter[] {
      return staff.listWaiters();
    },

    saveWaiter(input: SaveWaiterPayload): Waiter {
      if (input.id) {
        findWaiterOrFail(input.id);
        staff.updateWaiter({ id: input.id, ...input });
        return findWaiterOrFail(input.id);
      }

      const id = staff.createWaiter(input);
      logInfo(`Waiter added: ${input.name}`);
      return findWaiterOrFail(id);
    },

    removeWaiter(id: number): void {
      const waiter = findWaiterOrFail(id);
      staff.deactivateWaiter(id);
      logInfo(`Waiter deactivated: ${waiter.name}`);
    },

    listDeliveryBoys(): DeliveryBoy[] {
      return staff.listDeliveryBoys();
    },

    saveDeliveryBoy(input: SaveDeliveryBoyPayload): DeliveryBoy {
      if (input.vehicleId !== null && !vehicles.find(input.vehicleId)) {
        throw new AppError('NOT_FOUND', 'The selected vehicle does not exist');
      }

      // Only one active rider per vehicle: release the previous holder.
      if (input.vehicleId !== null) {
        const vehicle = vehicles.find(input.vehicleId);
        const assignedBoyId = vehicle?.assignedToId ?? null;
        if (assignedBoyId !== null && assignedBoyId !== input.id) {
          staff.setVehicle(assignedBoyId, null);
          vehicles.endAssignmentsForBoy(assignedBoyId, todaySqlDate());
        }
      }

      if (input.id) {
        const existing = findBoyOrFail(input.id);
        staff.updateDeliveryBoy({ id: input.id, ...input });

        if (existing.vehicleId !== input.vehicleId) {
          if (existing.vehicleId !== null) {
            vehicles.endAssignmentsForBoy(input.id, todaySqlDate());
          }
          if (input.vehicleId !== null) {
            vehicles.startAssignment(input.vehicleId, input.id, todaySqlDate());
          }
        }

        return findBoyOrFail(input.id);
      }

      const id = staff.createDeliveryBoy({ ...input, vehicleId: input.vehicleId });
      if (input.vehicleId !== null) {
        vehicles.startAssignment(input.vehicleId, id, todaySqlDate());
      }

      logInfo(`Delivery boy added: ${input.name}`);
      return findBoyOrFail(id);
    },

    removeDeliveryBoy(id: number): void {
      const boy = findBoyOrFail(id);
      if (boy.vehicleId !== null) {
        vehicles.endAssignmentsForBoy(id, todaySqlDate());
      }
      staff.deactivateDeliveryBoy(id);
      logInfo(`Delivery boy deactivated: ${boy.name}`);
    },

    listAttendance(personType: PersonType, personId: number, month: string): AttendanceRecord[] {
      return staff.listAttendance(personType, personId, month);
    },

    setAttendance(input: {
      personType: PersonType;
      personId: number;
      date: string;
      status: AttendanceStatus;
    }): AttendanceRecord {
      personName(input.personType, input.personId);
      return staff.setAttendance(input);
    },

    listAdvances(personType: PersonType, personId: number, month: string): AdvanceRecord[] {
      return staff.listAdvances(personType, personId, month);
    },

    addAdvance(input: AdvanceInput): AdvanceRecord {
      personName(input.personType, input.personId);
      if (input.date > todaySqlDate()) {
        throw new AppError('VALIDATION_ERROR', 'An advance cannot be dated in the future');
      }
      logInfo(`Advance of ${input.amount} paisa for ${input.personType} ${input.personId}`);
      return staff.addAdvance(input);
    },

    removeAdvance(id: number): void {
      const advance = staff.findAdvance(id);
      if (!advance) throw new AppError('NOT_FOUND', 'That advance no longer exists');
      staff.deleteAdvance(id);
    },

    /**
     * Builds the salary slip for one person and month. `deductions` only affect
     * the preview; the saved payment keeps the number the owner confirmed.
     */
    salarySlip(
      personType: PersonType,
      personId: number,
      month: string,
      deductions = 0,
    ): SalarySlip {
      const person = personType === 'waiter' ? findWaiterOrFail(personId) : findBoyOrFail(personId);
      const from = monthStart(month);
      const to = monthEnd(month);
      const workingDays = daysInRange(from, to);

      const attendance = staff.listAttendance(personType, personId, month);
      const daysPresent = attendance.filter((row) => row.status === 'present').length;
      const halfDays = attendance.filter((row) => row.status === 'half_day').length;
      const daysAbsent = attendance.filter((row) => row.status === 'absent').length;
      const leaves = attendance.filter((row) => row.status === 'leave').length;

      const perDay = Math.round(person.salary / workingDays);
      const earnedSalary = daysPresent * perDay + Math.round((halfDays * perDay) / 2);
      const commission = personType === 'delivery_boy' ? commissionForMonth(personId, month) : 0;
      const advances = staff.sumAdvancesForMonth(personType, personId, month);
      const payment = staff.findSalaryPayment(personType, personId, month);
      const netPay = Math.max(0, earnedSalary + commission - advances - deductions);

      return {
        personType,
        personId,
        name: person.name,
        role: personType === 'waiter' ? 'Waiter' : 'Delivery boy',
        month,
        monthlySalary: person.salary,
        workingDays,
        daysPresent,
        daysAbsent,
        halfDays,
        leaves,
        perDay,
        earnedSalary,
        commission,
        advances,
        deductions,
        netPay,
        paidOn: payment?.paidOn ?? null,
      };
    },

    paySalary(input: {
      personType: PersonType;
      personId: number;
      month: string;
      deductions: number;
    }): SalaryPaymentRecord {
      const slip = this.salarySlip(input.personType, input.personId, input.month, input.deductions);
      if (slip.paidOn) {
        throw new AppError('CONFLICT', `Salary for ${input.month} is already recorded as paid`);
      }
      if (slip.daysPresent + slip.halfDays === 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Mark attendance for this month before paying the salary',
        );
      }

      const record = staff.saveSalaryPayment({
        personType: input.personType,
        personId: input.personId,
        month: input.month,
        base: slip.earnedSalary + slip.commission,
        deductions: input.deductions,
        advances: slip.advances,
        net: slip.netPay,
        paidOn: todaySqlDate(),
      });

      logInfo(`Salary paid: ${slip.name} ${input.month} (${slip.netPay} paisa)`);
      return record;
    },

    salaryPayments(month: string): SalaryPaymentRecord[] {
      return staff.listSalaryPayments(month);
    },

    /** Used by the reports module for the salary summary table. */
    peopleWithSalary(month: string) {
      const waiters = staff.listWaiters().map((waiter) => ({
        personType: 'waiter' as PersonType,
        personId: waiter.id,
        name: waiter.name,
        role: 'Waiter',
        month,
        netPay: this.salarySlip('waiter', waiter.id, month).netPay,
        paid: staff.findSalaryPayment('waiter', waiter.id, month) !== null,
      }));

      const boys = staff.listDeliveryBoys().map((boy) => ({
        personType: 'delivery_boy' as PersonType,
        personId: boy.id,
        name: boy.name,
        role: 'Delivery boy',
        month,
        netPay: this.salarySlip('delivery_boy', boy.id, month).netPay,
        paid: staff.findSalaryPayment('delivery_boy', boy.id, month) !== null,
      }));

      return [...waiters, ...boys];
    },
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
