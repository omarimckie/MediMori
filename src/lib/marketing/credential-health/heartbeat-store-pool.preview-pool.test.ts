import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import type { Pool } from "@neondatabase/serverless";
import {
  PREVIEW_DATABASE_GUARD_ERROR,
  PREVIEW_DATABASE_GUARD_REF,
  PREVIEW_DB_EXPECTED_BRANCH,
  PREVIEW_DB_EXPECTED_DATABASE,
  PREVIEW_DB_EXPECTED_PROJECT,
  PREVIEW_DB_EXPECTED_USER,
  PreviewDatabaseGuardError,
  setPreviewPoolProbeTimeoutForTests,
} from "../preview-db-guard";
import {
  getMarketingPool,
  resetMarketingPoolForTests,
  setMarketingPoolFactoryForTests,
  withCredentialHealthSourceLock,
  withMarketingPoolTransaction,
} from "./heartbeat-store-pool";

const ORIGINAL_ENV = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  DATABASE_URL: process.env.DATABASE_URL,
};

afterEach(() => {
  restoreEnv();
  resetMarketingPoolForTests();
  setPreviewPoolProbeTimeoutForTests(null);
});

function restoreEnv() {
  for (const key of ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "DATABASE_URL"] as const) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function protect() {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = PREVIEW_DATABASE_GUARD_REF;
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
}

function goodRow(overrides: Record<string, unknown> = {}) {
  return {
    current_user: PREVIEW_DB_EXPECTED_USER,
    current_database: PREVIEW_DB_EXPECTED_DATABASE,
    neon_branch_id: PREVIEW_DB_EXPECTED_BRANCH,
    neon_project_id: PREVIEW_DB_EXPECTED_PROJECT,
    marketing_content_insert_allowed: false,
    ...overrides,
  };
}

type Entry = { clientId: number; text: string };

function isProbe(text: string) {
  return text.includes("neon.branch_id");
}

function harness(options?: {
  probe?: () => unknown;
  reuse?: boolean;
  holdWhileCheckedOut?: boolean;
}) {
  const log: Entry[] = [];
  const releases: number[] = [];
  let connects = 0;
  let nextId = 1;
  let held: FakeClient | null = null;
  let checkedOut = false;

  type FakeClient = {
    id: number;
    query: (text: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>;
    release: () => void;
  };

  function makeClient(id: number): FakeClient {
    return {
      id,
      async query(text: string) {
        log.push({ clientId: id, text });
        if (!isProbe(text)) return { rows: [] };
        const body = options?.probe ? await options.probe() : [goodRow()];
        return { rows: Array.isArray(body) ? body : [body] };
      },
      release() {
        checkedOut = false;
        releases.push(id);
      },
    };
  }

  const pool = {
    async connect() {
      connects += 1;
      if (options?.reuse && held) {
        if (checkedOut && options.holdWhileCheckedOut) return held;
        checkedOut = true;
        return held;
      }
      const client = makeClient(nextId++);
      held = client;
      checkedOut = true;
      return client;
    },
  };

  setMarketingPoolFactoryForTests(() => pool as unknown as Pool);
  return {
    log,
    releases,
    connects: () => connects,
  };
}

async function expectGuard(
  run: () => Promise<unknown>,
  category: PreviewDatabaseGuardError["category"],
) {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof PreviewDatabaseGuardError);
    assert.equal(error.category, category);
    assert.equal(error.message, PREVIEW_DATABASE_GUARD_ERROR);
    assert.equal(error.message.includes("postgres://"), false);
    assert.equal(error.message.includes(PREVIEW_DB_EXPECTED_USER), false);
    return true;
  });
}

function texts(log: Entry[]) {
  return log.map((entry) => entry.text);
}

test("matching identity allows the marketing query on the probed connection", async () => {
  protect();
  const fake = harness();
  const result = await withMarketingPoolTransaction(async (client) => {
    const query = await client.query("SELECT marketing_app");
    return query.rows;
  });
  assert.deepEqual(result, []);
  const ids = new Set(fake.log.map((entry) => entry.clientId));
  assert.equal(ids.size, 1);
  assert.deepEqual(
    texts(fake.log).map((text) => (isProbe(text) ? "probe" : text)),
    ["probe", "BEGIN", "SELECT marketing_app", "COMMIT"],
  );
  assert.deepEqual(fake.releases, [1]);
});

test("wrong user rejects before the marketing query", async () => {
  protect();
  const fake = harness({ probe: () => [goodRow({ current_user: "neondb_owner" })] });
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "mismatch",
  );
  assert.deepEqual(texts(fake.log).map((text) => (isProbe(text) ? "probe" : text)), ["probe"]);
  assert.deepEqual(fake.releases, [1]);
});

