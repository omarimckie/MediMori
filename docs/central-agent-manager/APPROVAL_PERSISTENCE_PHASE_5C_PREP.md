# Approval persistence — Phase 5c preparation

## Missing-coverage matrix

| Area | Offline today | Live PostgreSQL disposable |
| --- | --- | --- |
| Manifest structure (38 ids) | `disposable-verification-manifest.test.ts`, dry-run script | — |
| Postgres adapter unit tests | `postgres-approval-store.test.ts` (mocked) | Partial |
| SQL cases 1.1–9.4 | — | **Not automated** |
| Route wiring to postgres store | **Not enabled** (`unavailableApprovalStore`) | — |
| Identity on connect | `connection-preflight.test.ts` | Disposable branch only |
| RLS / authority vs executor | Adversarial unit tests | Manifest cases 7.x |

## Disposable-only harness design

1. Apply `sql/central-agent-manager-approvals.sql` on **isolated** branch (`br-nameless-mode-b7hkls9l` parent), never orchestration staging `br-wispy-river-b7zzwpij`.
2. Set `CAM_APPROVAL_DATABASE_URL` (gitignored) + role credentials from SQL apply.
3. Run manifest cases in order; capture redacted JSON evidence per case id.
4. `npm run cam:approval-disposable-harness-dry-run` — manifest validator (no DB).
5. Future: `cam:approval-disposable-harness-offline` — expands matrix export (no network).

## Activation dependency checklist

- [ ] All 38 mandatory ids pass on disposable branch with evidence bundle
- [ ] Explicit feature flag to swap route from `unavailableApprovalStore`
- [ ] Identity probe matches `approval-database-identity.ts`
- [ ] Rollback: disable flag, revoke disposable credentials
- [ ] No schema on product project `solitary-leaf-77946642`

## Rollback / failure

- Keep production route on unavailable store (current default).
- Failed disposable run: drop branch or revoke roles; do not touch orchestration staging jobs.
