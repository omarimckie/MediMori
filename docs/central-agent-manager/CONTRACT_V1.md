# Central Agent Status Contract v1

Contract identifier: `central-agent-status/v1`

Satellite projects expose a **read-only JSON document** describing their own state. The Central Agent Manager validates, maps, and displays the document. The manager **never invents** progress, timestamps, approvals, or agent activity.

## Source vs derived vs unknown

| Kind | Meaning |
| --- | --- |
| **Source-reported** | Field present in the JSON and copied after validation (e.g. `progressPercent` when supplied). |
| **Derived (manager)** | Computed only inside the manager (e.g. manager-level stale threshold overlay on `lastSuccessfulUpdate`). |
| **Unknown** | Omit optional fields or use JSON `null` for `progressPercent`, `milestone`, `checklistItem`, or timestamps — mapped to `null` in `ProjectSourceReport`. |

## Root object (bounded)

| Field | Required | Description |
| --- | --- | --- |
| `contractVersion` | yes | Must be `central-agent-status/v1` |
| `projectId` | yes | One of the five registered manager project ids |
| `displayName` | yes | Human-readable project name (bounded) |
| `reportingStatus` | yes | `live` \| `stale` \| `disconnected` \| `unavailable` |
| `statusDetail` | no | Bounded explanation shown in the dashboard |
| `lastSuccessfulUpdate` | no | ISO-8601 timestamp or `null` |
| `lastMeaningfulStateChange` | no | ISO-8601 or omitted/`null` |
| `milestone` | no | Source-reported milestone label |
| `checklistItem` | no | Source-reported checklist item |
| `progressPercent` | no | Integer 0–100 only when supported; omit or `null` if unknown |
| `activeAgents` | no | Array (bounded, sanitized) |
| `workItems` | no | Work items (same shape as manager tasks) |
| `blockers` | no | Project-level blockers (mapped to a synthetic work item) |
| `pendingApprovals` | no | Owner approvals required **as reported by the source** |
| `evidence` | no | Admin-relative evidence links only |

Unknown root keys are **rejected** (fail closed). Maximum JSON size: **256 KiB** (existing M1.5 policy).

## Reporting status semantics

| Status | Manager connection | Live task/agent data |
| --- | --- | --- |
| `disconnected` | `disconnected` | Hidden (empty collections) |
| `unavailable` | `unavailable` | Hidden |
| `stale` | `stale` (source assertion) | Shown when present |
| `live` | `connected` (may become manager-`stale` by age) | Shown when present |

## Example — disconnected (MediMori fixture)

```json
{
  "contractVersion": "central-agent-status/v1",
  "projectId": "medimori",
  "displayName": "MediMori",
  "reportingStatus": "disconnected",
  "statusDetail": "Engineering control plane not connected in this fixture.",
  "lastSuccessfulUpdate": null
}
```

## Example — live with progress (Twilight Feather fixture)

```json
{
  "contractVersion": "central-agent-status/v1",
  "projectId": "twilight-feather",
  "displayName": "Twilight Feather",
  "reportingStatus": "live",
  "statusDetail": "Marketing queue snapshot (fixture).",
  "lastSuccessfulUpdate": "2026-01-15T12:00:00.000Z",
  "lastMeaningfulStateChange": "2026-01-15T11:30:00.000Z",
  "milestone": "Weekly content review",
  "checklistItem": "Approve caption batch",
  "progressPercent": 62,
  "activeAgents": [{ "id": "agent-planner", "label": "Content planner", "state": "active" }],
  "workItems": [
    { "id": "work-1", "title": "Finalize Instagram carousel", "status": "in_review", "blockers": [] }
  ],
  "pendingApprovals": [
    { "id": "approval-1", "summary": "Review caption batch", "requestedAt": "2026-01-15T10:00:00.000Z" }
  ],
  "evidence": [{ "kind": "marketing", "label": "Content queue", "href": "/admin/marketing/content" }]
}
```

## Example — unknown progress

Omit `progressPercent` or set `"progressPercent": null`. Do **not** send `0` unless the source truly means zero percent complete.

## Legacy compatibility

Documents **without** `contractVersion` continue to use the M1 legacy remote shape (`activeAgents`, `tasks`, `pendingApprovals`, `lastSuccessfulUpdate`, `evidence`) and map to a connected manager snapshot.

Implementation: `parseStatusDocumentToSnapshot`, `parseContractV1Document`, `contractV1ToAdapterSnapshot`.

Synthetic fixtures: `src/lib/central-agent-manager/contract/fixtures-v1.ts`.
