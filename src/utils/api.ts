import type { ApiError, ApiResult } from '../types/api';

/** Thrown by `unwrap` so callers can `catch` a friendly message in one place. */
export class ApiRequestError extends Error {
  public readonly code: ApiError['code'];

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
  }
}

export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new ApiRequestError(result.error);
  }
  return result.data;
}

export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * The single bridge object. In Electron this is the preload-created `window.api`;
 * the dev preview injects an equivalent object, so no page needs to care which.
 */
export function getApi() {
  if (!window.api) {
    throw new ApiRequestError({
      code: 'INTERNAL_ERROR',
      message: 'The app bridge is not available. Please start the desktop app.',
    });
  }
  return window.api;
}
