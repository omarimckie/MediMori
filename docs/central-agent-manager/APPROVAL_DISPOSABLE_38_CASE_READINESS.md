# Approval adapter — 38-case disposable harness readiness

## Current production route

- HTTP approval route uses **`unavailableApprovalStore`** (fail closed).
- Do **not** activate postgres approval store on staging/production until this harness passes on a disposable branch.

## Interfaces

| Piece | Path |
| --- | --- |
| Trusted store contract | `supervisor/trusted-approval.ts` |
| Postgres implementation | `adapter/postgres-approval-store.ts` |
| Identity config | `approval-database-identity.ts` (`aged-brook-70202332`, branch `br-nameless-mode-b7hkls9l`) |
| Manifest (38 mandatory ids) | `verification/disposable-verification-manifest.ts` |
| Offline manifest validator | `dryRunValidateDisposableManifest()` |

## 38 mandatory cases

Ids in `MANDATORY_DISPOSABLE_VERIFICATION_IDS` (38 entries). Manifest lists SQL-level scenarios (authority vs executor, RLS, identity spoofing, idempotent issuance, teardown).

**Offline coverage today:**

| Category | Offline tests | Real PostgreSQL |
| --- | --- | --- |
| Manifest structure | `disposable-verification-manifest.test.ts` | — |
| Adapter identity preflight | `connection-preflight.test.ts`, `postgres-approval-store.test.ts`, `adversarial-security.test.ts` | Partial (mocked lifecycle) |
| SQL digest / contract | `approval-schema-contract.test.ts` | — |
| Disposable SQL cases 1.1–9.4 | — | **Not automated** in CI |

## Gap

- No checked-in runner executes manifest cases against a live disposable Neon branch.
- Cases **7.x / 9.x** require applied `sql/central-agent-manager-approvals.sql` on an isolated branch (not orchestration staging branch).
- Orchestration staging (`cam-orchestration-staging-5a`) must **not** host approval schema unless explicitly planned.

## Environment (future disposable run)

| Variable | Purpose |
| --- | --- |
| `CAM_APPROVAL_DATABASE_URL` | Disposable branch only (documented in `.env.example` / ADAPTER_INTEGRATION) |
| Authority + executor roles | From approvals SQL apply |
| Branch isolation | Separate from `br-withered-dream-b71r3mo0` orchestration pool tests |

## Activation requirements (after harness green)

1. All 38 mandatory manifest cases pass on disposable branch with evidence bundle.
2. Route wired to `createPostgresApprovalStore` behind explicit flag (not done).
3. Identity matches `approval-database-identity.ts` observation on connect.
4. Rollback: disable flag, revert route to unavailable store, revoke disposable credentials.

## Rollback

- Keep route on unavailable store (current default).
- No schema apply on product DB `solitary-leaf-77946642`.

## Blockers

- Missing automated disposable SQL executor (operator-driven only).
- No Neon execution authorized in engineering passes until owner approves bounded disposable run.

Offline dry-run: `npm run cam:approval-disposable-harness-dry-run`.
