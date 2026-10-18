/**
 * Pure Docker inspect validation for disposable watchdog PostgreSQL runs.
 * No Docker CLI calls — safe for unit tests with JSON fixtures.
 */

import { resourceNamesForRun } from "./dispatcher-watchdog-integration-resources.mjs";
import {
  assertDockerDesktopMountSourceMatchesWorkspace,
  assertRunnerWorkspacePathMatchesRunIdentity,
  normalizeWindowsRunnerWorkspaceHostPath,
  runIdFromRunnerContainerName,
} from "./dispatcher-watchdog-runner-workspace-path.mjs";

export const POSTGRES_CONTAINER_PREFIX = "tf-watchdog-pg-";
export const RUNNER_CONTAINER_PREFIX = "tf-watchdog-runner-";
export const POSTGRES_DATA_MOUNT_DESTINATION = "/var/lib/postgresql/data";
const RUNNER_WORKSPACE_MOUNT_DESTINATION = "/work";

const FORBIDDEN_MOUNT_PROPAGATION = new Set([
  "shared",
  "rshared",
  "slave",
  "rslave",
]);

/**
 * @param {string} containerName
 */
export function expectedPostgresVolumeNameForContainer(containerName) {
  if (!containerName.startsWith(POSTGRES_CONTAINER_PREFIX)) {
    return null;
  }
  const runId = containerName.slice(POSTGRES_CONTAINER_PREFIX.length);
  return resourceNamesForRun(runId).volume;
}

/**
 * @param {string} containerName
 * @returns {"postgres" | "runner" | "unknown"}
 */
export function containerIsolationRole(containerName) {
  if (containerName.startsWith(POSTGRES_CONTAINER_PREFIX)) {
    return "postgres";
  }
  if (containerName.startsWith(RUNNER_CONTAINER_PREFIX)) {
    return "runner";
  }
  return "unknown";
}

/**
 * @param {unknown} entry
 * @returns {{ source: string, destination: string, mode: string | null }}
 */
export function parseDockerBindEntry(entry) {
  const text = String(entry);
  let mode = null;
  let core = text;
  if (core.endsWith(":ro")) {
    mode = "ro";
    core = core.slice(0, -3);
  } else if (core.endsWith(":rw")) {
    mode = "rw";
    core = core.slice(0, -3);
  }
  const destMatch = core.match(/:(\/[^:]*)$/);
  if (!destMatch) {
    throw new Error("docker_isolation_binds_malformed");
  }
  const destination = destMatch[1];
  const source = core.slice(0, core.length - destMatch[0].length);
  if (!source) {
    throw new Error("docker_isolation_binds_malformed");
  }
  return { source, destination, mode };
}

/**
 * @param {string} source
 * @param {string} expectedPostgresVolumeName
 */
export function looksLikeHostBindSource(source, expectedPostgresVolumeName) {
  if (source === expectedPostgresVolumeName) {
    return false;
  }
  if (/^[A-Za-z]:[\\/]/.test(source)) {
    return true;
  }
  if (source.startsWith("\\\\")) {
    return true;
  }
  if (source.startsWith("./") || source.startsWith("../")) {
    return true;
  }
  if (source.startsWith("/")) {
    return true;
  }
  return false;
}

/**
 * @param {unknown} mount
 */
function assertMountPropagationAllowed(mount) {
  const propagation = mount?.Propagation;
  if (propagation && FORBIDDEN_MOUNT_PROPAGATION.has(String(propagation))) {
    throw new Error("docker_isolation_mount_propagation_forbidden");
  }
}

/**
 * @param {unknown} binds
 * @param {unknown} mounts
 * @param {string} expectedVolumeName
 */
export function assertPostgresNamedVolumePolicy(binds, mounts, expectedVolumeName) {
  if (!Array.isArray(binds) || binds.length !== 1) {
    throw new Error("docker_isolation_postgres_binds_count_invalid");
  }

  const parsed = parseDockerBindEntry(binds[0]);
  if (parsed.source !== expectedVolumeName) {
    throw new Error("docker_isolation_postgres_volume_name_mismatch");
  }
  if (looksLikeHostBindSource(parsed.source, expectedVolumeName)) {
    throw new Error("docker_isolation_postgres_host_bind_forbidden");
  }
  if (parsed.destination !== POSTGRES_DATA_MOUNT_DESTINATION) {
    throw new Error("docker_isolation_postgres_volume_destination_mismatch");
  }

  if (!Array.isArray(mounts) || mounts.length !== 1) {
    throw new Error("docker_isolation_postgres_mounts_count_invalid");
  }

  const mount = mounts[0];
  if (mount?.Type !== "volume") {
    throw new Error("docker_isolation_postgres_mount_type_invalid");
  }
  if (mount?.Name !== expectedVolumeName) {
    throw new Error("docker_isolation_postgres_mount_name_mismatch");
  }
  if (mount?.Destination !== POSTGRES_DATA_MOUNT_DESTINATION) {
    throw new Error("docker_isolation_postgres_mount_destination_mismatch");
  }
  assertMountPropagationAllowed(mount);
}

