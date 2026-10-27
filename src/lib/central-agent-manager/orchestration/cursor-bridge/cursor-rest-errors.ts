export type CursorCloudApiPhase = "create" | "get_run";

export class CursorCloudApiError extends Error {
  readonly phase: CursorCloudApiPhase;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  /** Create may have succeeded but the client did not receive a parseable response. */
  readonly ambiguousCreateOutcome: boolean;

  constructor(
    message: string,
    options: {
      phase: CursorCloudApiPhase;
      status?: number | null;
      code?: string | null;
      retryable?: boolean;
      retryAfterMs?: number | null;
      ambiguousCreateOutcome?: boolean;
    },
  ) {
    super(message);
    this.name = "CursorCloudApiError";
    this.phase = options.phase;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.ambiguousCreateOutcome = options.ambiguousCreateOutcome ?? false;
  }
}

export function isCursorCloudApiError(error: unknown): error is CursorCloudApiError {
  return error instanceof CursorCloudApiError;
}
