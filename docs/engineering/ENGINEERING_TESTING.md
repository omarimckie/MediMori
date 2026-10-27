# Engineering test procedures

## Default suite

```bash
npm run test:engineering
```

Runs all `src/lib/engineering/*.test.ts` files with Node’s default test concurrency. On memory-constrained Windows hosts this can OOM when many PGlite/Git-heavy files run together.

## Low-memory profile (recommended locally and in CI)

```bash
node scripts/engineering-test-low-memory.mjs
```

Defaults:

- `NODE_OPTIONS=--max-old-space-size=8192`
- `--test-concurrency=1`
- pattern `src/lib/engineering/*.test.ts`

Overrides:

- `ENGINEERING_TEST_HEAP_MB` (2048–32768, default `8192`)
- `ENGINEERING_TEST_CONCURRENCY` (default `1`)
- optional first argument: narrower glob, e.g. `src/lib/engineering/admin-engineering-get-handler.test.ts`

Focused Option A / projection bundle:

```bash
node scripts/engineering-test-low-memory.mjs "src/lib/engineering/event-diagnostics.test.ts src/lib/engineering/prepare-validation-failure.test.ts src/lib/engineering/admin-execution-authorization.test.ts src/lib/engineering/diagnostic-retention.test.ts src/lib/engineering/admin-engineering-get-handler.test.ts src/lib/engineering/diagnostic-recovery-scenarios.test.ts"
```

Agent 2 dispatch (PGlite + mocks, no Neon):

```bash
node scripts/engineering-test-low-memory.mjs "src/lib/engineering/agent2-*.test.ts src/lib/engineering/engineering-agent-2-dispatch.contract.test.ts"
```

The runner accepts multiple space-separated file globs in one argument.

## Documentation checks

Working-tree runbook (default):

```bash
npm run docs:engineering:check
```

Validate an arbitrary runbook file (e.g. staged index export):

```bash
git show :docs/engineering/OPERATIONS_RUNBOOK.md > %TEMP%\\staged-runbook.md
node scripts/check-engineering-runbook-file.mjs %TEMP%\\staged-runbook.md
```

## Environmental limitations

- Engineering tests use **PGlite** and local **Git** fixtures; they do not start Docker workers or connect to Neon.
- Two symlink cases skip on Windows when the host policy blocks symlink creation (`source-manifest.test.ts`, `workspace.test.ts`).
- Full-suite stability on ~16 GB RAM with IDE overhead typically requires the low-memory profile above.

## Typecheck

```bash
npm run typecheck
```
