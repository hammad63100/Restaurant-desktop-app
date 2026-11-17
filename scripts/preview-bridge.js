/**
 * Injected into the preview HTML only (development helper).
 * Provides the same `window.api` surface as electron/preload.ts, forwarding every
 * call to the preview server, which runs the real main-process registry.
 * This file is never shipped inside the app.
 */
(function installPreviewBridge() {
  if (window.api) return;

  async function call(channel) {
    return async (...args) => {
      const payload = args.length === 1 ? args[0] : args.length === 0 ? undefined : args;
      const response = await fetch('/__preview/ipc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, args: payload }),
      });

      if (!response.ok) {
        return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Preview server is not responding.' } };
      }

      return response.json();
    };
  }

  window.api = {
    auth: {
      login: call('auth:login'),
      logout: call('auth:logout'),
      getSession: call('auth:session'),
      changePassword: call('auth:change-password'),
      getPermissions: call('auth:permissions'),
    },
    menu: {
      listCategories: call('menu:categories'),
      saveCategory: call('menu:category-save'),
      deleteCategory: call('menu:category-delete'),
      listItems: call('menu:items'),
      saveItem: call('menu:item-save'),
      deleteItem: call('menu:item-delete'),
      toggleItem: call('menu:item-toggle'),
    },
    orders: {
      create: call('orders:create'),
      list: call('orders:list'),
      get: call('orders:get'),
      updateStatus: call('orders:status'),
      cancel: call('orders:cancel'),
      invoice: call('orders:invoice'),
      markPrinted: call('orders:mark-printed'),
      print: call('orders:print'),
      savePdf: call('orders:pdf'),
    },
    staff: {
      listWaiters: call('staff:waiters'),
      saveWaiter: call('staff:waiter-save'),
      removeWaiter: call('staff:waiter-delete'),
      listDeliveryBoys: call('staff:delivery-boys'),
      saveDeliveryBoy: call('staff:delivery-boy-save'),
      removeDeliveryBoy: call('staff:delivery-boy-delete'),
      listAttendance: call('staff:attendance'),
      setAttendance: call('staff:attendance-set'),
      listAdvances: call('staff:advances'),
      addAdvance: call('staff:advance-add'),
      removeAdvance: call('staff:advance-delete'),
      salarySlip: call('staff:salary-slip'),
      paySalary: call('staff:salary-pay'),
      salaryPayments: call('staff:salary-payments'),
    },
    vehicles: {
      list: call('vehicles:list'),
      save: call('vehicles:save'),
      remove: call('vehicles:delete'),
      assign: call('vehicles:assign'),
      assignments: call('vehicles:assignments'),
      expenses: call('vehicles:expenses'),
      addExpense: call('vehicles:expense-add'),
      removeExpense: call('vehicles:expense-delete'),
    },
    reports: {
      dashboard: call('reports:dashboard'),
      range: call('reports:range'),
      salarySummary: call('reports:salary'),
      deliveryReport: call('reports:delivery'),
      vehicleExpenses: call('reports:vehicle-expenses'),
      exportCsv: call('reports:export'),
    },
    settings: {
      get: call('settings:get'),
      save: call('settings:save'),
      pickLogo: call('settings:pick-logo'),
      listBackups: call('settings:backup-list'),
      createBackup: call('settings:backup-create'),
      restoreBackup: call('settings:backup-restore'),
    },
    users: {
      list: call('users:list'),
      save: call('users:save'),
      setActive: call('users:set-active'),
      resetPassword: call('users:reset-password'),
    },
  };
})();
