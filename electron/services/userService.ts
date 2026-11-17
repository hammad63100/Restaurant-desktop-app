import type { AppUser, UserRole } from '../../src/types/api';
import type { UserRepository } from '../db/repositories/userRepository';
import { toAppUser } from '../db/repositories/userRepository';
import { hashPassword } from '../utils/password';
import { AppError } from '../utils/errors';
import { logInfo } from './logger';

export interface SaveUserPayload {
  id?: number;
  username: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  password?: string;
}

/**
 * User administration. Business rules live here, not in the React page:
 * - a new user always needs a password
 * - the last active admin cannot be disabled or demoted
 * - usernames are unique (case-insensitive)
 */
export function createUserService(users: UserRepository) {
  function findOrFail(id: number): AppUser {
    const row = users.findById(id);
    if (!row) throw new AppError('NOT_FOUND', 'This user does not exist');
    return toAppUser(row);
  }

  function assertUsernameFree(username: string, ignoreId?: number): void {
    const existing = users.findByUsername(username);
    if (existing && existing.id !== ignoreId) {
      throw new AppError('CONFLICT', 'That username is already taken');
    }
  }

  function assertKeepsAnActiveAdmin(
    targetId: number,
    nextActive: boolean,
    nextRole: UserRole,
  ): void {
    const target = users.findById(targetId);
    if (!target || target.role !== 'admin' || target.active !== 1) return;

    if (nextActive && nextRole === 'admin') return;

    const otherActiveAdmins = users
      .list()
      .filter((user) => user.role === 'admin' && user.active && user.id !== targetId);

    if (otherActiveAdmins.length === 0) {
      throw new AppError(
        'CONFLICT',
        'At least one active admin is required. Create another admin first.',
      );
    }
  }

  return {
    list(): AppUser[] {
      return users.list();
    },

    async save(input: SaveUserPayload): Promise<AppUser> {
      if (input.id) {
        const existing = users.findById(input.id);
        if (!existing) throw new AppError('NOT_FOUND', 'This user does not exist');

        assertUsernameFree(input.username, input.id);
        assertKeepsAnActiveAdmin(input.id, input.active, input.role);

        users.update({
          id: input.id,
          username: input.username,
          fullName: input.fullName,
          role: input.role,
          active: input.active,
        });

        if (input.password) {
          const hash = await hashPassword(input.password);
          users.updatePasswordHash(input.id, hash, true);
        }

        logInfo(`User updated: ${input.username} (${input.role}, active: ${input.active})`);
        return findOrFail(input.id);
      }

      assertUsernameFree(input.username);
      if (!input.password) {
        throw new AppError('VALIDATION_ERROR', 'A password is required for a new user');
      }

      const hash = await hashPassword(input.password);
      const id = users.create({
        username: input.username,
        passwordHash: hash,
        fullName: input.fullName,
        role: input.role,
        active: input.active,
        // A password set by the admin is temporary: the user replaces it at first login.
        mustChangePassword: true,
      });

      logInfo(`User created: ${input.username} (${input.role})`);
      return findOrFail(id);
    },

    setActive(id: number, active: boolean, currentUserId: number): AppUser {
      if (id === currentUserId && !active) {
        throw new AppError('CONFLICT', 'You cannot disable the account you are signed in with');
      }

      const target = findOrFail(id);
      assertKeepsAnActiveAdmin(id, active, target.role);
      users.setActive(id, active);
      logInfo(`User ${active ? 'enabled' : 'disabled'}: ${target.username}`);
      return findOrFail(id);
    },

    async resetPassword(id: number, newPassword: string): Promise<void> {
      const target = findOrFail(id);
      const hash = await hashPassword(newPassword);
      users.updatePasswordHash(id, hash, true);
      logInfo(`Password reset for ${target.username}; change is required at next login`);
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
