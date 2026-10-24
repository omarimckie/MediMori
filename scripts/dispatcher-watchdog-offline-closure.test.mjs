import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectLinuxRunnerPackageClosure,
  collectOfflinePackageClosure,
  OFFLINE_RUNNER_TARGET,
  packageMetadataMatchesTarget,
} from "./dispatcher-watchdog-runner-snapshot.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function writePkg(root, name, manifest) {
  const dir = name.startsWith("@")
    ? join(root, "node_modules", ...name.split("/"))
    : join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
}

function makeFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "wd-closure-"));
}

describe("offline package closure (linux/amd64 runner target)", () => {
  it("skips optional dependencies that are not installed on the host", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        dependencies: { kept: "1.0.0" },
        optionalDependencies: { missing_optional: "1.0.0" },
      });
      writePkg(root, "kept", { name: "kept", version: "1.0.0" });
      const closure = collectOfflinePackageClosure(root, ["root"]);
      assert.deepEqual(closure, ["kept", "root"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a mandatory dependency is missing", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        dependencies: { required_missing: "1.0.0" },
      });
      assert.throws(
        () => collectOfflinePackageClosure(root, ["root"]),
        /offline_dependency_missing:required_missing/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats a shared dependency as mandatory when required by any path", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        dependencies: { middle: "1.0.0" },
        optionalDependencies: { shared: "1.0.0" },
      });
      writePkg(root, "middle", {
        name: "middle",
        version: "1.0.0",
        dependencies: { shared: "1.0.0" },
      });
      writePkg(root, "shared", { name: "shared", version: "1.0.0" });
      const closure = collectOfflinePackageClosure(root, ["root"]);
      assert.deepEqual(closure, ["middle", "root", "shared"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a dependency becomes mandatory but is still missing", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        dependencies: { middle: "1.0.0" },
        optionalDependencies: { shared: "1.0.0" },
      });
      writePkg(root, "middle", {
        name: "middle",
        version: "1.0.0",
        dependencies: { shared: "1.0.0" },
      });
      assert.throws(
        () => collectOfflinePackageClosure(root, ["root"]),
        /offline_dependency_missing:shared/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes platform-specific optional packages from the linux closure", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        optionalDependencies: { fsevents: "1.0.0" },
      });
      writePkg(root, "fsevents", {
        name: "fsevents",
        version: "1.0.0",
        os: ["darwin"],
      });
      const closure = collectOfflinePackageClosure(root, ["root"]);
      assert.deepEqual(closure, ["root"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes optional packages that match the runner target", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        optionalDependencies: { linux_only: "1.0.0" },
      });
      writePkg(root, "linux_only", {
        name: "linux_only",
        version: "1.0.0",
        os: ["linux"],
        cpu: ["x64"],
      });
      const closure = collectOfflinePackageClosure(root, ["root"]);
      assert.deepEqual(closure, ["linux_only", "root"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("walks transitive optional chains only when installed and target-compatible", () => {
    const root = makeFixtureRoot();
    try {
      writePkg(root, "root", {
        name: "root",
        version: "1.0.0",
        optionalDependencies: { opt_a: "1.0.0" },
      });
      writePkg(root, "opt_a", {
        name: "opt_a",
        version: "1.0.0",
        optionalDependencies: { opt_b: "1.0.0" },
      });
      writePkg(root, "opt_b", { name: "opt_b", version: "1.0.0" });
      const closure = collectOfflinePackageClosure(root, ["root"]);
      assert.deepEqual(closure, ["opt_a", "opt_b", "root"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("packageMetadataMatchesTarget honors darwin-only metadata", () => {
    assert.equal(
      packageMetadataMatchesTarget({ os: ["darwin"] }, OFFLINE_RUNNER_TARGET),
      false,
    );
    assert.equal(
      packageMetadataMatchesTarget({ os: ["linux"], cpu: ["x64"] }, OFFLINE_RUNNER_TARGET),
      true,
    );
  });

  it("resolves the real host javascript closure without fsevents on Windows hosts", () => {
    const closure = collectOfflinePackageClosure(repoRoot);
    assert.ok(closure.includes("tsx"));
    assert.ok(closure.includes("@neondatabase/serverless"));
    assert.ok(closure.includes("@upstash/qstash"));
    assert.ok(closure.includes("pg"));
    assert.ok(closure.includes("esbuild"));
    assert.equal(closure.includes("fsevents"), false);
    assert.equal(closure.includes("@esbuild/win32-x64"), false);
  });

  it("fails linux runner closure on real repo when @esbuild/linux-x64 is absent", () => {
    assert.throws(
      () => collectLinuxRunnerPackageClosure(repoRoot, undefined, undefined, {}),
      /linux_runner_native_missing:@esbuild\/linux-x64/,
    );
  });
});
