import {
  BUFFER_GRAPHQL_URL,
  getBufferAccessToken,
} from "./buffer-config";

export type BufferGraphqlResponse<TData> = {
  data?: TData;
  errors?: Array<{ message: string }>;
};

export type BufferGraphqlClientOptions = {
  fetchImpl?: typeof fetch;
  accessToken?: string | null;
  baseUrl?: string;
};

export class BufferGraphqlError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options?: { retryable?: boolean; status?: number }) {
    super(message);
    this.name = "BufferGraphqlError";
    this.retryable = options?.retryable ?? false;
    this.status = options?.status;
  }
}

function parseRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw?.trim()) return null;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return null;
}

export async function bufferGraphqlRequest<TData>(
  query: string,
  variables?: Record<string, unknown>,
  options: BufferGraphqlClientOptions = {},
): Promise<TData> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.accessToken ?? getBufferAccessToken();
  if (!token) {
    throw new BufferGraphqlError("buffer_credentials_missing", { retryable: false });
  }

  const response = await fetchImpl(options.baseUrl ?? BUFFER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 429) {
    const waitMs = parseRetryAfterMs(response.headers) ?? 60_000;
    throw new BufferGraphqlError(`buffer_rate_limited:${waitMs}`, {
      retryable: true,
      status: 429,
    });
  }

  if (!response.ok) {
    throw new BufferGraphqlError(`buffer_http_${response.status}`, {
      retryable: response.status >= 500,
      status: response.status,
    });
  }

  const payload = (await response.json()) as BufferGraphqlResponse<TData>;
  if (payload.errors?.length) {
    const message = payload.errors.map((item) => item.message).join("; ");
    throw new BufferGraphqlError(message, { retryable: false });
  }
  if (!payload.data) {
    throw new BufferGraphqlError("buffer_empty_response", { retryable: true });
  }
  return payload.data;
}