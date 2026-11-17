import { CHANNELS } from '../../src/types/api';
import { changePasswordIpcSchema, loginSchema } from '../../src/types/schemas';
import type { AuthService } from '../services/authService';
import { getRolePermissions } from '../services/permissions';
import { logInfo } from '../services/logger';
import { AppError } from '../utils/errors';
import type { HandlerRegistry } from './registry';

/** All authentication channels. Validation happens here, never only in the form. */
export function authHandlers(auth: AuthService): HandlerRegistry {
  return {
    [CHANNELS.login]: {
      public: true,
      schema: loginSchema,
      handler: async (input: { username: string; password: string }) => {
        const user = await auth.login(input.username, input.password);
        logInfo(`Login succeeded for "${user.username}" (${user.role})`);
        return user;
      },
    },

    [CHANNELS.logout]: {
      public: true,
      handler: () => {
        const user = auth.getCurrentUser();
        auth.logout();
        if (user) logInfo(`Logout for "${user.username}"`);
        return null;
      },
    },

    [CHANNELS.session]: {
      public: true,
      handler: () => auth.getCurrentUser(),
    },

    [CHANNELS.changePassword]: {
      schema: changePasswordIpcSchema,
      handler: async (input: { currentPassword: string; newPassword: string }) => {
        const user = await auth.changePassword(input.currentPassword, input.newPassword);
        logInfo(`Password changed for "${user.username}"`);
        return user;
      },
    },

    // The renderer asks which pages its role may open instead of hardcoding a matrix.
    [CHANNELS.permissions]: {
      public: true,
      handler: () => {
        const user = auth.getCurrentUser();
        if (!user) return null;
        return getRolePermissions(user.role);
      },
    },
  };
}

/** Guard used by handlers that must not run while a forced password change is pending. */
export function assertPasswordChanged(user: { mustChangePassword: boolean }): void {
  if (user.mustChangePassword) {
    throw new AppError('FORBIDDEN', 'Please set a new password before using the app');
  }
}