/**
 * @param {unknown} binds
 * @param {unknown} mounts
 * @param {string} trustedRunnerWorkspaceHostPath normalized trusted Windows workspace path
 */
export function assertRunnerWorkspaceMountPolicy(binds, mounts, trustedRunnerWorkspaceHostPath) {
  const trusted = normalizeWindowsRunnerWorkspaceHostPath(trustedRunnerWorkspaceHostPath);

  if (!Array.isArray(binds) || binds.length !== 1) {
    throw new Error("docker_isolation_runner_binds_count_invalid");
  }

  const parsed = parseDockerBindEntry(binds[0]);
  if (parsed.destination !== RUNNER_WORKSPACE_MOUNT_DESTINATION) {
    throw new Error("docker_isolation_runner_workspace_destination_invalid");
  }
  if (parsed.mode !== "ro") {
    throw new Error("docker_isolation_runner_workspace_not_read_only");
  }
  if (!looksLikeHostBindSource(parsed.source, "")) {
    throw new Error("docker_isolation_runner_workspace_bind_source_invalid");
  }
  if (parsed.source.startsWith("tf-watchdog-pg-data-")) {
    throw new Error("docker_isolation_runner_postgres_volume_forbidden");
  }
  const bindSource = normalizeWindowsRunnerWorkspaceHostPath(parsed.source);
  if (bindSource.toLowerCase() !== trusted.toLowerCase()) {
    throw new Error("docker_isolation_runner_workspace_bind_source_mismatch");
  }

  if (!Array.isArray(mounts)) {
    throw new Error("docker_isolation_mounts_malformed");
  }

  if (mounts.length !== 1) {
    throw new Error("docker_isolation_runner_mounts_count_invalid");
  }

  const bindMounts = mounts.filter((mount) => mount?.Type === "bind");
  if (bindMounts.length !== 1) {
    throw new Error("docker_isolation_runner_bind_mount_count_invalid");
  }
  const bindMount = bindMounts[0];
  if (bindMount.Type !== "bind") {
    throw new Error("docker_isolation_runner_bind_mount_type_invalid");
  }
  if (bindMount.Destination !== RUNNER_WORKSPACE_MOUNT_DESTINATION) {
    throw new Error("docker_isolation_runner_bind_mount_destination_invalid");
  }
  assertDockerDesktopMountSourceMatchesWorkspace(bindMount.Source, trusted);
  const mountReadOnly =
    bindMount.ReadOnly === true ||
    bindMount.RW === false ||
    String(bindMount.Mode ?? "").toLowerCase() === "ro";
  if (!mountReadOnly) {
    throw new Error("docker_isolation_runner_bind_mount_not_read_only");
  }
  assertMountPropagationAllowed(bindMount);

  for (const mount of mounts) {
    if (mount?.Type === "volume") {
      throw new Error("docker_isolation_runner_named_volume_forbidden");
    }
    const destination = String(mount?.Destination ?? "");
    if (destination.includes("docker.sock")) {
      throw new Error("docker_isolation_docker_socket_mount");
    }
  }
}

/**
 * @param {unknown} value
 */
