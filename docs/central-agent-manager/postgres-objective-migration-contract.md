# PostgreSQL objective persistence contract (prepared, not applied)

## Table: `central_agent_manager.objective_executions`

| Column | Type | Notes |
| --- | --- | --- |
| `objective_id` | `text` PK | |
| `idempotency_key` | `text` UNIQUE | |
| `record_fence` | `bigint` NOT NULL | optimistic concurrency |
| `document_json` | `jsonb` NOT NULL | `PersistedObjectiveExecutionRecordV2` |
| `checksum` | `text` NOT NULL | sha256 of canonical json |
| `updated_at` | `timestamptz` NOT NULL | |

## Write protocol

1. `SELECT record_fence, document_json FOR UPDATE`
2. Validate checksum and contract version.
3. Apply mutation with `expected_fence`.
4. `UPDATE ... WHERE record_fence = expected_fence`
5. If zero rows updated → fail closed.

No migration executed in Phase 6c offline work.
