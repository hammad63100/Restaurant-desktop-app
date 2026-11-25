/** Application level error carrying a stable code plus a message that is safe to show a user. */
export class AppError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/** Small helper used by IPC handlers to build the standard failure result. */
export interface FailureResult {
  ok: false;
  error: { code: string; message: string };
}
