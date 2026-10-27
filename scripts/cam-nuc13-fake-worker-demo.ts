/**
 * Disabled-by-default NUC13 fake-worker demonstration (no live API / external DB).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

function main(): void {
  if (process.env.CAM_NUC13_FAKE_WORKER_DEMO !== "1") {
    console.log(
      JSON.stringify({
        ok: false,
        code: "demo_disabled",
        message:
          "Set CAM_NUC13_FAKE_WORKER_DEMO=1 after cam:phase6d-offline-acceptance passes. No live Cursor or Neon.",
      }),
    );
    process.exitCode = 1;
    return;
  }
  process.env.CURSOR_API_KEY = "";
  delete process.env.CAM_ORCHESTRATION_DATABASE_URL;
  const tsxBin = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const acceptance = spawnSync(tsxBin, ["scripts/cam-fake-worker-workflow-demo.ts"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (acceptance.status !== 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify({
      ok: true,
      code: "nuc13_fake_worker_demo",
      message: "Offline fake-worker path validated. Enable bridge fake transport separately with homelab env.",
      emergencyStop: "Create emergency-stop file per deploy/homelab/cam-bridge.env.example",
      rollback: "Unset CAM_NUC13_FAKE_WORKER_DEMO and remove temp objective files.",
    }),
  );
}

main();
