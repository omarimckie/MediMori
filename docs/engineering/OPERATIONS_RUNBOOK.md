# Engineering Worker Operations Runbook

This runbook describes the production worker path and safe, read-only diagnosis. The worker is an explicitly invoked, authenticated engineering control-plane operation; it is not a general-purpose runner.

## Production path

1. `scripts/engineering-worker.ts` is the host-side supervisor and the production `main()` entry point. It reads configuration, checks scratch capacity and source binding, verifies the restricted database identity and approved target lineage, exports the approved source, and then creates a `DockerWorkspace` before invoking `runWorker`.
2. `src/lib/engineering/worker.ts` is the lifecycle orchestrator. It claims the authorized run, performs bounded provider calls, applies only approved replacements, records validation evidence, and blocks or finishes the run through the restricted worker ingress.
3. `src/lib/engineering/workspace.ts` prepares isolated Docker volumes from the sanitized source export, runs the fixed validation commands in the pinned image, and cleans up only resources carrying the current task/run ownership labels. It does not use Docker prune.
4. `src/app/api/admin/engineering/route.ts` serves task history only after admin authentication. Block-event diagnostics are projected through explicit allowlists; persisted raw exceptions and free-form messages are never returned. Prepared-attempt responses include `sourceSelectionPolicyVersion` only when it is a non-negative safe integer. The execution-authorization control stays disabled unless that projected value is exactly 2 and the worker, prepared-subject, plan-version, and target-SHA checks still pass.

The production supervisor launcher is `scripts/engineering-worker-launch.mjs`. The `engineering:worker` package script points to that launcher. `scripts/engineering-worker.ts` also contains read-only initialization, database identity, and sanitized source-export diagnostics; these diagnostics do not call `main()`.

## Configuration

The production worker launcher (`scripts/engineering-worker-launch.mjs`, `npm run engineering:worker`) loads `.env.engineering-2a.local` internally. Its public interface is a worker run UUID or exactly one read-only `--diagnose-*` flag from **Safe diagnosis** below. It does not accept `--env-file`, alternate env-path flags, bootstrap-only names such as `--initialization-diagnostic`, or any other undocumented argv. Keep credentials in the local ignored env file and never paste values into logs, tickets, or this runbook.

The worker validates these settings before execution:

- `ENGINEERING_WORKER_ENABLED` must be `true`.
- `ENGINEERING_WORKER_DATABASE_URL` must identify the restricted worker role, expected database, and approved worker branch. The web/control-plane database URL is not a substitute.
- `ENGINEERING_WORKSPACE_SOURCE`, `ENGINEERING_SCRATCH_ROOT`, and `ENGINEERING_WORKSPACE_EXPORT` must resolve to the approved source and a separate scratch filesystem; the export parent must be beneath the scratch root and outside the source root.
- `ENGINEERING_SANDBOX_IMAGE` must be digest-pinned; `ENGINEERING_NODE_MODULES_VOLUME` must be a valid pre-existing dependency-volume name.
- `OPENAI_API_KEY` is required for actual provider calls. Optional model/rate JSON must satisfy the worker allowlists. `ENGINEERING_SOL_ESCALATION_REASON` is optional.

`ENGINEERING_CONTROL_PLANE_ENABLED`, `ENGINEERING_WORKER_ENABLED`, and `ENGINEERING_MERGE_ENABLED` are distinct gates. This runbook does not authorize changing any gate or granting database permissions.

## Safe diagnosis

1. Start with `npm run engineering:preflight` for repository/policy checks. It does not invoke the worker.
2. Use the launcher read-only options `--diagnose-initialization`, `--diagnose-database-identity`, or `--diagnose-source-export` when the matching subsystem needs inspection. Initialization and source-export diagnosis do not claim a run or call Docker; the database identity diagnosis performs a database identity query.
3. For an already recorded run, retrieve task history from the authenticated admin engineering API. Block-event `details.diagnostic` is projected again at read time through `safeBlockDiagnostic`: only bounded `operation`, `category`, `cleanupOutcome`, code/stage classifications, and allowlisted `validationPreparationOperation` and `preparationFailureClass` values are returned. Invalid or unknown values for those fields are omitted independently of one another. `cleanupFailures` and other worker-only diagnostic arrays are not returned by the admin API even when stored durably.
4. Treat `validationStage: source_volume` and `validation_source_prepare_failed` as the location and primary code. When the worker classified them, the process exit report and the SQL-persisted block event keep allowlisted `validationPreparationOperation` and `preparationFailureClass` values (unknown strings are dropped at ingress). Raw subprocess output, credentials, command arguments, and filesystem paths are not stored. Cleanup failure is recorded in `cleanupOutcome` and bounded `cleanupFailures` on the durable block record and exit report; it does not replace the primary code. On Windows Docker Desktop, a fixed 60s `docker cp` populate bound was a common failure mode for full-repo manifests; production populate now streams tar into the helper container with a scaled timeout. The populate helper container is started explicitly and its entrypoint sleep is derived from the same workspace/uploads timeout budget (not a fixed 60s). The disposable database function must be updated from `sql/engineering-worker.sql` before a live worker run will persist the new fields.
5. When cleanup reports `failed`, use the task and run IDs with the targeted cleanup tooling only after an operator reviews the owned resources and authorizes that cleanup. Never use broad Docker prune commands.

## Authorization budget, validation gates, and terminalization

1. SQL authorization is fixed at 30 minutes from `engineering_runs.started_at`. The worker does not extend, reset, or bypass that fence.
2. Before each validation cycle, each validation gate, and each repair cycle, the worker compares remaining authorized runtime against a **terminalization reserve** of 120 seconds plus the maximum time the next step could consume. Each validation gate is budgeted at up to 240 seconds (matching the Docker exec bound in `workspace.ts`), and validation environment preparation is budgeted at up to 60 seconds. If insufficient time remains, the worker stops with `runtime_deadline_exceeded` rather than starting a gate it cannot finish or skipping required gates.
3. On failure, the worker captures a **primary** bounded diagnostic first (validation, proposal, provider, or deadline). Workspace cleanup runs afterward; cleanup failure is recorded separately and does not replace the primary code unless cleanup itself was the primary failure (`sandbox_cleanup_failed`).
4. Terminal `block` ingress is attempted while the lease remains valid. If ingress rejects the block (for example `lease_denied` after the SQL fence), the process exit report sets `durableDisposition: unknown` and records `terminalization.ingressError`; do not assume the run is durably blocked from stderr alone. After a post-claim failure, `scripts/engineering-worker-bootstrap.cjs` emits a bounded JSON exit report with `primary`, `cleanupOutcome`, and `terminalization` fields.
5. A **stranded active run** shows `engineering_runs.disposition = active` with no recent worker lease, often after authorization expiry with a failed terminal `block`. Recovery is **not automatic**: an operator must use the supported control-plane **`prepareFreshAttempt`** path (same task version rules as production) to expire stale runs and prepare a fresh attempt before re-authorizing execution.

## Deferred backlog

A future agent may evaluate dedicated diagnostic-history storage if the bounded `engineering_events` projection proves insufficient for operational analysis. This change uses the existing event table only.

## Documentation validation

`npm run docs:engineering:check` verifies that the runbook exists and that its referenced production files and launcher options still exist. Update this runbook when those paths or interfaces change.
