/**
 * Read-only Buffer GraphQL connection diagnostic.
 * @see https://developers.buffer.com/guides/getting-started.html
 * @see https://developers.buffer.com/guides/data-model.html
 * Endpoint: POST https://api.buffer.com (Bearer API key)
 */

export const BUFFER_GRAPHQL_ENDPOINT = "https://api.buffer.com" as const;

const BUFFER_CONNECTION_ACCOUNT_QUERY = `
query BufferConnectionAccount {
  account {
    id
    organizations {
      id
      name
    }
  }
}`;

const BUFFER_CONNECTION_CHANNELS_QUERY = `
query BufferConnectionChannels($organizationId: ID!) {
  channels(input: { organizationId: $organizationId }) {
    id
    name
    service
  }
}`;

export type BufferOrganizationRef = {
  id: string;
  name: string | null;
};

export type BufferTikTokChannelRef = {
  id: string;
  organizationId: string;
  name: string | null;
  service: string;
};

export type BufferConnectionDiagnosticSuccess = {
  ok: true;
  endpoint: typeof BUFFER_GRAPHQL_ENDPOINT;
  accountId: string | null;
  organizations: BufferOrganizationRef[];
  tiktokChannels: BufferTikTokChannelRef[];
};

export type BufferConnectionDiagnosticFailure = {
  ok: false;
  endpoint: typeof BUFFER_GRAPHQL_ENDPOINT;
  error: string;
  errorCode?: string;
};

export type BufferConnectionDiagnosticResult =
  | BufferConnectionDiagnosticSuccess
  | BufferConnectionDiagnosticFailure;

type EnvLike = Record<string, string | undefined>;

export function getBufferApiToken(env: EnvLike = process.env): string | null {
  return env.BUFFER_API_TOKEN?.trim() || null;
}

function isTikTokService(service: unknown): boolean {
  return typeof service === "string" && service.trim().toLowerCase() === "tiktok";
}

function sanitizeGraphQlErrorMessage(message: unknown): string {
  if (typeof message !== "string" || !message.trim()) {
    return "buffer_graphql_error";
  }
  return message.trim().slice(0, 240);
}

type GraphQlEnvelope = {
  data?: unknown;
  errors?: { message?: string; extensions?: { code?: string } }[];
};

async function postBufferGraphQl(input: {
  query: string;
  variables?: Record<string, unknown>;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<{ ok: true; data: unknown } | { ok: false; error: string; errorCode?: string }> {
  let response: Response;
  try {
    response = await input.fetchImpl(BUFFER_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({
        query: input.query,
        variables: input.variables ?? {},
      }),
    });
  } catch {
    return { ok: false, error: "buffer_network_error", errorCode: "network" };
  }

  let body: GraphQlEnvelope;
  try {
    body = (await response.json()) as GraphQlEnvelope;
  } catch {
    return { ok: false, error: "buffer_invalid_response", errorCode: "invalid_json" };
  }

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    return {
      ok: false,
      error: sanitizeGraphQlErrorMessage(first?.message),
      errorCode:
        typeof first?.extensions?.code === "string"
          ? first.extensions.code.slice(0, 64)
          : response.ok
            ? "graphql_error"
            : "http_error",
    };
  }

  if (!response.ok) {
    return { ok: false, error: "buffer_http_error", errorCode: `http_${response.status}` };
  }

  return { ok: true, data: body.data };
}

export async function runBufferConnectionDiagnostic(input: {
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  token?: string | null;
} = {}): Promise<BufferConnectionDiagnosticResult> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = input.token === undefined ? getBufferApiToken(env) : input.token;

  if (!token) {
    return {
      ok: false,
      endpoint: BUFFER_GRAPHQL_ENDPOINT,
      error: "buffer_api_token_not_configured",
      errorCode: "token_missing",
    };
  }

  const accountResult = await postBufferGraphQl({
    query: BUFFER_CONNECTION_ACCOUNT_QUERY,
    token,
    fetchImpl,
  });
  if (!accountResult.ok) {
    return {
      ok: false,
      endpoint: BUFFER_GRAPHQL_ENDPOINT,
      error: accountResult.error,
      errorCode: accountResult.errorCode,
    };
  }

  const accountPayload = accountResult.data as {
    account?: { id?: string; organizations?: { id?: string; name?: string | null }[] };
  } | null;
  const rawOrganizations = accountPayload?.account?.organizations ?? [];
  const organizations: BufferOrganizationRef[] = rawOrganizations
    .filter((org): org is { id: string; name?: string | null } => typeof org?.id === "string" && org.id.length > 0)
    .map((org) => ({
      id: org.id,
      name: typeof org.name === "string" ? org.name : null,
    }));

  const accountId =
    typeof accountPayload?.account?.id === "string" ? accountPayload.account.id : null;

  const tiktokChannels: BufferTikTokChannelRef[] = [];

  for (const org of organizations) {
    const channelsResult = await postBufferGraphQl({
      query: BUFFER_CONNECTION_CHANNELS_QUERY,
      variables: { organizationId: org.id },
      token,
      fetchImpl,
    });
    if (!channelsResult.ok) {
      return {
        ok: false,
        endpoint: BUFFER_GRAPHQL_ENDPOINT,
        error: channelsResult.error,
        errorCode: channelsResult.errorCode,
      };
    }

    const channelsPayload = channelsResult.data as {
      channels?: { id?: string; name?: string | null; service?: string }[];
    } | null;
    const channels = channelsPayload?.channels ?? [];
    for (const channel of channels) {
      if (typeof channel?.id !== "string" || !channel.id) continue;
      if (!isTikTokService(channel.service)) continue;
      tiktokChannels.push({
        id: channel.id,
        organizationId: org.id,
        name: typeof channel.name === "string" ? channel.name : null,
        service: String(channel.service).trim().toLowerCase(),
      });
    }
  }

  return {
    ok: true,
    endpoint: BUFFER_GRAPHQL_ENDPOINT,
    accountId,
    organizations,
    tiktokChannels,
  };
}

export function serializeBufferConnectionDiagnosticForApi(
  result: BufferConnectionDiagnosticResult,
): Record<string, unknown> {
  if (!result.ok) {
    return {
      ok: false,
      endpoint: result.endpoint,
      error: result.error,
      errorCode: result.errorCode ?? null,
      readOnly: true,
    };
  }
  return {
    ok: true,
    endpoint: result.endpoint,
    readOnly: true,
    accountId: result.accountId,
    organizations: result.organizations,
    tiktokChannels: result.tiktokChannels,
  };
}
