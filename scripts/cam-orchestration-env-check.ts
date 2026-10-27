import { diagnoseOrchestrationEnvFromProcessEnv } from "../src/lib/central-agent-manager/orchestration/orchestration-env-safeguards";

function main(): void {
  const diagnostics = diagnoseOrchestrationEnvFromProcessEnv();
  for (const row of diagnostics) {
    console.log(JSON.stringify({ ok: row.ok, code: row.code, message: row.message }));
  }
  if (diagnostics.some((row) => !row.ok)) {
    process.exitCode = 1;
  }
}

main();
