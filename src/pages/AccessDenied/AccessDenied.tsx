import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PageKey } from '../../types/api';
import { ROLE_LABELS } from '../../types/labels';
import { useAuth } from '../../hooks/useAuth';

interface AccessDeniedProps {
  requiredPage: PageKey;
}

const PAGE_LABELS: Record<PageKey, string> = {
  home: 'Dashboard',
  orders: 'Orders',
  menu: 'Menu',
  udhaar: 'Udhaar',
  shifts: 'Day close',
  tables: 'Tables',
  staff: 'Staff',
  vehicles: 'Vehicles',
  reports: 'Reports',
  users: 'Users',
  settings: 'Settings',
};

/** Shown by the route guard when a signed-in user opens a page their role lacks. */
export function AccessDenied({ requiredPage }: AccessDeniedProps) {
  const { user } = useAuth();

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="card w-full max-w-md p-6 text-center">
        <ShieldAlert aria-hidden className="mx-auto mb-3 h-10 w-10 text-primary" />
        <h1 className="mb-1 text-section-title">Not allowed</h1>
        <p className="mb-4 text-body text-text-secondary">
          The {PAGE_LABELS[requiredPage]} page is not available to the{' '}
          <span className="font-semibold text-text-primary">
            {user ? ROLE_LABELS[user.role] : 'current'}
          </span>{' '}
          role. Ask the shop owner if you need access.
        </p>
        <Link
          to="/dashboard"
          className="inline-flex h-control items-center justify-center rounded-control bg-primary px-4 text-button text-white hover:bg-primary-dark"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
