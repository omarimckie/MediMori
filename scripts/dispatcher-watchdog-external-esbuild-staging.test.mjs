import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  assertEsbuildStagingRootSafe,
  computeSha512Base64,
  ESBUILD_LINUX_X64_TARBALL_SHA512_BASE64,
  ESBUILD_STAGING_ROOT_ENV,
  ESBUILD_STAGING_TARBALL_NAME,
  readAndVerifyEsbuildLinuxX64Tarball,
  resolveExternalEsbuildStagingRoot,
} from "./dispatcher-watchdog-external-esbuild-staging.mjs";
import {
  collectLinuxRunnerPackageClosure,
  stageOfflineNodeModules,
} from "./dispatcher-watchdog-runner-snapshot.mjs";
import { assertLinuxRunnerStagingReadiness } from "./dispatcher-watchdog-integration-wrapper-lib.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const verifiedAcquisitionRoot =
  process.env.TF_WATCHDOG_VERIFIED_ESBUILD_ROOT ??
  "C:\\Users\\napti\\AppData\\Local\\Temp\\tf-watchdog-esbuild-598065c96ca2";
const verifiedTarball = join(verifiedAcquisitionRoot, ESBUILD_STAGING_TARBALL_NAME);
const hasVerifiedTarball = existsSync(verifiedTarball);

describe("external esbuild linux-x64 staging", () => {
  it("requires MARKETING_DISPATCHER_WATCHDOG_ESBUILD_STAGING_ROOT for external native", () => {
    assert.equal(resolveExternalEsbuildStagingRoot({}), null);
  });

  it("rejects staging root inside repository", () => {
    assert.throws(
      () => assertEsbuildStagingRootSafe(repoRoot, repoRoot),
      /esbuild_staging_root_inside_repo/,
    );
  });

  it("rejects altered tarball integrity", () => {
    const root = mkdtempSync(join(tmpdir(), "wd-esbuild-bad-"));
    try {
      writeFileSync(join(root, ESBUILD_STAGING_TARBALL_NAME), Buffer.from("not-a-tarball"));
      assert.throws(
        () => readAndVerifyEsbuildLinuxX64Tarball(join(root, ESBUILD_STAGING_TARBALL_NAME)),
        /esbuild_staging_integrity_mismatch/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("re-verifies official tarball sha512 from verified acquisition root", { skip: !hasVerifiedTarball }, () => {
    const result = readAndVerifyEsbuildLinuxX64Tarball(verifiedTarball);
    assert.equal(result.integrityMatch, true);
    assert.equal(
      computeSha512Base64(result.buffer),
      ESBUILD_LINUX_X64_TARBALL_SHA512_BASE64,
    );
  });

  it("passes linux runner closure with external staging env without repo native package", { skip: !hasVerifiedTarball }, () => {
    const env = {
      [ESBUILD_STAGING_ROOT_ENV]: verifiedAcquisitionRoot,
    };
    const closure = collectLinuxRunnerPackageClosure(repoRoot, undefined, undefined, env);
    assert.ok(closure.includes("@esbuild/linux-x64"));
    assert.ok(closure.includes("esbuild"));
  });

  it("stages verified native package into disposable workspace node_modules", { skip: !hasVerifiedTarball }, () => {
    const env = { [ESBUILD_STAGING_ROOT_ENV]: verifiedAcquisitionRoot };
    const out = mkdtempSync(join(tmpdir(), "wd-runner-work-"));
    try {
      stageOfflineNodeModules(out, repoRoot, undefined, undefined, env);
      const staged = join(out, "node_modules", "@esbuild", "linux-x64", "package.json");
      assert.ok(staged);
      const pkg = JSON.parse(readFileSync(staged, "utf8"));
      assert.equal(pkg.version, "0.28.2");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("assertLinuxRunnerStagingReadiness passes with verified acquisition root", { skip: !hasVerifiedTarball }, () => {
    const env = { [ESBUILD_STAGING_ROOT_ENV]: verifiedAcquisitionRoot };
    const report = assertLinuxRunnerStagingReadiness(repoRoot, env);
    assert.equal(report.linuxRunnerStagingClosurePassed, true);
  });
});
