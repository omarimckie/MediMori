import {
  resolveHarnessMode,
  runStagingAcceptancePreflight,
} from "../src/lib/central-agent-manager/orchestration/cam-consumer-staging-acceptance-harness";

function main(): void {
  const mode = resolveHarnessMode(process.env, process.argv);
  const lines = runStagingAcceptancePreflight({ env: process.env, mode });
  const failed = lines.filter((row) => !row.ok);
  for (const row of lines) {
    console.log(JSON.stringify(row));
  }
  if (failed.length) process.exitCode = 1;
  else console.log(JSON.stringify({ ok: true, code: "preflight_ready", message: "Harness preflight passed (no network I/O)." }));
}

main();
