import test from "node:test";
import assert from "node:assert/strict";
import { mergeExecutorArgs, mergeExecutorChildEnvironment } from "./engineering-merge-executor-launch.mjs";

test("merge launcher validates approval IDs and uses file-URL preload on Windows", () => {
  assert.throws(() => mergeExecutorArgs("not-an-id"));
  const args = mergeExecutorArgs("b61b0dc7-d1ab-45ea-88c0-6480cda5029a");
  assert.equal(args[0], "--env-file=.env.engineering-merge.local");
  assert.match(args[1], /^--import=file:/);
  assert.equal(args[2], "--require=tsx/cjs");
  assert.equal(args[3], "scripts/engineering-merge-executor.ts");
});

test("merge child drops worker, provider, app-admin, and GitHub token environment", () => {
  const child = mergeExecutorChildEnvironment({
    ENGINEERING_WORKER_ENABLED: "true", DATABASE_URL: "database-secret", ENGINEERING_WORKER_DATABASE_URL: "worker-secret",
    OPENAI_API_KEY: "provider-secret", ADMIN_USERS: "admin-secret", ADMIN_SESSION_SECRET: "session-secret",
    GITHUB_TOKEN: "github-secret", GH_TOKEN: "gh-secret", ENGINEERING_MERGE_DATABASE_URL: "merge-db-secret",
    ENGINEERING_MERGE_ENABLED: "true",
  });
  assert.equal(child.ENGINEERING_WORKER_ENABLED, "false");
  for (const key of ["DATABASE_URL", "ENGINEERING_WORKER_DATABASE_URL", "OPENAI_API_KEY", "ADMIN_USERS", "ADMIN_SESSION_SECRET", "GITHUB_TOKEN", "GH_TOKEN"]) assert.equal(key in child, false);
  assert.equal(child.ENGINEERING_MERGE_DATABASE_URL, "merge-db-secret");
  assert.equal(child.ENGINEERING_MERGE_ENABLED, "true");
});
