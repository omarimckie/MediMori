import { FileCursorBridgeRunnerLockStore } from "../src/lib/central-agent-manager/orchestration/cursor-bridge/cursor-bridge-runner-file-lock";

async function main(): Promise<void> {
  const action = process.argv[2];
  const lockPath = process.argv[3];
  const runnerId = process.argv[4] ?? "lock-probe-runner";
  if (!action || !lockPath) {
    console.error("Usage: cursor-bridge-runner-lock-probe.ts <acquire|release> <lockPath> [runnerId]");
    process.exitCode = 2;
    return;
  }
  const store = new FileCursorBridgeRunnerLockStore();
  if (action === "acquire") {
    const acquired = await store.tryAcquire(lockPath, {
      runnerId,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    });
    process.stdout.write(acquired ? "acquired\n" : "contested\n");
    process.exitCode = acquired ? 0 : 1;
    return;
  }
  if (action === "release") {
    await store.release(lockPath, runnerId);
    process.stdout.write("released\n");
    return;
  }
  console.error(`Unknown action: ${action}`);
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "lock probe failed");
  process.exitCode = 1;
});
