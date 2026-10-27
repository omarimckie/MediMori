# Central Agent Manager — adapter recovery runbook

## Fail-closed defaults

- Approval API uses `unavailableApprovalStore` when no durable store is injected.
- Adapter store construction calls `assertValidAdapterConfig` and rejects shared staging branch `br-nameless-mode-b7hkls9l` and production host patterns.
- Missing `CAM_APPROVAL_*` variables yield `null` identity; no implicit `DATABASE_URL` fallback.

## Failure modes and response

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| HTTP 503 on approval POST | Route still on unavailable store or feature disabled | Expected pre-activation; do not bypass with memory store in production |
| `approval_database_identity_rejected` (real PG) | Wrong branch, database, host, or spoofed GUC | Stop; verify Neon branch id and endpoint overlay; re-run manifest cases 7.x |
| Adapter errors mention `redacted` | Backend connection failure | Fix credentials/endpoint offline; inspect logs only through redacted messages |
| Issuance succeeds locally but PG verification fails | Mock ports only exercised | Complete disposable 38-case harness before route wiring |
| Partial disposable run | Operator stop condition | Do not attach route; delete branch per case 9.3 after evidence export 9.4 |

## Rollback

1. Remove any experimental `store` injection from `centralAgentManagerApprovalResponse` deps (should remain default).
2. Clear `CAM_APPROVAL_*` from deployment environment if a trial was mounted.
3. Revoke disposable branch credentials in Neon console; confirm branch deleted.
4. Re-run `npm run test:central-agent-manager` and confirm approval route test expects 503 without store.

## Interrupted transactions

Supervisor trusted-approval tests cover ambiguous commit and replay. On real wire, treat “success unknown” as **not committed** until `readApproval` confirms the idempotency key; never retry issuance with a new key for the same owner intent without operator review.

## Pooling architecture (unresolved)

The current `TrustedApprovalStore` caches verified authority/executor gates per store instance. Long-lived pools must re-verify session identity after checkout or TTL; options:

1. **Store per request** — simplest, no stale gate risk; higher connect cost.
2. **Invalidate gate on checkout** — explicit `invalidateAuthority()` / `invalidateExecutor()` API (not yet exposed).
3. **Pool wrapper** — connection pool owns observation on every transaction.

No pooling choice is implemented for production; document owner decision before route activation.

## Evidence retention

Store SQLSTATE and hash evidence per manifest; never commit connection strings, passwords, or raw catalog dumps to the repository.
