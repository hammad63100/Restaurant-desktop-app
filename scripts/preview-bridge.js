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
      profitAndLoss: call('reports:profit'),
      range: call('reports:range'),
      salarySummary: call('reports:salary'),
      deliveryReport: call('reports:delivery'),
      vehicleExpenses: call('reports:vehicle-expenses'),
      itemProfit: call('reports:item-profit'),
      stockValuation: call('reports:stock-valuation'),
      purchaseReport: call('reports:purchases'),
      wastageReport: call('reports:wastage'),
      expenseReport: call('reports:expenses'),
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
    stock: {
      overview: call('stock:overview'),
      ingredients: call('stock:ingredients'),
      ingredient: call('stock:ingredient'),
      saveIngredient: call('stock:ingredient-save'),
      deleteIngredient: call('stock:ingredient-delete'),
      starterCatalogue: call('stock:starter-catalogue'),
      subRecipes: call('stock:sub-recipes'),
      subRecipe: call('stock:sub-recipe'),
      saveSubRecipe: call('stock:sub-recipe-save'),
      makeSubRecipeBatch: call('stock:sub-recipe-make'),
      subRecipeBatches: call('stock:sub-recipe-batches'),
      loadStarterList: call('stock:starter-load'),
      suppliers: call('stock:suppliers'),
      saveSupplier: call('stock:supplier-save'),
      deleteSupplier: call('stock:supplier-delete'),
      purchases: call('stock:purchases'),
      purchase: call('stock:purchase'),
      createPurchase: call('stock:purchase-create'),
      voidPurchase: call('stock:purchase-void'),
      openingStock: call('stock:opening'),
      movements: call('stock:movements'),
      recordWastage: call('stock:wastage'),
      supplierReturn: call('stock:supplier-return'),
      adjust: call('stock:adjust'),
      wastageReport: call('stock:wastage-report'),
      counts: call('stock:counts'),
      count: call('stock:count'),
      saveCount: call('stock:count-save'),
    },
    recipes: {
      menuCosts: call('recipes:menu-costs'),
      recipe: call('recipes:get'),
      saveRecipe: call('recipes:save'),
      suggestPrice: call('recipes:suggest-price'),
      setItemPrice: call('recipes:set-item-price'),
      stockSettings: call('stock:settings'),
      saveStockSettings: call('stock:settings-save'),
    },
    expenses: {
      overview: call('expenses:overview'),
      save: call('expenses:save'),
      void: call('expenses:void'),
      saveCategory: call('expenses:category-save'),
      deleteCategory: call('expenses:category-delete'),
      recurringBills: call('expenses:recurring'),
      saveRecurringBill: call('expenses:recurring-save'),
      deleteRecurringBill: call('expenses:recurring-delete'),
      settleRecurringBill: call('expenses:recurring-settle'),
      unsettleRecurringBill: call('expenses:recurring-unsettle'),
    },
    users: {
      list: call('users:list'),
      save: call('users:save'),
      setActive: call('users:set-active'),
      resetPassword: call('users:reset-password'),
    },
  };
})();
