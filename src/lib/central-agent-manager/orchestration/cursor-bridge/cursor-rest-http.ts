import { CursorCloudApiError } from "./cursor-rest-errors";
import { parseCursorApiErrorBody } from "./cursor-rest-parse";

export type CursorRestHttpFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

function parseRetryAfterMs(header: string | null): number | null {
  if (!header?.trim()) return null;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.min(Math.ceil(asNumber * 1000), 300_000);
  }
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.min(asDate - Date.now(), 300_000));
  }
  return null;
}

export async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return await response.text();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new CursorCloudApiError("Cursor API response exceeded the configured size bound.", {
        phase: "get_run",
        status: response.status,
      });
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

export async function cursorRestHttpRequest(input: {
  fetchImpl: CursorRestHttpFetcher;
  url: string;
  method: "GET" | "POST";
  apiKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
  phase: "create" | "get_run";
  body?: Record<string, unknown>;
}): Promise<{ status: number; bodyText: string; retryAfterMs: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const headers = new Headers({
      Authorization: `Bearer ${input.apiKey}`,
      Accept: "application/json",
    });
    let body: string | undefined;
    if (input.body) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(input.body);
    }
    const response = await input.fetchImpl(input.url, {
      method: input.method,
      headers,
      body,
      signal: controller.signal,
    });
    const bodyText = await readBoundedResponseText(response, input.maxResponseBytes);
    return {
      status: response.status,
      bodyText,
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new CursorCloudApiError(
      aborted ? "Cursor API request timed out." : "Cursor API request failed before a response was received.",
      {
        phase: input.phase,
        status: null,
        retryable: input.phase === "get_run",
        ambiguousCreateOutcome: input.phase === "create",
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function mapCursorHttpStatusToError(input: {
  phase: "create" | "get_run";
  status: number;
  bodyText: string;
  retryAfterMs: number | null;
}): CursorCloudApiError {
  const parsed = parseCursorApiErrorBody(input.bodyText);
  const code = parsed.code;
  const message = parsed.message ?? `Cursor API returned HTTP ${input.status}.`;
  if (input.status === 401 || input.status === 403) {
    return new CursorCloudApiError("Cursor API authentication failed.", {
      phase: input.phase,
      status: input.status,
      code,
      retryable: false,
    });
  }
  if (input.status === 409) {
    return new CursorCloudApiError(message, {
      phase: input.phase,
      status: input.status,
      code: code ?? "agent_busy",
      retryable: false,
      ambiguousCreateOutcome: input.phase === "create",
    });
  }
  if (input.status === 429) {
    return new CursorCloudApiError("Cursor API rate limit exceeded.", {
      phase: input.phase,
      status: input.status,
      code: code ?? "rate_limit_exceeded",
      retryable: input.phase === "get_run",
      retryAfterMs: input.retryAfterMs,
    });
  }
  if (input.status >= 500) {
    return new CursorCloudApiError(message, {
      phase: input.phase,
      status: input.status,
      code,
      retryable: input.phase === "get_run",
      retryAfterMs: input.retryAfterMs,
      ambiguousCreateOutcome: input.phase === "create",
    });
  }
  return new CursorCloudApiError(message, {
    phase: input.phase,
    status: input.status,
    code,
    retryable: false,
  });
}
