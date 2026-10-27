import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertPathWithinProjectWorkspace, projectWorkspaceRoot } from "./project-workspace-guard";

test("MediMori worker cannot write Twilight Feather workspace via traversal", () => {
  const base = mkdtempSync(join(tmpdir(), "cam-ws-"));
  const medRoot = projectWorkspaceRoot("medimori", base);
  const tfRoot = projectWorkspaceRoot("twilight_feather", base);
  mkdirSync(medRoot, { recursive: true });
  mkdirSync(tfRoot, { recursive: true });
  writeFileSync(join(tfRoot, "secret.txt"), "tf-only", "utf8");

  const medFile = join(medRoot, "work.txt");
  writeFileSync(medFile, "ok", "utf8");
  assertPathWithinProjectWorkspace(medRoot, medFile);

  const escape = join(medRoot, "..", "twilight_feather", "secret.txt");
  assert.throws(() => assertPathWithinProjectWorkspace(medRoot, escape));
});

test("symlink escape outside project root is rejected", () => {
  const base = mkdtempSync(join(tmpdir(), "cam-ws-sym-"));
  const medRoot = projectWorkspaceRoot("medimori", base);
  const outside = join(base, "outside");
  mkdirSync(medRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "leak.txt"), "x", "utf8");
  const link = join(medRoot, "escape-link");
  try {
    symlinkSync(outside, link, "dir");
  } catch {
    test.skip("symlink not permitted on this host");
    return;
  }
  assert.throws(() => assertPathWithinProjectWorkspace(medRoot, join(link, "leak.txt")));
});