function isEmptyObject(value) {
  if (value == null) {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.keys(value).length === 0;
}

/**
 * @param {unknown} entry
 */
function isPublishedHostBinding(entry) {
  if (entry == null) {
    return false;
  }
  if (!Array.isArray(entry)) {
    return true;
  }
  if (entry.length === 0) {
    return false;
  }
  return entry.some(
    (item) =>
      item &&
      typeof item === "object" &&
      (Boolean(item.HostIp) || Boolean(item.HostPort)),
  );
}

/**
 * @param {unknown} ports
 */
export function assertNoPublishedPorts(ports) {
  if (ports == null) {
    return;
  }
  if (typeof ports !== "object") {
    throw new Error("docker_isolation_ports_malformed");
  }
  for (const value of Object.values(ports)) {
    if (isPublishedHostBinding(value)) {
      throw new Error("docker_isolation_host_ports_published");
    }
  }
}

/**
 * @param {unknown} portBindings
 */
export function assertNoPortBindings(portBindings) {
  if (portBindings == null) {
    return;
  }
  if (typeof portBindings !== "object") {
    throw new Error("docker_isolation_port_bindings_malformed");
  }
  if (!isEmptyObject(portBindings)) {
    throw new Error("docker_isolation_port_bindings_present");
  }
}

/**
 * @param {unknown} binds
 * @param {unknown} mounts
 */
function assertNoHostBindsOrMounts(binds, mounts) {
  if (Array.isArray(binds) && binds.length > 0) {
    throw new Error("docker_isolation_host_binds_present");
  }
  if (Array.isArray(mounts)) {
    for (const mount of mounts) {
      if (mount?.Type === "bind") {
        throw new Error("docker_isolation_bind_mount_present");
      }
      const destination = String(mount?.Destination ?? "");
      if (destination.includes("docker.sock")) {
        throw new Error("docker_isolation_docker_socket_mount");
      }
    }
  }
}

/**
 * @param {unknown} inspect
 * @param {{ expectedContainerName: string, expectedRunnerWorkspaceHostPath?: string }} options
 */
export function validateContainerInspect(inspect, options) {
  if (!inspect || typeof inspect !== "object") {
    throw new Error("docker_isolation_inspect_missing");
  }

  const record = inspect;
  const name = String(record.Name ?? "").replace(/^\//, "");
  if (name !== options.expectedContainerName) {
    throw new Error("docker_isolation_container_name_mismatch");
  }

  const hostConfig = record.HostConfig ?? {};
  if (hostConfig.NetworkMode === "host") {
    throw new Error("docker_isolation_network_mode_host");
  }
  if (hostConfig.Privileged === true) {
    throw new Error("docker_isolation_privileged_container");
  }

  const extraHosts = hostConfig.ExtraHosts;
  if (Array.isArray(extraHosts) && extraHosts.length > 0) {
    throw new Error("docker_isolation_extra_hosts_present");
  }

  assertNoPortBindings(hostConfig.PortBindings);
  assertNoPublishedPorts(record.NetworkSettings?.Ports);

  const restartName = hostConfig.RestartPolicy?.Name ?? "no";
  if (restartName !== "no" && restartName !== "") {
    throw new Error("docker_isolation_restart_policy_not_no");
  }

  const binds = hostConfig.Binds;
  const mounts = record.Mounts;
  const role = containerIsolationRole(name);

  if (role === "postgres") {
    const expectedVolumeName = expectedPostgresVolumeNameForContainer(name);
    if (!expectedVolumeName) {
      throw new Error("docker_isolation_postgres_volume_identity_invalid");
    }
    assertPostgresNamedVolumePolicy(binds, mounts, expectedVolumeName);
  } else if (role === "runner") {
    const workspacePath = String(options.expectedRunnerWorkspaceHostPath ?? "").trim();
    if (!workspacePath || workspacePath === "-") {
      throw new Error("docker_isolation_runner_workspace_path_required");
    }
    const runId = runIdFromRunnerContainerName(name);
    const trusted = assertRunnerWorkspacePathMatchesRunIdentity(workspacePath, runId);
    assertRunnerWorkspaceMountPolicy(binds, mounts, trusted);
  } else {
    assertNoHostBindsOrMounts(binds, mounts);
  }

  const networks = record.NetworkSettings?.Networks;
  if (!networks || typeof networks !== "object" || isEmptyObject(networks)) {
    throw new Error("docker_isolation_no_networks_attached");
  }

  const networkNames = Object.keys(networks);
  if (networkNames.length !== 1) {
    throw new Error("docker_isolation_multiple_networks_attached");
  }

  return { attachedNetwork: networkNames[0] };
}

/**
 * @param {unknown} networkInspect
 * @param {{ expectedNetworkName: string }} options
 */
export function validateNetworkInspect(networkInspect, options) {
  if (!networkInspect || typeof networkInspect !== "object") {
    throw new Error("docker_isolation_network_inspect_missing");
  }

  const record = networkInspect;
  const name = String(record.Name ?? "");
  if (name !== options.expectedNetworkName) {
    throw new Error("docker_isolation_network_name_mismatch");
  }

  if (record.Internal !== true) {
    throw new Error("docker_isolation_network_not_internal");
  }
}

/**
 * @param {unknown} inspectArray
 * @param {{ expectedContainerName: string, expectedNetworkName: string, expectedRunnerWorkspaceHostPath?: string }} options
 */
export function validateDockerIsolationFromInspect(
  inspectArray,
  options,
) {
  if (!Array.isArray(inspectArray) || inspectArray.length !== 1) {
    throw new Error("docker_isolation_inspect_array_invalid");
  }

  const { attachedNetwork } = validateContainerInspect(inspectArray[0], {
    expectedContainerName: options.expectedContainerName,
    expectedRunnerWorkspaceHostPath: options.expectedRunnerWorkspaceHostPath,
  });

  if (attachedNetwork !== options.expectedNetworkName) {
    throw new Error("docker_isolation_unexpected_attached_network");
  }

  return { ok: true, attachedNetwork };
}

/**
 * @param {unknown} containerInspectArray
 * @param {unknown} networkInspectArray
 * @param {{ expectedContainerName: string, expectedNetworkName: string, expectedRunnerWorkspaceHostPath?: string }} options
 */
export function validateDockerIsolationPair(
  containerInspectArray,
  networkInspectArray,
  options,
) {
  validateDockerIsolationFromInspect(containerInspectArray, options);
  if (!Array.isArray(networkInspectArray) || networkInspectArray.length !== 1) {
    throw new Error("docker_isolation_network_inspect_array_invalid");
  }
  validateNetworkInspect(networkInspectArray[0], {
    expectedNetworkName: options.expectedNetworkName,
  });
  return { ok: true };
}
