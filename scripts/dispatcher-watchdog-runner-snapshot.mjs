import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveExternalEsbuildStagingRoot,
  stageExternalEsbuildLinuxX64FromEnv,
  verifyExternalEsbuildStagingTarball,
} from "./dispatcher-watchdog-external-esbuild-staging.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const FORBIDDEN_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".git",
  ".gitignore",
]);

const FORBIDDEN_PATH_SEGMENTS = [".git", "node_modules", "_wt-", ".cursor"];

/** Relative paths from repository root allowed in runner snapshot. */
export const RUNNER_SOURCE_ALLOWLIST = [
  "package.json",
  "sql/marketing-incidents.sql",
  "sql/marketing-dispatcher-watchdog.sql",
  "sql/marketing-dispatcher-qstash-primary.sql",
  "scripts/resolve-marketing-dispatcher-watchdog-test-database-url.mjs",
  "scripts/apply-marketing-incidents-schema.mjs",
  "scripts/apply-marketing-dispatcher-watchdog-schema.mjs",
  "scripts/apply-marketing-dispatcher-qstash-primary-schema.mjs",
  "scripts/resolve-marketing-qstash-primary-schema-database-url.mjs",
  "scripts/apply-marketing-web-push-schema.mjs",
  "scripts/dispatcher-watchdog-apply-schemas-disposable.mjs",
  "scripts/dispatcher-watchdog-disposable-postgres-pool.mjs",
  "src/lib/marketing/incidents/sanitize.ts",
  "src/lib/marketing/incidents/types.ts",
  "src/lib/marketing/credential-health/heartbeat-store-pool.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/commit-observation-core.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/constants.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-integration-guards.test.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/disposable-postgres-pool.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/dispatcher-watchdog-postgres.integration.test.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/evaluate.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/incident-persistence.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/notification-claims.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/postgres-integration-helpers.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/postgres-persistence.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/repository.ts",
  "src/lib/marketing/reliability/dispatcher-watchdog/types.ts",
  "src/lib/marketing/reliability/qstash-primary/constants.ts",
  "src/lib/marketing/reliability/qstash-primary/config.ts",
  "src/lib/marketing/reliability/qstash-primary/types.ts",
  "src/lib/marketing/reliability/qstash-primary/verify.ts",
  "src/lib/marketing/reliability/qstash-primary/persistence.ts",
  "src/lib/marketing/reliability/qstash-primary/postgres-integration-helpers.ts",
  "src/lib/marketing/reliability/qstash-primary/qstash-primary-postgres.integration.test.ts",
];

export const OFFLINE_RUNTIME_ROOT_PACKAGES = [
  "tsx",
  "pg",
  "@neondatabase/serverless",
  "@upstash/qstash",
];

/**
 * Disposable Node runner target contract.
 * Image family: node:22-alpine (musl libc on linux/amd64).
 * esbuild ships @esbuild/linux-x64 (static binary; used on glibc and musl).
 */
export const OFFLINE_RUNNER_TARGET = {
  os: "linux",
  cpu: "amd64",
  libc: "musl",
  runnerImageFamily: "node:22-alpine",
};

const ESBUILD_UNIX_NATIVE_BY_TARGET_KEY = {
  "linux:x64": "@esbuild/linux-x64",
  "linux:arm64": "@esbuild/linux-arm64",
  "linux:ia32": "@esbuild/linux-ia32",
  "darwin:arm64": "@esbuild/darwin-arm64",
  "darwin:x64": "@esbuild/darwin-x64",
  "win32:x64": "@esbuild/win32-x64",
  "win32:arm64": "@esbuild/win32-arm64",
  "win32:ia32": "@esbuild/win32-ia32",
};

export function targetCpuToPackageArch(cpu) {
  const normalized = String(cpu).toLowerCase();
  if (normalized === "amd64") {
    return "x64";
  }
  return normalized;
}

export function esbuildNativePackageForTarget(target = OFFLINE_RUNNER_TARGET) {
  const key = `${target.os.toLowerCase()}:${targetCpuToPackageArch(target.cpu)}`;
  return ESBUILD_UNIX_NATIVE_BY_TARGET_KEY[key] ?? null;
}

