import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
/** @typedef {{ os: string, cpu: string, libc?: string, runnerImageFamily?: string }} RunnerTarget */

const ESBUILD_LINUX_X64_PACKAGE = "@esbuild/linux-x64";

function readHostPackageJson(repoRoot, packageName) {
  const path = packageName.startsWith("@")
    ? join(repoRoot, "node_modules", ...packageName.split("/"), "package.json")
    : join(repoRoot, "node_modules", packageName, "package.json");
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export const ESBUILD_STAGING_ROOT_ENV = "MARKETING_DISPATCHER_WATCHDOG_ESBUILD_STAGING_ROOT";
export const ESBUILD_STAGING_TARBALL_NAME = "package.tgz";
export const ESBUILD_LINUX_X64_EXPECTED_VERSION = "0.28.2";
export const ESBUILD_LINUX_X64_TARBALL_SHA512_BASE64 =
  "4xTZr1FUmSoQW4XIWmit3tzQrUTZM+N3P0XV8xROKYF50XfI7xeO90+1bZvNwxIufQ9hDQVRJH5YhgPVF8A/HQ==";

export function resolveExternalEsbuildStagingRoot(env = process.env) {
  const raw = env[ESBUILD_STAGING_ROOT_ENV]?.trim();
  return raw || null;
}

export function assertEsbuildStagingRootSafe(stagingRoot, repoRoot) {
  if (!stagingRoot) {
    throw new Error("esbuild_staging_root_missing");
  }
  const resolvedStaging = realpathSync(resolve(stagingRoot));
  const resolvedRepo = realpathSync(resolve(repoRoot));
  const stagingNorm = resolvedStaging.toLowerCase();
  const repoNorm = resolvedRepo.toLowerCase();
  if (stagingNorm === repoNorm || stagingNorm.startsWith(repoNorm + "\\") || stagingNorm.startsWith(repoNorm + "/")) {
    throw new Error("esbuild_staging_root_inside_repo");
  }
  if (/_wt-[^\\/]+/i.test(resolvedStaging)) {
    throw new Error("esbuild_staging_root_inside_worktree");
  }
  const stat = lstatSync(resolvedStaging);
  if (stat.isSymbolicLink()) {
    throw new Error("esbuild_staging_root_symlink");
  }
  return resolvedStaging;
}

export function resolveEsbuildStagingTarballPath(stagingRoot) {
  return join(stagingRoot, ESBUILD_STAGING_TARBALL_NAME);
}

export function computeSha512Base64(buffer) {
  return createHash("sha512").update(buffer).digest("base64");
}

export function assertTarballEntriesSafe(tarballPath) {
  const listing = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" });
  const entries = listing.split(/\r?\n/).filter(Boolean);
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry)) {
      throw new Error(`esbuild_staging_tar_absolute_path:${entry}`);
    }
    if (entry.split("/").some((part) => part === "..")) {
      throw new Error(`esbuild_staging_tar_traversal:${entry}`);
    }
  }
  return entries;
}

export function readAndVerifyEsbuildLinuxX64Tarball(tarballPath, expectedVersion = ESBUILD_LINUX_X64_EXPECTED_VERSION) {
  if (!existsSync(tarballPath)) {
    throw new Error(`esbuild_staging_tarball_missing:${tarballPath}`);
  }
  const tarballStat = lstatSync(tarballPath);
  if (tarballStat.isSymbolicLink()) {
    throw new Error("esbuild_staging_tarball_symlink");
  }
  const buffer = readFileSync(tarballPath);
  const actualDigest = computeSha512Base64(buffer);
  if (actualDigest !== ESBUILD_LINUX_X64_TARBALL_SHA512_BASE64) {
    throw new Error(
      `esbuild_staging_integrity_mismatch:expected=${ESBUILD_LINUX_X64_TARBALL_SHA512_BASE64}:actual=${actualDigest}`,
    );
  }
  assertTarballEntriesSafe(tarballPath);
  return { buffer, integrityMatch: true, expectedVersion };
}

export function inspectElfLinuxX86_64(binaryPath) {
  const binBuf = readFileSync(binaryPath);
  const elf =
    binBuf.length >= 20 &&
    binBuf[0] === 0x7f &&
    binBuf[1] === 0x45 &&
    binBuf[2] === 0x4c &&
    binBuf[3] === 0x46;
  const elfClass = elf ? binBuf[4] : null;
  const elfMachine = elf ? binBuf.readUInt16LE(18) : null;
  return {
    elf,
    elfClass64: elfClass === 2,
    elfMachineX86_64: elfMachine === 62,
    size: binBuf.length,
  };
}

