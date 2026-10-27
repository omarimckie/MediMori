# Agent 2 follow-up release manifests (not staged)

Option A remains isolated at commit `a14f3f481427ac3fe28f8605226120f1e729824f`. The groups below are **proposed** review units. Apply SQL and enable dispatch only after operator approval.

## Group 1 — Engineering test harness and documentation

**Purpose:** Repeatable low-memory verification and operator docs without changing runtime behavior.

| Path | Role |
|------|------|
| `scripts/engineering-test-low-memory.mjs` | Bounded heap + concurrency wrapper for `tsx --test` |
| `scripts/check-engineering-runbook-file.mjs` | Validate arbitrary runbook export (staged index checks) |
| `docs/engineering/ENGINEERING_TESTING.md` | Procedures, env overrides, limitations |
| `docs/engineering/AGENT2_BOUNDARIES.md` | Agent 2 scope, gates, local test command |
| `docs/engineering/AGENT2_RELEASE_MANIFESTS.md` | This manifest |

**Dependencies:** None on Agent 2 SQL or daemon code.

**Verification:** `node scripts/engineering-test-low-memory.mjs`, `npm run docs:engineering:check`, `npm run typecheck`.

**Exclude from Group 1:** `package.json`, `OPERATIONS_RUNBOOK.md`, any Agent 2 runtime code.

---

## Group 2 — Admin route testability and diagnostic recovery

**Purpose:** Extract event-detail projection for tests; align future route refactor with Option A behavior.

| Path | Role |
|------|------|
| `src/lib/engineering/admin-engineering-event-details.ts` | `projectEngineeringAdminEventDetails` (mirrors committed `safeEventDetails` in route) |
| `src/lib/engineering/admin-engineering-get-handler.ts` | Testable GET history core (events branch) |
| `src/lib/engineering/admin-engineering-get-handler.test.ts` | Auth + block diagnostic projection |
| `src/lib/engineering/diagnostic-recovery-scenarios.test.ts` | Cross-cutting recovery projection scenarios |

**Integration path (deferred):** In `src/app/api/admin/engineering/route.ts`, replace the inline `safeEventDetails` body with `projectEngineeringAdminEventDetails` import only — no schema change. Full `boundedTaskHistory` stays in the route until a broader refactor is justified.

**Dependencies:** Option A (`event-diagnostics.ts`, committed route behavior).

---

## Group 3 — Agent 2 control plane and dispatch

**Purpose:** Host daemon, SQL ingress, PGlite contract tests, launch/bootstrap scripts.

| Path | Role |
|------|------|
| `sql/engineering-agent-2-dispatch.sql` | Migration 9 (unapplied source artifact) |
| `src/lib/engineering/engineering-pglite-fixture.ts` | Loads migrations 1–9 for local tests |
| `src/lib/engineering/engineering-agent-2-dispatch.contract.test.ts` | Offline SQL structure checks |
| `src/lib/engineering/agent2-control-plane.ts` | Register / heartbeat / assign / release client |
| `src/lib/engineering/agent2-control-plane.test.ts` | Config parsing |
| `src/lib/engineering/agent2-control-plane.hardening.test.ts` | Owner token + diagnostic sanitizer |
| `src/lib/engineering/agent2-execution.ts` | Fenced heartbeat during worker child |
| `src/lib/engineering/agent2-daemon.ts` | Poll cycle and shutdown semantics |
| `src/lib/engineering/agent2-daemon.test.ts` | Mocked cycle tests |
| `src/lib/engineering/agent2-sql-adapter.ts` | Neon worker DB adapter |
| `src/lib/engineering/agent2-assignment.test.ts` | Authorization + dispatch idempotency |
| `src/lib/engineering/agent2-recovery.test.ts` | Stale fence / duplicate release |
| `src/lib/engineering/agent2-safety.test.ts` | Owner conflict, lease interaction |
| `scripts/engineering-agent-2-bootstrap.cjs` | Daemon entry bootstrap |
| `scripts/engineering-agent-2-daemon.ts` | Daemon process |
| `scripts/engineering-agent-2-launch.mjs` | Host launcher + module smoke |
| `scripts/apply-engineering-agent2-dispatch.mjs` | **Operator-only** Neon apply (do not run in CI agent) |

**Adjunct files (stage separately — never with Group 4 harness lines):**

| Path | Staging rule |
|------|----------------|
| `package.json` | **Hunk only:** `"engineering:agent2": "node scripts/engineering-agent-2-launch.mjs"` — omit `engineering:harness:integrated-prepare` |
| `docs/engineering-agent.md` | **Hunk only:** migration list item 9 for `engineering-agent-2-dispatch.sql` |
| `docs/engineering/OPERATIONS_RUNBOOK.md` | **Hunks only:** “Agent 2 dispatch daemon” section + Configuration paragraph mentioning `ENGINEERING_AGENT2_ENV_FILE` — omit preimage and flag-session sections (Group 4) |

**Dependencies:** Engineering migrations 1–8 on disposable worker DB before migration 9. `ENGINEERING_AGENT2_OWNER_TOKEN` when `ENGINEERING_AGENT2_EXECUTE_WORKER=true`.

**Protected:** Keep `ENGINEERING_WORKER_ENABLED` / `ENGINEERING_MERGE_ENABLED` disabled in app config until explicitly approved.

---

## Group 4 — Unrelated preimage, merge-target, flag-session, harness WIP

**Purpose:** Separate from Agent 2; do not mix with Groups 1–3.

| Path | Notes |
|------|--------|
| `src/lib/engineering/merge-target.ts` (modified) | Merge target / preimage reads |
| `src/lib/engineering/merge-target-preimage.test.ts` | Preimage tests |
| `scripts/engineering-worker-launch.mjs` (modified) | Abort signal / launcher |
| `scripts/engineering-worker-flag-session.ts` + `.test.ts` | Flag session helper |
| `scripts/harness-*`, `scripts/medimori-*`, `scripts/same-task-*` | One-off recovery harnesses |
| `scripts/isolated-docker-population-test.ts` | Docker (out of autonomous scope) |
| `.env.example`, `package.json`, `next.config.ts`, `AGENTS.md` | Config/docs drift |
| `docs/engineering/OPERATIONS_RUNBOOK.md` (working tree) | Extra sections beyond Option A commit |
| Root `.*.out`, `.git.backup-*`, patch/stage helper scripts | Local artifacts — exclude from releases |

**Dependencies:** May touch merge approval and worker launcher; review independently of Agent 2 dispatch.

---

## Suggested commit order

1. Group 1 (harness + docs only)
2. Group 2 (admin projection module + tests)
3. Group 3 (Agent 2 stack + SQL artifact + contract test)
4. Group 4 (split further if needed: merge-target vs harness vs config)
