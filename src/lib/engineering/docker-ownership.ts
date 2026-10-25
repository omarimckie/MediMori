import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EngineeringInputError } from "./policy";

const exec = promisify(execFile);
export type DockerCommand = (args: string[]) => Promise<string>;
export const dockerOwnershipLabels = {
  task: "com.medimori.engineering.task-id",
  run: "com.medimori.engineering.run-id",
  type: "com.medimori.engineering.resource-type",
} as const;
export const executionResourceTypes = [
  "populate-container",
  "validation-container",
  "source-volume",
  "cache-volume",
  "uploads-volume",
  "private-volume",
] as const;
export type ExecutionResourceType = typeof executionResourceTypes[number];
export type DockerOwnership = { taskId: string; runId: string };
export type CleanupFailure = { resourceType: ExecutionResourceType; category: "docker_unavailable" | "resource_in_use" | "already_absent" | "docker_error" | "too_many_owned_resources" };
export type CleanupResult = { attempted: number; removed: number; failures: CleanupFailure[] };

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateDockerOwnership(owner: DockerOwnership) {
  if (!uuid.test(owner.taskId) || !uuid.test(owner.runId)) throw new Error("Invalid execution ownership.");
  return owner;
}
export function dockerOwnershipArgs(owner: DockerOwnership, type: ExecutionResourceType) {
  validateDockerOwnership(owner);
  return [
    "--label", `${dockerOwnershipLabels.task}=${owner.taskId}`,
    "--label", `${dockerOwnershipLabels.run}=${owner.runId}`,
    "--label", `${dockerOwnershipLabels.type}=${type}`,
  ];
}

export class DockerCleanupError extends EngineeringInputError {
  constructor(readonly cleanupFailures: CleanupFailure[]) { super("Sandbox resource cleanup failed."); }
}

function classify(error: unknown): CleanupFailure["category"] {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "docker_unavailable";
  const stderr = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  if (/no such (container|volume)|not found|does not exist/i.test(stderr)) return "already_absent";
  return /in use|being used|is being used/i.test(stderr) ? "resource_in_use" : "docker_error";
}

/** Remove only containers and volumes carrying this execution's complete ownership labels. */
const defaultDockerCommand: DockerCommand = async args => (await exec("docker", args, { timeout: 15000, windowsHide: true })).stdout;
export async function cleanupOwnedDockerResources(owner: DockerOwnership, docker: DockerCommand = defaultDockerCommand): Promise<CleanupResult> {
  validateDockerOwnership(owner);
  const result: CleanupResult = { attempted: 0, removed: 0, failures: [] };
  const selectors = [
    "--filter", `label=${dockerOwnershipLabels.task}=${owner.taskId}`,
    "--filter", `label=${dockerOwnershipLabels.run}=${owner.runId}`,
  ];
  const kinds: Array<{ resourceType: ExecutionResourceType; list: string[]; remove: string }> = [
    { resourceType: "populate-container", list: ["ps", "--all", "--quiet"], remove: "rm" },
    { resourceType: "validation-container", list: ["ps", "--all", "--quiet"], remove: "rm" },
    { resourceType: "source-volume", list: ["volume", "ls", "--quiet"], remove: "volume rm" },
    { resourceType: "cache-volume", list: ["volume", "ls", "--quiet"], remove: "volume rm" },
    { resourceType: "uploads-volume", list: ["volume", "ls", "--quiet"], remove: "volume rm" },
    { resourceType: "private-volume", list: ["volume", "ls", "--quiet"], remove: "volume rm" },
  ];
  const failures: CleanupFailure[] = [];
  for (const kind of kinds) {
    let ids: string[];
    try {
      const stdout = await docker([...kind.list, ...selectors, "--filter", `label=${dockerOwnershipLabels.type}=${kind.resourceType}`]);
      ids = stdout.split(/\r?\n/).map(id => id.trim()).filter(Boolean);
    } catch (error) {
      failures.push({ resourceType: kind.resourceType, category: classify(error) });
      continue;
    }
    if (ids.length > 16) {
      failures.push({ resourceType: kind.resourceType, category: "too_many_owned_resources" });
      continue;
    }
    for (const id of ids) {
      result.attempted++;
      const args = kind.remove === "rm" ? ["rm", "--force", id] : ["volume", "rm", id];
      try {
        await docker(args);
        result.removed++;
      } catch (error) {
        const category=classify(error);
        if(category==="already_absent")result.removed++;
        else failures.push({ resourceType: kind.resourceType, category });
      }
    }
  }
  result.failures = failures.slice(0, 16);
  return result;
}
