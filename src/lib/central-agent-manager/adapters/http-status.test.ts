import assert from "node:assert/strict";
import test from "node:test";
import { createHttpStatusAdapter } from "./http-status";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("http adapter stays disconnected without configured URL", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
  delete process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
  try {
    const adapter = createHttpStatusAdapter({
      projectId: "on-the-way",
      displayName: "On the Way",
      envKey: "ON_THE_WAY",
    });
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "disconnected");
    assert.equal(snapshot.tasks.length, 0);
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
    else process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = previous;
  }
});

test("http adapter rejects unapproved destinations without sending credentials", async () => {
  const previousUrl = process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL;
  const previousBearer = process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER;
  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL =
    "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER = "secret-token";
  delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  try {
    let fetchCalled = false;
    const fetchImpl: typeof fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };
    const adapter = createHttpStatusAdapter(
      {
        projectId: "twilight-feather",
        displayName: "Twilight Feather",
        envKey: "TWILIGHT_FEATHER",
      },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "unavailable");
    assert.equal(fetchCalled, false);
  } finally {
    if (previousUrl === undefined) delete process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL;
    else process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL = previousUrl;
    if (previousBearer === undefined) {
      delete process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER;
    } else process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER = previousBearer;
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
});

test("http adapter sanitizes remote payload and never leaks bearer tokens", async () => {
  const previousUrl = process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL;
  const previousBearer = process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER;
  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL =
    "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER = "secret-token";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "example.test";
  let capturedAuth: string | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    capturedAuth = headers?.authorization;
    return new Response(
      JSON.stringify({
        activeAgents: [{ id: "agent-1", label: "Planner", state: "active" }],
        tasks: [
          {
            id: "task-1",
            title: "Draft weekly content",
            status: "planned",
            blockers: [],
          },
        ],
        pendingApprovals: [{ id: "approval-1", summary: "Review caption batch" }],
        lastSuccessfulUpdate: "2026-01-01T12:00:00.000Z",
        evidence: [
          {
            kind: "marketing",
            label: "Marketing queue",
            href: "/admin/marketing/content",
          },
          { kind: "bad", label: "External", href: "https://evil.example" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const adapter = createHttpStatusAdapter(
      {
        projectId: "twilight-feather",
        displayName: "Twilight Feather",
        envKey: "TWILIGHT_FEATHER",
      },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "connected");
    assert.equal(capturedAuth, "Bearer secret-token");
    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.evidence.length, 2);
    assert.equal(snapshot.evidence[0]?.href, "/admin/marketing/content");
    assert.equal(snapshot.evidence[1]?.href, undefined);
  } finally {
    if (previousUrl === undefined) delete process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL;
    else process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL = previousUrl;
    if (previousBearer === undefined) {
      delete process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER;
    } else process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER = previousBearer;
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
});

test("http adapter fails closed on redirects", async () => {
  const previousUrl = process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "example.test";
  try {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.test/other" },
      });
    const adapter = createHttpStatusAdapter(
      {
        projectId: "on-the-way",
        displayName: "On the Way",
        envKey: "ON_THE_WAY",
      },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "unavailable");
    assert.match(snapshot.connectionDetail, /redirect/i);
  } finally {
    if (previousUrl === undefined) delete process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
    else process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = previousUrl;
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
});

test("http adapter accepts contract v1 documents", async () => {
  const previousUrl = process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL;
  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL =
    "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "example.test";
  try {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          contractVersion: "central-agent-status/v1",
          projectId: "twilight-feather",
          displayName: "Twilight Feather",
          reportingStatus: "live",
          lastSuccessfulUpdate: "2026-01-15T12:00:00.000Z",
          progressPercent: 40,
          workItems: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const adapter = createHttpStatusAdapter(
      {
        projectId: "twilight-feather",
        displayName: "Twilight Feather",
        envKey: "TWILIGHT_FEATHER",
      },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "connected");
    assert.equal(snapshot.source?.progressPercent, 40);
  } finally {
    if (previousUrl === undefined) delete process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL;
    else process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL = previousUrl;
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
});

test("http adapter marks stale when remote payload omits lastSuccessfulUpdate", async () => {
  const previousUrl = process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "example.test";
  try {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ tasks: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const adapter = createHttpStatusAdapter(
      {
        projectId: "on-the-way",
        displayName: "On the Way",
        envKey: "ON_THE_WAY",
      },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "connected");
    assert.equal(snapshot.lastSuccessfulUpdate, null);
  } finally {
    if (previousUrl === undefined) delete process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
    else process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = previousUrl;
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
});

const BYPASS_SECRET = "bypass-secret-value";

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test("http adapter sends protection bypass only for the configured host", async () => {
  const previous = {
    url: process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL,
    bearer: process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER,
    hosts: process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS,
    bypass: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS,
    bypassHost: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST,
  };
  process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL = "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER = "secret-token";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "example.test";
  process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS = BYPASS_SECRET;
  process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST = "example.test";
  let requestedUrl = "";
  let captured: Record<string, string> | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    captured = init?.headers as Record<string, string>;
    return new Response(
      JSON.stringify({
        contractVersion: "central-agent-status/v1",
        projectId: "twilight-feather",
        displayName: "Twilight Feather",
        reportingStatus: "disconnected",
        statusDetail: "Engineering control plane is disabled.",
        lastSuccessfulUpdate: null,
        progressPercent: null,
        workItems: [],
      }),
      { status: 200 },
    );
  };
  try {
    const adapter = createHttpStatusAdapter(
      {
        projectId: "twilight-feather",
        displayName: "Twilight Feather",
        envKey: "TWILIGHT_FEATHER",
      },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "disconnected");
    assert.equal(captured?.authorization, "Bearer secret-token");
    assert.equal(captured?.[ "x-vercel-protection-bypass"], BYPASS_SECRET);
    assert.equal(requestedUrl.includes(BYPASS_SECRET), false);
    assert.equal(snapshot.connectionDetail.includes(BYPASS_SECRET), false);
  } finally {
    restoreEnv("CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL", previous.url);
    restoreEnv("CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_BEARER", previous.bearer);
    restoreEnv("CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS", previous.hosts);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS", previous.bypass);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST", previous.bypassHost);
  }
});

test("http adapter omits protection bypass when it is not configured", async () => {
  const previous = {
    url: process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL,
    hosts: process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS,
    bypass: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS,
    bypassHost: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST,
  };
  process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "example.test";
  delete process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS;
  delete process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST;
  let captured: Record<string, string> | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    captured = init?.headers as Record<string, string>;
    return new Response(JSON.stringify({ tasks: [] }), { status: 200 });
  };
  try {
    const adapter = createHttpStatusAdapter(
      { projectId: "on-the-way", displayName: "On the Way", envKey: "ON_THE_WAY" },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "connected");
    assert.equal(captured?.["x-vercel-protection-bypass"], undefined);
  } finally {
    restoreEnv("CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL", previous.url);
    restoreEnv("CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS", previous.hosts);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS", previous.bypass);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST", previous.bypassHost);
  }
});

test("http adapter does not send protection bypass to a different approved host", async () => {
  const previous = {
    url: process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL,
    hosts: process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS,
    bypass: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS,
    bypassHost: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST,
  };
  process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = "https://other.test/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "other.test";
  process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS = BYPASS_SECRET;
  process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST = "example.test";
  let fetchCalled = false;
  const fetchImpl: typeof fetch = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const adapter = createHttpStatusAdapter(
      { projectId: "on-the-way", displayName: "On the Way", envKey: "ON_THE_WAY" },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(fetchCalled, false);
    assert.equal(snapshot.connection, "unavailable");
    assert.equal(snapshot.connectionDetail.includes(BYPASS_SECRET), false);
  } finally {
    restoreEnv("CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL", previous.url);
    restoreEnv("CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS", previous.hosts);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS", previous.bypass);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST", previous.bypassHost);
  }
});