export function isHostOnlyNativePackageName(packageName, target = OFFLINE_RUNNER_TARGET) {
  if (!packageName.startsWith("@esbuild/")) {
    return false;
  }
  const requiredNative = esbuildNativePackageForTarget(target);
  if (packageName === requiredNative) {
    return false;
  }
  const hostNative = esbuildNativePackageForTarget({
    os: process.platform,
    cpu: targetCpuToPackageArch(process.arch),
  });
  return packageName === hostNative;
}

/**
 * @param {string} repoRoot
 * @param {string[]} jsClosure
 * @param {typeof OFFLINE_RUNNER_TARGET} target
 */
export function getRequiredTargetNativePackages(repoRoot, jsClosure, target = OFFLINE_RUNNER_TARGET) {
  const requirements = [];
  if (!jsClosure.includes("esbuild")) {
    return requirements;
  }
  const esbuildPkg = readInstalledPackageJson(repoRoot, "esbuild");
  if (!esbuildPkg?.version) {
    throw new Error("offline_dependency_missing:esbuild");
  }
  const nativeName = esbuildNativePackageForTarget(target);
  if (!nativeName) {
    throw new Error(
      `linux_runner_native_unknown_target:${target.os}:${target.cpu}:${target.libc ?? "unknown"}`,
    );
  }
  requirements.push({
    name: nativeName,
    expectedVersion: esbuildPkg.version,
    requiredFor: "esbuild",
    target,
  });
  return requirements;
}

/**
 * @param {string} repoRoot
 * @param {{ name: string, expectedVersion: string }} requirement
 * @param {typeof OFFLINE_RUNNER_TARGET} target
 */
export function validateTargetNativePackage(repoRoot, requirement, target = OFFLINE_RUNNER_TARGET) {
  const { name, expectedVersion } = requirement;
  const pkg = readInstalledPackageJson(repoRoot, name);
  if (pkg == null) {
    throw new Error(
      `linux_runner_native_missing:${name}:required_for=${requirement.requiredFor}:expected_version=${expectedVersion}:runner=${target.runnerImageFamily}`,
    );
  }
  if (pkg.version !== expectedVersion) {
    throw new Error(
      `linux_runner_native_version_mismatch:${name}:expected=${expectedVersion}:actual=${pkg.version}`,
    );
  }
  if (!packageMetadataMatchesTarget(pkg, target)) {
    throw new Error(`linux_runner_native_platform_mismatch:${name}`);
  }
  const binaryPath = join(resolvePackageDir(repoRoot, name), "bin", "esbuild");
  if (!existsSync(binaryPath)) {
    throw new Error(`linux_runner_native_binary_missing:${name}:${binaryPath}`);
  }
}

/**
 * JavaScript closure for the runner target (host node_modules scan).
 */
export function collectHostJavaScriptPackageClosure(
  repoRoot,
  rootPackages = OFFLINE_RUNTIME_ROOT_PACKAGES,
  target = OFFLINE_RUNNER_TARGET,
) {
  return collectOfflinePackageClosure(repoRoot, rootPackages, target);
}

/**
 * Full Linux runner staging closure: JS packages plus required target-native binaries.
 */
export function collectLinuxRunnerPackageClosure(
  repoRoot,
  rootPackages = OFFLINE_RUNTIME_ROOT_PACKAGES,
  target = OFFLINE_RUNNER_TARGET,
  env = process.env,
) {
  const jsClosure = collectOfflinePackageClosure(repoRoot, rootPackages, target);
  const expanded = new Set(jsClosure);

  for (const req of getRequiredTargetNativePackages(repoRoot, jsClosure, target)) {
    const hostNative = readInstalledPackageJson(repoRoot, req.name);
    if (hostNative != null) {
      validateTargetNativePackage(repoRoot, req, target);
    } else {
      const stagingRoot = resolveExternalEsbuildStagingRoot(env);
      if (!stagingRoot) {
        throw new Error(
          `linux_runner_native_missing:${req.name}:required_for=${req.requiredFor}:expected_version=${req.expectedVersion}:runner=${target.runnerImageFamily}`,
        );
      }
      verifyExternalEsbuildStagingTarball(stagingRoot, repoRoot, req.expectedVersion);
    }
    expanded.add(req.name);
  }

  for (const name of expanded) {
    if (isHostOnlyNativePackageName(name, target)) {
      throw new Error(`linux_runner_host_native_in_closure:${name}`);
    }
    const pkg = readInstalledPackageJson(repoRoot, name);
    if (pkg && !packageMetadataMatchesTarget(pkg, target)) {
      if (name.startsWith("@esbuild/")) {
        throw new Error(`linux_runner_incompatible_native_in_closure:${name}`);
      }
    }
  }

  return [...expanded].sort();
}

