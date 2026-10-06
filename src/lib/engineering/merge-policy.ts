import { EngineeringInputError } from "./policy";

export const mergeTargetPolicy = Object.freeze({ repository: "omarimckie/MediMori", branch: "main", remote: "origin" });

export type MergeTarget = { repository: string; branch: string; remote: string };

/** Merge stays disabled until a separately provisioned target and executor identity are configured. */
export function configuredMergeTarget(env: NodeJS.ProcessEnv = process.env): MergeTarget {
  if (env.ENGINEERING_MERGE_ENABLED !== "true") throw new EngineeringInputError("Engineering merge execution is disabled.");
  const target = {
    repository: env.ENGINEERING_MERGE_TARGET_REPOSITORY?.trim() ?? "",
    branch: env.ENGINEERING_MERGE_TARGET_BRANCH?.trim() ?? "",
    remote: env.ENGINEERING_MERGE_TARGET_REMOTE?.trim() || mergeTargetPolicy.remote,
  };
  if (target.repository !== mergeTargetPolicy.repository || target.branch !== mergeTargetPolicy.branch || target.remote !== mergeTargetPolicy.remote) {
    throw new EngineeringInputError("Engineering merge target does not match the approved project policy.");
  }
  return target;
}

export function repositoryHttpsUrl(repository: string) {
  if (repository !== mergeTargetPolicy.repository) throw new EngineeringInputError("Unapproved merge repository.");
  return `https://github.com/${mergeTargetPolicy.repository}.git`;
}

export function isSafeMergeRelativePath(path: string): boolean {
  return typeof path === "string" && path.length <= 240 && /^[\w./-]+$/.test(path) && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..") && !path.startsWith(".git/") && !path.startsWith(".env");
}
