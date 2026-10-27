/**
 * Homelab offline acceptance (default safe). Does not install services or contact Proxmox.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const files = [
  "src/lib/central-agent-manager/orchestration/cursor-bridge/cursor-bridge-offline-lifecycle-full.test.ts",
  "src/lib/central-agent-manager/orchestration/cursor-bridge/cursor-bridge-durable-offline-lifecycle.integration.test.ts",
  "src/lib/central-agent-manager/orchestration/cursor-bridge/cursor-bridge-runner-shutdown.test.ts",
  "src/lib/central-agent-manager/orchestration/cursor-bridge/cursor-bridge-runner-shutdown-extended.test.ts",
  "src/lib/central-agent-manager/orchestration/cursor-bridge/cursor-bridge-runner-lock-concurrency.test.ts",
  "src/lib/central-agent-manager/orchestration/cursor-bridge/cursor-bridge-runner-budget-reliability.test.ts",
  "src/lib/central-agent-manager/orchestration/cursor-bridge/cursor-bridge-runner-process-security.test.ts",
];

function main(): void {
  process.env.CURSOR_API_KEY = "";
  delete process.env.CAM_ORCHESTRATION_DATABASE_URL;
  const tsxBin = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const result = spawnSync(tsxBin, ["--test", ...files], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.error) {
    console.error(JSON.stringify({ ok: false, code: "spawn_failed", message: result.error.message }));
  }
  if (result.status !== 0) process.exitCode = 1;
  else console.log(JSON.stringify({ ok: true, code: "homelab_offline_acceptance", files }));
}

main();