/**
 * Read-only readiness report (does not throw).
 */
export function inspectLinuxRunnerDependencyReadiness(
  repoRoot,
  rootPackages = OFFLINE_RUNTIME_ROOT_PACKAGES,
  target = OFFLINE_RUNNER_TARGET,
  env = process.env,
) {
  const tsxPkg = readInstalledPackageJson(repoRoot, "tsx");
  const esbuildPkg = readInstalledPackageJson(repoRoot, "esbuild");
  const hostNative = esbuildNativePackageForTarget({
    os: process.platform,
    cpu: targetCpuToPackageArch(process.arch),
  });
  const targetNative = esbuildNativePackageForTarget(target);
  const hostNativePkg = hostNative ? readInstalledPackageJson(repoRoot, hostNative) : null;
  const targetNativePkg = targetNative ? readInstalledPackageJson(repoRoot, targetNative) : null;

  let hostJavaScriptClosure = [];
  let hostJavaScriptClosurePassed = false;
  let hostJavaScriptClosureError = null;
  try {
    hostJavaScriptClosure = collectOfflinePackageClosure(repoRoot, rootPackages, target);
    hostJavaScriptClosurePassed = true;
  } catch (error) {
    hostJavaScriptClosureError = String(error?.message ?? error);
  }

  let linuxRunnerClosure = [];
  let linuxRunnerClosurePassed = false;
  let linuxRunnerClosureError = null;
  try {
    linuxRunnerClosure = collectLinuxRunnerPackageClosure(repoRoot, rootPackages, target, env);
    linuxRunnerClosurePassed = true;
  } catch (error) {
    linuxRunnerClosureError = String(error?.message ?? error);
  }

  let linuxRunnerStagingClosurePassed = false;
  let linuxRunnerStagingClosureError = null;
  let linuxRunnerStagingWorkDir = null;
  try {
    const workDir = mkdtempSync(join(tmpdir(), "wd-linux-runner-staging-"));
    linuxRunnerStagingWorkDir = workDir;
    stageOfflineNodeModules(workDir, repoRoot, target, rootPackages, env);
    const stagedBinary = join(workDir, "node_modules", "@esbuild", "linux-x64", "bin", "esbuild");
    if (!existsSync(stagedBinary)) {
      throw new Error("linux_runner_staging_binary_missing");
    }
    linuxRunnerStagingClosurePassed = true;
  } catch (error) {
    linuxRunnerStagingClosureError = String(error?.message ?? error);
  } finally {
    if (linuxRunnerStagingWorkDir) {
      rmSync(linuxRunnerStagingWorkDir, { recursive: true, force: true });
    }
  }

  return {
    target,
    tsxVersion: tsxPkg?.version ?? null,
    esbuildVersion: esbuildPkg?.version ?? null,
    hostNativePackage: hostNative,
    hostNativeInstalled: hostNativePkg != null,
    hostNativeVersion: hostNativePkg?.version ?? null,
    targetNativePackage: targetNative,
    targetNativeInstalled: targetNativePkg != null,
    targetNativeVersion: targetNativePkg?.version ?? null,
    targetNativeVersionMatchesEsbuild:
      targetNativePkg != null && esbuildPkg != null
        ? targetNativePkg.version === esbuildPkg.version
        : false,
    hostJavaScriptClosurePassed,
    hostJavaScriptClosureError,
    hostJavaScriptClosure,
    linuxRunnerClosurePassed,
    linuxRunnerClosureError,
    linuxRunnerClosure,
    externalEsbuildStagingConfigured: resolveExternalEsbuildStagingRoot(env) != null,
    linuxRunnerStagingClosurePassed,
    linuxRunnerStagingClosureError,
  };
}

