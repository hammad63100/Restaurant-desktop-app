import type { SessionUser, UserRole } from '../../src/types/api';
import type { UserRow, UserRepository } from '../db/repositories/userRepository';
import { hashPassword, verifyPassword } from '../utils/password';
import { AppError } from '../utils/errors';
import { logWarn } from './logger';
import { toSqlDateTime } from '../utils/datetime';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;
const FAILED_ATTEMPT_DELAY_MS = 200;

export interface SessionView {
  user: SessionUser | null;
}

/** Maps a database row to the object that is safe to send to the renderer. */
export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
  };
}

export function createAuthService(users: UserRepository) {
  // The session is a single object so callers can share the reference.
  const session: SessionView = { user: null };

  /**
   * Without a row there is no account to count against — an unknown username must
   * not leak whether it exists, so the caller still pays the same delay.
   */
  function lockExpiryFromNow(): string {
    const expiry = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    return toSqlDateTime(expiry);
  }

  function isLocked(lockedUntil: string | null): boolean {
    if (!lockedUntil) return false;
    // `locked_until` is a SQL timestamp; compare it as local time to match the app.
    return lockedUntil > toSqlDateTime();
  }

  function assertNotLocked(row: UserRow | undefined, usernameKey: string): void {
    if (!row) return;
    if (!isLocked(row.locked_until)) return;

    logWarn(`Locked account tried to log in: "${usernameKey}"`);
    throw new AppError(
      'TOO_MANY_ATTEMPTS',
      `Too many wrong attempts. This account is locked for ${LOCK_MINUTES} minutes.`,
    );
  }

  /**
   * Counts one wrong password and locks the account on the fifth.
   *
   * An **expired** lock starts a fresh count: otherwise a user who waited out a
   * lockout would be re-locked by their very next typo, which is how people end up
   * unable to work. The count lives in the database so restarting the app is not a
   * way to buy more tries.
   */
  function recordFailedAttempt(row: UserRow | undefined, usernameKey: string): void {
    if (!row) return;

    // A lock that has run out resets the count; an account that has simply made a
    // few mistakes since the last success keeps counting up.
    const lockExpired = row.locked_until !== null && !isLocked(row.locked_until);
    const previous = lockExpired ? 0 : row.failed_attempts;
    const attempts = previous + 1;
    const shouldLock = attempts >= MAX_ATTEMPTS;

    users.recordFailedLogin(row.id, attempts, shouldLock ? lockExpiryFromNow() : null);

    if (shouldLock) {
      logWarn(
        `Account "${usernameKey}" locked for ${LOCK_MINUTES} minutes after ${attempts} failed attempts`,
      );
    }
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    session,

    getCurrentUser(): SessionUser | null {
      return session.user;
    },

    /** Throws if there is no session, or if the role is not in `allowedRoles`. */
    requireUser(allowedRoles?: UserRole[]): SessionUser {
      const user = session.user;
      if (!user) {
        throw new AppError('UNAUTHENTICATED', 'Please log in to continue');
      }
      if (allowedRoles && !allowedRoles.includes(user.role)) {
        throw new AppError('FORBIDDEN', 'Your role does not allow this action');
      }
      return user;
    },

    async login(username: string, password: string): Promise<SessionUser> {
      const usernameKey = username.trim().toLowerCase();
      const row = users.findByUsername(username);

      assertNotLocked(row, usernameKey);

      const passwordMatches = row ? await verifyPassword(password, row.password_hash) : false;

      if (!row || !passwordMatches) {
        recordFailedAttempt(row, usernameKey);
        await wait(FAILED_ATTEMPT_DELAY_MS);
        logWarn(`Failed login attempt for username "${usernameKey}"`);
        throw new AppError('INVALID_CREDENTIALS', 'Wrong username or password');
      }

      if (row.active !== 1) {
        logWarn(`Disabled account tried to log in: "${usernameKey}"`);
        throw new AppError('ACCOUNT_DISABLED', 'This account is disabled. Contact the owner.');
      }

      // A good password clears the count, so a lock cannot outlive a success.
      users.clearFailedLogins(row.id);
      users.updateLastLogin(row.id);

      const user = toSessionUser(row);
      session.user = user;
      return user;
    },

    /**
     * Changing the password also clears `must_change_password`, so a forced
     * first-login change only ever happens once.
     */
    async changePassword(currentPassword: string, newPassword: string): Promise<SessionUser> {
      const currentUser = this.requireUser();
      const row = users.findById(currentUser.id);

      if (!row) {
        throw new AppError('NOT_FOUND', 'This user no longer exists');
      }

      const matches = await verifyPassword(currentPassword, row.password_hash);
      if (!matches) {
        throw new AppError('INVALID_CREDENTIALS', 'Current password is not correct');
      }

      const newHash = await hashPassword(newPassword);
      users.updatePasswordHash(row.id, newHash, false);

      const updated: SessionUser = { ...toSessionUser(row), mustChangePassword: false };
      session.user = updated;
      return updated;
    },

    logout(): void {
      session.user = null;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
