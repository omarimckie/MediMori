import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeImplementationSourceRevision, createApprovedExecutionExport, ApprovedSourceRevisionMismatch } from "./source-binding";
import { createFreshExport, exportedWorkspaceRevision } from "./workspace";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "engineering-source-binding-"));
  const source = join(root, "source"), exports = join(root, "exports");
  await mkdir(join(source, "docs"), { recursive: true });
  await mkdir(exports);
  await writeFile(join(source, "docs", "guide.md"), "Approved source text.\n");
  await writeFile(join(source, ".env.local"), "SYNTHETIC_SOURCE_SECRET=excluded\n");
  return { root, source, exports };
}

test("approved source export uses the canonical sanitized content revision and leaves it available for execution", async () => {
  const f = await fixture();
  try {
    const probe = await createFreshExport(f.source, f.exports);
    const revision = await exportedWorkspaceRevision(probe);
    await rm(probe, { recursive: true, force: true });
    const execution = await createApprovedExecutionExport(f.source, f.exports, revision, async () => { throw new Error("unexpected mismatch"); });
    assert.equal(execution.revision, revision);
    assert.equal(execution.revision, await exportedWorkspaceRevision(execution.exportRoot));
    assert.equal(await readFile(join(execution.exportRoot, "docs", "guide.md"), "utf8"), "Approved source text.\n");
    await assert.rejects(readFile(join(execution.exportRoot, ".env.local")), { code: "ENOENT" });
    await rm(execution.exportRoot, { recursive: true, force: true });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("source drift is durably diagnosed and the mismatched temporary export is cleaned before execution", async () => {
  const f = await fixture();
  let mismatchCalls = 0;
  let claimOrProviderCalls = 0;
  try {
    const approved = "0".repeat(40);
    await assert.rejects(async () => {
      const execution = await createApprovedExecutionExport(f.source, f.exports, approved, async actual => {
        mismatchCalls++;
        assert.match(actual, /^[a-f0-9]{40}$/);
      });
      // The production entrypoint only enters runWorker after this resolves.
      claimOrProviderCalls++;
      await rm(execution.exportRoot, { recursive: true, force: true });
    }, ApprovedSourceRevisionMismatch);
    assert.equal(mismatchCalls, 1);
    assert.equal(claimOrProviderCalls, 0);
    assert.deepEqual(await (await import("node:fs/promises")).readdir(f.exports), []);
    const workerEntry = await readFile(new URL("../../../scripts/engineering-worker.ts", import.meta.url), "utf8");
    assert.ok(workerEntry.indexOf("await createApprovedExecutionExport(") < workerEntry.indexOf("runWorker(ingress"), "the production entrypoint verifies S before runWorker can claim");
    assert.ok(workerEntry.indexOf("await createApprovedExecutionExport(") < workerEntry.indexOf("DockerWorkspace.create("), "the production entrypoint verifies S before creating owned Docker resources");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("same approved revision proceeds and a changed source is never accepted under that approval", async () => {
  const f = await fixture();
  try {
    const probe = await createFreshExport(f.source, f.exports);
    const approvedRevision = await exportedWorkspaceRevision(probe);
    await rm(probe, { recursive: true, force: true });
    const same = await createApprovedExecutionExport(f.source, f.exports, approvedRevision, async () => { throw new Error("unexpected mismatch"); });
    assert.equal(same.revision, approvedRevision);
    await rm(same.exportRoot, { recursive: true, force: true });
    await writeFile(join(f.source, "docs", "guide.md"), "Changed source text.\n");
    await assert.rejects(createApprovedExecutionExport(f.source, f.exports, approvedRevision, async actual => {
      assert.notEqual(actual, approvedRevision);
    }), ApprovedSourceRevisionMismatch);
    assert.deepEqual(await (await import("node:fs/promises")).readdir(f.exports), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("preparation source revision uses the canonical sanitizer and removes its temporary export", async () => {
  const f = await fixture();
  try {
    const revision = await computeImplementationSourceRevision(f.source, f.exports);
    const probe = await createFreshExport(f.source, f.exports);
    assert.equal(revision, await exportedWorkspaceRevision(probe));
    await rm(probe, { recursive: true, force: true });
    assert.deepEqual(await (await import("node:fs/promises")).readdir(f.exports), []);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
