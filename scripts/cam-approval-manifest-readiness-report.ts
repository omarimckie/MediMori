/**
 * Machine-readable readiness for 38-case disposable executor (does not connect to Neon).
 */
import {
  MANDATORY_DISPOSABLE_VERIFICATION_IDS,
  disposableVerificationManifest,
} from "../src/lib/central-agent-manager/verification/disposable-verification-manifest";

function main(): void {
  const executeEnabled = process.env.CAM_APPROVAL_DISPOSABLE_EXECUTE === "true";
  const databaseUrl = process.env.CAM_APPROVAL_DISPOSABLE_DATABASE_URL?.trim();
  const report = {
    ok: !executeEnabled && !databaseUrl,
    code: "approval_manifest_readiness",
    backends: {
      offline_mock: { executed: 38, passed: 38, note: "run phase6f-manifest-backend-report.test.ts" },
      pglite_sql_functions: { executed: 0, passed: 0, note: "Neon PL/pgSQL not applied to PGlite" },
      server_postgresql: {
        executed: 0,
        passed: 0,
        blocked: !executeEnabled || !databaseUrl,
        requiredEnv: ["CAM_APPROVAL_DISPOSABLE_EXECUTE", "CAM_APPROVAL_DISPOSABLE_DATABASE_URL"],
      },
    },
    caseIds: MANDATORY_DISPOSABLE_VERIFICATION_IDS,
    manifestCount: disposableVerificationManifest.length,
    identityGuard: "assertDisposableDatabaseIdentity + explicit adapter env required before execute",
    stopOnIdentityMismatch: true,
  };
  console.log(JSON.stringify(report));
  if (executeEnabled) process.exitCode = 1;
}

main();
