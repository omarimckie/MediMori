# USB → NUC13 development migration readiness (copy-first)

**No transfers executed in Phase 5c.** Use `scripts/usb-nuc13-migration-inventory.ps1.example` on the operator workstation.

## Migration order (recommended)

1. **Restic baseline** of USB dev tree (encrypted).
2. **MediMori** monorepo / manager worktrees (largest, most active).
3. **Twilight Feather** and other repos found in inventory.
4. Secrets: copy `.env` / `.local` via secure channel — never commit.
5. Re-run `npm ci` + `npm run test:central-agent-manager` on NUC13 checkout.

## Verification after copy

| Check | Command |
| --- | --- |
| Git clean vs intentional dirty | `git status` |
| CAM offline acceptance | `npm run cam:homelab-offline-acceptance` |
| Phase 6c durable manager | `npm run cam:phase6c-offline-acceptance` |
| Phase 6d control plane (offline) | `npm run cam:phase6d-offline-acceptance` |
| Typecheck | `npm run typecheck` |

## Rollback

- Keep USB copies **read-only** until NUC13 passes verification for 48h.
- Do not delete USB originals until owner sign-off.

## Secret locations (names only)

- `.env`, `.env.local`, `.local/`, OS credential manager entries for Neon/Cursor.
- Values are **not** recorded in inventory JSON.

## Worktrees

Inventory script records `git worktree list` line count; expand manually before migration if > 1.

## Phase 6c copy-first plan (coordination)

| Artifact | Copy? | Notes |
| --- | --- | --- |
| `integration/candidate-cam-manager-only` worktree | Yes, after `cam:phase6c-offline-acceptance` passes | Include dirty `AGENTS.md` only if intentional |
| `.local/` secrets | Secure channel only | Never commit |
| In-flight objective JSON under `/tmp` | No | Regenerate on NUC13 |
| Active staging Neon branches | Do not copy | Disposable branches blocked for approval executor |

Rollback: keep USB checkout read-only until NUC13 passes 6c acceptance twice.

## Phase 6d copy-first plan (coordination)

| Artifact | Copy? | Notes |
| --- | --- | --- |
| `integration/candidate-cam-manager-only` worktree | Yes, after `cam:phase6d-offline-acceptance` passes | SQL migrations copied but **not** applied to Neon from dev |
| `sql/cam-objective-*.migration.sql` | Yes | Apply on NUC13 disposable Postgres only after owner sign-off |
| `.local/` secrets | Secure channel only | Never commit |
| In-flight objective JSON / SQL rows under `/tmp` | No | Regenerate on NUC13 |
| Active staging Neon branches | Do not copy | Disposable branches blocked for approval executor |

Rollback: keep USB checkout read-only until NUC13 passes 6d offline acceptance and optional `cam:nuc13-fake-worker-demo` (with `CAM_NUC13_FAKE_WORKER_DEMO=1`) twice.
