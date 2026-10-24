import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertAllowlistPathSafe,
  collectLinuxRunnerPackageClosure,
  collectOfflinePackageClosure,
  esbuildNativePackageForTarget,
  inspectLinuxRunnerDependencyReadiness,
  isHostOnlyNativePackageName,
  OFFLINE_RUNNER_TARGET,
  packageMetadataMatchesTarget,
  RUNNER_SOURCE_ALLOWLIST,
  stageOfflineNodeModules,
  validateTargetNativePackage,
} from "./dispatcher-watchdog-runner-snapshot.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const target = OFFLINE_RUNNER_TARGET;

function writePkg(root, name, manifest) {
  const dir = name.startsWith("@")
    ? join(root, "node_modules", ...name.split("/"))
    : join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  if (name === "@esbuild/linux-x64") {
    mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(join(dir, "bin", "esbuild"), "#!/bin/sh\n");
  }
}

function makeFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "wd-native-"));
}

describe("linux runner native dependency compatibility", () => {
  it("accepts pure JavaScript dependencies", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        dependencies: { pure: "1.0.0" },
      });
      writePkg(root, "pure", { name: "pure", version: "1.0.0" });
      const closure = collectLinuxRunnerPackageClosure(root, ["root"]);
      assert.deepEqual(closure, ["pure", "root"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts correct linux amd64 esbuild native package", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", { name: "root", version: "1.0.0", dependencies: { tsx: "1.0.0" } });
      writePkg(root, "tsx", { name: "tsx", version: "1.0.0", dependencies: { esbuild: "1.0.0" } });
      writePkg(root, "esbuild", { name: "esbuild", version: "1.0.0" });
      writePkg(root, "@esbuild/linux-x64", {
        name: "@esbuild/linux-x64",
        version: "1.0.0",
        os: ["linux"],
        cpu: ["x64"],
      });
      const closure = collectLinuxRunnerPackageClosure(root, ["root"]);
      assert.ok(closure.includes("@esbuild/linux-x64"));
      assert.ok(closure.includes("esbuild"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing linux amd64 esbuild native package", () => {
    const stagingEnvKey = "MARKETING_DISPATCHER_WATCHDOG_ESBUILD_STAGING_ROOT";
    const hadStagingEnv = Object.prototype.hasOwnProperty.call(process.env, stagingEnvKey);
    const originalStagingRoot = process.env[stagingEnvKey];
    const root = makeFixtureRoot();
    try {
      delete process.env[stagingEnvKey];
      writePkg(root, "root", { name: "root", version: "1.0.0", dependencies: { esbuild: "1.0.0" } });
      writePkg(root, "esbuild", { name: "esbuild", version: "1.0.0" });
      assert.throws(
        () => collectLinuxRunnerPackageClosure(root, ["root"]),
        /linux_runner_native_missing:@esbuild\/linux-x64/,
      );
    } finally {
      if (hadStagingEnv) {
        process.env[stagingEnvKey] = originalStagingRoot;
      } else {
        delete process.env[stagingEnvKey];
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects windows-only native package for linux staging metadata", () => {
    assert.equal(
      packageMetadataMatchesTarget({ os: ["win32"], cpu: ["x64"] }, target),
      false,
    );
    assert.equal(isHostOnlyNativePackageName("@esbuild/win32-x64", target), true);
  });

  it("rejects wrong native package version", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "esbuild", { name: "esbuild", version: "2.0.0" });
      writePkg(root, "@esbuild/linux-x64", {
        name: "@esbuild/linux-x64",
        version: "1.0.0",
        os: ["linux"],
        cpu: ["x64"],
      });
      assert.throws(
        () =>
          validateTargetNativePackage(
            root,
            {
              name: "@esbuild/linux-x64",
              expectedVersion: "2.0.0",
              requiredFor: "esbuild",
            },
            target,
          ),
        /linux_runner_native_version_mismatch/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still omits macOS-only fsevents safely", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        optionalDependencies: { fsevents: "1.0.0" },
      });
      writePkg(root, "fsevents", { name: "fsevents", version: "1.0.0", os: ["darwin"] });
      const closure = collectOfflinePackageClosure(root, ["root"]);
      assert.deepEqual(closure, ["root"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps mandatory missing dependency fatal", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        dependencies: { required_missing: "1.0.0" },
      });
      assert.throws(
        () => collectLinuxRunnerPackageClosure(root, ["root"]),
        /offline_dependency_missing:required_missing/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deduplicates shared dependencies deterministically", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        dependencies: { a: "1.0.0", b: "1.0.0" },
      });
      writePkg(root, "a", { name: "a", version: "1.0.0", dependencies: { shared: "1.0.0" } });
      writePkg(root, "b", { name: "b", version: "1.0.0", dependencies: { shared: "1.0.0" } });
      writePkg(root, "shared", { name: "shared", version: "1.0.0" });
      const first = collectOfflinePackageClosure(root, ["root"]);
      const second = collectOfflinePackageClosure(root, ["root"]);
      assert.deepEqual(first, second);
      assert.deepEqual(first, ["a", "b", "root", "shared"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves allowlist and rejects traversal", () => {
    assert.throws(() => assertAllowlistPathSafe("../package.json"), /traversal/);
    assert.ok(RUNNER_SOURCE_ALLOWLIST.includes("package.json"));
  });

  it("does not provide install fallback in staging", () => {
    const root = makeFixtureRoot();
    const out = makeFixtureRoot();
    try {
      writePkg(root, "esbuild", { name: "esbuild", version: "1.0.0" });
      assert.throws(
        () => stageOfflineNodeModules(out, root, target, ["esbuild"], {}),
        /linux_runner_native_missing/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("reports host closure passed separately from linux runner closure on real repo", () => {
    const report = inspectLinuxRunnerDependencyReadiness(repoRoot, undefined, undefined, {});
    assert.equal(report.hostJavaScriptClosurePassed, true);
    assert.equal(report.linuxRunnerClosurePassed, false);
    assert.match(report.linuxRunnerClosureError ?? "", /linux_runner_native_missing:@esbuild\/linux-x64/);
    assert.equal(report.targetNativePackage, "@esbuild/linux-x64");
    assert.equal(report.targetNativeInstalled, false);
    assert.equal(esbuildNativePackageForTarget(target), "@esbuild/linux-x64");
  });
});
