import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { changePasswordSchema, type ChangePasswordPayload } from '../../types/schemas';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Alert } from '../../components/Alert';

/** Forced on first login while `must_change_password` is set (Phase 1 requirement). */
export function ChangePasswordPage() {
  const { user, changePassword, logout, isSubmitting, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [isDone, setIsDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordPayload>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  if (!user) return <Navigate to="/login" replace />;

  if (!user.mustChangePassword && !isDone) {
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    clearError();
    try {
      await changePassword(values.currentPassword, values.newPassword);
      setIsDone(true);
      navigate('/dashboard', { replace: true });
    } catch {
      // The store already holds the friendly message; the form stays open.
    }
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-[440px]">
        <div className="card p-6">
          <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-card bg-secondary/15 text-secondary">
            <ShieldCheck aria-hidden className="h-5 w-5" />
          </span>

          <h1 className="text-page-title">Set a new password</h1>
          <p className="mb-6 mt-1 text-body text-text-secondary">
            Hi {user.fullName || user.username}, the factory password must be replaced before you
            can use the counter.
          </p>

          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            {error && <Alert tone="error">{error}</Alert>}

            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              error={errors.currentPassword?.message}
              {...register('currentPassword')}
            />

            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters."
              error={errors.newPassword?.message}
              {...register('newPassword')}
            />

            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />

            <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
              {!isSubmitting && <KeyRound aria-hidden className="h-4 w-4" />}
              {isSubmitting ? 'Saving…' : 'Save password'}
            </Button>
          </form>
        </div>

        <Button variant="ghost" fullWidth className="mt-2" onClick={handleLogout}>
          <LogOut aria-hidden className="h-4 w-4" />
          Sign out instead
        </Button>
      </div>
    </div>
  );
}
