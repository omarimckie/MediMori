import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export const validationPreparationOperations = [
  "local_staging_export",
  "docker_volume_create",
  "docker_populate_create",
  "docker_populate_workspace",
  "docker_populate_uploads",
  "docker_populate_remove",
  "docker_overlay_init",
  "staging_cleanup",
] as const;
export type ValidationPreparationOperation = typeof validationPreparationOperations[number];

/** Scale populate timeouts for large Git manifests; the prior fixed 60s bound was too low on Windows Docker Desktop. */
export function sourceVolumePopulateTimeoutMs(fileCount: number): number {
  const bounded = Number.isFinite(fileCount) && fileCount > 0 ? Math.floor(fileCount) : 1;
  const scaled = 60_000 + bounded * 250;
  return Math.min(600_000, Math.max(120_000, scaled));
}

const populateHelperOverheadMs = 60_000;

/** Keep the populate helper alive through workspace and optional uploads tar streams plus bounded overhead. */
export function populateHelperKeepAliveMs(fileCount: number, includeUploads: boolean): number {
  const workspaceTimeoutMs = sourceVolumePopulateTimeoutMs(fileCount);
  const uploadsTimeoutMs = includeUploads ? Math.min(workspaceTimeoutMs, 180_000) : 0;
  return Math.min(900_000, workspaceTimeoutMs + uploadsTimeoutMs + populateHelperOverheadMs);
}

export function populateHelperKeepAliveSeconds(fileCount: number, includeUploads: boolean): number {
  return Math.ceil(populateHelperKeepAliveMs(fileCount, includeUploads) / 1000);
}

export function populateHelperEntrypointCommand(fileCount: number, includeUploads: boolean): string {
  const seconds = populateHelperKeepAliveSeconds(fileCount, includeUploads);
  if (!Number.isInteger(seconds) || seconds < 120 || seconds > 900) throw new Error("Invalid populate helper lifetime.");
  return `sleep ${seconds}`;
}

type SpawnLike = typeof spawn;

function isContainerDirectoryAllowed(containerDirectory: string) {
  return containerDirectory === "/workspace" || containerDirectory === "/uploads";
}

/** Streams a host directory into a running container via tar to avoid slow per-file docker cp on Windows. */
export function streamTarDirectoryIntoDockerExec(
  helperContainer: string,
  hostDirectory: string,
  containerDirectory: string,
  timeoutMs: number,
  spawnImpl: SpawnLike = spawn,
): Promise<void> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(helperContainer)) return Promise.reject(new Error("Invalid helper container."));
  if (!isContainerDirectoryAllowed(containerDirectory)) return Promise.reject(new Error("Invalid container directory."));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) return Promise.reject(new Error("Invalid populate timeout."));
  return new Promise((resolve, reject) => {
    let settled = false;
    let tarCode: number | null = null;
    let dockerCode: number | null = null;
    const terminateChildren = () => {
      for (const proc of [tarProc, dockerProc]) {
        if (proc && proc.exitCode === null && !proc.killed) {
          try { proc.kill("SIGTERM"); } catch { /* ignore kill races */ }
        }
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) terminateChildren();
      if (error) reject(error);
      else resolve();
    };
    const checkBoth = () => {
      if (tarCode === null || dockerCode === null || settled) return;
      if (tarCode === 0 && dockerCode === 0) finish();
      else finish(Object.assign(new Error("Populate failed."), { code: dockerCode !== 0 ? "DOCKER_POPULATE_FAILED" : "TAR_FAILED" }));
    };
    const timer = setTimeout(() => {
      finish(Object.assign(new Error("Populate timed out."), { code: "ETIMEDOUT", killed: true }));
    }, timeoutMs);
    const tarProc = spawnImpl("tar", ["-C", hostDirectory, "-cf", "-", "."], { windowsHide: true }) as ChildProcessWithoutNullStreams;
    const dockerProc = spawnImpl("docker", ["exec", "-i", helperContainer, "tar", "-xf", "-", "-C", containerDirectory], { windowsHide: true }) as ChildProcessWithoutNullStreams;
    tarProc.stdout.pipe(dockerProc.stdin);
    dockerProc.stdin.on("error", () => {});
    tarProc.on("error", error => finish(error instanceof Error ? error : new Error("Tar spawn failed.")));
    dockerProc.on("error", error => finish(error instanceof Error ? error : new Error("Docker exec spawn failed.")));
    tarProc.on("close", code => {
      tarCode = code ?? 1;
      if (tarCode !== 0) terminateChildren();
      checkBoth();
    });
    dockerProc.on("close", code => {
      dockerCode = code ?? 1;
      if (dockerCode !== 0) terminateChildren();
      checkBoth();
    });
  });
}
