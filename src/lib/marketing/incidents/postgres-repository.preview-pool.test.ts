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
  createPostgresIncidentRepository,
  resetIncidentPoolForTests,
  setIncidentPoolFactoryForTests,
} from "./postgres-repository";

const ORIGINAL_ENV = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  DATABASE_URL: process.env.DATABASE_URL,
};

afterEach(() => {
  restoreEnv();
  resetIncidentPoolForTests();
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

function harness(options?: { probe?: () => unknown; reuse?: boolean }) {
  const log: Entry[] = [];
  const releases: number[] = [];
  let connects = 0;
  let nextId = 1;
  let held: { id: number } | null = null;
  let checkedOut = false;

  function makeClient(id: number) {
    return {
      id,
      async query(text: string) {
        log.push({ clientId: id, text });
        if (!isProbe(text)) return { rows: [], rowCount: 0 };
        const body = options?.probe ? await options.probe() : [goodRow()];
        return { rows: Array.isArray(body) ? body : [body], rowCount: 1 };
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
        checkedOut = true;
        return held;
      }
      const client = makeClient(nextId++);
      held = client;
      checkedOut = true;
      return client;
    },
  };

  setIncidentPoolFactoryForTests(() => pool as unknown as Pool);
  return { log, releases, connects: () => connects, checkedOut: () => checkedOut };
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
    return true;
  });
}

function texts(log: Entry[]) {
  return log.map((entry) => entry.text);
}

async function lookup(dedupeKey: string) {
  return createPostgresIncidentRepository().findByDedupeKeyForUpdate(dedupeKey);
}

test("matching identity allows the incident query on the probed connection", async () => {
  protect();
  const fake = harness();
  const row = await lookup("dedupe-1");
  assert.equal(row, null);
  assert.equal(new Set(fake.log.map((entry) => entry.clientId)).size, 1);
  assert.equal(isProbe(texts(fake.log)[0] ?? ""), true);
  assert.equal(texts(fake.log)[1], "BEGIN");
  assert.match(texts(fake.log)[2] ?? "", /FOR UPDATE/);
  assert.equal(texts(fake.log)[3], "COMMIT");
  assert.deepEqual(fake.releases, [1]);
});

