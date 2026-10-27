import { spawnSync } from "node:child_process";
import { join } from "node:path";

const files = [
  "src/lib/central-agent-manager/phase6f/phase6f-budget-dispatch-pglite.integration.test.ts",
  "src/lib/central-agent-manager/phase6f/phase6f-approval-sql-pglite.integration.test.ts",
  "src/lib/central-agent-manager/phase6f/phase6f-manifest-backend-report.test.ts",
  "src/lib/central-agent-manager/phase6e/phase6e-closed-loop-pglite.integration.test.ts",
  "src/lib/central-agent-manager/phase6f/phase6f-cursor-adapter-contract.test.ts",
  "src/lib/central-agent-manager/phase6f/phase6f-security-fail-closed.test.ts",
  "src/lib/central-agent-manager/phase6e/phase6e-project-workspace-isolation.test.ts",
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
  else console.log(JSON.stringify({ ok: true, code: "phase6f_offline_acceptance", files }));
}

main();
