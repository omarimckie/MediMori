import { lstat, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { EngineeringInputError } from "./policy";
import { createFreshExport, exportedWorkspaceRevision, preflightEngineeringScratch } from "./workspace";

const revisionPattern = /^[a-f0-9]{40}$/;

function sourcePaths(env: NodeJS.ProcessEnv) {
  const sourceRoot = env.ENGINEERING_WORKSPACE_SOURCE;
  const exportParent = env.ENGINEERING_WORKSPACE_EXPORT;
  const scratchRoot = env.ENGINEERING_SCRATCH_ROOT;
  if (!sourceRoot || !exportParent || !scratchRoot) throw new EngineeringInputError("Configured engineering source binding is unavailable.");
  return { sourceRoot: resolve(sourceRoot), exportParent: resolve(exportParent), scratchRoot: resolve(scratchRoot) };
}

async function removeOwnedExport(path: string) {
  await rm(path, { recursive: true, force: true });
  try {
    await lstat(path);
    throw new EngineeringInputError("Temporary engineering source export cleanup could not be verified.");
  } catch (error) {
    if (error instanceof EngineeringInputError) throw error;
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw new EngineeringInputError("Temporary engineering source export cleanup could not be verified.");
    }
  }
}

/** Computes the approved implementation identity with the same sanitized export used by the worker. */
export async function deriveImplementationSourceRevision(env: NodeJS.ProcessEnv = process.env) {
  const { sourceRoot, exportParent, scratchRoot } = sourcePaths(env);
  await preflightEngineeringScratch(sourceRoot, scratchRoot, exportParent);
  return computeImplementationSourceRevision(sourceRoot, exportParent);
}

/** Shared sanitized-export calculation; its unique temporary export is removed after hashing. */
export async function computeImplementationSourceRevision(sourceRoot: string, exportParent: string) {
  const exportRoot = await createFreshExport(sourceRoot, exportParent);
  try {
    return await exportedWorkspaceRevision(exportRoot);
  } finally {
    await removeOwnedExport(exportRoot);
  }
}

export class ApprovedSourceRevisionMismatch extends EngineeringInputError {
  constructor() { super("The execution source does not match the approved implementation source revision."); }
}

/** Creates the run's fresh sanitized export and verifies P+T+S before any claim or Docker setup. */
export async function createApprovedExecutionExport(
  sourceRoot: string,
  exportParent: string,
  approvedRevision: string,
  onMismatch: (actualRevision: string) => Promise<void>,
) {
  if (!revisionPattern.test(approvedRevision)) throw new EngineeringInputError("Approved implementation source revision is invalid.");
  const exportRoot = await createFreshExport(sourceRoot, exportParent);
  try {
    const actualRevision = await exportedWorkspaceRevision(exportRoot);
    if (actualRevision !== approvedRevision) {
      await onMismatch(actualRevision);
      throw new ApprovedSourceRevisionMismatch();
    }
    return { exportRoot, revision: actualRevision };
  } catch (error) {
    await removeOwnedExport(exportRoot);
    throw error;
  }
}
