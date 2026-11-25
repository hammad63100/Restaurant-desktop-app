import { createHashRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RouteError } from './components/RouteError';
import { LoginPage } from './pages/Login/LoginPage';
import { ChangePasswordPage } from './pages/Login/ChangePasswordPage';
import { DashboardPage } from './pages/Dashboard/DashboardPage';
import { MenuPage } from './pages/Menu/MenuPage';
import { OrdersPage } from './pages/Orders/OrdersPage';
import { NewOrderPage } from './pages/Orders/NewOrderPage';
import { InvoicePage } from './pages/Invoice/InvoicePage';
import { StaffPage } from './pages/Staff/StaffPage';
import { UdhaarPage } from './pages/Udhaar/UdhaarPage';
import { DayClosePage } from './pages/Shifts/DayClosePage';
import { TablesPage } from './pages/Tables/TablesPage';
import { VehiclesPage } from './pages/Vehicles/VehiclesPage';
import { ReportsPage } from './pages/Reports/ReportsPage';
import { SettingsPage } from './pages/Settings/SettingsPage';
import { UsersPage } from './pages/Users/UsersPage';

/**
 * Hash routing is used because the packaged app runs from file://.
 * Every page inside the layout is wrapped in ProtectedRoute with its PageKey;
 * the main process re-checks the same permission on every IPC call.
 */
export const router = createHashRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/change-password',
    element: (
      <ProtectedRoute allowPendingPasswordChange>
        <ChangePasswordPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      {
        path: 'dashboard',
        element: (
          <ProtectedRoute requiredPage="home">
            <DashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'menu',
        element: (
          <ProtectedRoute requiredPage="menu">
            <MenuPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'tables',
        element: (
          <ProtectedRoute requiredPage="tables">
            <TablesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'orders',
        element: (
          <ProtectedRoute requiredPage="orders">
            <OrdersPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'orders/new',
        element: (
          <ProtectedRoute requiredPage="orders">
            <NewOrderPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'invoice/:id',
        element: (
          <ProtectedRoute requiredPage="orders">
            <InvoicePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'staff',
        element: (
          <ProtectedRoute requiredPage="staff">
            <StaffPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'vehicles',
        element: (
          <ProtectedRoute requiredPage="vehicles">
            <VehiclesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'reports',
        element: (
          <ProtectedRoute requiredPage="reports">
            <ReportsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'udhaar',
        element: (
          <ProtectedRoute requiredPage="udhaar">
            <UdhaarPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'shifts',
        element: (
          <ProtectedRoute requiredPage="shifts">
            <DayClosePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'settings',
        element: (
          <ProtectedRoute requiredPage="settings">
            <SettingsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'users',
        element: (
          <ProtectedRoute requiredPage="users">
            <UsersPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);
