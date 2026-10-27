import { spawn } from "node:child_process";

const MARKER = "CAM_TRACKED_CHILD_OWNER_PID";

export function spawnTrackedDevServer(cwd, extraEnv = {}) {
  return spawn("npm", ["run", "dev"], {
    cwd,
    shell: true,
    env: { ...process.env, [MARKER]: String(process.pid), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function stopTrackedDevServer(child) {
  if (!child?.pid) return Promise.resolve();
  return new Promise((resolve) => {
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
