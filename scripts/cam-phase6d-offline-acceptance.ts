/**
 * Phase 6d offline acceptance — SQL objective store, approvals, integrated scenarios.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const files = [
  "src/lib/central-agent-manager/phase6d/phase6d-postgres-objective-store.test.ts",
  "src/lib/central-agent-manager/phase6d/phase6d-approval-manifest-38.test.ts",
  "src/lib/central-agent-manager/phase6d/phase6d-integrated-scenarios.integration.test.ts",
  "src/lib/central-agent-manager/phase6c/phase6c-durable-closed-loop.integration.test.ts",
];

function main(): void {
  process.env.CURSOR_API_KEY = "";
  delete process.env.CAM_ORCHESTRATION_DATABASE_URL;
  delete process.env.CAM_APPROVAL_DISPOSABLE_DATABASE_URL;
  const tsxBin = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const result = spawnSync(tsxBin, ["--test", ...files], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) process.exitCode = 1;
  else console.log(JSON.stringify({ ok: true, code: "phase6d_offline_acceptance", files }));
}

main();
