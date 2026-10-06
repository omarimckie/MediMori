# Engineering platform operator guide

This guide describes the current, explicitly controlled engineering platform. It is an internal code-change workflow. It does not deploy or publish production changes.

## Lifecycle and identities

An Engineering request is a durable task with one stable task ID. Each authorized execution is a separate, numbered, immutable attempt with its own run ID, plan version, timestamps, usage, evidence, and disposition. A stopped run is retained as history; it is never rejuvenated or reused.

The normal path is:

1. An authenticated administrator submits a request. The client generates an idempotency key, reuses it for a retry of that same submission, and the control plane returns the original task on replay. A later intentional submission uses a new key.
2. A human moves the request through analysis and records a bounded plan with explicit file scope, required checks, risk, and protected operations.
3. Before plan approval, the control plane reads the fixed target repository and branch and displays their current immutable commit SHA. Approval is version-checked and records the target lineage. For a prepared retry, the new attempt must use the target SHA already bound to that preparation; a changed target fails closed.
4. A human explicitly approves the plan. This creates the run and immutable attempt lineage. Opening the admin page or approving a plan does not invoke the worker.
5. An operator separately invokes the worker for the approved run. The worker verifies the restricted database identity and eligibility, binds a fresh sanitized source export and revision, reserves worst-case usage before provider dispatch, and records bounded evidence through the worker ingress functions.
6. The worker applies only a bounded proposal within approved scope, runs the required validation checks in the isolated Docker environment, and performs self-review. A successful result becomes `awaiting_merge`; failures remain auditable and require the supported human retry lifecycle.
7. A human inspects the merge review and may approve or reject the exact result. A separately authorized merge executor verifies the approval, target preimages, source revision and exact file hashes before committing and pushing. Completion is recorded only after remote verification.

Task approval, worker invocation, merge approval, and merge execution are distinct decisions and actions. The worker cannot prepare attempts, approve its own plan, or merge. The admin API requires an authenticated administrator and same-origin POST requests. It returns bounded task/history data and does not expose provider bodies, credentials, or raw exception details.

## Attempts and retry safety

The admin view keeps the stable request/task ID separate from numbered attempts and run IDs. It presents current and prior attempt disposition, plan version, target lineage, call/token/cost totals, validation results, repairs, self-review, and merge state.

“Prepare attempt” is an authenticated human-side action. It is available only when the prior attempt is no longer executable and provider activity is resolved. The control plane closes the prior attempt with its disposition, retains its evidence, returns the same request to planning, and records target lineage for the next attempt. Preparation alone creates no run, plan approval, lease, or provider reservation. A fresh plan and explicit approval are required before execution.

The 30-minute runtime limit is not extended to rescue an expired run. Do not directly edit task, attempt, approval, usage, or evidence records. Use the supported lifecycle and keep historical rows intact.

## Worker security and proposal application

The human/control-plane database URL and restricted worker database URL are separate. The worker uses only the restricted identity and bounded security-definer ingress functions. It has no direct task, plan, approval, run, cost, or audit-table mutation grants. Initialization fails closed if database identity, branch, role, required schema, or privileges do not match.

Before a provider call, the worker verifies human approval, active attempt, plan version, whole-tree revision, one-file/path scope, duplicate-dispatch state, token/runtime/repair limits, and worst-case cost reservation. The default model is `gpt-6-luna`; `gpt-6.1-sol` is gated by an explicit recorded escalation reason, and Astra is unavailable. Keep provider keys out of source and validation containers.

For bounded replacements, the host derives a limited catalog from source context authorized for that call. It issues opaque IDs only for anchors verified to occur exactly once in the complete approved file and binds each ID to path, revision, and content hash. The model selects an issued ID and supplies bounded replacement content; it does not choose arbitrary shell commands, paths, or source targets. Immediately before writing, the host rechecks the ID, approved path, revision, hash, exact anchor content, unique occurrence, and overlap constraints. Missing, stale, unknown, changed, repeated, or overlapping anchors fail closed. Matching uses the original literal anchor without case folding or whitespace normalization.

