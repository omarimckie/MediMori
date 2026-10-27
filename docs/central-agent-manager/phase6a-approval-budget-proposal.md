# Phase 6a — Approval and budget integration (remaining work proposal)

**Status:** Orchestration closed-loop and templates integrate with existing **in-memory** approval checks (`jobRequiresLiveOwnerApproval`, supervisor tasks). **Durable** approval remains behind `unavailableApprovalStore`.

## Implemented in Phase 6a (offline)

- Protected operations in plan tasks pause objectives (`awaiting_owner_approval`).
- Project/template permission intersection before worker match.
- Budget remaining gate in worker matching (objective-level USD).
- Bridge runner daily create budget unchanged (file-backed).

## Remaining PostgreSQL approval work

1. Activate `TrustedApprovalStore` Postgres adapter on disposable branch only.
2. Wire `issueTrustedOwnerApproval` to plan `protectedOperations` with plan digest binding.
3. Record approval id on job `externalRefs` for consumer claim gate.
4. Replay protection and revoke permanence (manifest cases 6.x).

## Remaining budget reservation work

See `cam-budget-durable-reservation-proposal.md` — cross-process create budget requires SQL reservation tied to assignment id.

## Do not

- Enable production approval routes until store is switched with owner sign-off.
- Bypass `unavailableApprovalStore` in handlers.
