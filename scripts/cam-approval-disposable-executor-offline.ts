import { createOfflineDisposableMockPort } from "../src/lib/central-agent-manager/adapter/approval-disposable-offline-mock-port";
import {
  listMandatoryDisposableCases,
  redactDisposableExecutorReport,
  runDisposableCaseOffline,
} from "../src/lib/central-agent-manager/adapter/approval-disposable-postgres-executor";

async function main(): Promise<void> {
  if (process.env.CAM_APPROVAL_DISPOSABLE_EXECUTE === "true") {
    console.log(
      JSON.stringify({
        ok: false,
        code: "neon_execute_forbidden",
        message: "This offline entrypoint does not connect to Neon. Unset CAM_APPROVAL_DISPOSABLE_EXECUTE.",
      }),
    );
    process.exitCode = 1;
    return;
  }
  const slice = listMandatoryDisposableCases().filter((case_) =>
    ["1.1", "1.2", "1.3", "1.4", "4.4", "5.1", "6.1", "6.2", "7.1", "7.2"].includes(case_.id),
  );
  const executed = [];
  for (const case_ of slice) {
    const result = await runDisposableCaseOffline(case_, createOfflineDisposableMockPort(case_));
    executed.push(result);
    if (!result.ok && case_.stopOnFail) break;
  }
  const report = {
    ok: executed.every((row) => row.ok),
    executed,
    skipped: slice.slice(executed.length).map((row) => row.id),
  };
  console.log(JSON.stringify(redactDisposableExecutorReport(report)));
  if (!report.ok) process.exitCode = 1;
}

main().catch(() => {
  process.exitCode = 1;
});
