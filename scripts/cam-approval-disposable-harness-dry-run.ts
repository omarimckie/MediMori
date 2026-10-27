import {
  dryRunValidateDisposableManifest,
  disposableVerificationManifest,
  MANDATORY_DISPOSABLE_VERIFICATION_IDS,
} from "../src/lib/central-agent-manager/verification/disposable-verification-manifest";

function main(): void {
  const report = dryRunValidateDisposableManifest();
  console.log(
    JSON.stringify({
      ok: report.ok,
      caseCount: report.caseCount,
      mandatoryCount: MANDATORY_DISPOSABLE_VERIFICATION_IDS.length,
      duplicateIds: report.duplicateIds,
      missingIds: report.missingIds,
      extraIds: report.extraIds,
    }),
  );
  for (const case_ of disposableVerificationManifest) {
    console.log(JSON.stringify({ id: case_.id, phase: case_.phase, role: case_.role, expected: case_.expectedOutcome }));
  }
  if (!report.ok) process.exitCode = 1;
}

main();
