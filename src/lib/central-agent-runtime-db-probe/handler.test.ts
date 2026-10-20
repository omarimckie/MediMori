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
  type ProbeUnavailableReason,
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
const BEARER = "probe-test-bearer";

const LEAK_PATTERN =
  /DATABASE_URL|postgresql:\/\/|Bearer\s|password|engineering_tasks|br-quiet-fire|probe-test-bearer|connection refused|ECONNREFUSED/i;

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
  process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_BEARER_ENV] = BEARER;
  process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV] = FIXED_RELEASE_GIT_REF;
  process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV] =
    FIXED_STAGING_NEON_BRANCH_ID;
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = FIXED_RELEASE_GIT_REF;
}

function assertNoLeak(body: unknown): void {
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, LEAK_PATTERN);
}

async function assertUnavailableReason(
  response: Response,
  reason: ProbeUnavailableReason,
  fetchCalls: number,
  expectedFetchCalls = 0,
): Promise<void> {
  assert.equal(response.status, 503);
  assert.equal(fetchCalls, expectedFetchCalls);
  const body = (await response.json()) as { error: string; reason: string };
  assert.equal(body.error, "Runtime database probe is unavailable.");
  assert.equal(body.reason, reason);
  assertNoLeak(body);
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
  it("rejects non-preview VERCEL_ENV values with vercel_env", () => {
    for (const vercelEnv of [undefined, "", "development", "test", "production", "staging"]) {
      const failure = evaluateRuntimeDbProbePreflightGuards({
        VERCEL_ENV: vercelEnv,
        VERCEL_GIT_COMMIT_REF: FIXED_RELEASE_GIT_REF,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]: FIXED_RELEASE_GIT_REF,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]: FIXED_STAGING_NEON_BRANCH_ID,
      });
      assert.ok(failure);
      assert.equal(failure.reason, "vercel_env");
    }
  });

  it("rejects wrong or missing actual git ref with git_commit_ref", () => {
    const base = {
      VERCEL_ENV: "preview",
      [CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]: FIXED_RELEASE_GIT_REF,
      [CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]: FIXED_STAGING_NEON_BRANCH_ID,
    };
    assert.equal(evaluateRuntimeDbProbePreflightGuards({ ...base })?.reason, "git_commit_ref");
    assert.equal(
      evaluateRuntimeDbProbePreflightGuards({
        ...base,
        VERCEL_GIT_COMMIT_REF: "main",
      })?.reason,
      "git_commit_ref",
    );
  });

  it("rejects wrong configured git ref with allowed_git_ref", () => {
    const base = {
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: FIXED_RELEASE_GIT_REF,
      [CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]: FIXED_STAGING_NEON_BRANCH_ID,
    };
    assert.equal(evaluateRuntimeDbProbePreflightGuards({ ...base })?.reason, "allowed_git_ref");
    assert.equal(
      evaluateRuntimeDbProbePreflightGuards({
        ...base,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]: "main",
      })?.reason,
      "allowed_git_ref",
    );
  });

  it("rejects wrong expected branch id with expected_branch_id", () => {
    assert.equal(
      evaluateRuntimeDbProbePreflightGuards({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: FIXED_RELEASE_GIT_REF,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV]: FIXED_RELEASE_GIT_REF,
        [CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV]: "br-quiet-fire-ausvjkg8",
      })?.reason,
      "expected_branch_id",
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

  it("1. returns 503 disabled without reason codes or DB access", async () => {
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest("x"), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    assert.equal(response.status, 503);
    assert.equal(fetchCalls, 0);
    const body = (await response.json()) as { error: string; reason?: string };
    assert.match(body.error, /disabled/i);
    assert.equal(body.reason, undefined);
    assertNoLeak(body);
  });

  it("1b. returns 503 when enabled flag is not exactly true", async () => {
    validPreviewEnv();
    process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ENABLED_ENV] = "TRUE";
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    assert.equal(response.status, 503);
    assert.equal(fetchCalls, 0);
  });

  it("2. returns vercel_env after auth when VERCEL_ENV is wrong", async () => {
    validPreviewEnv();
    process.env.VERCEL_ENV = "production";
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    await assertUnavailableReason(response, "vercel_env", fetchCalls);
  });

  it("3. returns git_commit_ref after auth when VERCEL_GIT_COMMIT_REF is missing", async () => {
    validPreviewEnv();
    delete process.env.VERCEL_GIT_COMMIT_REF;
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    await assertUnavailableReason(response, "git_commit_ref", fetchCalls);
  });

  it("4. returns git_commit_ref after auth when VERCEL_GIT_COMMIT_REF is wrong", async () => {
    validPreviewEnv();
    process.env.VERCEL_GIT_COMMIT_REF = "main";
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    await assertUnavailableReason(response, "git_commit_ref", fetchCalls);
  });

  it("5. returns allowed_git_ref after auth when allowlist is missing or wrong", async () => {
    validPreviewEnv();
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV];
    let fetchCalls = 0;
    let response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    await assertUnavailableReason(response, "allowed_git_ref", fetchCalls);

    validPreviewEnv();
    process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ALLOWED_GIT_REF_ENV] = "main";
    fetchCalls = 0;
    response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    await assertUnavailableReason(response, "allowed_git_ref", fetchCalls);
  });

  it("6. returns expected_branch_id after auth when expected branch is missing or wrong", async () => {
    validPreviewEnv();
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV];
    let fetchCalls = 0;
    let response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    await assertUnavailableReason(response, "expected_branch_id", fetchCalls);

    validPreviewEnv();
    process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_EXPECTED_BRANCH_ID_ENV] =
      "br-quiet-fire-ausvjkg8";
    fetchCalls = 0;
    response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    await assertUnavailableReason(response, "expected_branch_id", fetchCalls);
  });

  it("7. returns bearer_missing without DB access when bearer env is unset", async () => {
    validPreviewEnv();
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_BEARER_ENV];
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    });
    await assertUnavailableReason(response, "bearer_missing", fetchCalls);
  });

  it("8. returns 401 for missing or invalid bearer without env diagnostics or DB", async () => {
    validPreviewEnv();
    process.env.VERCEL_ENV = "production";
    let fetchCalls = 0;
    const deps = {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("should not run");
      },
    };

    const missing = await centralAgentRuntimeDbProbeGet(new Request(PROBE_URL), deps);
    assert.equal(missing.status, 401);
    const missingBody = (await missing.json()) as { error: string; reason?: string };
    assert.equal(missingBody.error, "Unauthorized.");
    assert.equal(missingBody.reason, undefined);
    assertNoLeak(missingBody);

    const wrong = await centralAgentRuntimeDbProbeGet(authRequest("wrong"), deps);
    assert.equal(wrong.status, 401);
    const wrongBody = (await wrong.json()) as { error: string; reason?: string };
    assert.equal(wrongBody.error, "Unauthorized.");
    assert.equal(wrongBody.reason, undefined);
    assertNoLeak(wrongBody);
    assert.equal(fetchCalls, 0);
  });

  it("9. returns db_runtime for unexpected database/runtime exceptions", async () => {
    validPreviewEnv();
    let fetchCalls = 0;
    const response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("connection refused");
      },
    });
    assert.equal(fetchCalls, 1);
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string; reason: string };
    assert.equal(body.error, "Runtime database probe is unavailable.");
    assert.equal(body.reason, "db_runtime");
    assertNoLeak(body);
  });

  it("10. returns Branch identity mismatch without reason codes", async () => {
    validPreviewEnv();
    for (const failure of [
      async () => ({
        databaseName: FIXED_STAGING_DATABASE_NAME,
        neonBranchId: "br-quiet-fire-ausvjkg8",
      }),
      async () => {
        throw new RuntimeDatabaseIdentityError("wrong_branch");
      },
    ]) {
      const response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
        fetchIdentity: failure,
      });
      assert.equal(response.status, 503);
      const body = (await response.json()) as { error: string; reason?: string };
      assert.match(body.error, /mismatch/i);
      assert.equal(body.reason, undefined);
      assertNoLeak(body);
    }
  });

  it("11. returns staging identity on success", async () => {
    validPreviewEnv();
    const response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
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
    assertNoLeak(body);
  });

  it("12. error responses never include secrets or config values", async () => {
    validPreviewEnv();
    process.env.VERCEL_GIT_COMMIT_REF = "main";
    const response = await centralAgentRuntimeDbProbeGet(authRequest(BEARER), {
      fetchIdentity: async () => {
        throw new Error("should not run");
      },
    });
    const body = await response.json();
    assertNoLeak(body);
    assert.doesNotMatch(JSON.stringify(body), /main/);
  });

  it("13. preflight and auth failures never call the database", async () => {
    let fetchCalls = 0;
    const counting = {
      fetchIdentity: async () => {
        fetchCalls += 1;
        throw new Error("db");
      },
    };

    validPreviewEnv();
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_ENABLED_ENV];
    await centralAgentRuntimeDbProbeGet(authRequest(BEARER), counting);
    assert.equal(fetchCalls, 0);

    validPreviewEnv();
    delete process.env[CENTRAL_AGENT_RUNTIME_DB_PROBE_BEARER_ENV];
    await centralAgentRuntimeDbProbeGet(authRequest(BEARER), counting);
    assert.equal(fetchCalls, 0);

    validPreviewEnv();
    await centralAgentRuntimeDbProbeGet(authRequest("wrong"), counting);
    assert.equal(fetchCalls, 0);

    validPreviewEnv();
    process.env.VERCEL_ENV = "production";
    await centralAgentRuntimeDbProbeGet(authRequest(BEARER), counting);
    assert.equal(fetchCalls, 0);
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
