# Phase 5c — Budget and resource controls

## Implemented (offline-tested)

| Control | Location | Behavior |
| --- | --- | --- |
| Job budget fields | `contracts-v1` / enqueue | `budgetBlockReason` blocks claim when exhausted |
| Runner daily create budget | `cursor-bridge-runner-budget.ts` | File-backed counters; rejects when over limit |
| Hourly cycle limit | runner config | Caps runner loop frequency |
| Request timeouts / response bytes | `cursor-rest-config` | Bounded HTTP reads to Cursor API |
| Supervisor usage | `supervisor/budget` | Token/cost/repair limits on protected work |

## Gaps (documented, not claimed safe)

- **No durable SQL reservation** tying spend to assignment id across crash.
- **Concurrent runners** on multiple hosts can each consume budget files unless lock + single host enforced.
- **Live Cursor billing** not modeled in offline tests.
- Missing/invalid runner budget file: tests cover fail-closed paths; operators must provision files before enable.

## Operator rule

Enable `CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED` only after offline fake-transport acceptance and explicit budget file values.
