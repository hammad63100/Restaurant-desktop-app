import type { AppDatabase } from '../connection';
import type {
  AdvanceRecord,
  AttendanceRecord,
  AttendanceStatus,
  DeliveryBoy,
  PersonType,
  SalaryPaymentRecord,
  Waiter,
} from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';

interface WaiterRow {
  id: number;
  name: string;
  phone: string;
  cnic: string;
  address: string;
  join_date: string;
  salary: number;
  active: number;
}

interface DeliveryBoyRow extends WaiterRow {
  commission: number;
  vehicle_id: number | null;
  vehicle_plate: string | null;
}

interface AttendanceRow {
  id: number;
  person_type: PersonType;
  person_id: number;
  date: string;
  status: AttendanceStatus;
}

interface AdvanceRow {
  id: number;
  person_type: PersonType;
  person_id: number;
  amount: number;
  date: string;
  note: string;
}

interface SalaryPaymentRow {
  id: number;
  person_type: PersonType;
  person_id: number;
  month: string;
  base: number;
  deductions: number;
  advances: number;
  net: number;
  paid_on: string;
}

const toWaiter = (row: WaiterRow): Waiter => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  cnic: row.cnic,
  address: row.address,
  joinDate: row.join_date,
  salary: row.salary,
  active: row.active === 1,
});

const toDeliveryBoy = (row: DeliveryBoyRow): DeliveryBoy => ({
  ...toWaiter(row),
  commission: row.commission,
  vehicleId: row.vehicle_id,
  vehiclePlate: row.vehicle_plate,
});

const toAttendance = (row: AttendanceRow): AttendanceRecord => ({
  id: row.id,
  personType: row.person_type,
  personId: row.person_id,
  date: row.date,
  status: row.status,
});

const toAdvance = (row: AdvanceRow): AdvanceRecord => ({
  id: row.id,
  personType: row.person_type,
  personId: row.person_id,
  amount: row.amount,
  date: row.date,
  note: row.note,
});

const toSalaryPayment = (row: SalaryPaymentRow): SalaryPaymentRecord => ({
  id: row.id,
  personType: row.person_type,
  personId: row.person_id,
  month: row.month,
  base: row.base,
  deductions: row.deductions,
  advances: row.advances,
  net: row.net,
  paidOn: row.paid_on,
});

