import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { RUNNER_SOURCE_ALLOWLIST } from "./dispatcher-watchdog-runner-snapshot.mjs";
import {
  APPROVED_INTEGRATION_POSTGRES_IMAGE_REF,
  assertAllowlistCommittedAtHead,
  assertGitPreflight,
  assertPinnedImageReference,
  EXPECTED_REPO_ROOT,
  INTEGRATION_REPOSITORY_MARKERS,
  runIntegrationGit,
  validateIntegrationRepositoryRoot,
} from "./dispatcher-watchdog-integration-wrapper-lib.mjs";

function seedMinimalIntegrationRepo(dir) {
  const paths = [...new Set([...INTEGRATION_REPOSITORY_MARKERS, ...RUNNER_SOURCE_ALLOWLIST])];
  for (const rel of paths) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, rel.endsWith(".json") ? "{}\n" : "// harness\n");
  }
  execSync("git init -b main", { cwd: dir, stdio: "ignore" });
  execSync("git add -A", { cwd: dir, stdio: "ignore" });
  execSync('git -c user.email=t@test -c user.name=t commit -m "harness"', { cwd: dir, stdio: "ignore" });
}

function gitIn(dir, ...args) {
  execSync(["git", ...args].join(" "), { cwd: dir, stdio: "ignore" });
}

function currentRepoHead(repoRoot = EXPECTED_REPO_ROOT) {
  return execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
}

function integrationHarnessDirtyVsHead(repoRoot = EXPECTED_REPO_ROOT) {
  return INTEGRATION_REPOSITORY_MARKERS.some((rel) => {
    const dirty = execSync(`git diff --name-only HEAD -- "${rel}"`, {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const staged = execSync(`git diff --name-only --cached -- "${rel}"`, {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    return Boolean(dirty || staged);
  });
}

describe("integration git preflight (B2.1)", () => {
  it("accepts the current harness HEAD without a pinned EXPECTED_HEAD sha", () => {
    const head = currentRepoHead();
    if (integrationHarnessDirtyVsHead()) {
      assert.throws(() => assertGitPreflight(EXPECTED_REPO_ROOT), /integration_git_harness_dirty:/);
      return;
    }
    const report = assertGitPreflight(EXPECTED_REPO_ROOT);
    assert.equal(report.head, head);
    assert.equal(report.repoRoot, execSync("git rev-parse --show-toplevel", {
      cwd: EXPECTED_REPO_ROOT,
      encoding: "utf8",
    }).trim());
  });

  it("does not embed a single hard-coded integration HEAD constant", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./dispatcher-watchdog-integration-wrapper-lib.mjs", import.meta.url)),
      "utf8",
    );
    assert.doesNotMatch(src, /EXPECTED_HEAD\s*=\s*"[a-f0-9]{40}"/);
    assert.doesNotMatch(
      readFileSync(
        fileURLToPath(new URL("./run-dispatcher-watchdog-postgres-integration.ps1", import.meta.url)),
        "utf8",
      ),
      /a95a8c5d27dfe2cf954ebd60a78189743d6aa70a/,
    );
  });

  it("rejects a non-integration directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-invalid-"));
    try {
      assert.equal(validateIntegrationRepositoryRoot(dir), false);
      assert.throws(() => assertGitPreflight(dir), /integration_repository_root_invalid/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a directory that is not a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-norepo-"));
    try {
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(
        join(dir, "scripts/dispatcher-watchdog-integration-wrapper-lib.mjs"),
        "// stub\n",
      );
      writeFileSync(
        join(dir, "scripts/run-dispatcher-watchdog-postgres-integration.ps1"),
        "# stub\n",
      );
      assert.throws(() => assertGitPreflight(dir), /integration_git_command_failed|integration_git_not_a_repository/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves digest-pinned Docker image contract", () => {
    assert.match(APPROVED_INTEGRATION_POSTGRES_IMAGE_REF, /^postgres@sha256:[a-f0-9]{64}$/i);
    assert.throws(
      () => assertPinnedImageReference("postgres:16", "postgres"),
      /integration_image_digest_missing/,
    );
  });

  it("runIntegrationGit succeeds on the validated harness checkout", () => {
    const head = String(runIntegrationGit(EXPECTED_REPO_ROOT, ["rev-parse", "HEAD"])).trim();
    assert.equal(head, currentRepoHead());
  });
});

describe("integration git preflight synthetic repos", () => {
  it("accepts a subsequent commit without changing harness source constants", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-second-commit-"));
    try {
      seedMinimalIntegrationRepo(dir);
      const first = assertGitPreflight(dir);
      writeFileSync(join(dir, "package.json"), '{"next":true}\n');
      gitIn(dir, "-c", "user.email=t@test", "-c", "user.name=t", "add", "package.json");
      gitIn(dir, "-c", "user.email=t@test", "-c", "user.name=t", "commit", "-m", "next");
      const second = assertGitPreflight(dir);
      assert.notEqual(second.head, first.head);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unstaged dirty allowlist paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-dirty-"));
    try {
      seedMinimalIntegrationRepo(dir);
      writeFileSync(join(dir, "package.json"), '{"dirty":true}\n');
      assert.throws(() => assertAllowlistCommittedAtHead(dir), /integration_git_allowlist_dirty:package\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unstaged dirty executable harness paths outside the runner allowlist", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-harness-dirty-"));
    try {
      seedMinimalIntegrationRepo(dir);
      writeFileSync(
        join(dir, "scripts/dispatcher-watchdog-integration-wrapper-lib.mjs"),
        "// tampered harness\n",
      );
      assert.throws(() => assertGitPreflight(dir), /integration_git_harness_dirty:scripts\/dispatcher-watchdog-integration-wrapper-lib\.mjs/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects staged allowlist changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-staged-"));
    try {
      seedMinimalIntegrationRepo(dir);
      writeFileSync(join(dir, "package.json"), '{"staged":true}\n');
      gitIn(dir, "add", "package.json");
      assert.throws(() => assertAllowlistCommittedAtHead(dir), /integration_git_allowlist_dirty:package\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects allowlist paths missing at HEAD", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-missing-allowlist-"));
    try {
      seedMinimalIntegrationRepo(dir);
      gitIn(dir, "rm", "package.json");
      gitIn(dir, "-c", "user.email=t@test", "-c", "user.name=t", "commit", "-m", "drop");
      assert.throws(() => assertAllowlistCommittedAtHead(dir), /integration_git_allowlist_missing_at_head:package\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-main checked-out branches", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-branch-"));
    try {
      seedMinimalIntegrationRepo(dir);
      gitIn(dir, "checkout", "-b", "feature");
      assert.throws(() => assertGitPreflight(dir), /integration_git_branch_mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects runIntegrationGit on paths that fail harness marker validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-untrusted-"));
    try {
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "scripts/dispatcher-watchdog-integration-wrapper-lib.mjs"), "// partial\n");
      assert.throws(
        () => runIntegrationGit(dir, ["rev-parse", "HEAD"]),
        /integration_repository_root_invalid/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("surfaces git command failures instead of misinterpreting output", () => {
    const dir = mkdtempSync(join(tmpdir(), "wd-git-bad-cmd-"));
    try {
      seedMinimalIntegrationRepo(dir);
      assert.throws(
        () => runIntegrationGit(dir, ["not-a-real-git-subcommand"]),
        /integration_git_command_failed:not-a-real-git-subcommand/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