export function resolvePackageJsonPath(repoRoot, packageName) {
  return packageName.startsWith("@")
    ? join(repoRoot, "node_modules", ...packageName.split("/"), "package.json")
    : join(repoRoot, "node_modules", packageName, "package.json");
}

export function resolvePackageDir(repoRoot, packageName) {
  return packageName.startsWith("@")
    ? join(repoRoot, "node_modules", ...packageName.split("/"))
    : join(repoRoot, "node_modules", packageName);
}

/**
 * @param {{ os?: string | string[], cpu?: string | string[] }} pkg
 * @param {{ os: string, cpu: string }} target
 */
export function packageMetadataMatchesTarget(pkg, target = OFFLINE_RUNNER_TARGET) {
  const targetOs = target.os.toLowerCase();
  const targetCpus = new Set(
    target.cpu === "amd64" ? ["amd64", "x64"] : [target.cpu.toLowerCase()],
  );

  const osField = pkg.os;
  if (osField != null) {
    const osList = Array.isArray(osField) ? osField : [osField];
    for (const entry of osList) {
      if (typeof entry !== "string") continue;
      if (entry.startsWith("!")) {
        const denied = entry.slice(1).toLowerCase();
        if (denied === targetOs) {
          return false;
        }
      }
    }
    const positive = osList.filter((e) => typeof e === "string" && !e.startsWith("!"));
    if (positive.length > 0) {
      const allowed = positive.map((e) => e.toLowerCase());
      if (!allowed.includes(targetOs)) {
        return false;
      }
    }
  }

  const cpuField = pkg.cpu;
  if (cpuField != null) {
    const cpuList = Array.isArray(cpuField) ? cpuField : [cpuField];
    const normalized = cpuList.map((c) => String(c).toLowerCase());
    if (!normalized.some((c) => targetCpus.has(c))) {
      return false;
    }
  }

  return true;
}

function readInstalledPackageJson(repoRoot, packageName) {
  const path = resolvePackageJsonPath(repoRoot, packageName);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function assertAllowlistPathSafe(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("..")) {
    throw new Error(`allowlist_path_traversal:${relativePath}`);
  }
  const base = basename(normalized);
  if (FORBIDDEN_BASENAMES.has(base)) {
    throw new Error(`allowlist_forbidden_basename:${relativePath}`);
  }
  for (const segment of FORBIDDEN_PATH_SEGMENTS) {
    if (normalized.split("/").some((part) => part.startsWith(segment))) {
      throw new Error(`allowlist_forbidden_segment:${relativePath}`);
    }
  }
  if (!/\.(ts|mjs|json|sql)$/.test(base) && base !== "package.json") {
    throw new Error(`allowlist_unexpected_file_type:${relativePath}`);
  }
}

export function resolveAllowlistedSource(repoRoot, relativePath) {
  assertAllowlistPathSafe(relativePath);
  const abs = resolve(repoRoot, relativePath);
  const realRepo = realpathSync(repoRoot);
  const realFile = realpathSync(abs);
  const relFromRepo = relative(realRepo, realFile).replace(/\\/g, "/");
  if (relFromRepo.startsWith("..") || relFromRepo.includes("/..")) {
    throw new Error(`allowlist_symlink_escape:${relativePath}`);
  }
  if (!existsSync(realFile)) {
    throw new Error(`allowlist_missing:${relativePath}`);
  }
  const stat = lstatSync(realFile);
  if (stat.isSymbolicLink()) {
    throw new Error(`allowlist_symlink_not_allowed:${relativePath}`);
  }
  return realFile;
}