test("http adapter does not forward protection bypass across a redirect", async () => {
  const previous = {
    url: process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL,
    hosts: process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS,
    bypass: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS,
    bypassHost: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST,
  };
  process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "example.test";
  process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS = BYPASS_SECRET;
  process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST = "example.test";
  const requested: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requested.push(String(input));
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["x-vercel-protection-bypass"], BYPASS_SECRET);
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.test/steal" },
    });
  };
  try {
    const adapter = createHttpStatusAdapter(
      { projectId: "on-the-way", displayName: "On the Way", envKey: "ON_THE_WAY" },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(requested.length, 1);
    assert.equal(requested[0], "https://example.test/status");
    assert.equal(snapshot.connection, "unavailable");
    assert.match(snapshot.connectionDetail, /redirect/i);
    assert.equal(snapshot.connectionDetail.includes(BYPASS_SECRET), false);
  } finally {
    restoreEnv("CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL", previous.url);
    restoreEnv("CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS", previous.hosts);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS", previous.bypass);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST", previous.bypassHost);
  }
});

test("http adapter redacts protection bypass secrets from transport failures", async () => {
  const previous = {
    url: process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL,
    hosts: process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS,
    bypass: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS,
    bypassHost: process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST,
  };
  process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = "https://example.test/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "example.test";
  process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS = BYPASS_SECRET;
  process.env.CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST = "example.test";
  try {
    const adapter = createHttpStatusAdapter(
      { projectId: "on-the-way", displayName: "On the Way", envKey: "ON_THE_WAY" },
      {
        lookup: publicLookup,
        pinnedGet: async () => ({
          ok: false,
          reason: `transport failed with ${BYPASS_SECRET}`,
        }),
      },
    );
    const snapshot = await adapter.fetchSnapshot();
    assert.equal(snapshot.connection, "unavailable");
    assert.equal(snapshot.connectionDetail.includes(BYPASS_SECRET), false);
    assert.match(snapshot.connectionDetail, /\[redacted\]/);
  } finally {
    restoreEnv("CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL", previous.url);
    restoreEnv("CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS", previous.hosts);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS", previous.bypass);
    restoreEnv("CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST", previous.bypassHost);
  }
});
