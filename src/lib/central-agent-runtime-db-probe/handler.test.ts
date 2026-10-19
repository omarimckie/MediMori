import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  CENTRAL_AGENT_RUNTIME_DB_PROBE_BEARER_ENV,
  CENTRAL_AGENT_RUNTIME_DB_PROBE_ENABLED_ENV,
} from "./auth";
import {
  FIXED_RELEASE_GIT_REF,
  FIXED_STAGING_DATABASE_NAME,
  FIXED_STAGING_NEON_BRANCH_ID,
  RUNTIME_DB_PROBE_CONTRACT,
} from "./constants";
import {
  CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV,
  CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV,
  evaluateRuntimeDbProbePreflightGuards,
} from "./guards";
import {
  centralAgentRuntimeDbProbeGet,
  centralAgentRuntimeDbProbeMethodNotAllowed,
} from "./handler";
import {
  fetchRuntimeDatabaseIdentity,
  RuntimeDatabaseIdentityError,
} from "./identity-query";
import type { NeonQueryFunction } from "@neondatabase/serverless";

const PROBE_URL = "https://example.test/api/internal/central-agent-runtime-db-probe/v1";

function authRequest(token: string): Request {
  return new Request(PROBE_URL, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function mockIdentitySql(
  rows: Array<Record<string, unknown>>,
): NeonQueryFunction<false, false> {
  const fn = async () => rows;
  return fn as unknown as NeonQueryFunction<false, false>;
}

function validPreviewEnv(): void {
  process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ENABLED_ENV] = "true";
  process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_BEARER_ENV] = "probe-test-bearer";
  process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV] = FIXED_RELEASE_GIT_REF;
  process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV] =
    FIXED_STAGING_NEON_BRANCH_ID;
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = FIXED_RELEASE_GIT_REF;
}

describe("runtime db probe identity query", () => {
  it("accepts staging database and branch from SQL rows", async () => {
    const identity = await fetchRuntimeDatabaseIdentity(
      mockIdentitySql([
        {
          database_name: FIXED_STAGING_DATABASE_NAME,
          neon_branch_id: FIXED_STAGING_NEON_BRANCH_ID,
        },
      ]),
    );
    assert.deepEqual(identity, {
      databaseName: FIXED_STAGING_DATABASE_NAME,
      neonBranchId: FIXED_STAGING_NEON_BRANCH_ID,
    });
  });

  it("rejects empty, malformed, or production identity rows", async () => {
    for (const rows of [
      [],
      [{ database_name: "", neon_branch_id: FIXED_STAGING_NEON_BRANCH_ID }],
      [{ database_name: FIXED_STAGING_DATABASE_NAME, neon_branch_id: "" }],
      [{ database_name: "otherdb", neon_branch_id: FIXED_STAGING_NEON_BRANCH_ID }],
      [{ database_name: FIXED_STAGING_DATABASE_NAME, neon_branch_id: "br-quiet-fire-ausvjkg8" }],
      [{ database_name: 1, neon_branch_id: FIXED_STAGING_NEON_BRANCH_ID }],
    ]) {
      await assert.rejects(
        () => fetchRuntimeDatabaseIdentity(mockIdentitySql(rows)),
        RuntimeDatabaseIdentityError,
      );
    }
  });
});

describe("runtime db probe preflight guards", () => {
  it("rejects non-preview VERCEL_ENV values", () => {
    for (const vercelEnv of [undefined, "", "development", "test", "production", "staging"]) {
      const env = {
        VERCEL_ENV: vercelEnv,
        VERCEL_GIT_COMMIT_REF: FIXED_RELEASE_GIT_REF,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]: FIXED_RELEASE_GIT_REF,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]: FIXED_STAGING_NEON_BRANCH_ID,
      };
      assert.ok(evaluateRuntimeDbProbePreflightGuards(env));
    }
  });

  it("rejects wrong or missing actual git ref", () => {
    const base = {
      VERCEL_ENV: "preview",
      [CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]: FIXED_RELEASE_GIT_REF,
      [CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]: FIXED_STAGING_NEON_BRANCH_ID,
    };
    assert.ok(evaluateRuntimeDbProbePreflightGuards({ ...base }));
    assert.ok(
      evaluateRuntimeDbProbePreflightGuards({
        ...base,
        VERCEL_GIT_COMMIT_REF: "main",
      }),
    );
  });

  it("rejects wrong configured git ref or production branch expectation", () => {
    const base = {
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: FIXED_RELEASE_GIT_REF,
      [CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]: FIXED_STAGING_NEON_BRANCH_ID,
    };
    assert.ok(evaluateRuntimeDbProbePreflightGuards({ ...base }));
    assert.ok(
      evaluateRuntimeDbProbePreflightGuards({
        ...base,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]: "main",
      }),
    );
    assert.ok(
      evaluateRuntimeDbProbePreflightGuards({
        ...base,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]: FIXED_RELEASE_GIT_REF,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]: "br-quiet-fire-ausvjkg8",
      }),
    );
  });

  it("accepts fully aligned preview configuration", () => {
    assert.equal(
      evaluateRuntimeDbProbePreflightGuards({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: FIXED_RELEASE_GIT_REF,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]: FIXED_RELEASE_GIT_REF,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]: FIXED_STAGING_NEON_BRANCH_ID,
      }),
      null,
    );
  });
});

