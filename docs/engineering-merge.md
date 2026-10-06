# Engineering merge review and execution

The engineering merge gate is separate from implementation. A worker can produce an `awaiting_merge` result, but it cannot approve or execute a merge. The admin interface records a human decision; a separately authorized merge executor performs the operation.

## Human review

Review the stable Engineering request ID, successful run ID, numbered attempt, approved plan version, target repository/branch, immutable target base SHA, resulting worker revision, exact approved changed-file set, before/after hashes, required validation outcomes, repair count, and self-review evidence. Investigate any missing evidence or blocker before deciding.

Approval is a durable, version-checked decision bound to the run, attempt, plan, result revision, file set, and target. Before recording approval, the server obtains the current approved target SHA and reads the exact approved file preimages at that commit. Missing files or mismatched before hashes reject the request before a merge approval is written. A stale target requires a refreshed review. The browser never performs this check itself as a substitute for the server.

Rejecting a merge records the human decision and does not invoke Git. Approving a merge also does not invoke Git; it enables only the separately authorized executor lifecycle.

## Executor safeguards

The executor revalidates the approval binding and target snapshot, reads the preserved reviewed source, verifies its revision and file hashes, applies only the approved files, and checks the resulting diff has exactly the approved path set and after hashes. It creates a normal commit without force-push or automatic conflict resolution, pushes to the configured target, then verifies the remote commit before marking the lifecycle complete.

The executor is idempotent around ambiguous push results. If a remote commit was created before a local interruption, it verifies and records that commit rather than creating a second one. Failures before a push may be marked blocked with an allow-listed code. Once a push may have started, the approval remains recoverable until remote state is verified.

The merge target is fixed to `omarimckie/MediMori`, branch `main`, remote `origin`, and merge is disabled by default. A separate merge database identity, branch, scratch root, and preserved review root are required when enabling the executor. Never put credentials in source-controlled files or pass them into validation containers.

## Operator boundaries

- Do not treat plan approval as merge approval.
- Do not treat merge approval as executor invocation.
- Do not merge an accumulated working checkout or unapproved infrastructure changes.
- Do not force-push, auto-resolve conflicts, or mark complete before remote verification.
- Do not deploy or publish as part of this merge lifecycle.
