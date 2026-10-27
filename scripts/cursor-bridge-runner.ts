import { isCursorBridgeRunnerEnabled } from "../src/lib/central-agent-manager/orchestration/flags";
import { runCursorBridgeRunnerProcess } from "../src/lib/central-agent-manager/orchestration/cursor-bridge/cursor-bridge-runner-runtime";

async function main(): Promise<void> {
  if (!isCursorBridgeRunnerEnabled()) {
    console.error(
      "Cursor bridge runner is disabled. Set CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED=true after reviewing docs/central-agent-manager/CURSOR_BRIDGE_RUNNER.md",
    );
    process.exitCode = 1;
    return;
  }
  try {
    const result = await runCursorBridgeRunnerProcess();
    if (result.stopReason !== "completed" && result.stopReason !== "signal") {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Cursor bridge runner failed.");
    process.exitCode = 1;
  }
}

main();
