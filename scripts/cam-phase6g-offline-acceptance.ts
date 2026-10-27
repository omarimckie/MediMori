import { spawnSync } from "node:child_process";
import { join } from "node:path";

const files = [
  "src/lib/central-agent-manager/phase6g/phase6g-budget-lifecycle-pglite.integration.test.ts",
  "src/lib/central-agent-manager/phase6g/phase6g-budget-stress-pglite.integration.test.ts",
  "src/lib/central-agent-manager/phase6g/phase6g-full-closed-loop-pglite.integration.test.ts",
  "src/lib/central-agent-manager/phase6g/phase6g-crash-boundaries-pglite.integration.test.ts",
  "src/lib/central-agent-manager/phase6g/phase6g-worker-supervision.test.ts",
  "src/lib/central-agent-manager/phase6g/phase6g-linux-workspace-symlink.test.ts",
  "src/lib/central-agent-manager/phase6e/phase6e-project-workspace-isolation.test.ts",
];

function main(): void {
  process.env.CURSOR_API_KEY = "";
  delete process.env.CAM_ORCHESTRATION_DATABASE_URL;
  delete process.env.CAM_APPROVAL_DISPOSABLE_EXECUTE;
  const tsxBin = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const result = spawnSync(tsxBin, ["--test", ...files], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) process.exitCode = 1;
  else console.log(JSON.stringify({ ok: true, code: "phase6g_offline_acceptance", files }));
}

main();
