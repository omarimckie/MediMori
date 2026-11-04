import assert from "node:assert/strict";
import test from "node:test";
import {
  BUFFER_GRAPHQL_ENDPOINT,
  getBufferApiToken,
  runBufferConnectionDiagnostic,
  serializeBufferConnectionDiagnosticForApi,
} from "./buffer-connection-diagnostic";

const SECRET = "buffer_test_secret_token_abc123";

test("getBufferApiToken reads BUFFER_API_TOKEN only", () => {
  assert.equal(getBufferApiToken({ BUFFER_API_TOKEN: "  tok  " }), "tok");
  assert.equal(getBufferApiToken({ BUFFER_ACCESS_TOKEN: "legacy" }), null);
  assert.equal(getBufferApiToken({}), null);
});

test("runBufferConnectionDiagnostic fails closed when token missing", async () => {
  const result = await runBufferConnectionDiagnostic({ env: {}, token: null });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "buffer_api_token_not_configured");
  assert.equal(result.endpoint, BUFFER_GRAPHQL_ENDPOINT);
});

test("runBufferConnectionDiagnostic returns org and TikTok channel ids", async () => {
  const calls: { query: string; variables?: Record<string, unknown>; auth?: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    assert.equal(String(url), BUFFER_GRAPHQL_ENDPOINT);
    const auth = init?.headers instanceof Headers
      ? init.headers.get("Authorization")
      : (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({
      auth: auth ?? undefined,
      query: JSON.parse(String(init?.body)).query as string,
      variables: JSON.parse(String(init?.body)).variables as Record<string, unknown> | undefined,
    });

    if (calls.length === 1) {
      return new Response(
        JSON.stringify({
          data: {
            account: {
              id: "acct_1",
              organizations: [{ id: "org_1", name: "Twilight Feather" }],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    assert.deepEqual(calls[1].variables, { organizationId: "org_1" });
    return new Response(
      JSON.stringify({
        data: {
          channels: [
            { id: "ch_tiktok_1", name: "TF TikTok", service: "tiktok" },
            { id: "ch_ig_1", name: "TF IG", service: "instagram" },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await runBufferConnectionDiagnostic({
    token: SECRET,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.accountId, "acct_1");
  assert.deepEqual(result.organizations, [{ id: "org_1", name: "Twilight Feather" }]);
  assert.deepEqual(result.tiktokChannels, [
    {
      id: "ch_tiktok_1",
      organizationId: "org_1",
      name: "TF TikTok",
      service: "tiktok",
    },
  ]);
  assert.equal(calls[0].auth, `Bearer ${SECRET}`);
  const serialized = JSON.stringify(serializeBufferConnectionDiagnosticForApi(result));
  assert.doesNotMatch(serialized, /buffer_test_secret/);
});

test("runBufferConnectionDiagnostic surfaces GraphQL auth errors without token leakage", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        errors: [{ message: "Not authorized", extensions: { code: "UNAUTHORIZED" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await runBufferConnectionDiagnostic({
    token: SECRET,
    fetchImpl,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "Not authorized");
  assert.equal(result.errorCode, "UNAUTHORIZED");
  assert.doesNotMatch(JSON.stringify(result), /buffer_test_secret/);
});
