# Process cleanup incident — Phase 5a-2B smoke follow-up

## Summary

The repository smoke script `.local/cam-5a2b-smoke-http.mjs` only terminates **its own** spawned `npm run dev` children via `child.kill("SIGTERM")`.

During post-smoke cleanup in an agent session, a **separate manual command** ran `taskkill /IM node.exe /F`, which can terminate **every** Node.js process on the host. That command is **not** part of the committed smoke script.

## Scope of possible impact

| Source | Risk |
| --- | --- |
| Smoke script `dev.kill` / `dev2.kill` | Limited to spawned child handles (may leave shell grandchildren on Windows depending on `shell: true`) |
| Manual `taskkill /IM node.exe /F` | **Broad** — any Node process (dev servers, watchers, unrelated tools) |

**Cannot reconstruct** which unrelated services were running or whether they were terminated. Do not assume all unrelated services survived.

## Fix

- `cam-tracked-child-process.ts` — forbid broad `node.exe` image kills in CAM helpers; track owner PID env marker; terminate only explicit child PIDs.
- `scripts/cam-smoke-dev-server.mjs` — shared spawn/stop for future smoke harnesses.
- Regression: `cam-tracked-child-process.test.ts`.

## Operator guidance

- Never use `taskkill /IM node.exe` for CAM cleanup.
- Stop smoke dev servers via tracked child stop only.
- Prefer one smoke terminal; record PID if debugging.
