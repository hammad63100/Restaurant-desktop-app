import { useAuthStore } from '../store/authStore';

/** Small read-only view of the auth store for components. */
export function useAuth() {
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);
  const capabilities = useAuthStore((state) => state.capabilities);
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const isSubmitting = useAuthStore((state) => state.isSubmitting);
  const login = useAuthStore((state) => state.login);
  const logout = useAuthStore((state) => state.logout);
  const changePassword = useAuthStore((state) => state.changePassword);
  const clearError = useAuthStore((state) => state.clearError);
  const can = useAuthStore((state) => state.can);
  const allow = useAuthStore((state) => state.allow);

  return {
    user,
    permissions,
    capabilities,
    status,
    error,
    isSubmitting,
    login,
    logout,
    changePassword,
    clearError,
    can,
    allow,
    isAuthenticated: status === 'authenticated' && user !== null,
  };
}
