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
    amend: (input) => invoke(CHANNELS.orderAmend, input),
    amendments: (id) => invoke(CHANNELS.orderAmendments, { id }),
  },

  payments: {
    addPayment: (input) => invoke(CHANNELS.paymentAdd, input),
    voidPayment: (id, reason) => invoke(CHANNELS.paymentVoid, { id, reason }),
    listByOrder: (orderId) => invoke(CHANNELS.paymentListByOrder, { orderId }),
    udhaarList: () => invoke(CHANNELS.udhaarList, {}),
    udhaarLedger: (customerId) => invoke(CHANNELS.udhaarLedger, { customerId }),
    settleUdhaar: (input) => invoke(CHANNELS.udhaarSettle, input),
  },

  shifts: {
    current: () => invoke(CHANNELS.shiftCurrent, {}),
    open: (openingCash) => invoke(CHANNELS.shiftOpen, { openingCash }),
    close: (input) => invoke(CHANNELS.shiftClose, input),
    report: (shiftId) => invoke(CHANNELS.shiftReport, shiftId === undefined ? {} : { shiftId }),
    list: (limit = 20) => invoke(CHANNELS.shiftList, { limit }),
    addCashMovement: (input) => invoke(CHANNELS.shiftCashMovement, input),
    print: (shiftId, paper) => invoke(CHANNELS.shiftPrint, { shiftId, paper }),
  },

  discounts: {
    rules: () => invoke(CHANNELS.discountRules, {}),
    saveRule: (input) => invoke(CHANNELS.discountSaveRule, input),
    validate: (input) => invoke(CHANNELS.discountValidate, input),
    approve: (input) => invoke(CHANNELS.discountApprove, input),
    listPromos: () => invoke(CHANNELS.promoList, {}),
    savePromo: (input) => invoke(CHANNELS.promoSave, input),
    deletePromo: (id) => invoke(CHANNELS.promoDelete, { id }),
  },

  tables: {
    list: () => invoke(CHANNELS.tablesList, {}),
    save: (input) => invoke(CHANNELS.tableSave, input),
    remove: (id) => invoke(CHANNELS.tableDelete, { id }),
    merge: (input) => invoke(CHANNELS.orderMerge, input),
    split: (input) => invoke(CHANNELS.orderSplit, input),
  },

  kot: {
    ticket: (orderId) => invoke(CHANNELS.kotTicket, { orderId }),
    print: (orderId) => invoke(CHANNELS.kotPrint, { orderId }),
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
    profitAndLoss: (range) => invoke(CHANNELS.reportProfit, range),
    range: (range) => invoke(CHANNELS.reportRange, range),
    salarySummary: (month) => invoke(CHANNELS.reportSalary, { month }),
    deliveryReport: (range) => invoke(CHANNELS.reportDelivery, range),
    vehicleExpenses: (range) => invoke(CHANNELS.reportVehicleExpenses, range),
    itemProfit: (range) => invoke(CHANNELS.reportItemProfit, range),
    stockValuation: () => invoke(CHANNELS.reportStockValuation),
    purchaseReport: (range) => invoke(CHANNELS.reportPurchases, range),
    wastageReport: (range) => invoke(CHANNELS.reportWastage, range),
    expenseReport: (range) => invoke(CHANNELS.reportExpenses, range),
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

  stock: {
    overview: () => invoke(CHANNELS.stockOverview),
    ingredients: () => invoke(CHANNELS.ingredients),
    ingredient: (id) => invoke(CHANNELS.ingredientGet, { id }),
    saveIngredient: (input) => invoke(CHANNELS.ingredientSave, input),
    deleteIngredient: (id) => invoke(CHANNELS.ingredientDelete, { id }),
    starterCatalogue: () => invoke(CHANNELS.starterCatalogue),
    loadStarterList: (input) => invoke(CHANNELS.starterLoad, input),
    suppliers: () => invoke(CHANNELS.suppliers),
    saveSupplier: (input) => invoke(CHANNELS.supplierSave, input),
    deleteSupplier: (id) => invoke(CHANNELS.supplierDelete, { id }),
    purchases: (input) => invoke(CHANNELS.purchases, input),
    purchase: (id) => invoke(CHANNELS.purchaseGet, { id }),
    createPurchase: (input) => invoke(CHANNELS.purchaseCreate, input),
    voidPurchase: (input) => invoke(CHANNELS.purchaseVoid, input),
    openingStock: (input) => invoke(CHANNELS.openingStock, input),
    movements: (ingredientId, limit = 100) =>
      invoke(CHANNELS.stockMovements, { ingredientId, limit }),
    recordWastage: (input) => invoke(CHANNELS.stockWastage, input),
    supplierReturn: (input) => invoke(CHANNELS.stockSupplierReturn, input),
    adjust: (input) => invoke(CHANNELS.stockAdjust, input),
    wastageReport: (range) => invoke(CHANNELS.stockWastageReport, range),
    counts: () => invoke(CHANNELS.stockCounts),
    count: (id) => invoke(CHANNELS.stockCountGet, { id }),
    saveCount: (input) => invoke(CHANNELS.stockCountSave, input),
    subRecipes: () => invoke(CHANNELS.subRecipes),
    subRecipe: (input) => invoke(CHANNELS.subRecipe, input),
    saveSubRecipe: (input) => invoke(CHANNELS.subRecipeSave, input),
    makeSubRecipeBatch: (input) => invoke(CHANNELS.subRecipeMake, input),
    subRecipeBatches: (input) => invoke(CHANNELS.subRecipeBatches, input),
  },

  recipes: {
    menuCosts: () => invoke(CHANNELS.menuCosts),
    recipe: (itemId) => invoke(CHANNELS.recipeGet, { itemId }),
    saveRecipe: (input) => invoke(CHANNELS.recipeSave, input),
    suggestPrice: (input) => invoke(CHANNELS.recipeSuggestPrice, input),
    setItemPrice: (input) => invoke(CHANNELS.recipeSetItemPrice, input),
    stockSettings: () => invoke(CHANNELS.stockSettingsGet),
    saveStockSettings: (input) => invoke(CHANNELS.stockSettingsSave, input),
  },

  expenses: {
    overview: (input) => invoke(CHANNELS.expensesOverview, input),
    save: (input) => invoke(CHANNELS.expenseSave, input),
    void: (input) => invoke(CHANNELS.expenseVoid, input),
    saveCategory: (input) => invoke(CHANNELS.expenseCategorySave, input),
    deleteCategory: (input) => invoke(CHANNELS.expenseCategoryDelete, input),
    recurringBills: (period) => invoke(CHANNELS.recurringBills, { period }),
    saveRecurringBill: (input) => invoke(CHANNELS.recurringBillSave, input),
    deleteRecurringBill: (input) => invoke(CHANNELS.recurringBillDelete, input),
    settleRecurringBill: (input) => invoke(CHANNELS.recurringBillSettle, input),
    unsettleRecurringBill: (input) => invoke(CHANNELS.recurringBillUnsettle, input),
  },

  users: {
    list: () => invoke(CHANNELS.users),
    save: (input) => invoke(CHANNELS.userSave, input),
    setActive: (id, active) => invoke(CHANNELS.userActive, { id, active }),
    resetPassword: (id, newPassword) => invoke(CHANNELS.userPassword, { id, newPassword }),
  },
};

contextBridge.exposeInMainWorld('api', api);
