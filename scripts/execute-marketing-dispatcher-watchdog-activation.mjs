/**
 * Operator-only QStash primary watchdog activation.
 * Run: npx tsx scripts/execute-marketing-dispatcher-watchdog-activation.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { executeDispatcherWatchdogActivation } from "./marketing-dispatcher-watchdog-activation-runner.mjs";

export { executeDispatcherWatchdogActivation };

async function main() {
  const result = await executeDispatcherWatchdogActivation(process.env);
  if (result.dryRun) {
    console.log(JSON.stringify(result.dryRun));
    return;
  }
  console.log(
    JSON.stringify({
      ok: true,
      primaryQstashActivatedAt: result.state.primaryQstashActivatedAt,
      targetHost: result.targetHost,
      targetDatabase: result.targetDatabase,
      attestationIdPresent: Boolean(result.evidence.attestationId),
      verifiedAt: result.evidence.verifiedAt,
    }),
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]));

if (isMain) {
  main().catch((error) => {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "dispatcher_watchdog_activation_failed";
    console.error(code);
    process.exit(1);
  });
}
