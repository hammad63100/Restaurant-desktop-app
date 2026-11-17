import { ZodError, type ZodType } from 'zod';
import type {
  ApiErrorCode,
  ApiResult,
  Capability,
  SessionUser,
  UserRole,
} from '../../src/types/api';
import { firstIssueMessage } from '../../src/types/schemas';
import { AppError } from '../utils/errors';
import { logError } from '../services/logger';
import { roleHasCapability } from '../services/permissions';

export interface HandlerContext {
  user: SessionUser;
}

/**
 * One handler registration. `handler` implementations never see IPC transport
 * details, so the same registry drives Electron's ipcMain and the dev HTTP bridge.
 */
export interface HandlerDefinition<TInput, TOutput> {
  /** Optional runtime validation of the payload (second validation pass). */
  schema?: ZodType<TInput>;
  /** Roles allowed to call this channel. Omitted = any signed-in user. */
  roles?: UserRole[];
  /** Fine grained permission, checked after authentication. */
  capability?: Capability;
  /** Set to true for channels that must work before login (auth:login). */
  public?: boolean;
  handler: (input: TInput, context: HandlerContext) => Promise<TOutput> | TOutput;
}

/**
 * Erased form of a handler used by the registry map. Inputs are validated at
 * runtime by each definition's Zod schema, so the map is intentionally untyped.
 * Narrowing these type arguments breaks every handler on variance, so they stay
 * as the only `any` in the codebase (Rules.md: no `any` in app logic).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- single erased shape, see comment above */
export type AnyHandlerDefinition = HandlerDefinition<any, any>;

export type HandlerRegistry = Record<string, AnyHandlerDefinition>;

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(code: ApiErrorCode, message: string): ApiResult<T> {
  return { ok: false, error: { code, message } };
}

export function toErrorResult(channel: string, error: unknown): ApiResult<never> {
  if (error instanceof ZodError) {
    return fail('VALIDATION_ERROR', firstIssueMessage(error));
  }

  if (error instanceof AppError) {
    logError(`${channel} failed (${error.code}): ${error.message}`);
    return fail(error.code as ApiErrorCode, error.message);
  }

  logError(`${channel} crashed unexpectedly`, error);
  return fail('INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

/**
 * Single entry point for every channel. Order of checks matters:
 * authentication -> role -> capability -> validation -> handler.
 */
export async function dispatch(
  channel: string,
  registry: HandlerRegistry,
  rawInput: unknown,
  getCurrentUser: () => SessionUser | null,
  isLoggedIn: boolean,
): Promise<ApiResult<unknown>> {
  const definition = registry[channel];
  if (!definition) {
    logError(`Unknown IPC channel requested: ${channel}`);
    return fail('INTERNAL_ERROR', 'This action is not available in this version.');
  }

  try {
    let user: SessionUser | null = null;

    if (!definition.public) {
      user = getCurrentUser();
      if (!isLoggedIn || !user) {
        throw new AppError('UNAUTHENTICATED', 'Please log in to continue');
      }
      if (definition.roles && !definition.roles.includes(user.role)) {
        throw new AppError('FORBIDDEN', 'Your role does not allow this action');
      }
      if (definition.capability) {
        if (!roleHasCapability(user.role, definition.capability)) {
          throw new AppError('FORBIDDEN', 'Your role does not allow this action');
        }
      }
    }

    const input = definition.schema ? definition.schema.parse(rawInput) : rawInput;
    const data = await definition.handler(input, { user: user as SessionUser });
    return ok(data);
  } catch (error) {
    return toErrorResult(channel, error);
  }
}