describe("central-agent-runtime-db-probe handler", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ENABLED_ENV];
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_BEARER_ENV];
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV];
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV];
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_GIT_COMMIT_REF;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("returns 503 when probe is disabled by default", async () => {
    const response = await centralAgentRuntimeDbProbeGet(authRequest("x"));
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /disabled/i);
  });

  it("returns 503 when enabled flag is not exactly true", async () => {
    validPreviewEnv();
    process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ENABLED_ENV] = "TRUE";
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest("probe-test-bearer"), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        return {
          databaseName: FIXED_STAGING_DATABASE_NAME,
          neonBranchId: FIXED_STAGING_NEON_BRANCH_ID,
        };
      },
    });
    assert.equal(response.status, 503);
    assert.equal(fetchCalls, 0);
  });

  it("returns 503 for preflight failures without calling SQL", async () => {
    validPreviewEnv();
    process.env.VERCEL_ENV = "production";
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest("probe-test-bearer"), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    assert.equal(response.status, 503);
    assert.equal(fetchCalls, 0);
  });

  it("returns 503 when bearer is not configured", async () => {
    validPreviewEnv();
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_BEARER_ENV];
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest("probe-test-bearer"), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    assert.equal(response.status, 503);
    assert.equal(fetchCalls, 0);
  });

  it("returns 401 for missing or invalid bearer", async () => {
    validPreviewEnv();
    const missing = await centralAgentRuntimeDbProbeGet(new Request(PROBE_URL));
    assert.equal(missing.status, 401);

    const wrong = await centralAgentRuntimeDbProbeGet(authRequest("wrong"));
    assert.equal(wrong.status, 401);
  });

  it("returns staging identity on success without secrets or task data", async () => {
    validPreviewEnv();
    const response = await centralAgentRuntimeDbProbeGet(authRequest("probe-test-bearer"), {
      fetchIdentity: async () => ({
        databaseName: FIXED_STAGING_DATABASE_NAME,
        neonBranchId: FIXED_STAGING_NEON_BRANCH_ID,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.probe, RUNTIME_DB_PROBE_CONTRACT);
    assert.equal(body.ok, true);
    assert.equal(body.databaseName, FIXED_STAGING_DATABASE_NAME);
    assert.equal(body.neonBranchId, FIXED_STAGING_NEON_BRANCH_ID);
    assert.equal(Object.keys(body).length, 4);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /DATABASE_URL|postgresql|Bearer|password|engineering_tasks/i);
  });

  it("returns 503 for production or unexpected branch identity", async () => {
    validPreviewEnv();
    for (const identity of [
      {
        databaseName: FIXED_STAGING_DATABASE_NAME,
        neonBranchId: "br-quiet-fire-ausvjkg8",
      },
      {
        databaseName: FIXED_STAGING_DATABASE_NAME,
        neonBranchId: "br-unknown-branch",
      },
    ]) {
      const response = await centralAgentRuntimeDbProbeGet(authRequest("probe-test-bearer"), {
        fetchIdentity: async () => identity,
      });
      assert.equal(response.status, 503);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /mismatch/i);
    }
  });

  it("returns sanitized 503 for identity query failures", async () => {
    validPreviewEnv();
    for (const failure of [
      () => {
        throw new RuntimeDatabaseIdentityError("missing_branch");
      },
      () => {
        throw new RuntimeDatabaseIdentityError("wrong_database");
      },
      () => {
        throw new Error("connection refused");
      },
    ]) {
      const response = await centralAgentRuntimeDbProbeGet(authRequest("probe-test-bearer"), {
        fetchIdentity: failure,
      });
      assert.equal(response.status, 503);
      const body = (await response.json()) as { error: string };
      assert.doesNotMatch(body.error, /connection refused|ECONNREFUSED|postgresql/i);
    }
  });

  it("sets no-store on error responses", async () => {
    const response = await centralAgentRuntimeDbProbeGet(new Request(PROBE_URL));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });

  it("rejects non-GET methods via helper", () => {
    const response = centralAgentRuntimeDbProbeMethodNotAllowed();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });
});
