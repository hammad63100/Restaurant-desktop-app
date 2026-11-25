import type { AppDatabase } from '../connection';
import type {
  Vehicle,
  VehicleAssignment,
  VehicleExpense,
  VehicleExpenseType,
  VehicleType,
} from '../../../src/types/api';
import { toSqlDateTime } from '../../utils/datetime';

interface VehicleRow {
  id: number;
  type: VehicleType;
  plate_no: string;
  model: string;
  color: string;
  registration_expiry: string | null;
  insurance_expiry: string | null;
  active: number;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
}

interface AssignmentRow {
  id: number;
  vehicle_id: number;
  delivery_boy_id: number;
  delivery_boy_name: string;
  from_date: string;
  to_date: string | null;
}

interface ExpenseRow {
  id: number;
  vehicle_id: number;
  type: VehicleExpenseType;
  amount: number;
  date: string;
  note: string;
}

const toVehicle = (row: VehicleRow): Vehicle => ({
  id: row.id,
  type: row.type,
  plateNo: row.plate_no,
  model: row.model,
  color: row.color,
  registrationExpiry: row.registration_expiry,
  insuranceExpiry: row.insurance_expiry,
  active: row.active === 1,
  assignedToId: row.assigned_to_id,
  assignedToName: row.assigned_to_name,
});

const toAssignment = (row: AssignmentRow): VehicleAssignment => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  deliveryBoyId: row.delivery_boy_id,
  deliveryBoyName: row.delivery_boy_name,
  fromDate: row.from_date,
  toDate: row.to_date,
});

const toExpense = (row: ExpenseRow): VehicleExpense => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  type: row.type,
  amount: row.amount,
  date: row.date,
  note: row.note,
});

const VEHICLE_SELECT = `
  SELECT v.id, v.type, v.plate_no, v.model, v.color, v.registration_expiry, v.insurance_expiry, v.active,
         d.id   AS assigned_to_id,
         d.name AS assigned_to_name
    FROM vehicles v
    LEFT JOIN delivery_boys d ON d.vehicle_id = v.id AND d.active = 1
`;

