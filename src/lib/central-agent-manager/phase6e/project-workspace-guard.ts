import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve a project workspace root and reject paths outside it (including symlink traversal).
 */
export function assertPathWithinProjectWorkspace(workspaceRoot: string, candidatePath: string): void {
  const rootReal = realpathSync(resolve(workspaceRoot));
  const candidateResolved = resolve(candidatePath);
  if (!existsSync(candidateResolved)) {
    throw new Error("Path does not exist.");
  }
  const candidateReal = realpathSync(candidateResolved);
  const prefix = rootReal.endsWith("\\") || rootReal.endsWith("/") ? rootReal : `${rootReal}`;
  if (candidateReal !== prefix && !candidateReal.startsWith(`${prefix}\\`) && !candidateReal.startsWith(`${prefix}/`)) {
    throw new Error("Path escapes project workspace boundary.");
  }
}

export function projectWorkspaceRoot(projectId: string, baseDir: string): string {
  return resolve(baseDir, projectId);
}
