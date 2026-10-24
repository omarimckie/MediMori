/**
 * Trusted disposable runner workspace host-path identity (Windows integration host).
 * Paths are derived from validated RUN_ID — never from Docker inspect alone.
 */

import { lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateRunId } from "./dispatcher-watchdog-integration-resources.mjs";

export const RUNNER_WORKSPACE_DIR_PREFIX = "tf-watchdog-runner-";
export const DOCKER_DESKTOP_LINUX_HOST_MOUNT_ROOT = "/run/desktop/mnt/host";

/**
 * @param {string} runId
 */
export function runnerWorkspaceBasenameForRun(runId) {
  const id = validateRunId(runId);
  return `${RUNNER_WORKSPACE_DIR_PREFIX}${id}`;
}

/**
 * @param {string} containerName
 */
export function runIdFromRunnerContainerName(containerName) {
  const name = String(containerName ?? "").replace(/^\//, "");
  if (!name.startsWith(RUNNER_WORKSPACE_DIR_PREFIX)) {
    throw new Error("docker_isolation_runner_container_name_invalid");
  }
  const suffix = name.slice(RUNNER_WORKSPACE_DIR_PREFIX.length);
  return validateRunId(suffix);
}

/**
 * Normalize a Windows absolute host path for trusted workspace comparison.
 * Policy: win32 absolute drive path only; reject UNC, device paths, traversal, ADS, relative.
 *
 * @param {string} rawPath
 */
export function normalizeWindowsRunnerWorkspaceHostPath(rawPath) {
  const text = String(rawPath ?? "").trim();
  if (!text) {
    throw new Error("docker_isolation_runner_workspace_path_empty");
  }
  if (text.startsWith("\\\\")) {
    throw new Error("docker_isolation_runner_workspace_unc_forbidden");
  }
  if (text.startsWith("\\\\?\\")) {
    throw new Error("docker_isolation_runner_workspace_device_path_forbidden");
  }
  if (text.startsWith("./") || text.startsWith("../") || text.startsWith(".\\") || text.startsWith("..\\")) {
    throw new Error("docker_isolation_runner_workspace_relative_forbidden");
  }
  if (/([\\/]|^)\.\.([\\/]|$)/.test(text)) {
    throw new Error("docker_isolation_runner_workspace_traversal_forbidden");
  }
  if (!/^[A-Za-z]:[\\/]/.test(text)) {
    throw new Error("docker_isolation_runner_workspace_not_absolute_windows");
  }
  const colonCount = (text.match(/:/g) ?? []).length;
  if (colonCount !== 1) {
    throw new Error("docker_isolation_runner_workspace_malformed_drive");
  }
  const normalized = path.win32.normalize(text);
  if (normalized.includes("..")) {
    throw new Error("docker_isolation_runner_workspace_traversal_forbidden");
  }
  return normalized;
}

/**
 * @param {string} tempRoot
 */
function normalizeWindowsTempRoot(tempRoot) {
  const root = String(tempRoot ?? "").trim();
  if (!root) {
    throw new Error("docker_isolation_runner_workspace_temp_root_empty");
  }
  return path.win32.normalize(root).replace(/[\\/]+$/, "");
}

/**
 * @param {string} runId
 * @param {string} [tempRoot]
 */
export function expectedRunnerWorkspaceHostPathForRun(runId, tempRoot = tmpdir()) {
  const basename = runnerWorkspaceBasenameForRun(runId);
  const parent = normalizeWindowsTempRoot(tempRoot);
  return normalizeWindowsRunnerWorkspaceHostPath(path.win32.join(parent, basename));
}

/**
 * @param {string} hostPath
 * @param {string} runId
 * @param {string} [tempRoot]
 */
export function assertRunnerWorkspacePathMatchesRunIdentity(hostPath, runId, tempRoot = tmpdir()) {
  const normalized = normalizeWindowsRunnerWorkspaceHostPath(hostPath);
  const expected = expectedRunnerWorkspaceHostPathForRun(runId, tempRoot);
  if (normalized.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("docker_isolation_runner_workspace_path_mismatch");
  }
  if (path.win32.basename(normalized) !== runnerWorkspaceBasenameForRun(runId)) {
    throw new Error("docker_isolation_runner_workspace_basename_mismatch");
  }
  const parent = normalizeWindowsTempRoot(path.win32.dirname(normalized));
  const tempNorm = normalizeWindowsTempRoot(tempRoot);
  if (parent.toLowerCase() !== tempNorm.toLowerCase()) {
    throw new Error("docker_isolation_runner_workspace_not_under_temp");
  }
  return normalized;
}

/**
 * @param {string} normalizedWindowsPath
 */
export function dockerDesktopLinuxMountSourceFromWindowsPath(normalizedWindowsPath) {
  const normalized = normalizeWindowsRunnerWorkspaceHostPath(normalizedWindowsPath);
  const drive = normalized.charAt(0).toLowerCase();
  if (!/^[a-z]$/.test(drive) || normalized.charAt(1) !== ":") {
    throw new Error("docker_isolation_runner_workspace_mount_translation_invalid");
  }
  const rest = normalized.slice(2).replace(/^\\+/, "").replace(/\\/g, "/");
  return `${DOCKER_DESKTOP_LINUX_HOST_MOUNT_ROOT}/${drive}/${rest}`;
}

/**
 * @param {string} mountSource
 * @param {string} trustedWindowsPath already normalized trusted workspace
 */
function windowsNativeMountSourceMatchesTrustedWorkspace(mountSource, trustedWindowsPath) {
  const trusted = normalizeWindowsRunnerWorkspaceHostPath(trustedWindowsPath);
  let normalizedMount;
  try {
    normalizedMount = normalizeWindowsRunnerWorkspaceHostPath(mountSource);
  } catch {
    return false;
  }
  return normalizedMount.toLowerCase() === trusted.toLowerCase();
}

/**
 * @param {string} mountSource
 * @param {string} trustedWindowsPath
 */
export function assertDockerDesktopMountSourceMatchesWorkspace(mountSource, trustedWindowsPath) {
  const trusted = normalizeWindowsRunnerWorkspaceHostPath(trustedWindowsPath);
  const expectedLinux = dockerDesktopLinuxMountSourceFromWindowsPath(trusted);
  const actual = String(mountSource ?? "");
  if (actual === expectedLinux) {
    return;
  }
  if (windowsNativeMountSourceMatchesTrustedWorkspace(actual, trusted)) {
    return;
  }
  throw new Error("docker_isolation_runner_mount_source_mismatch");
}

/**
 * @param {string} hostPath
 * @param {string} runId
 * @param {string} [tempRoot]
 */
export function assertTrustedRunnerWorkspaceOnDisk(hostPath, runId, tempRoot = tmpdir()) {
  const normalized = assertRunnerWorkspacePathMatchesRunIdentity(hostPath, runId, tempRoot);
  const stat = lstatSync(normalized);
  if (stat.isSymbolicLink()) {
    throw new Error("docker_isolation_runner_workspace_symlink_forbidden");
  }
  if (!stat.isDirectory()) {
    throw new Error("docker_isolation_runner_workspace_not_directory");
  }
  return normalized;
}
