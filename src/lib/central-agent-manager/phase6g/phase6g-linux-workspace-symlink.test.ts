import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertPathWithinProjectWorkspace, projectWorkspaceRoot } from "../phase6e/project-workspace-guard";

const linuxSymlinkTest =
  process.platform === "linux" ? test : test.skip.bind(test);

linuxSymlinkTest("Linux NUC13 required: symlink escape rejected", () => {
  const base = mkdtempSync(join(tmpdir(), "cam-linux-ws-"));
  const medRoot = projectWorkspaceRoot("medimori", base);
  const outside = join(base, "outside");
  mkdirSync(medRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "leak.txt"), "x", "utf8");
  symlinkSync(outside, join(medRoot, "escape-link"), "dir");
  assert.throws(() => assertPathWithinProjectWorkspace(medRoot, join(medRoot, "escape-link", "leak.txt")));
});