export function buildRunnerSourceSnapshot(outputDir, repoRoot = REPO_ROOT) {
  const outRoot = resolve(outputDir);
  mkdirSync(outRoot, { recursive: true });
  for (const rel of RUNNER_SOURCE_ALLOWLIST) {
    const src = resolveAllowlistedSource(repoRoot, rel);
    const dest = join(outRoot, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
  return { outputDir: outRoot, fileCount: RUNNER_SOURCE_ALLOWLIST.length };
}

/**
 * Collect packages to copy into the offline runner image workspace.
 * Mandatory edges always require an installed package.json on the host.
 * Optional edges are skipped when not installed, or when package os/cpu excludes the runner target.
 * If a name is mandatory anywhere, it stays mandatory (optional-only paths cannot downgrade it).
 *
 * @param {string} repoRoot
 * @param {string[]} [rootPackages]
 * @param {{ os: string, cpu: string }} [target]
 */
export function collectOfflinePackageClosure(
  repoRoot,
  rootPackages = OFFLINE_RUNTIME_ROOT_PACKAGES,
  target = OFFLINE_RUNNER_TARGET,
) {
  const mandatory = new Set(rootPackages);
  const visited = new Set();
  const closure = new Set();
  const queue = rootPackages.map((name) => ({ name, required: true }));

  while (queue.length > 0) {
    const { name, required } = queue.shift();
    if (visited.has(name)) {
      continue;
    }
    visited.add(name);

    const pkg = readInstalledPackageJson(repoRoot, name);
    if (pkg == null) {
      if (required || mandatory.has(name)) {
        throw new Error(`offline_dependency_missing:${name}`);
      }
      continue;
    }

    if (!packageMetadataMatchesTarget(pkg, target)) {
      if (required || mandatory.has(name)) {
        throw new Error(`offline_dependency_platform_mismatch:${name}`);
      }
      continue;
    }

    closure.add(name);

    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      mandatory.add(dep);
      queue.push({ name: dep, required: true });
    }

    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      const depRequired = mandatory.has(dep);
      queue.push({ name: dep, required: depRequired });
    }
  }

  return [...closure].sort();
}

export function stageOfflineNodeModules(
  outputDir,
  repoRoot = REPO_ROOT,
  target = OFFLINE_RUNNER_TARGET,
  rootPackages = OFFLINE_RUNTIME_ROOT_PACKAGES,
  env = process.env,
) {
  const packages = collectLinuxRunnerPackageClosure(repoRoot, rootPackages, target, env);
  const destRoot = join(resolve(outputDir), "node_modules");
  mkdirSync(destRoot, { recursive: true });
  const esbuildPkg = readInstalledPackageJson(repoRoot, "esbuild");
  for (const name of packages) {
    if (isHostOnlyNativePackageName(name, target)) {
      throw new Error(`linux_runner_host_native_staging_blocked:${name}`);
    }
    const srcDir = resolvePackageDir(repoRoot, name);
    if (!existsSync(srcDir)) {
      if (name === "@esbuild/linux-x64") {
        stageExternalEsbuildLinuxX64FromEnv(
          outputDir,
          repoRoot,
          esbuildPkg?.version ?? "",
          env,
          target,
        );
        continue;
      }
      throw new Error(`offline_dependency_dir_missing:${name}`);
    }
    const destDir = join(destRoot, ...name.split("/"));
    mkdirSync(dirname(destDir), { recursive: true });
    cpSync(srcDir, destDir, { recursive: true, dereference: true });
  }
  return { packageCount: packages.length, packages };
}

export function isPathAllowedInRunnerSnapshot(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  try {
    assertAllowlistPathSafe(normalized);
  } catch {
    return false;
  }
  return RUNNER_SOURCE_ALLOWLIST.includes(normalized);
}

export function validateForbiddenSnapshotPath(repoRoot, candidatePath) {
  const allowed = isPathAllowedInRunnerSnapshot(candidatePath);
  if (allowed) {
    return { allowed: true };
  }
  try {
    assertAllowlistPathSafe(candidatePath.replace(/\\/g, "/"));
    return { allowed: false, reason: "not_on_allowlist" };
  } catch (error) {
    return { allowed: false, reason: String(error.message) };
  }
}
