import type { UserRepository } from './repositories/userRepository';
import { hashPassword } from '../utils/password';
import { logInfo, logWarn } from '../services/logger';

export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'admin123';

/**
 * Creates the first admin account on a fresh database.
 * The account is flagged `must_change_password` so the default password
 * cannot stay in use (see docs/memory.md decisions).
 */
export async function seedDefaultAdmin(users: UserRepository): Promise<void> {
  if (users.count() > 0) return;

  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);

  users.create({
    username: DEFAULT_ADMIN_USERNAME,
    passwordHash,
    fullName: 'Shop Owner',
    role: 'admin',
    active: true,
    mustChangePassword: true,
  });

  logInfo('Default admin user created (username: admin). Password change is required at login.');
  logWarn('Default admin password is still the factory value until the first login completes.');
}
