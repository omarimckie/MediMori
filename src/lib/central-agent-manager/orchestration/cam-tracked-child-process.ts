import type { ChildProcess } from "node:child_process";

/** Env marker set on children spawned by CAM smoke/dev helpers (process-scoped ownership). */
export const CAM_TRACKED_CHILD_MARKER_ENV = "CAM_TRACKED_CHILD_OWNER_PID";

export type TrackedChildProcess = {
  child: ChildProcess;
  ownerPid: number;
  label: string;
};

export function createTrackedChildOwnershipEnv(ownerPid: number = process.pid): Record<string, string> {
  return { [CAM_TRACKED_CHILD_MARKER_ENV]: String(ownerPid) };
}

export function isTrackedChildProcess(child: ChildProcess | null | undefined): boolean {
  return Boolean(child && typeof child.pid === "number" && child.pid > 0);
}

/**
 * Returns PIDs that may be terminated for this tracked child only.
 * Never matches by image name (e.g. never all node.exe).
 */
export function trackedChildTerminationPids(child: ChildProcess): number[] {
  if (!isTrackedChildProcess(child)) return [];
  return [child.pid!];
}

export function assertNeverBroadNodeTermination(command: string): void {
  const normalized = command.toLowerCase();
  const taskkillByNodeImage =
    /\btaskkill\b/.test(normalized) && /\/im\s+node\.exe\b/.test(normalized);
  if (taskkillByNodeImage || (/\bnode\.exe\b/.test(normalized) && /\s\/im\s/.test(normalized))) {
    throw new Error("Broad node.exe image termination is forbidden for CAM smoke cleanup.");
  }
  if (normalized.includes("killall node") || normalized.includes("pkill node")) {
    throw new Error("Broad node process pattern termination is forbidden for CAM smoke cleanup.");
  }
}

export async function terminateTrackedChild(child: ChildProcess, label: string): Promise<void> {
  if (!isTrackedChildProcess(child)) return;
  const pid = child.pid!;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  void label;
  void pid;
}