export function createVehiclesRepository(db: AppDatabase) {
  const selectVehicles = db.prepare<[], VehicleRow>(
    `${VEHICLE_SELECT} ORDER BY v.active DESC, v.plate_no COLLATE NOCASE`,
  );
  const selectVehicle = db.prepare<[number], VehicleRow>(`${VEHICLE_SELECT} WHERE v.id = ?`);
  const insertVehicle = db.prepare(`
    INSERT INTO vehicles (type, plate_no, model, color, registration_expiry, insurance_expiry, active, created_at, updated_at)
    VALUES (@type, @plateNo, @model, @color, @registrationExpiry, @insuranceExpiry, @active, @now, @now)
  `);
  const updateVehicle = db.prepare(`
    UPDATE vehicles
       SET type = @type, plate_no = @plateNo, model = @model, color = @color,
           registration_expiry = @registrationExpiry, insurance_expiry = @insuranceExpiry,
           active = @active, updated_at = @now
     WHERE id = @id
  `);

  const selectAssignments = db.prepare<[number], AssignmentRow>(`
    SELECT a.id, a.vehicle_id, a.delivery_boy_id, d.name AS delivery_boy_name, a.from_date, a.to_date
      FROM vehicle_assignments a
      JOIN delivery_boys d ON d.id = a.delivery_boy_id
     WHERE a.vehicle_id = ?
     ORDER BY a.from_date DESC, a.id DESC
  `);
  const selectOpenAssignment = db.prepare<[number], AssignmentRow>(`
    SELECT a.id, a.vehicle_id, a.delivery_boy_id, d.name AS delivery_boy_name, a.from_date, a.to_date
      FROM vehicle_assignments a
      JOIN delivery_boys d ON d.id = a.delivery_boy_id
     WHERE a.vehicle_id = ? AND a.to_date IS NULL
     ORDER BY a.id DESC LIMIT 1
  `);
  const insertAssignment = db.prepare(`
    INSERT INTO vehicle_assignments (vehicle_id, delivery_boy_id, from_date, to_date, created_at)
    VALUES (?, ?, ?, NULL, ?)
  `);
  const closeAssignment = db.prepare(
    'UPDATE vehicle_assignments SET to_date = ? WHERE id = ? AND to_date IS NULL',
  );
  const closeAssignmentsForBoy = db.prepare(
    'UPDATE vehicle_assignments SET to_date = ? WHERE delivery_boy_id = ? AND to_date IS NULL',
  );
  const openAssignmentsForBoy = db.prepare<[number], { vehicle_id: number }>(
    'SELECT vehicle_id FROM vehicle_assignments WHERE delivery_boy_id = ? AND to_date IS NULL',
  );

  const selectExpenses = db.prepare<[number, string, string], ExpenseRow>(`
    SELECT id, vehicle_id, type, amount, date, note
      FROM vehicle_expenses
     WHERE vehicle_id = ? AND date BETWEEN ? AND ?
     ORDER BY date DESC, id DESC
  `);
  const insertExpense = db.prepare(`
    INSERT INTO vehicle_expenses (vehicle_id, type, amount, date, note, created_at)
    VALUES (@vehicleId, @type, @amount, @date, @note, @now)
  `);
  const selectExpense = db.prepare<[number], ExpenseRow>(
    'SELECT id, vehicle_id, type, amount, date, note FROM vehicle_expenses WHERE id = ?',
  );
  const deleteExpense = db.prepare('DELETE FROM vehicle_expenses WHERE id = ?');
  const selectExpiryAlerts = db.prepare<[string, string], VehicleRow>(`
    ${VEHICLE_SELECT}
    WHERE v.active = 1
      AND (
        (v.registration_expiry IS NOT NULL AND v.registration_expiry <= ?)
        OR (v.insurance_expiry IS NOT NULL AND v.insurance_expiry <= ?)
      )
    ORDER BY v.plate_no
  `);

  return {
    list(): Vehicle[] {
      return selectVehicles.all().map(toVehicle);
    },

    find(id: number): Vehicle | null {
      const row = selectVehicle.get(id);
      return row ? toVehicle(row) : null;
    },

    create(input: Omit<Vehicle, 'id' | 'assignedToId' | 'assignedToName'>): number {
      const result = insertVehicle.run({
        ...input,
        active: input.active ? 1 : 0,
        now: toSqlDateTime(),
      });
      return Number(result.lastInsertRowid);
    },

    update(input: Vehicle): void {
      updateVehicle.run({ ...input, active: input.active ? 1 : 0, now: toSqlDateTime() });
    },

    /** Vehicles are never hard deleted: assignments and expenses keep their history. */
    deactivate(id: number): void {
      db.prepare('UPDATE vehicles SET active = 0, updated_at = ? WHERE id = ?').run(
        toSqlDateTime(),
        id,
      );
    },

    assignments(vehicleId: number): VehicleAssignment[] {
      return selectAssignments.all(vehicleId).map(toAssignment);
    },

    openAssignment(vehicleId: number): VehicleAssignment | null {
      const row = selectOpenAssignment.get(vehicleId);
      return row ? toAssignment(row) : null;
    },

    startAssignment(vehicleId: number, deliveryBoyId: number, fromDate: string): number {
      const result = insertAssignment.run(vehicleId, deliveryBoyId, fromDate, toSqlDateTime());
      return Number(result.lastInsertRowid);
    },

    endAssignment(assignmentId: number, toDate: string): void {
      closeAssignment.run(toDate, assignmentId);
    },

    endAssignmentsForBoy(deliveryBoyId: number, toDate: string): void {
      closeAssignmentsForBoy.run(toDate, deliveryBoyId);
    },

    vehiclesOfBoy(deliveryBoyId: number): number[] {
      return openAssignmentsForBoy.all(deliveryBoyId).map((row) => row.vehicle_id);
    },

    expenses(vehicleId: number, fromDate: string, toDate: string): VehicleExpense[] {
      return selectExpenses.all(vehicleId, fromDate, toDate).map(toExpense);
    },

    addExpense(input: Omit<VehicleExpense, 'id'>): VehicleExpense {
      const result = insertExpense.run({ ...input, now: toSqlDateTime() });
      const row = selectExpense.get(Number(result.lastInsertRowid));
      if (!row) throw new Error('Vehicle expense was not saved');
      return toExpense(row);
    },

    findExpense(id: number): VehicleExpense | null {
      const row = selectExpense.get(id);
      return row ? toExpense(row) : null;
    },

    deleteExpense(id: number): void {
      deleteExpense.run(id);
    },

    /** Vehicles whose registration or insurance expires on/before `beforeDate`. */
    expiringBefore(beforeDate: string): Vehicle[] {
      return selectExpiryAlerts.all(beforeDate, beforeDate).map(toVehicle);
    },
  };
}

export type VehiclesRepository = ReturnType<typeof createVehiclesRepository>;
