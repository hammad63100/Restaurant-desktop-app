import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Capability, PageKey } from '../types/api';
import { useAuth } from '../hooks/useAuth';
import { AccessDenied } from '../pages/AccessDenied/AccessDenied';

interface ProtectedRouteProps {
  children: ReactNode;
  /** Page the user must be allowed to open. Omit for "any signed-in user". */
  requiredPage?: PageKey;
  /** Optional extra capability check for read-only pages (e.g. write actions). */
  requiredCapability?: Capability;
  /** The change-password screen itself must stay reachable during a forced change. */
  allowPendingPasswordChange?: boolean;
}

/**
 * Route guard for the UI. It is a convenience only — the main process
 * re-checks the session, role and capability on every IPC call (Rules.md section 7).
 */
export function ProtectedRoute({
  children,
  requiredPage,
  allowPendingPasswordChange = false,
}: ProtectedRouteProps) {
  const { status, user, can } = useAuth();
  const location = useLocation();

  if (status === 'idle' || status === 'checking') {
    return (
      <div className="flex h-full items-center justify-center bg-background text-text-secondary">
        <p className="text-body">Checking your session…</p>
      </div>
    );
  }

  if (status !== 'authenticated' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // A forced password change blocks everything except the change-password screen.
  if (user.mustChangePassword && !allowPendingPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }

  if (requiredPage && !can(requiredPage)) {
    return <AccessDenied requiredPage={requiredPage} />;
  }

  return <>{children}</>;
}
