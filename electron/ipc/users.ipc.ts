import { z } from 'zod';
import { CHANNELS } from '../../src/types/api';
import { appUserSchema, resetUserPasswordSchema } from '../../src/types/schemas';
import type { UserService, SaveUserPayload } from '../services/userService';
import type { HandlerContext, HandlerRegistry } from './registry';

export function usersHandlers(users: UserService): HandlerRegistry {
  return {
    [CHANNELS.users]: {
      roles: ['admin'],
      handler: () => users.list(),
    },

    [CHANNELS.userSave]: {
      roles: ['admin'],
      schema: appUserSchema,
      handler: (input: SaveUserPayload) => users.save(input),
    },

    [CHANNELS.userActive]: {
      roles: ['admin'],
      schema: z.object({ id: z.number().int().positive(), active: z.boolean() }),
      handler: (input: { id: number; active: boolean }, context: HandlerContext) =>
        users.setActive(input.id, input.active, context.user.id),
    },

    [CHANNELS.userPassword]: {
      roles: ['admin'],
      schema: resetUserPasswordSchema,
      handler: async (input: { id: number; newPassword: string }) => {
        await users.resetPassword(input.id, input.newPassword);
        return null;
      },
    },
  };
}
