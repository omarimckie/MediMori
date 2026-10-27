# Central Agent Manager — approval adapter integration

## Scope

The approval adapter under `src/lib/central-agent-manager/adapter/` is an **inactive** integration package. It wires supervisor trusted-approval flows to injectable persistence ports with identity and connection preflight. It does **not** open live database connections during import and is **not** bound to the HTTP approval route by default.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `identity-guards.ts` | Configurable Neon project/branch/database/host/role expectations |
| `trusted-connection-target.ts` | Trusted vs attempted connection metadata |
| `connection-preflight.ts` | Pre-connect and post-connect session verification |
| `safe-error.ts` | Redact URLs and credentials from adapter errors |
| `approval-persistence-port.ts` | Authority vs executor persistence and lifecycle hooks |
| `postgres-approval-store.ts` | `TrustedApprovalStore` with separate authority/executor gates |
| `explicit-config.ts` | `CAM_APPROVAL_*` env resolution (no `DATABASE_URL`) |
| `config-validation.ts` | Fail-closed validation; denies shared staging/production identities for adapter activation |
| `verification/disposable-verification-manifest.ts` | Offline 38-case SQL verification manifest (dry-run only) |

## Per-store session gate (readiness cache)

`createPostgresApprovalStore` sets `authorityReady` / `executorReady` after one successful preflight + observation per gate. Further operations on the **same store instance** skip re-observation until identity/target failure invalidates the gate. A future real-wire lifecycle **must** either use one verified connection for the gate lifetime, re-verify on pool checkout, or construct a **new store per request**. Swapping an underlying pooled connection without invalidating the gate would allow privileged I/O without a fresh session check.

## Trust boundaries

- **Owner session** (admin cookie) is required before issuance; enforced in supervisor code, not the adapter alone.
- **Trusted target** comes from operator configuration and Neon API–backed endpoint choice, not from `neon.branch_id` GUC alone.
- **Authority** and **executor** roles use separate connection gates; neither path may perform the other’s privileged operations.
- **HTTP approval route** (`approval-handler.ts`) defaults to `unavailableApprovalStore` until an owner explicitly wires a durable store after disposable PostgreSQL evidence.

## Configuration contract

Set all of the following for a disposable verification branch (never reuse shared staging IDs for adapter activation):

- `CAM_APPROVAL_PROJECT_ID`
- `CAM_APPROVAL_BRANCH_ID`
- `CAM_APPROVAL_DATABASE_NAME`
- `CAM_APPROVAL_ENDPOINT_ID` (endpoint host id, e.g. `ep-…`)
- Optional: `CAM_APPROVAL_AUTHORITY_ROLE`, `CAM_APPROVAL_EXECUTOR_ROLE`

`resolveExplicitAdapterIdentity()` returns `null` when incomplete or when validation fails. `DATABASE_URL` is never read for adapter identity.

## Local tests vs real PostgreSQL

| Layer | What it proves |
| --- | --- |
| CAM unit/contract tests (`adapter/*.test.ts`, supervisor tests) | TypeScript security invariants with injected fakes |
| `dryRunValidateDisposableManifest()` | All 38 mandatory SQL cases are documented with expected outcomes |
| Disposable branch execution (owner-operated) | SQL roles, RLS, identity asserts, and idempotency on real wire |

Local mock tests do **not** substitute for disposable branch verification.

## Expected real-wire verification

1. Apply `sql/central-agent-manager-approvals.sql` on a **disposable** Neon branch with overlay identity matching `CAM_APPROVAL_*`.
2. Execute cases in `verification/disposable-verification-manifest.ts` per phase prerequisites.
3. Collect redacted evidence per `VERIFICATION_REDACTION_RULES`.
4. Teardown branch per cases 9.3–9.4.

Cases **7.5b** and **7.5c** failing block migration readiness until SQL or adapter mitigation is approved.

## Owner approvals still required

- Wire `createPostgresApprovalStore` (or future driver) into `approval-handler.ts`
- Staging or production branch apply
- Neon API branch lifecycle outside dry-run manifest
- Activation of durable approval persistence in deployed environments

See `ADAPTER_RECOVERY.md` for rollback and failure handling.
