import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import {
  getSql,
  resetSqlCacheForTests,
  setSqlFactoryForTests,
} from "../db";
import {
  createPreviewGuardedSql,
  PREVIEW_DATABASE_GUARD_ERROR,
  PREVIEW_DATABASE_GUARD_REF,
  PREVIEW_DB_EXPECTED_BRANCH,
  PREVIEW_DB_EXPECTED_DATABASE,
  PREVIEW_DB_EXPECTED_PROJECT,
  PREVIEW_DB_EXPECTED_USER,
  PREVIEW_DB_IDENTITY_PROBE_SQL,
  previewDatabaseGuardDecision,
  previewDbIdentityMatches,
  PreviewDatabaseGuardError,
} from "./preview-db-guard";

const ORIGINAL_ENV = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  DATABASE_URL: process.env.DATABASE_URL,
};

afterEach(() => {
  restoreEnv();
  resetSqlCacheForTests();
});

function restoreEnv() {
  for (const key of ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "DATABASE_URL"] as const) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

type Call = { kind: "template" | "query" | "transaction"; text: string };

function deferred<T>(run: () => T | Promise<T>) {
  let executed = false;
  const promise = {
    executed: () => executed,
    then(onFulfilled?: (value: T) => unknown, onRejected?: (reason: unknown) => unknown) {
      executed = true;
      return Promise.resolve()
        .then(run)
        .then(onFulfilled, onRejected);
    },
    catch(onRejected?: (reason: unknown) => unknown) {
      executed = true;
      return Promise.resolve()
        .then(run)
        .catch(onRejected);
    },
    finally(onFinally?: () => void) {
      executed = true;
      return Promise.resolve()
        .then(run)
        .finally(onFinally);
    },
  };
  return promise;
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

function isProbe(text: string) {
  return text.includes("neon.branch_id");
}

function fakeClient(options?: {
  probe?: () => unknown;
  onCaller?: (text: string) => void;
}) {
  const calls: Call[] = [];
  const executions: string[] = [];
  const client = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    calls.push({ kind: "template", text });
    return deferred(() => {
      executions.push(text);
      options?.onCaller?.(text);
      return [{ ok: true }];
    });
  }) as unknown as NeonQueryFunction<false, false>;

  client.query = ((text: string) => {
    calls.push({ kind: "query", text });
    if (isProbe(text)) {
      return deferred(() => {
        executions.push(text);
        const probe = options?.probe;
        if (probe) return probe();
        return [goodRow()];
      });
    }
    return deferred(() => {
      executions.push(text);
      options?.onCaller?.(text);
      return [{ ok: true }];
    });
  }) as unknown as NeonQueryFunction<false, false>["query"];

  client.transaction = (async () => {
    calls.push({ kind: "transaction", text: "transaction" });
    executions.push("transaction");
    options?.onCaller?.("transaction");
    return [];
  }) as unknown as NeonQueryFunction<false, false>["transaction"];

  client.unsafe = ((raw: string) => ({ raw })) as unknown as NeonQueryFunction<false, false>["unsafe"];

  return { client: client as unknown as NeonQueryFunction<false, false>, calls, executions };
}

function guardedWith(probe?: () => unknown, timeoutMs?: number) {
  const fake = fakeClient({ probe });
  const guarded = createPreviewGuardedSql(fake.client, { timeoutMs });
  return { ...fake, guarded };
}

async function expectRejected(run: () => Promise<unknown>, category: PreviewDatabaseGuardError["category"]) {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof PreviewDatabaseGuardError);
    assert.equal(error.category, category);
    assert.equal(error.message, PREVIEW_DATABASE_GUARD_ERROR);
    assert.equal(error.message.includes("postgres"), false);
    assert.equal(error.message.includes(PREVIEW_DB_EXPECTED_USER), false);
    assert.equal(JSON.stringify(error).includes("postgres://"), false);
    return true;
  });
}

test("identity probe is a single read of the five required facts", () => {
  assert.match(PREVIEW_DB_IDENTITY_PROBE_SQL, /^SELECT/);
  assert.match(PREVIEW_DB_IDENTITY_PROBE_SQL, /current_user/);
  assert.match(PREVIEW_DB_IDENTITY_PROBE_SQL, /current_database\(\)/);
  assert.match(PREVIEW_DB_IDENTITY_PROBE_SQL, /current_setting\('neon\.branch_id'\)/);
  assert.match(PREVIEW_DB_IDENTITY_PROBE_SQL, /current_setting\('neon\.project_id'\)/);
  assert.match(
    PREVIEW_DB_IDENTITY_PROBE_SQL,
    /has_table_privilege\(current_user, 'public\.marketing_content', 'INSERT'\)/,
  );
  assert.doesNotMatch(
    PREVIEW_DB_IDENTITY_PROBE_SQL,
    /\b(insert into|update\s|delete from|drop\s|grant\s|alter\s)\b/i,
  );
});

