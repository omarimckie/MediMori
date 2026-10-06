import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyTargetAncestry } from "./lineage";

test("host-side lineage check proves ancestry locally and rejects unrelated history", async () => {
  const root = await mkdtemp(join(tmpdir(), "engineering-lineage-git-"));
  const runGit = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore", windowsHide: true });
  try {
    runGit(["init", "--initial-branch=main"]);
    runGit(["config", "user.name", "Engineering lineage test"]);
    runGit(["config", "user.email", "lineage@example.invalid"]);
    await writeFile(join(root, "baseline.txt"), "base\n");
    runGit(["add", "baseline.txt"]); runGit(["commit", "-m", "baseline"]);
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await verifyTargetAncestry(root, base);
    await writeFile(join(root, "followup.txt"), "child\n");
    runGit(["add", "followup.txt"]); runGit(["commit", "-m", "child"]);
    await verifyTargetAncestry(root, base);
    runGit(["checkout", "--orphan", "unrelated"]);
    runGit(["rm", "-rf", "."]);
    await writeFile(join(root, "other.txt"), "other root\n");
    runGit(["add", "other.txt"]); runGit(["commit", "-m", "unrelated"]);
    await assert.rejects(verifyTargetAncestry(root, base), /not proven/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host-side lineage validation rejects malformed or non-absolute inputs", async () => {
  await assert.rejects(verifyTargetAncestry("relative", "a".repeat(40)), /invalid/);
  await assert.rejects(verifyTargetAncestry(process.cwd(), "not-a-commit"), /invalid/);
});