test("wrong database rejects before the marketing query", async () => {
  protect();
  const fake = harness({ probe: () => [goodRow({ current_database: "other" })] });
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "mismatch",
  );
  assert.equal(texts(fake.log).includes("BEGIN"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("wrong Neon branch rejects before the marketing query", async () => {
  protect();
  const fake = harness({ probe: () => [goodRow({ neon_branch_id: "br-other" })] });
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "mismatch",
  );
  assert.equal(texts(fake.log).includes("SELECT marketing_app"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("wrong Neon project rejects before the marketing query", async () => {
  protect();
  const fake = harness({ probe: () => [goodRow({ neon_project_id: "other-project" })] });
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "mismatch",
  );
  assert.equal(texts(fake.log).includes("SELECT marketing_app"), false);
});

test("INSERT permission rejects before the marketing query", async () => {
  protect();
  const fake = harness({
    probe: () => [goodRow({ marketing_content_insert_allowed: true })],
  });
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "mismatch",
  );
  assert.equal(texts(fake.log).includes("BEGIN"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("missing metadata rejects before the marketing query", async () => {
  protect();
  const row = goodRow();
  delete (row as { neon_project_id?: string }).neon_project_id;
  const fake = harness({ probe: () => [row] });
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "mismatch",
  );
  assert.equal(texts(fake.log).includes("SELECT marketing_app"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("probe failure rejects before the marketing query and hides the driver error", async () => {
  protect();
  const fake = harness({
    probe: () => {
      throw new Error("connect failed postgres://user:secret@example/neondb");
    },
  });
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "probe-failed",
  );
  assert.equal(texts(fake.log).includes("BEGIN"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("probe timeout rejects before the marketing query", async () => {
  protect();
  setPreviewPoolProbeTimeoutForTests(20);
  let late: (value: unknown) => void = () => {};
  const fake = harness({
    probe: () =>
      new Promise((resolve) => {
        late = resolve;
      }),
  });
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "timeout",
  );
  late([goodRow()]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(texts(fake.log).some((text) => !isProbe(text)), false);
  assert.deepEqual(fake.releases, [1]);
});

test("two concurrent marketing transactions probe independently", async () => {
  protect();
  let release: (value: unknown) => void = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let probes = 0;
  const fake = harness({
    probe: () => {
      probes += 1;
      return gate.then(() => [goodRow()]);
    },
  });
  const first = withMarketingPoolTransaction(async (client) => client.query("SELECT first"));
  const second = withMarketingPoolTransaction(async (client) => client.query("SELECT second"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(probes, 2);
  assert.equal(texts(fake.log).some((text) => text.startsWith("SELECT ")), false);
  assert.equal(texts(fake.log).includes("BEGIN"), false);
  release([goodRow()]);
  await Promise.all([first, second]);
  const firstId = fake.log.find((entry) => entry.text === "SELECT first")?.clientId;
  const secondId = fake.log.find((entry) => entry.text === "SELECT second")?.clientId;
  assert.notEqual(firstId, secondId);
  assert.equal(fake.releases.length, 2);
});

test("two pooled connections are verified separately", async () => {
  protect();
  const fake = harness();
  await withMarketingPoolTransaction(async (client) => client.query("SELECT one"));
  await withMarketingPoolTransaction(async (client) => client.query("SELECT two"));
  assert.equal(texts(fake.log).filter(isProbe).length, 2);
  const one = fake.log.find((entry) => entry.text === "SELECT one");
  const two = fake.log.find((entry) => entry.text === "SELECT two");
  assert.notEqual(one?.clientId, two?.clientId);
  assert.equal(
    fake.log.filter((entry) => entry.clientId === one?.clientId && isProbe(entry.text)).length,
    1,
  );
});

test("transaction statements stay on the verified marketing connection", async () => {
  protect();
  const fake = harness();
  await withCredentialHealthSourceLock("facebook", async (client) => {
    await client.query("SELECT heartbeat_app");
    return client;
  });
  const ids = new Set(fake.log.map((entry) => entry.clientId));
  assert.equal(ids.size, 1);
  assert.equal(texts(fake.log)[0]?.includes("neon.branch_id"), true);
  assert.equal(texts(fake.log)[1], "BEGIN");
  assert.match(texts(fake.log)[2] ?? "", /pg_advisory_xact_lock/);
  assert.equal(texts(fake.log)[3], "SELECT heartbeat_app");
  assert.equal(texts(fake.log)[4], "COMMIT");
});

test("a failed marketing probe does not authorize a later query", async () => {
  protect();
  let attempt = 0;
  const fake = harness({
    probe: () => {
      attempt += 1;
      if (attempt === 1) throw new Error("temporary failure");
      return [goodRow()];
    },
  });
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "probe-failed",
  );
  await withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app"));
  assert.equal(attempt, 2);
  assert.equal(texts(fake.log).filter((text) => text === "SELECT marketing_app").length, 1);
});

test("a released connection cannot inherit an earlier verification", async () => {
  protect();
  const fake = harness({ reuse: true });
  await getMarketingPool().query("SELECT one");
  await getMarketingPool().query("SELECT two");
  assert.equal(texts(fake.log).filter(isProbe).length, 2);
  assert.equal(new Set(fake.log.map((entry) => entry.clientId)).size, 1);
  assert.deepEqual(fake.releases, [1, 1]);
});

test("a still-held connection cannot be queried through a second checkout", async () => {
  protect();
  const fake = harness({ reuse: true, holdWhileCheckedOut: true });
  const first = await getMarketingPool().connect();
  const second = await getMarketingPool().connect();
  await expectGuard(() => second.query("SELECT stolen"), "probe-failed");
  await first.query("SELECT owner");
  first.release();
  assert.equal(texts(fake.log).includes("SELECT stolen"), false);
  assert.equal(texts(fake.log).includes("SELECT owner"), true);
  assert.deepEqual(fake.releases, [1]);
});

test("a query after release cannot use the closed client", async () => {
  protect();
  const fake = harness();
  const client = await getMarketingPool().connect();
  await client.query("SELECT held");
  client.release();
  await expectGuard(() => client.query("SELECT after"), "probe-failed");
  assert.equal(texts(fake.log).includes("SELECT after"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("an application failure rolls back the verified connection and releases it", async () => {
  protect();
  const fake = harness();
  await assert.rejects(
    () =>
      withMarketingPoolTransaction(async (client) => {
        await client.query("SELECT marketing_app");
        throw new Error("app failed");
      }),
    /app failed/,
  );
  assert.equal(texts(fake.log).at(-1), "ROLLBACK");
  assert.equal(texts(fake.log).includes("COMMIT"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("callback and config queries do not reach the driver", async () => {
  protect();
  const fake = harness();
  const pool = getMarketingPool();
  const query = pool.query as (text: unknown, values?: unknown) => Promise<unknown>;
  await expectGuard(() => query("SELECT cb", () => undefined), "probe-failed");
  await expectGuard(() => query({ text: "SELECT config" }), "probe-failed");
  const connect = pool.connect as (callback: (error?: unknown) => void) => void;
  const callbackError = await new Promise((resolve) => {
    connect((error) => resolve(error));
  });
  assert.ok(callbackError instanceof PreviewDatabaseGuardError);
  assert.equal(fake.connects(), 0);
  assert.equal(fake.log.length, 0);
});

test("Production does not invoke the marketing Preview guard", async () => {
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_GIT_COMMIT_REF = "main";
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = harness();
  await withMarketingPoolTransaction(async (client) => client.query("SELECT production_row"));
  await assert.rejects(
    () =>
      withMarketingPoolTransaction(async (client) => {
        await client.query("SELECT production_fail");
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.equal(texts(fake.log).some(isProbe), false);
  assert.deepEqual(texts(fake.log), [
    "BEGIN",
    "SELECT production_row",
    "COMMIT",
    "BEGIN",
    "SELECT production_fail",
    "ROLLBACK",
  ]);
});

test("another Preview branch does not invoke the marketing guard", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "release/central-agent-status-minimal";
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = harness();
  await withMarketingPoolTransaction(async (client) => client.query("SELECT other_preview"));
  assert.equal(texts(fake.log).some(isProbe), false);
  assert.equal(texts(fake.log).includes("SELECT other_preview"), true);
});

test("local development does not invoke the marketing guard", async () => {
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_GIT_COMMIT_REF;
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = harness();
  await withMarketingPoolTransaction(async (client) => client.query("SELECT local_row"));
  assert.equal(texts(fake.log).some(isProbe), false);
});

test("ambiguous Preview identity does not open a marketing connection", async () => {
  process.env.VERCEL_ENV = "preview";
  delete process.env.VERCEL_GIT_COMMIT_REF;
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = harness();
  await expectGuard(
    () => withMarketingPoolTransaction(async (client) => client.query("SELECT marketing_app")),
    "ambiguous-scope",
  );
  await expectGuard(async () => {
    getMarketingPool();
  }, "ambiguous-scope");
  assert.equal(fake.connects(), 0);
  assert.equal(fake.log.length, 0);
});

test("the protected ref without Preview does not open a marketing connection", async () => {
  delete process.env.VERCEL_ENV;
  process.env.VERCEL_GIT_COMMIT_REF = PREVIEW_DATABASE_GUARD_REF;
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = harness();
  await expectGuard(async () => {
    await getMarketingPool().query("SELECT marketing_app");
  }, "ambiguous-scope");
  assert.equal(fake.connects(), 0);
});

test("marketing pool module has no direct checkout outside the guard", () => {
  const source = readFileSync(new URL("./heartbeat-store-pool.ts", import.meta.url), "utf8");
  assert.match(source, /connectPreviewAwarePoolClient\(/);
  assert.match(source, /guardPoolForProtectedPreview\(/);
  assert.equal(source.match(/\.connect\(/g)?.length, 1);
  assert.match(source, /connect: \(\) => getRawMarketingPool\(\)\.connect\(\)/);
  assert.doesNotMatch(source, /process\.env\.(?!DATABASE_URL|VERCEL_ENV|VERCEL_GIT_COMMIT_REF)/);
});
