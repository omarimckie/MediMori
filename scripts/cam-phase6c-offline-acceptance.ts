/**
 * Phase 6c offline acceptance — durable objective manager + restart scenario.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const files = [
  "src/lib/central-agent-manager/phase6c/phase6c-durable-closed-loop.integration.test.ts",
  "src/lib/central-agent-manager/phase6c/phase6c-budget-reservation.test.ts",
  "src/lib/central-agent-manager/phase6c/phase6c-security.test.ts",
  "src/lib/central-agent-manager/phase6c/phase6c-escalation.test.ts",
  "src/lib/central-agent-manager/phase6c/phase6c-approval-offline-expansion.test.ts",
  "src/lib/central-agent-manager/phase6b/phase6b-queue-backed.integration.test.ts",
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
  if (result.status !== 0) process.exitCode = 1;
  else console.log(JSON.stringify({ ok: true, code: "phase6c_offline_acceptance", files }));
}

main();
