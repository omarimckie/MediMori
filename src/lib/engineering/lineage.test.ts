import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readTargetRefSha, TargetAncestryError, verifyTargetAncestryInIsolatedGraph } from "./merge-target";
import { computeImplementationSourceRevision } from "./source-binding";

async function gitRepository() {
  const root = await mkdtemp(join(tmpdir(), "engineering-target-graph-"));
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore", windowsHide: true });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Engineering target test"]);
  git(["config", "user.email", "target@example.invalid"]);
  await writeFile(join(root, "README.md"), "baseline\n");
  git(["add", "README.md"]); git(["commit", "-m", "target baseline"]);
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  await writeFile(join(root, "followup.md"), "followup\n");
  git(["add", "followup.md"]); git(["commit", "-m", "target followup"]);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return { root, git, base, head };
}

function localGitEnvironment(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "test", GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function resolvedMainSha(repositoryUrl: string, cwd: string, env: NodeJS.ProcessEnv) {
  const output = execFileSync("git", ["ls-remote", "--exit-code", repositoryUrl, "refs/heads/main"], { cwd, env, encoding: "utf8", windowsHide: true });
  return output.trim().split(/\s+/)[0];
}

async function withHostGitConfig(overrides: Record<string, string | undefined>, action: () => Promise<void>) {
  const keys = Object.keys(overrides);
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await action(); }
  finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function writeInsteadOfConfig(configPath: string, approvedUrl: string, maliciousUrl: string) {
  await writeFile(configPath, `[url "${maliciousUrl}"]\n\tinsteadOf = ${approvedUrl}\n`);
}

test("isolated target graph verifies ancestry when the target object is absent from the implementation checkout", async () => {
  const target = await gitRepository();
  const implementation = await gitRepository();
  const exportContainer = await mkdtemp(join(tmpdir(), "engineering-target-s-revision-"));
  try {
    implementation.git(["checkout", "--orphan", "candidate-platform"]);
    implementation.git(["rm", "-rf", "."]);
    await writeFile(join(implementation.root, "platform.ts"), "export {};\n");
    implementation.git(["add", "platform.ts"]); implementation.git(["commit", "-m", "candidate platform"]);
    const exportParent = join(exportContainer, "exports");
    const graphScratch = join(exportContainer, "git-temporary");
    await mkdir(exportParent);
    await mkdir(graphScratch);
    const sourceRevisionBefore = await computeImplementationSourceRevision(implementation.root, exportParent);
    const beforeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: implementation.root, encoding: "utf8" }).trim();
    const beforeStatus = execFileSync("git", ["status", "--porcelain"], { cwd: implementation.root, encoding: "utf8" });

    const result = await verifyTargetAncestryInIsolatedGraph(target.base, target.head, target.root, "main", graphScratch);
    assert.deepEqual(result, { verified: true, targetBaseSha: target.base, currentTargetSha: target.head });
    assert.deepEqual(await (await import("node:fs/promises")).readdir(graphScratch), [], "owned isolated graph is removed after verification");
    assert.equal(await computeImplementationSourceRevision(implementation.root, exportParent), sourceRevisionBefore, "target verification must not alter S");
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: implementation.root, encoding: "utf8" }).trim(), beforeHead);
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: implementation.root, encoding: "utf8" }), beforeStatus);
    assert.notEqual(spawnSync("git", ["cat-file", "-e", `${target.base}^{commit}`], { cwd: implementation.root, stdio: "ignore", windowsHide: true }).status, 0);
  } finally {
    await Promise.all([rm(target.root, { recursive: true, force: true }), rm(implementation.root, { recursive: true, force: true }), rm(exportContainer, { recursive: true, force: true })]);
  }
});

test("global insteadOf rewrite is ignored by target resolution and ancestry verification", async () => {
  const approved = await gitRepository();
  const malicious = await gitRepository();
  const scratch = await mkdtemp(join(tmpdir(), "engineering-git-config-global-"));
  const approvedUrl = pathToFileURL(approved.root).href;
  const maliciousUrl = pathToFileURL(malicious.root).href;
  const globalConfig = join(scratch, "malicious-global.gitconfig");
  const controlledEmptySystemConfig = join(scratch, "empty-system.gitconfig");
  try {
    await writeInsteadOfConfig(globalConfig, approvedUrl, maliciousUrl);
    await writeFile(controlledEmptySystemConfig, "");
    const hostileEnv = localGitEnvironment({ GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: controlledEmptySystemConfig });
    assert.equal(resolvedMainSha(approvedUrl, scratch, hostileEnv), malicious.head, "the test config must actually rewrite the approved URL");

    await withHostGitConfig({ GIT_CONFIG_NOSYSTEM: "0", GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: controlledEmptySystemConfig }, async () => {
      assert.equal(await readTargetRefSha(approvedUrl, "main", scratch), approved.head);
      const verified = await verifyTargetAncestryInIsolatedGraph(approved.base, approved.head, approvedUrl, "main", scratch);
      assert.equal(verified.verified, true);
    });
    assert.deepEqual(await (await import("node:fs/promises")).readdir(scratch), ["empty-system.gitconfig", "malicious-global.gitconfig"]);
  } finally {
    await Promise.all([rm(approved.root, { recursive: true, force: true }), rm(malicious.root, { recursive: true, force: true }), rm(scratch, { recursive: true, force: true })]);
  }
});

