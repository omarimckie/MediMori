/**
 * Run-scoped Docker resource identity and cleanup ownership (pure logic).
 */

const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/;

export function validateRunId(runId) {
  const trimmed = String(runId ?? "").trim();
  if (!trimmed) {
    throw new Error("dispatcher_watchdog_run_id_required");
  }
  if (!RUN_ID_PATTERN.test(trimmed)) {
    throw new Error("dispatcher_watchdog_run_id_invalid");
  }
  return trimmed;
}

export function resourceNamesForRun(runId) {
  const id = validateRunId(runId);
  return {
    runId: id,
    postgresContainer: `tf-watchdog-pg-${id}`,
    runnerContainer: `tf-watchdog-runner-${id}`,
    network: `tf-watchdog-net-${id}`,
    volume: `tf-watchdog-pg-data-${id}`,
  };
}

export function assertOwnedResourceName(runId, resourceName, kind) {
  const names = resourceNamesForRun(runId);
  const allowed = new Set([
    names.postgresContainer,
    names.runnerContainer,
    names.network,
    names.volume,
  ]);
  if (!allowed.has(resourceName)) {
    throw new Error(`cleanup_resource_not_owned:${kind}:${resourceName}`);
  }
  return resourceName;
}

export class RunResourceLedger {
  constructor(runId) {
    this.runId = validateRunId(runId);
    this.names = resourceNamesForRun(this.runId);
    /** @type {Array<{ id: string, name: string }>} */
    this.containers = [];
    /** @type {Array<{ id: string, name: string }>} */
    this.networks = [];
    /** @type {Array<{ id: string, name: string }>} */
    this.volumes = [];
  }

  registerContainer(id, name) {
    assertOwnedResourceName(this.runId, name, "container");
    this.containers.push({ id: String(id), name: String(name) });
  }

  registerNetwork(id, name) {
    assertOwnedResourceName(this.runId, name, "network");
    this.networks.push({ id: String(id), name: String(name) });
  }

  registerVolume(id, name) {
    assertOwnedResourceName(this.runId, name, "volume");
    this.volumes.push({ id: String(id), name: String(name) });
  }

  cleanupPlan() {
    return {
      containers: [...this.containers],
      networks: [...this.networks],
      volumes: [...this.volumes],
    };
  }

  /**
   * @param {{ containers?: string[], networks?: string[], volumes?: string[] }} remaining
   */
  verifyCleanupComplete(remaining) {
    const left = {
      containers: remaining.containers ?? [],
      networks: remaining.networks ?? [],
      volumes: remaining.volumes ?? [],
    };
    if (left.containers.length || left.networks.length || left.volumes.length) {
      throw new Error(
        `cleanup_incomplete:${JSON.stringify(left)}`,
      );
    }
    return true;
  }
}