After application, the worker persists bounded durable evidence: approved paths, replacement count, before/after hashes, bounded change hashes, resulting revision, and a bounded diff summary. Provider prompts, provider responses, credentials, secrets, and unrestricted source content are not persisted as proposal evidence.

## Validation and Docker isolation

The worker exports a sanitized snapshot from the canonical checkout into the configured scratch root. The export is fresh per invocation and bound to the captured source revision. The host must not silently fall back to another drive if the configured scratch location is unavailable or under capacity.

Validation uses an existing digest-pinned image and immutable dependency volume. The source workspace is mounted read-only for normal validation, dependencies are read-only, and any explicitly authorized private build outputs use separate bounded writable volumes. Containers use `--pull=never`, `--network=none`, a read-only root filesystem, dropped capabilities, resource limits, and no Docker socket or credentials. Each approved validation command has a 240-second timeout. Execution-created Docker containers and volumes carry task/run/resource ownership labels; cleanup targets only those owned resources and records bounded cleanup diagnostics.

The Docker Desktop daemon is an activation prerequisite. A present Docker client is insufficient: verify live client/server access, the exact pinned image, and immutable dependency volume before any real worker invocation. Until that verification succeeds, the platform is not ready for autonomous execution.

## Limits and protected operations

The current policy caps a run at 12 model calls, 60,000 aggregate tokens, 3 repairs, and 30 minutes. The worker uses the configured worst-case reservation policy, warns at $0.25, stops new operations at $0.75 cumulative operational spend, and enforces the database emergency ceiling of $5. Model calls and reservations are reconciled against actual provider usage; reporting must distinguish settled autonomous provider charges from unrelated or synthetic ledger entries.

The current protected-operation list includes merging, production deployment/secrets/infrastructure, destructive database work, authentication/security changes, external publishing, and payments. These require separate human/executor authorization. This platform does not implement autonomous deployment or publication.

## Schema installation and activation

For a disposable engineering database, install the additive engineering schema in this order:

1. `sql/engineering-schema.sql` — control-plane tasks, plans, approvals, runs, evidence, and bounded initial lifecycle procedures.
2. `sql/engineering-worker.sql` — restricted worker call accounting, progress and validation diagnostics, security-definer ingress, and worker grants.
3. `sql/engineering-lineage.sql` — immutable plan/attempt target lineage and fresh-attempt preparation binding.
4. `sql/engineering-merge.sql` — separately gated merge approvals and executor lifecycle records.

Apply only the specifically reviewed engineering SQL to the intended disposable branch. Do not apply these files to production or mix them with unrelated business migrations. Verify schema compatibility and the restricted role after each approved synchronization.

Local activation uses ignored environment files. Keep the control-plane database identity, restricted worker identity, admin session credentials, provider key, and any merge credentials private. `.env.example` documents names and safe defaults only. Control-plane, worker, and merge flags default to disabled. Merge requires separately configured target and executor storage; it must remain disabled until provisioned and verified.

## Operator checklist

Before plan approval, inspect the request, risk, exact files, checks, protected operations, policy limits, repository, branch, and displayed base SHA. Before worker invocation, verify that the fresh active attempt and explicit approval match the plan version, that the runtime window is valid, all usage/reservations are zero as expected, the restricted identity/schema checks pass, and Docker prerequisites are live.

Authorize one run-specific worker invocation. A permission prompt grants only the requested command's access; it does not authorize another worker retry. If initialization or execution blocks outside the existing bounded repair lifecycle, stop and diagnose offline. Do not manually compensate for a blocked run.

Before merge approval, review the exact changed paths, durable hashes/revision, all required validation results, repair count, self-review, attempt lineage, and merge blockers. The server rechecks target preimages before creating durable approval. Merge execution is a separate action and is not implied by viewing or approving the plan. Confirm the exact target branch and remote verification before treating a task as completed.