function assertPackageLinuxX64Metadata(pkg) {
  const osList = Array.isArray(pkg.os) ? pkg.os : pkg.os != null ? [pkg.os] : [];
  const cpuList = Array.isArray(pkg.cpu) ? pkg.cpu : pkg.cpu != null ? [pkg.cpu] : [];
  if (!osList.includes("linux") || !cpuList.includes("x64")) {
    throw new Error("esbuild_staging_extracted_platform_mismatch");
  }
}

export function validateExtractedEsbuildLinuxX64Package(packageDir, expectedVersion) {
  const pkgJsonPath = join(packageDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error("esbuild_staging_extracted_package_json_missing");
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (pkg.name !== ESBUILD_LINUX_X64_PACKAGE || pkg.version !== expectedVersion) {
    throw new Error(
      `esbuild_staging_extracted_identity_mismatch:${pkg.name ?? "?"}:${pkg.version ?? "?"}`,
    );
  }
  assertPackageLinuxX64Metadata(pkg);
  const binaryPath = join(packageDir, "bin", "esbuild");
  if (!existsSync(binaryPath)) {
    throw new Error("esbuild_staging_extracted_binary_missing");
  }
  if (lstatSync(binaryPath).isSymbolicLink()) {
    throw new Error("esbuild_staging_extracted_binary_symlink");
  }
  const elf = inspectElfLinuxX86_64(binaryPath);
  if (!elf.elfClass64 || !elf.elfMachineX86_64) {
    throw new Error("esbuild_staging_extracted_binary_not_elf_x86_64");
  }
  return { pkg, binaryPath, elf };
}

export function verifyExternalEsbuildStagingTarball(stagingRoot, repoRoot, expectedEsbuildVersion) {
  const safeRoot = assertEsbuildStagingRootSafe(stagingRoot, repoRoot);
  const tarballPath = resolveEsbuildStagingTarballPath(safeRoot);
  readAndVerifyEsbuildLinuxX64Tarball(tarballPath, expectedEsbuildVersion);
  if (expectedEsbuildVersion !== ESBUILD_LINUX_X64_EXPECTED_VERSION) {
    throw new Error(
      `esbuild_staging_version_contract_mismatch:expected=${ESBUILD_LINUX_X64_EXPECTED_VERSION}:requested=${expectedEsbuildVersion}`,
    );
  }
  return { stagingRoot: safeRoot, tarballPath, integrityMatch: true };
}

export function extractVerifiedEsbuildLinuxX64IntoWorkspace(
  stagingRoot,
  workspaceRoot,
  repoRoot,
  expectedEsbuildVersion,
) {
  const safeStaging = assertEsbuildStagingRootSafe(stagingRoot, repoRoot);
  const tarballPath = resolveEsbuildStagingTarballPath(safeStaging);
  readAndVerifyEsbuildLinuxX64Tarball(tarballPath, expectedEsbuildVersion);

  const hostEsbuild = readHostPackageJson(repoRoot, "esbuild");
  if (!hostEsbuild?.version || hostEsbuild.version !== expectedEsbuildVersion) {
    throw new Error(
      `esbuild_staging_host_version_mismatch:expected=${expectedEsbuildVersion}:actual=${hostEsbuild?.version ?? "missing"}`,
    );
  }

  const workRoot = join(resolve(workspaceRoot), ".verified-esbuild-staging-work");
  const extractRoot = join(workRoot, "extract");
  if (existsSync(workRoot)) {
    rmSync(workRoot, { recursive: true, force: true });
  }
  mkdirSync(extractRoot, { recursive: true });
  execFileSync("tar", ["-xzf", tarballPath, "-C", extractRoot], { stdio: "pipe" });

  const packageDir = join(extractRoot, "package");
  validateExtractedEsbuildLinuxX64Package(packageDir, expectedEsbuildVersion);

  const destDir = join(resolve(workspaceRoot), "node_modules", "@esbuild", "linux-x64");
  mkdirSync(dirname(destDir), { recursive: true });
  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }
  cpSync(packageDir, destDir, { recursive: true, dereference: true });

  const stagedPkg = join(destDir, "package.json");
  if (!existsSync(stagedPkg)) {
    throw new Error("esbuild_staging_dest_missing");
  }
  return {
    stagedPackageDir: destDir,
    integrityMatch: true,
    workRoot,
  };
}

export function stageExternalEsbuildLinuxX64FromEnv(
  outputDir,
  repoRoot,
  expectedEsbuildVersion,
  env = process.env,
) {
  const stagingRoot = resolveExternalEsbuildStagingRoot(env);
  if (!stagingRoot) {
    throw new Error("esbuild_staging_root_env_missing");
  }
  return extractVerifiedEsbuildLinuxX64IntoWorkspace(
    stagingRoot,
    outputDir,
    repoRoot,
    expectedEsbuildVersion,
  );
}