test("matching identity allows the caller query only after the probe", async () => {
  const { guarded, executions } = guardedWith();
  const row = await guarded.query("SELECT app_row");
  assert.deepEqual(row, [{ ok: true }]);
  assert.equal(executions.length, 2);
  assert.equal(executions[0].includes("neon.branch_id"), true);
  assert.equal(executions[1], "SELECT app_row");
});

test("template query waits for the probe", async () => {
  const { guarded, executions } = guardedWith();
  await guarded`SELECT template_row`;
  assert.equal(executions[0].includes("neon.branch_id"), true);
  assert.equal(executions.at(-1)?.includes("template_row"), true);
});

test("transaction waits for the probe", async () => {
  const { guarded, executions } = guardedWith();
  await guarded.transaction((sql) => [sql`SELECT inside_txn`]);
  assert.equal(executions[0].includes("neon.branch_id"), true);
  assert.equal(executions.at(-1), "transaction");
});

test("wrong database user blocks the caller", async () => {
  const { guarded, executions } = guardedWith(() => [goodRow({ current_user: "neondb_owner" })]);
  await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
  assert.deepEqual(executions, [PREVIEW_DB_IDENTITY_PROBE_SQL]);
});

test("wrong database blocks the caller", async () => {
  const { guarded, executions } = guardedWith(() => [goodRow({ current_database: "other" })]);
  await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
  assert.equal(executions.includes("SELECT app_row"), false);
});

test("wrong Neon branch blocks the caller", async () => {
  const { guarded, executions } = guardedWith(() => [goodRow({ neon_branch_id: "br-other" })]);
  await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
  assert.equal(executions.includes("SELECT app_row"), false);
});

test("wrong Neon project blocks the caller", async () => {
  const { guarded, executions } = guardedWith(() => [goodRow({ neon_project_id: "other-project" })]);
  await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
  assert.equal(executions.includes("SELECT app_row"), false);
});

test("INSERT permission blocks the caller", async () => {
  const { guarded, executions } = guardedWith(() => [
    goodRow({ marketing_content_insert_allowed: true }),
  ]);
  await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
  assert.equal(executions.includes("SELECT app_row"), false);
});

test("missing role blocks the caller", async () => {
  const row = goodRow();
  delete (row as { current_user?: string }).current_user;
  const { guarded, executions } = guardedWith(() => [row]);
  await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
  assert.equal(executions.includes("SELECT app_row"), false);
});

test("missing branch metadata blocks the caller", async () => {
  const row = goodRow();
  delete (row as { neon_branch_id?: string }).neon_branch_id;
  const { guarded } = guardedWith(() => [row]);
  await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
});

test("missing project metadata blocks the caller", async () => {
  const row = goodRow();
  delete (row as { neon_project_id?: string }).neon_project_id;
  const { guarded } = guardedWith(() => [row]);
  await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
});

test("null metadata blocks the caller", async () => {
  const { guarded } = guardedWith(() => [goodRow({ neon_branch_id: null })]);
  await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
});

test("malformed probe responses block the caller", async () => {
  for (const body of [null, [], [{}, {}], "row", { current_user: PREVIEW_DB_EXPECTED_USER }]) {
    const { guarded, executions } = guardedWith(() => body);
    await expectRejected(() => guarded.query("SELECT app_row"), "mismatch");
    assert.equal(executions.includes("SELECT app_row"), false);
  }
});

test("a thrown probe blocks the caller and hides the driver error", async () => {
  const { guarded, executions } = guardedWith(() => {
    throw new Error("connect failed postgres://user:secret@ep-example.neon.tech/neondb");
  });
  await expectRejected(() => guarded.query("SELECT app_row"), "probe-failed");
  assert.equal(executions.includes("SELECT app_row"), false);
});

test("a probe timeout blocks the caller", async () => {
  const { guarded, executions } = guardedWith(
    () => new Promise(() => {}),
    20,
  );
  await expectRejected(() => guarded.query("SELECT app_row"), "timeout");
  assert.equal(executions.includes("SELECT app_row"), false);
});

test("two concurrent first queries share one probe and cannot skip it", async () => {
  let release: (value: unknown) => void = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let probes = 0;
  const { guarded, executions } = guardedWith(() => {
    probes += 1;
    return gate;
  });
  const first = guarded.query("SELECT first");
  const second = guarded.query("SELECT second");
  const pendingFirst = first.then();
  const pendingSecond = second.then();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(probes, 1);
  assert.equal(executions.some((text) => text.startsWith("SELECT first")), false);
  assert.equal(executions.some((text) => text.startsWith("SELECT second")), false);
  release([goodRow()]);
  await Promise.all([pendingFirst, pendingSecond]);
  assert.equal(executions.includes("SELECT first"), true);
  assert.equal(executions.includes("SELECT second"), true);
});