export function createStaffRepository(db: AppDatabase) {
  const selectWaiters = db.prepare<[], WaiterRow>(
    'SELECT * FROM waiters WHERE active = 1 ORDER BY name COLLATE NOCASE',
  );
  const selectWaiter = db.prepare<[number], WaiterRow>('SELECT * FROM waiters WHERE id = ?');
  const insertWaiter = db.prepare(`
    INSERT INTO waiters (name, phone, cnic, address, join_date, salary, active, created_at, updated_at)
    VALUES (@name, @phone, @cnic, @address, @joinDate, @salary, @active, @now, @now)
  `);
  const updateWaiter = db.prepare(`
    UPDATE waiters
       SET name = @name, phone = @phone, cnic = @cnic, address = @address,
           join_date = @joinDate, salary = @salary, active = @active, updated_at = @now
     WHERE id = @id
  `);
  const deactivateWaiter = db.prepare('UPDATE waiters SET active = 0, updated_at = ? WHERE id = ?');

  const selectDeliveryBoys = db.prepare<[], DeliveryBoyRow>(`
    SELECT d.*, v.plate_no AS vehicle_plate
      FROM delivery_boys d
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.active = 1
     ORDER BY d.name COLLATE NOCASE
  `);
  const selectDeliveryBoy = db.prepare<[number], DeliveryBoyRow>(`
    SELECT d.*, v.plate_no AS vehicle_plate
      FROM delivery_boys d
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.id = ?
  `);
  const insertDeliveryBoy = db.prepare(`
    INSERT INTO delivery_boys (name, phone, cnic, address, join_date, salary, commission, vehicle_id, active, created_at, updated_at)
    VALUES (@name, @phone, @cnic, @address, @joinDate, @salary, @commission, @vehicleId, @active, @now, @now)
  `);
  const updateDeliveryBoy = db.prepare(`
    UPDATE delivery_boys
       SET name = @name, phone = @phone, cnic = @cnic, address = @address,
           join_date = @joinDate, salary = @salary, commission = @commission,
           vehicle_id = @vehicleId, active = @active, updated_at = @now
     WHERE id = @id
  `);
  const deactivateDeliveryBoy = db.prepare(
    'UPDATE delivery_boys SET active = 0, updated_at = ? WHERE id = ?',
  );

  const selectAttendance = db.prepare<[PersonType, number, string], AttendanceRow>(`
    SELECT id, person_type, person_id, date, status
      FROM attendance
     WHERE person_type = ? AND person_id = ? AND date LIKE ?
     ORDER BY date
  `);
  const upsertAttendance = db.prepare(`
    INSERT INTO attendance (person_type, person_id, date, status, created_at, updated_at)
    VALUES (@personType, @personId, @date, @status, @now, @now)
    ON CONFLICT (person_type, person_id, date)
    DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
  `);
  const selectAttendanceRow = db.prepare<[PersonType, number, string], AttendanceRow>(
    'SELECT id, person_type, person_id, date, status FROM attendance WHERE person_type = ? AND person_id = ? AND date = ?',
  );

  const selectAdvances = db.prepare<[PersonType, number, string], AdvanceRow>(`
    SELECT id, person_type, person_id, amount, date, note
      FROM advances
     WHERE person_type = ? AND person_id = ? AND date LIKE ?
     ORDER BY date DESC, id DESC
  `);
  const insertAdvance = db.prepare(`
    INSERT INTO advances (person_type, person_id, amount, date, note, created_at)
    VALUES (@personType, @personId, @amount, @date, @note, @now)
  `);
  const selectAdvance = db.prepare<[number], AdvanceRow>(
    'SELECT id, person_type, person_id, amount, date, note FROM advances WHERE id = ?',
  );
  const deleteAdvance = db.prepare('DELETE FROM advances WHERE id = ?');

  const selectSalaryPaymentsMonth = db.prepare<[string], SalaryPaymentRow>(
    'SELECT * FROM salary_payments WHERE month = ? ORDER BY person_type, person_id',
  );
  const selectSalaryPayment = db.prepare<[PersonType, number, string], SalaryPaymentRow>(
    'SELECT * FROM salary_payments WHERE person_type = ? AND person_id = ? AND month = ?',
  );
  const upsertSalaryPayment = db.prepare(`
    INSERT INTO salary_payments (person_type, person_id, month, base, deductions, advances, net, paid_on, created_at)
    VALUES (@personType, @personId, @month, @base, @deductions, @advances, @net, @paidOn, @now)
    ON CONFLICT (person_type, person_id, month)
    DO UPDATE SET base = excluded.base, deductions = excluded.deductions,
                  advances = excluded.advances, net = excluded.net, paid_on = excluded.paid_on
  `);
  const sumAdvancesMonth = db.prepare<[PersonType, number, string], { total: number | null }>(
    'SELECT SUM(amount) AS total FROM advances WHERE person_type = ? AND person_id = ? AND date LIKE ?',
  );

  return {
    listWaiters(): Waiter[] {
      return selectWaiters.all().map(toWaiter);
    },

    findWaiter(id: number): Waiter | null {
      const row = selectWaiter.get(id);
      return row ? toWaiter(row) : null;
    },

    createWaiter(input: Omit<Waiter, 'id'>): number {
      const result = insertWaiter.run({
        ...input,
        active: input.active ? 1 : 0,
        now: toSqlDateTime(),
      });
      return Number(result.lastInsertRowid);
    },

    updateWaiter(input: Waiter): void {
      updateWaiter.run({ ...input, active: input.active ? 1 : 0, now: toSqlDateTime() });
    },

    deactivateWaiter(id: number): void {
      deactivateWaiter.run(toSqlDateTime(), id);
    },

    listDeliveryBoys(): DeliveryBoy[] {
      return selectDeliveryBoys.all().map(toDeliveryBoy);
    },

    findDeliveryBoy(id: number): DeliveryBoy | null {
      const row = selectDeliveryBoy.get(id);
      return row ? toDeliveryBoy(row) : null;
    },

    createDeliveryBoy(input: Omit<DeliveryBoy, 'id' | 'vehiclePlate'>): number {
      const result = insertDeliveryBoy.run({
        ...input,
        active: input.active ? 1 : 0,
        now: toSqlDateTime(),
      });
      return Number(result.lastInsertRowid);
    },

    updateDeliveryBoy(input: Omit<DeliveryBoy, 'vehiclePlate'>): void {
      updateDeliveryBoy.run({ ...input, active: input.active ? 1 : 0, now: toSqlDateTime() });
    },

    deactivateDeliveryBoy(id: number): void {
      deactivateDeliveryBoy.run(toSqlDateTime(), id);
    },

    /** Used when a vehicle is assigned/unassigned so both sides stay in sync. */
    setVehicle(deliveryBoyId: number, vehicleId: number | null): void {
      db.prepare('UPDATE delivery_boys SET vehicle_id = ?, updated_at = ? WHERE id = ?').run(
        vehicleId,
        toSqlDateTime(),
        deliveryBoyId,
      );
    },

    listAttendance(personType: PersonType, personId: number, month: string): AttendanceRecord[] {
      return selectAttendance.all(personType, personId, `${month}-%`).map(toAttendance);
    },

    setAttendance(input: {
      personType: PersonType;
      personId: number;
      date: string;
      status: AttendanceStatus;
    }): AttendanceRecord {
      upsertAttendance.run({ ...input, now: toSqlDateTime() });
      const row = selectAttendanceRow.get(input.personType, input.personId, input.date);
      if (!row) throw new Error('Attendance row was not saved');
      return toAttendance(row);
    },

    listAdvances(personType: PersonType, personId: number, month: string): AdvanceRecord[] {
      return selectAdvances.all(personType, personId, `${month}-%`).map(toAdvance);
    },

    addAdvance(input: {
      personType: PersonType;
      personId: number;
      amount: number;
      date: string;
      note: string;
    }): AdvanceRecord {
      const result = insertAdvance.run({ ...input, now: toSqlDateTime() });
      const row = selectAdvance.get(Number(result.lastInsertRowid));
      if (!row) throw new Error('Advance row was not saved');
      return toAdvance(row);
    },

    findAdvance(id: number): AdvanceRecord | null {
      const row = selectAdvance.get(id);
      return row ? toAdvance(row) : null;
    },

    deleteAdvance(id: number): void {
      deleteAdvance.run(id);
    },

    sumAdvancesForMonth(personType: PersonType, personId: number, month: string): number {
      return sumAdvancesMonth.get(personType, personId, `${month}-%`)?.total ?? 0;
    },

    listSalaryPayments(month: string): SalaryPaymentRecord[] {
      return selectSalaryPaymentsMonth.all(month).map(toSalaryPayment);
    },

    findSalaryPayment(
      personType: PersonType,
      personId: number,
      month: string,
    ): SalaryPaymentRecord | null {
      const row = selectSalaryPayment.get(personType, personId, month);
      return row ? toSalaryPayment(row) : null;
    },

    saveSalaryPayment(input: {
      personType: PersonType;
      personId: number;
      month: string;
      base: number;
      deductions: number;
      advances: number;
      net: number;
      paidOn: string;
    }): SalaryPaymentRecord {
      upsertSalaryPayment.run({ ...input, now: toSqlDateTime() });
      const row = selectSalaryPayment.get(input.personType, input.personId, input.month);
      if (!row) throw new Error('Salary payment was not saved');
      return toSalaryPayment(row);
    },
  };
}

export type StaffRepository = ReturnType<typeof createStaffRepository>;
