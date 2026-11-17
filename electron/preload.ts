import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type RendererApi } from '../src/types/api';

/**
 * The only bridge between React and the main process.
 * `contextIsolation` stays on, so React never gets `ipcRenderer` or `require` itself.
 * Every function is a thin `invoke` wrapper — no logic, no validation, no DB access.
 */
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: RendererApi = {
  auth: {
    login: (input) => invoke(CHANNELS.login, input),
    logout: () => invoke(CHANNELS.logout),
    getSession: () => invoke(CHANNELS.session),
    changePassword: (input) => invoke(CHANNELS.changePassword, input),
    getPermissions: () => invoke(CHANNELS.permissions),
  },

  menu: {
    listCategories: () => invoke(CHANNELS.categories),
    saveCategory: (input) => invoke(CHANNELS.categorySave, input),
    deleteCategory: (id) => invoke(CHANNELS.categoryDelete, { id }),
    listItems: () => invoke(CHANNELS.items),
    saveItem: (input) => invoke(CHANNELS.itemSave, input),
    deleteItem: (id) => invoke(CHANNELS.itemDelete, { id }),
    toggleItem: (id, available) => invoke(CHANNELS.itemToggle, { id, available }),
  },

  orders: {
    create: (input) => invoke(CHANNELS.orderCreate, input),
    list: (filter) => invoke(CHANNELS.orderList, filter),
    get: (id) => invoke(CHANNELS.orderGet, { id }),
    updateStatus: (id, status) => invoke(CHANNELS.orderStatus, { id, status }),
    cancel: (id) => invoke(CHANNELS.orderCancel, { id }),
    invoice: (id) => invoke(CHANNELS.orderInvoice, { id }),
    markPrinted: (id) => invoke(CHANNELS.orderMarkPrinted, { id }),
    print: (id, paper) => invoke(CHANNELS.orderPrint, { id, paper }),
    savePdf: (id, paper) => invoke(CHANNELS.orderPdf, { id, paper }),
  },

  staff: {
    listWaiters: () => invoke(CHANNELS.waiters),
    saveWaiter: (input) => invoke(CHANNELS.waiterSave, input),
    removeWaiter: (id) => invoke(CHANNELS.waiterDelete, { id }),
    listDeliveryBoys: () => invoke(CHANNELS.deliveryBoys),
    saveDeliveryBoy: (input) => invoke(CHANNELS.deliveryBoySave, input),
    removeDeliveryBoy: (id) => invoke(CHANNELS.deliveryBoyDelete, { id }),
    listAttendance: (personType, personId, month) =>
      invoke(CHANNELS.attendance, { personType, personId, month }),
    setAttendance: (input) => invoke(CHANNELS.attendanceSet, input),
    listAdvances: (personType, personId, month) =>
      invoke(CHANNELS.advances, { personType, personId, month }),
    addAdvance: (input) => invoke(CHANNELS.advanceAdd, input),
    removeAdvance: (id) => invoke(CHANNELS.advanceDelete, { id }),
    salarySlip: (personType, personId, month) =>
      invoke(CHANNELS.salarySlip, { personType, personId, month }),
    paySalary: (input) => invoke(CHANNELS.salaryPay, input),
    salaryPayments: (month) => invoke(CHANNELS.salaryPayments, { month }),
  },

  vehicles: {
    list: () => invoke(CHANNELS.vehicles),
    save: (input) => invoke(CHANNELS.vehicleSave, input),
    remove: (id) => invoke(CHANNELS.vehicleDelete, { id }),
    assign: (vehicleId, deliveryBoyId, fromDate) =>
      invoke(CHANNELS.vehicleAssign, { vehicleId, deliveryBoyId, fromDate }),
    assignments: (vehicleId) => invoke(CHANNELS.vehicleAssignments, { vehicleId }),
    expenses: (vehicleId, fromDate, toDate) =>
      invoke(CHANNELS.vehicleExpenses, { vehicleId, fromDate, toDate }),
    addExpense: (input) => invoke(CHANNELS.vehicleExpenseAdd, input),
    removeExpense: (id) => invoke(CHANNELS.vehicleExpenseDelete, { id }),
  },

  reports: {
    dashboard: () => invoke(CHANNELS.dashboard),
    range: (range) => invoke(CHANNELS.reportRange, range),
    salarySummary: (month) => invoke(CHANNELS.reportSalary, { month }),
    deliveryReport: (range) => invoke(CHANNELS.reportDelivery, range),
    vehicleExpenses: (range) => invoke(CHANNELS.reportVehicleExpenses, range),
    exportCsv: (report, range) => invoke(CHANNELS.reportExport, { report, range }),
  },

  settings: {
    get: () => invoke(CHANNELS.settingsGet),
    save: (input) => invoke(CHANNELS.settingsSave, input),
    pickLogo: () => invoke(CHANNELS.settingsPickLogo),
    listBackups: () => invoke(CHANNELS.backupList),
    createBackup: () => invoke(CHANNELS.backupCreate),
    restoreBackup: (filePath) => invoke(CHANNELS.backupRestore, { filePath }),
  },

  users: {
    list: () => invoke(CHANNELS.users),
    save: (input) => invoke(CHANNELS.userSave, input),
    setActive: (id, active) => invoke(CHANNELS.userActive, { id, active }),
    resetPassword: (id, newPassword) => invoke(CHANNELS.userPassword, { id, newPassword }),
  },
};

contextBridge.exposeInMainWorld('api', api);