test("system insteadOf rewrite is ignored without changing host system configuration", async () => {
  const approved = await gitRepository();
  const malicious = await gitRepository();
  const scratch = await mkdtemp(join(tmpdir(), "engineering-git-config-system-"));
  const approvedUrl = pathToFileURL(approved.root).href;
  const maliciousUrl = pathToFileURL(malicious.root).href;
  const systemConfig = join(scratch, "simulated-system.gitconfig");
  const controlledEmptyGlobalConfig = join(scratch, "empty-global.gitconfig");
  try {
    await writeInsteadOfConfig(systemConfig, approvedUrl, maliciousUrl);
    await writeFile(controlledEmptyGlobalConfig, "");
    const hostileEnv = localGitEnvironment({ GIT_CONFIG_NOSYSTEM: "0", GIT_CONFIG_GLOBAL: controlledEmptyGlobalConfig, GIT_CONFIG_SYSTEM: systemConfig });
    assert.equal(resolvedMainSha(approvedUrl, scratch, hostileEnv), malicious.head, "the simulated system config must actually rewrite the approved URL");

    await withHostGitConfig({ GIT_CONFIG_NOSYSTEM: "0", GIT_CONFIG_GLOBAL: controlledEmptyGlobalConfig, GIT_CONFIG_SYSTEM: systemConfig }, async () => {
      assert.equal(await readTargetRefSha(approvedUrl, "main", scratch), approved.head);
      const verified = await verifyTargetAncestryInIsolatedGraph(approved.base, approved.head, approvedUrl, "main", scratch);
      assert.equal(verified.verified, true);
    });
  } finally {
    await Promise.all([rm(approved.root, { recursive: true, force: true }), rm(malicious.root, { recursive: true, force: true }), rm(scratch, { recursive: true, force: true })]);
  }
});

test("isolated target graph rejects a genuine non-ancestor with a bounded classification", async () => {
  const target = await gitRepository();
  try {
    target.git(["branch", "preserved-target", "main"]);
    target.git(["checkout", "--orphan", "unrelated"]);
    target.git(["rm", "-rf", "."]);
    await writeFile(join(target.root, "other.md"), "unrelated root\n");
    target.git(["add", "other.md"]); target.git(["commit", "-m", "unrelated root"]);
    const unrelated = execFileSync("git", ["rev-parse", "HEAD"], { cwd: target.root, encoding: "utf8" }).trim();
    target.git(["branch", "-f", "main", unrelated]);
    await assert.rejects(verifyTargetAncestryInIsolatedGraph(target.base, unrelated, target.root), error => error instanceof TargetAncestryError && error.code === "target_not_ancestor");
  } finally { await rm(target.root, { recursive: true, force: true }); }
});

test("isolated target graph distinguishes an unavailable approved commit without guessing why fetch failed", async () => {
  const target = await gitRepository();
  try {
    const missing = "f".repeat(40);
    await assert.rejects(verifyTargetAncestryInIsolatedGraph(missing, target.head, target.root), error => error instanceof TargetAncestryError && error.code === "target_fetch_failed");
  } finally { await rm(target.root, { recursive: true, force: true }); }
});

test("incomplete shallow remote history fails closed when the approved base cannot be verified", async () => {
  const target = await gitRepository();
  const shallowRemote = await mkdtemp(join(tmpdir(), "engineering-target-shallow-remote-"));
  try {
    execFileSync("git", ["clone", "--bare", "--depth=1", pathToFileURL(target.root).href, shallowRemote], { stdio: "ignore", windowsHide: true });
    await assert.rejects(
      verifyTargetAncestryInIsolatedGraph(target.base, target.head, pathToFileURL(shallowRemote).href),
      error => error instanceof TargetAncestryError && error.code === "target_fetch_failed",
    );
  } finally { await Promise.all([rm(target.root, { recursive: true, force: true }), rm(shallowRemote, { recursive: true, force: true })]); }
});

test("isolated target graph fails closed if the target ref changes between resolution and fetch", async () => {
  const target = await gitRepository();
  try {
    const wrongResolution = "0".repeat(40);
    await assert.rejects(verifyTargetAncestryInIsolatedGraph(target.base, wrongResolution, target.root), error => error instanceof TargetAncestryError && error.code === "target_ref_changed");
  } finally { await rm(target.root, { recursive: true, force: true }); }
});
