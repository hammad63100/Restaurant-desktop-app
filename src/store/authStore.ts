import { create } from 'zustand';
import type { Capability, PageKey, RolePermissions, SessionUser } from '../types/api';
import { errorMessage, getApi, unwrap } from '../utils/api';

interface AuthState {
  user: SessionUser | null;
  permissions: PageKey[];
  capabilities: Capability[];
  status: 'idle' | 'checking' | 'authenticated' | 'anonymous';
  error: string | null;
  isSubmitting: boolean;
  restoreSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  can: (page: PageKey) => boolean;
  allow: (capability: Capability) => boolean;
  clearError: () => void;
}

/**
 * Auth state only. All rules live in the main process; this store just
 * caches the session and the page list the main process returned.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  permissions: [],
  capabilities: [],
  status: 'idle',
  error: null,
  isSubmitting: false,

  async restoreSession() {
    set({ status: 'checking', error: null });
    try {
      const api = getApi();
      const session = unwrap(await api.auth.getSession());

      if (!session) {
        set({ user: null, permissions: [], capabilities: [], status: 'anonymous' });
        return;
      }

      const permissions: RolePermissions | null = unwrap(await api.auth.getPermissions());
      set({
        user: session,
        permissions: permissions?.pages ?? [],
        capabilities: permissions?.capabilities ?? [],
        status: 'authenticated',
      });
    } catch (error) {
      set({ user: null, permissions: [], status: 'anonymous', error: errorMessage(error) });
    }
  },

  async login(username, password) {
    set({ isSubmitting: true, error: null });
    try {
      const api = getApi();
      const user = unwrap(await api.auth.login({ username, password }));
      const permissions = unwrap(await api.auth.getPermissions());

      set({
        user,
        permissions: permissions?.pages ?? [],
        capabilities: permissions?.capabilities ?? [],
        status: 'authenticated',
        isSubmitting: false,
      });
    } catch (error) {
      set({ isSubmitting: false, error: errorMessage(error, 'Login failed') });
    }
  },

  async logout() {
    try {
      unwrap(await getApi().auth.logout());
    } catch {
      // Even if the main process rejects, the UI must return to the login screen.
    } finally {
      set({ user: null, permissions: [], capabilities: [], status: 'anonymous', error: null });
    }
  },

  async changePassword(currentPassword, newPassword) {
    set({ isSubmitting: true, error: null });
    try {
      const user = unwrap(await getApi().auth.changePassword({ currentPassword, newPassword }));
      set({ user, isSubmitting: false });
    } catch (error) {
      set({ isSubmitting: false, error: errorMessage(error, 'Could not change password') });
      throw error;
    }
  },

  can(page) {
    return get().permissions.includes(page);
  },

  allow(capability) {
    return get().capabilities.includes(capability);
  },

  clearError() {
    set({ error: null });
  },
}));
