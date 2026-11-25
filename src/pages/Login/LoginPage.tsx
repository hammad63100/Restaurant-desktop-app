import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation } from 'react-router-dom';
import { Lock, LogIn, User } from 'lucide-react';
import { loginSchema, type LoginPayload } from '../../types/schemas';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Alert } from '../../components/Alert';
import { BrandPanel } from './BrandPanel';

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { login, isSubmitting, error, status, user, clearError } = useAuth();
  const location = useLocation();
  const redirectTo = (location.state as LocationState | null)?.from ?? '/dashboard';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginPayload>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  useEffect(() => {
    clearError();
  }, [clearError]);

  if (status === 'authenticated' && user) {
    return <Navigate to={user.mustChangePassword ? '/change-password' : redirectTo} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    clearError();
    await login(values.username, values.password);
  });

  return (
    <div className="flex h-full bg-background">
      <BrandPanel />

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 lg:hidden">
            <p className="font-heading text-section-title text-text-primary">Gul Khan Fast Food</p>
            <p className="text-caption text-text-secondary">Shop Management</p>
          </div>

          <div className="card p-6">
            <h1 className="text-page-title">Sign in</h1>
            <p className="mb-6 mt-1 text-body text-text-secondary">
              Enter your username and password to open the counter.
            </p>

            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              {error && <Alert tone="error">{error}</Alert>}

              <Input
                label="Username"
                placeholder="admin"
                autoComplete="username"
                autoFocus
                error={errors.username?.message}
                {...register('username')}
              />

              <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                error={errors.password?.message}
                {...register('password')}
              />

              <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
                {!isSubmitting && <LogIn aria-hidden className="h-4 w-4" />}
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <div className="mt-6 flex items-start gap-2 rounded-control bg-background p-3 text-caption text-text-secondary">
              <Lock aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Passwords are checked offline on this computer. Accounts are created by the shop
                owner, and a new password is required on first sign-in.
              </span>
            </div>
          </div>

          <p className="mt-4 flex items-center justify-center gap-1 text-caption text-text-secondary">
            <User aria-hidden className="h-3.5 w-3.5" />
            Accounts are created by the shop owner.
          </p>
        </div>
      </main>
    </div>
  );
}