test("a failed probe does not authorize a later query", async () => {
  let attempt = 0;
  const { guarded, executions } = guardedWith(() => {
    attempt += 1;
    if (attempt === 1) throw new Error("temporary failure");
    return [goodRow()];
  });
  await expectRejected(() => guarded.query("SELECT app_row"), "probe-failed");
  assert.equal(executions.includes("SELECT app_row"), false);
  await guarded.query("SELECT app_row");
  assert.equal(attempt, 2);
  assert.equal(executions.includes("SELECT app_row"), true);
});

test("a successful probe is reused for the same client only", async () => {
  let probes = 0;
  const first = fakeClient({
    probe: () => {
      probes += 1;
      return [goodRow()];
    },
  });
  const second = fakeClient({
    probe: () => {
      probes += 1;
      return [goodRow()];
    },
  });
  const guardedA = createPreviewGuardedSql(first.client);
  const guardedB = createPreviewGuardedSql(second.client);
  await guardedA.query("SELECT one");
  await guardedA.query("SELECT two");
  await guardedB.query("SELECT three");
  assert.equal(probes, 2);
  assert.equal(first.executions.includes("SELECT one"), true);
  assert.equal(first.executions.includes("SELECT two"), true);
  assert.equal(first.executions.filter((text) => text.includes("neon.branch_id")).length, 1);
  assert.equal(second.executions.filter((text) => text.includes("neon.branch_id")).length, 1);
});

test("guard scope follows only the protected Preview branch", () => {
  assert.equal(
    previewDatabaseGuardDecision({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: PREVIEW_DATABASE_GUARD_REF,
    }),
    "guard",
  );
  assert.equal(
    previewDatabaseGuardDecision({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
    }),
    "skip",
  );
  assert.equal(
    previewDatabaseGuardDecision({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: PREVIEW_DATABASE_GUARD_REF,
    }),
    "skip",
  );
  assert.equal(
    previewDatabaseGuardDecision({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "release/central-agent-status-minimal",
    }),
    "skip",
  );
  assert.equal(previewDatabaseGuardDecision({}), "skip");
  assert.equal(previewDatabaseGuardDecision({ VERCEL_ENV: "preview" }), "reject");
  assert.equal(
    previewDatabaseGuardDecision({ VERCEL_GIT_COMMIT_REF: PREVIEW_DATABASE_GUARD_REF }),
    "reject",
  );
  assert.equal(previewDbIdentityMatches([goodRow()]), true);
  assert.equal(previewDbIdentityMatches([goodRow({ marketing_content_insert_allowed: "false" })]), false);
});

test("getSql on Production does not probe and keeps the unguarded client", async () => {
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_GIT_COMMIT_REF = "main";
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = fakeClient();
  let built = 0;
  setSqlFactoryForTests(() => {
    built += 1;
    return fake.client;
  });
  const first = getSql();
  process.env.DATABASE_URL = "postgres://other@localhost/neondb";
  const second = getSql();
  assert.equal(first, second);
  assert.equal(built, 1);
  await first.query("SELECT production_row");
  assert.equal(fake.executions.some((text) => text.includes("neon.branch_id")), false);
  assert.equal(fake.executions.includes("SELECT production_row"), true);
});

test("getSql on the protected Preview branch probes once per connection string", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = PREVIEW_DATABASE_GUARD_REF;
  const probes = new Map<string, number>();
  setSqlFactoryForTests(() => {
    return fakeClient({
      probe: () => {
        const key = process.env.DATABASE_URL ?? "";
        probes.set(key, (probes.get(key) ?? 0) + 1);
        return [goodRow()];
      },
    }).client;
  });
  process.env.DATABASE_URL = "postgres://one@localhost/neondb";
  const first = getSql();
  await first.query("SELECT a");
  await getSql().query("SELECT b");
  process.env.DATABASE_URL = "postgres://two@localhost/neondb";
  const second = getSql();
  assert.notEqual(first, second);
  await second.query("SELECT c");
  assert.equal(probes.get("postgres://one@localhost/neondb"), 1);
  assert.equal(probes.get("postgres://two@localhost/neondb"), 1);
});

test("getSql rejects an ambiguous Preview deployment before creating a client", () => {
  process.env.VERCEL_ENV = "preview";
  delete process.env.VERCEL_GIT_COMMIT_REF;
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  let built = 0;
  setSqlFactoryForTests(() => {
    built += 1;
    return fakeClient().client;
  });
  assert.throws(() => getSql(), (error: unknown) => {
    assert.ok(error instanceof PreviewDatabaseGuardError);
    assert.equal(error.category, "ambiguous-scope");
    assert.equal(error.message, PREVIEW_DATABASE_GUARD_ERROR);
    return true;
  });
  assert.equal(built, 0);
});

test("another Preview branch keeps the unguarded client", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "some-other-branch";
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = fakeClient();
  setSqlFactoryForTests(() => fake.client);
  await getSql().query("SELECT other_preview");
  assert.equal(fake.executions.some((text) => text.includes("neon.branch_id")), false);
  assert.equal(fake.executions.includes("SELECT other_preview"), true);
});
