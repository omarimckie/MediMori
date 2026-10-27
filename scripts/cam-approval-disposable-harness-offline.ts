import {
  dryRunValidateDisposableManifest,
  disposableVerificationManifest,
} from "../src/lib/central-agent-manager/verification/disposable-verification-manifest";

function main(): void {
  const report = dryRunValidateDisposableManifest();
  const matrix = disposableVerificationManifest.map((case_) => ({
    id: case_.id,
    phase: case_.phase,
    role: case_.role,
    expectedOutcome: case_.expectedOutcome,
    offlineAutomated: false,
    requiresDisposablePostgres: true,
  }));
  console.log(JSON.stringify({ ok: report.ok, report, caseCount: matrix.length }));
  for (const row of matrix) {
    console.log(JSON.stringify(row));
  }
  if (!report.ok) process.exitCode = 1;
}

main();