test("wrong user rejects before the incident query", async () => {
  protect();
  const fake = harness({ probe: () => [goodRow({ current_user: "neondb_owner" })] });
  await expectGuard(() => lookup("dedupe-1"), "mismatch");
  assert.equal(texts(fake.log).some((text) => text.includes("FOR UPDATE")), false);
  assert.equal(texts(fake.log).includes("BEGIN"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("wrong database rejects before the incident query", async () => {
  protect();
  const fake = harness({ probe: () => [goodRow({ current_database: "other" })] });
  await expectGuard(() => lookup("dedupe-1"), "mismatch");
  assert.equal(texts(fake.log).includes("BEGIN"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("wrong Neon branch rejects before the incident query", async () => {
  protect();
  const fake = harness({ probe: () => [goodRow({ neon_branch_id: "br-other" })] });
  await expectGuard(() => lookup("dedupe-1"), "mismatch");
  assert.equal(texts(fake.log).some((text) => text.includes("FOR UPDATE")), false);
});

test("wrong Neon project rejects before the incident query", async () => {
  protect();
  const fake = harness({ probe: () => [goodRow({ neon_project_id: "other-project" })] });
  await expectGuard(() => lookup("dedupe-1"), "mismatch");
  assert.equal(texts(fake.log).includes("BEGIN"), false);
});

test("INSERT permission rejects before the incident query", async () => {
  protect();
  const fake = harness({
    probe: () => [goodRow({ marketing_content_insert_allowed: true })],
  });
  await expectGuard(() => lookup("dedupe-1"), "mismatch");
  assert.equal(texts(fake.log).includes("BEGIN"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("missing metadata rejects before the incident query", async () => {
  protect();
  const fake = harness({ probe: () => [{ current_user: PREVIEW_DB_EXPECTED_USER }] });
  await expectGuard(() => lookup("dedupe-1"), "mismatch");
  assert.equal(texts(fake.log).includes("BEGIN"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("probe failure rejects before the incident query", async () => {
  protect();
  const fake = harness({
    probe: () => {
      throw new Error("driver postgres://user:secret@example/neondb");
    },
  });
  await expectGuard(() => lookup("dedupe-1"), "probe-failed");
  assert.equal(texts(fake.log).includes("ROLLBACK"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("probe timeout rejects before the incident query", async () => {
  protect();
  setPreviewPoolProbeTimeoutForTests(20);
  let late: (value: unknown) => void = () => {};
  const fake = harness({
    probe: () =>
      new Promise((resolve) => {
        late = resolve;
      }),
  });
  await expectGuard(() => lookup("dedupe-1"), "timeout");
  late([goodRow()]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(texts(fake.log).some((text) => !isProbe(text)), false);
  assert.deepEqual(fake.releases, [1]);
});

test("two concurrent incident lookups probe independently", async () => {
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
  const first = lookup("one");
  const second = lookup("two");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(probes, 2);
  assert.equal(texts(fake.log).some((text) => text.includes("FOR UPDATE")), false);
  assert.equal(texts(fake.log).includes("BEGIN"), false);
  release([goodRow()]);
  await Promise.all([first, second]);
  const updates = fake.log.filter((entry) => entry.text.includes("FOR UPDATE"));
  assert.equal(updates.length, 2);
  assert.notEqual(updates[0]?.clientId, updates[1]?.clientId);
  assert.equal(fake.releases.length, 2);
});

test("two incident connections are verified separately", async () => {
  protect();
  const fake = harness();
  await lookup("one");
  await lookup("two");
  assert.equal(texts(fake.log).filter(isProbe).length, 2);
  const updates = fake.log.filter((entry) => entry.text.includes("FOR UPDATE"));
  assert.notEqual(updates[0]?.clientId, updates[1]?.clientId);
});

test("incident transaction statements stay on the verified connection", async () => {
  protect();
  const fake = harness();
  await lookup("dedupe-1");
  const id = fake.log[0]?.clientId;
  assert.ok(fake.log.every((entry) => entry.clientId === id));
  assert.deepEqual(
    texts(fake.log).map((text) => (isProbe(text) ? "probe" : text.includes("FOR UPDATE") ? "LOCK" : text)),
    ["probe", "BEGIN", "LOCK", "COMMIT"],
  );
});

test("a failed incident probe does not authorize a later query", async () => {
  protect();
  let attempt = 0;
  const fake = harness({
    probe: () => {
      attempt += 1;
      if (attempt === 1) throw new Error("temporary failure");
      return [goodRow()];
    },
  });
  await expectGuard(() => lookup("dedupe-1"), "probe-failed");
  await lookup("dedupe-1");
  assert.equal(attempt, 2);
  assert.equal(texts(fake.log).filter((text) => text.includes("FOR UPDATE")).length, 1);
});

test("a released incident connection cannot inherit an earlier verification", async () => {
  protect();
  const fake = harness({ reuse: true });
  await lookup("one");
  await lookup("two");
  assert.equal(texts(fake.log).filter(isProbe).length, 2);
  assert.equal(new Set(fake.log.map((entry) => entry.clientId)).size, 1);
  assert.deepEqual(fake.releases, [1, 1]);
});

test("an incident application failure rolls back and releases the client", async () => {
  protect();
  const fake = harness({
    probe: () => [goodRow()],
  });
  const repo = createPostgresIncidentRepository();
  await assert.rejects(
    () =>
      repo.runTransaction(async () => {
        throw new Error("incident app failed");
      }),
    /incident app failed/,
  );
  assert.equal(texts(fake.log).at(-1), "ROLLBACK");
  assert.equal(texts(fake.log).includes("COMMIT"), false);
  assert.deepEqual(fake.releases, [1]);
});

test("Production does not invoke the incident Preview guard", async () => {
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_GIT_COMMIT_REF = "main";
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = harness();
  await lookup("dedupe-1");
  await assert.rejects(
    () =>
      createPostgresIncidentRepository().runTransaction(async () => {
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.equal(texts(fake.log).some(isProbe), false);
  assert.equal(texts(fake.log).includes("BEGIN"), true);
  assert.equal(texts(fake.log).at(-1), "ROLLBACK");
});

test("another Preview branch does not invoke the incident guard", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "some-other-branch";
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = harness();
  await lookup("dedupe-1");
  assert.equal(texts(fake.log).some(isProbe), false);
  assert.equal(texts(fake.log).some((text) => text.includes("FOR UPDATE")), true);
});

test("ambiguous Preview identity does not open an incident connection", async () => {
  process.env.VERCEL_ENV = "preview";
  delete process.env.VERCEL_GIT_COMMIT_REF;
  process.env.DATABASE_URL = "postgres://user@localhost/neondb";
  const fake = harness();
  await expectGuard(() => lookup("dedupe-1"), "ambiguous-scope");
  assert.equal(fake.connects(), 0);
  assert.equal(fake.log.length, 0);
});

test("incident pool module has no direct checkout outside the guard", () => {
  const source = readFileSync(new URL("./postgres-repository.ts", import.meta.url), "utf8");
  assert.match(source, /connectPreviewAwarePoolClient\(/);
  assert.equal(source.match(/\.connect\(/g)?.length, 1);
  assert.match(source, /connect: \(\) => getIncidentPool\(\)\.connect\(\)/);
  assert.equal(source.includes("export function getIncidentPool"), false);
});
