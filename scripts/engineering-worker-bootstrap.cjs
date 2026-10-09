"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- CJS bootstrap must register tsx before loading the worker graph. */

// This bootstrap deliberately uses the same CJS registration path as `tsx`
// scripts in this repository. Load the narrow host compatibility shim before
// tsx initializes its cache and pipe helpers.
require("./engineering-worker-tsx-compat.cjs");
require("tsx/cjs");

const worker = require("./engineering-worker.ts");

if (process.argv[2] === "--module-graph-smoke") {
  // Importing the real worker graph is safe: worker.ts exports main() and has
  // no execution-on-import behavior. This branch never calls that function.
  process.stdout.write("engineering-worker-module-graph-loaded\n");
} else if (process.argv[2] === "--initialization-diagnostic") {
  // This path calls only the worker's read-only config/scratch preflight.
  // It never calls main(), which owns DB identity, export, claim, provider,
  // and Docker operations.
  worker.diagnoseWorkerInitialization(process.env).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ready) process.exitCode = 1;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({
      ready: false,
      stage: "initialization",
      code: "unexpected_setup_failure",
      summary: "Initialization stopped unexpectedly; sensitive error details were withheld.",
      beforeClaim: true,
      providerCouldHaveBeenReached: false,
      dockerCouldHaveBeenReached: false,
    })}\n`);
    process.exitCode = 1;
  });
} else if (process.argv[2] === "--database-identity-diagnostic") {
  // Shares production config parsing, Neon construction, and the read-only
  // identity/privilege query. It has no path to main(), ingress, or claim.
  worker.diagnoseWorkerDatabaseIdentity(process.env).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ready) process.exitCode = 1;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({
      ready: false,
      stage: "initialization",
      code: "unexpected_setup_failure",
      summary: "Initialization stopped unexpectedly; sensitive error details were withheld.",
      beforeClaim: true,
      providerCouldHaveBeenReached: false,
      dockerCouldHaveBeenReached: false,
    })}\n`);
    process.exitCode = 1;
  });
} else if (process.argv[2] === "--source-export-diagnostic") {
  // Runs the real sanitizer under its configured scratch root and cleans only
  // its unique diagnostic directory. This branch has no database/provider/Docker path.
  worker.diagnoseWorkerSourceExport(process.env).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ready) process.exitCode = 1;
  }).catch(() => {
    process.stdout.write(`${JSON.stringify({
      ready: false,
      stage: "source_export",
      code: "unexpected_setup_failure",
      summary: "Source export diagnostics failed without exposing sensitive details.",
      beforeClaim: true,
      providerCouldHaveBeenReached: false,
      dockerCouldHaveBeenReached: false,
    })}\n`);
    process.exitCode = 1;
  });
} else {
  const runId = process.argv[2];
  if (!/^[a-f0-9-]{36}$/i.test(runId ?? "")) {
    console.error("A worker run ID is required.");
    process.exitCode = 2;
  } else {
    worker.main(runId).catch(error => {
      const { WorkerInitializationError, sanitizedInitializationDiagnostic } = require("../src/lib/engineering/worker-initialization");
      const { WorkspaceExportError } = require("../src/lib/engineering/workspace-export-diagnostics");
      const { PreclaimWorkerError, preclaimDiagnosticToJson } = require("../src/lib/engineering/preclaim-diagnostics");
      if (error instanceof PreclaimWorkerError) {
        console.error(JSON.stringify({
          ...preclaimDiagnosticToJson(error.diagnostic),
          ...(error.localExportDiagnostic ? { ownerActionableExportFailure: error.localExportDiagnostic } : {}),
        }));
      } else if (error instanceof WorkerInitializationError || error instanceof WorkspaceExportError) {
        console.error(JSON.stringify(sanitizedInitializationDiagnostic(error, true)));
      } else {
        // Runtime failures can happen after claim or dispatch. Do not label
        // those pre-claim or print arbitrary exception text; authoritative
        // task/run records remain the source of truth.
        console.error("Worker stopped; inspect authoritative records.");
      }
      process.exitCode = 1;
    });
  }
}
