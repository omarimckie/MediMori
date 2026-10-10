"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ExecutionAttempt, Task } from "@/lib/engineering/store";
import { protectedOperations, validationCommands } from "@/lib/engineering/policy";
import { TaskSubmissionController } from "@/lib/engineering/task-submission";
import { attemptPresentation } from "@/lib/engineering/attempt-presentation";

type TaskView = Task & {
  created_at?: string;
  updated_at?: string;
  attempts?: Array<ExecutionAttempt & { target?: { repository?: string; branch?: string; baseSha?: string; previousRunId?: string } }>;
};
type TargetBinding = { repository: string; branch: string; baseSha: string };

export function EngineeringClient() {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [policy, setPolicy] = useState<{ limits: Record<string, number>; modelPolicy: { defaultModel: string; escalationModel: string; escalationRequiresRecordedReason: boolean; astraEnabled: boolean }; workerLimits: { softUsd: number; stopUsd: number; emergencyUsd: number }; automaticDispatch: boolean; workerEnabled: boolean; mergeApprovalEnabled: boolean } | null>(null);
  const [request, setRequest] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creationError, setCreationError] = useState("");
  const [createdTaskId, setCreatedTaskId] = useState("");
  const [preparingTaskId, setPreparingTaskId] = useState("");
  const [preparationNotice, setPreparationNotice] = useState("");
  const [mergeBaseSha, setMergeBaseSha] = useState("");
  const [planTarget, setPlanTarget] = useState<TargetBinding | null>(null);
  const [targetError, setTargetError] = useState("");
  const [mergeNotice, setMergeNotice] = useState("");
  const [historyByTask, setHistoryByTask] = useState<Record<string, Record<string, unknown>>>({});
  const [historyLoading, setHistoryLoading] = useState("");
  const submission = useRef(new TaskSubmissionController<Task>());
  const prepareKeys = useRef(new Map<string, string>());
  const mergeDecisionKeys = useRef(new Map<string, string>());
  const actionInFlight = useRef(false);
  async function load() {
    const response = await fetch("/api/admin/engineering", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setTasks(data.tasks);
    setPolicy(data.policy);
    const needsPlanBinding = data.tasks.some((task: TaskView) => task.status === "awaiting_approval" || task.status === "awaiting_execution");
    if (needsPlanBinding) {
      setTargetError("");
      const targetResponse = await fetch("/api/admin/engineering?targetBase=1", { cache: "no-store" });
      const targetData = await targetResponse.json();
      if (targetResponse.ok && targetData.target?.baseSha) setPlanTarget(targetData.target);
      else { setPlanTarget(null); setTargetError(targetData.error ?? "The immutable target base could not be loaded."); }
    } else { setPlanTarget(null); setTargetError(""); }
    if (data.tasks.some((task: Task) => task.status === "awaiting_merge" && task.mergeReview?.approvalStatus !== "disabled")) {
      const target = await fetch("/api/admin/engineering?mergeBase=1", { cache: "no-store" }).then(response => response.json());
      if (target.targetBaseSha) setMergeBaseSha(target.targetBaseSha);
      else setMergeBaseSha("");
    }
  }
  useEffect(() => { load().catch(e => setError(String(e.message))); }, []);
  async function act(body: object) {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/engineering", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await load();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); return false; }
    finally { actionInFlight.current = false; setBusy(false); }
  }
  async function prepareAttempt(task: Task, attemptNumber: number) {
    const slot = `${task.id}:${task.version}`;
    const attemptKey = prepareKeys.current.get(slot) ?? crypto.randomUUID();
    prepareKeys.current.set(slot, attemptKey);
    setPreparationNotice(""); setPreparingTaskId(task.id);
    const success = await act({ id: task.id, version: task.version, action: "prepare_attempt", attemptKey });
    if (success) {
      prepareKeys.current.delete(slot);
      setPreparationNotice(`Attempt #${attemptNumber} is prepared for fresh planning. A new plan and explicit human approval are required before execution.`);
    }
    setPreparingTaskId("");
  }
  async function prepareInitial(task: Task) {
    const slot = `${task.id}:${task.version}:initial`;
    const attemptKey = prepareKeys.current.get(slot) ?? crypto.randomUUID();
    prepareKeys.current.set(slot, attemptKey);
    setPreparationNotice(""); setPreparingTaskId(task.id);
    const success = await act({ id: task.id, version: task.version, action: "prepare_initial_attempt", attemptKey });
    if (success) {
      prepareKeys.current.delete(slot);
      setPreparationNotice("Attempt #1 is bound to its plan, target, and implementation source. Review the complete subject before approving execution.");
    }
    setPreparingTaskId("");
  }
  async function prepareRetrySubject(task: Task, attemptNumber: number) {
    const slot = `${task.id}:${task.version}:subject`;
    const attemptKey = prepareKeys.current.get(slot) ?? crypto.randomUUID();
    prepareKeys.current.set(slot, attemptKey);
    setPreparationNotice(""); setPreparingTaskId(task.id);
    const success = await act({ id: task.id, version: task.version, action: "prepare_retry_subject", attemptKey });
    if (success) {
      prepareKeys.current.delete(slot);
      setPreparationNotice(`Attempt #${attemptNumber} is bound to its fresh plan, target, and implementation source. Review the complete subject before approving execution.`);
    }
    setPreparingTaskId("");
  }
  async function decideMerge(task: Task, decision: "approved" | "rejected") {
    if (!task.mergeReview || (decision === "approved" && !mergeBaseSha) || actionInFlight.current) return;
    const slot = task.id + ":" + task.version + ":" + decision;
    const key = mergeDecisionKeys.current.get(slot) ?? crypto.randomUUID();
    mergeDecisionKeys.current.set(slot, key);
    setMergeNotice("");
    const ok = await act({ id: task.id, version: task.version, action: "merge_decision", decision, targetBaseSha: decision === "approved" ? mergeBaseSha : null, idempotencyKey: key });
    if (ok) {
      mergeDecisionKeys.current.delete(slot);
      setMergeNotice(decision === "approved"
        ? "Merge approval recorded for run " + task.mergeReview.runId + ". A separate merge-executor invocation is still required; opening this page did not run Git."
        : "Merge rejected for run " + task.mergeReview.runId + ". No Git operation was run.");
    }
  }
  async function authorizeExecution(task: TaskView) {
    const subject = task.preparedAttempt;
    if (!subject || !planTarget || planTarget.baseSha !== subject.targetBaseSha || subject.planVersion !== task.version) return;
    if (!window.confirm(`Authorize execution for prepared Attempt #${subject.attemptNumber}? This creates one worker-enabled run; it does not merge or deploy.`)) return;
    await act({ id: task.id, version: task.version, action: "authorize_execution", preparedAttemptId: subject.attemptId, targetBaseSha: subject.targetBaseSha });
  }
  async function submitCreation() {
    if (busy) return;
    setBusy(true); setError(""); setCreationError(""); setCreatedTaskId("");
    try {
      const result = await submission.current.submit(request, async (text, submissionKey) => {
        const response = await fetch("/api/admin/engineering", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", request: text, submissionKey }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Task creation failed.");
        return data;
      });
      setTasks(current => [result.task, ...current.filter(task => task.id !== result.task.id)].slice(0, 100));
      setCreatedTaskId(result.task.id);
      setRequest("");
    } catch (e) {
      setCreationError(e instanceof Error ? e.message : "Task creation failed. Your request is preserved; retry the same text safely.");
    } finally { setBusy(false); }
  }
  function create(e: FormEvent<HTMLFormElement>) { e.preventDefault(); void submitCreation(); }
  async function showHistory(taskId: string) {
    if (historyByTask[taskId]) {
      setHistoryByTask(current => { const next = { ...current }; delete next[taskId]; return next; });
      return;
    }
    setHistoryLoading(taskId);
    try {
      const response = await fetch(`/api/admin/engineering?id=${encodeURIComponent(taskId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Task history is unavailable.");
      setHistoryByTask(current => ({ ...current, [taskId]: data }));
    } catch (e) { setError(e instanceof Error ? e.message : "Task history is unavailable."); }
    finally { setHistoryLoading(""); }
  }
  return <div className="space-y-6">
    {policy && <section className="rounded border bg-slate-50 p-3" aria-label="Engineering execution policy">
      <p><strong>Execution policy:</strong> automatic dispatch is {policy.automaticDispatch ? "enabled" : "disabled"}; worker is {policy.workerEnabled ? "enabled" : "disabled"}. This page never runs the worker or Git.</p>
      <p>Default model: {policy.modelPolicy.defaultModel} · Sol escalation requires a recorded reason ({policy.modelPolicy.escalationModel}) · Astra {policy.modelPolicy.astraEnabled ? "enabled" : "unavailable"}.</p>
      <p>Limits: {policy.limits.modelCalls} calls, {policy.limits.tokens.toLocaleString()} aggregate tokens, {policy.limits.repairs} repairs, ${policy.limits.costUsd} emergency ceiling, {Math.round(policy.limits.durationMs / 60000)} minutes. Cost policy: ${policy.workerLimits.softUsd} soft warning, ${policy.workerLimits.stopUsd} operational stop. Validation timeout: 240 seconds per command.</p>
      <p>Merge approval is {policy.mergeApprovalEnabled ? "configured" : "disabled"}; deployment and publishing are not available here.</p>
    </section>}
    <form onSubmit={create} className="space-y-2" aria-busy={busy}>
      <label htmlFor="engineering-request">New engineering request</label>
      <textarea id="engineering-request" required maxLength={8000} value={request} disabled={busy || Boolean(creationError)} onChange={e => setRequest(e.target.value)} className="block w-full rounded border p-3" />
      <button type="submit" disabled={busy || Boolean(creationError)} className="rounded border px-4 py-2">{busy ? "Creating task…" : "Create task"}</button>
    </form>
    {busy && <p role="status" aria-live="polite">Creating your engineering task. Please wait.</p>}
    {creationError && <div role="alert"><p>{creationError}</p><button type="button" disabled={busy} onClick={() => void submitCreation()}>Retry creation</button></div>}
    {createdTaskId && <p role="status" aria-live="polite">Task created successfully. ID: <code>{createdTaskId}</code> · <a className="underline" href={`#engineering-task-${createdTaskId}`}>View task</a></p>}
    {preparationNotice && <p role="status" aria-live="polite">{preparationNotice}</p>}
    {mergeNotice && <p role="status" aria-live="polite">{mergeNotice}</p>}
    {error && <p role="alert">{error}</p>}
    {tasks.length === 0 && !error && <p>No engineering requests have been submitted yet.</p>}
    {tasks.map(task => {
      const attemptView = attemptPresentation(task);
      const attempts = (attemptView.attempts ?? []) as Array<ExecutionAttempt & { target?: { repository?: string; branch?: string; baseSha?: string; previousRunId?: string } }>;
      return <article id={`engineering-task-${task.id}`} key={task.id} className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">{task.request}</h2>
      <p>Engineering request <code>{task.id}</code> · {task.status} · Risk: {task.risk ?? "unclassified"} · Version: {task.version}</p>
      {task.plan && <><p>{task.plan.summary}</p><p>Approved file scope: {task.plan.files.join(", ")}</p><p>Required checks: {task.plan.validations.join(", ")}</p><p>Protected operations: {task.plan.operations.join(", ") || "None declared"}</p></>}
      {["awaiting_merge", "merging", "completed"].includes(task.status) && task.mergeReview && <section aria-label="Human merge review" className="space-y-3 rounded border border-amber-300 bg-amber-50 p-4">
        <h3 className="font-semibold">Human merge review</h3>
        <p>Attempt #{task.mergeReview.attemptNumber} · run <code>{task.mergeReview.runId}</code> · plan version {task.mergeReview.planVersion}</p>
        <p>Result revision: <code>{task.mergeReview.resultingRevision}</code></p>
        <div><p>Reviewed files and durable hashes:</p><ul className="list-disc space-y-1 pl-6">{task.mergeReview.files.map(file =>
          <li key={file.path}><code>{file.path}</code><span className="block text-xs">before {file.beforeSha256}</span><span className="block text-xs">after {file.afterSha256}</span></li>
        )}{task.mergeReview.files.length === 0 && <li>No durable file evidence</li>}</ul></div>
        <p>Validation: {task.mergeReview.passedValidationCount}/{task.mergeReview.validations.length} required checks passed · self-review {task.mergeReview.selfReviewPassed ? "passed" : "not verified"}</p>
        <ul className="list-disc pl-6">{task.mergeReview.validations.map(command => <li key={command}>{command} · {task.mergeReview?.passedValidations.includes(command) ? "passed" : "missing"}</li>)}</ul>
        <p>Run target binding: {task.mergeReview.targetRepository} · {task.mergeReview.targetBranch} · immutable base SHA <code>{task.mergeReview.targetBaseSha ?? "unavailable"}</code></p>
        <p>Current target SHA for approval: <code>{mergeBaseSha || "not verified"}</code>{mergeBaseSha && mergeBaseSha !== task.mergeReview.targetBaseSha ? " · target has advanced since this attempt; server-side preimage checks still decide approval eligibility" : ""}</p>
        <p>Merge approval: <strong>{task.mergeReview.approvalStatus}</strong></p>
        {task.status === "merging" && <p role="status">The separately authorized merge executor is processing this approved result.</p>}
        {task.status === "completed" && <p role="status">Merge lifecycle completed. See task records for the attributed commit and remote verification.</p>}
        {task.mergeReview.approvalStatus === "approved" && <p role="status">Approval is recorded. A separate authorized merge-executor invocation is required; the admin page never executes Git operations.</p>}
        {task.status === "awaiting_merge" && task.mergeReview.approvalStatus !== "approved" && task.mergeReview.approvalStatus !== "consumed" && <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy || !mergeBaseSha || task.mergeReview.validations.some(command => !task.mergeReview?.passedValidations.includes(command)) || !task.mergeReview.selfReviewPassed || task.mergeReview.files.length === 0}
            onClick={() => void decideMerge(task, "approved")}
            className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">Approve merge</button>
          <button type="button" disabled={busy} onClick={() => void decideMerge(task, "rejected")}
            className="rounded border border-red-700 px-4 py-2 font-semibold text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50">Reject merge</button>
        </div>}
        {task.mergeReview.approvalStatus === "disabled" && <p>Merge approval controls are disabled until the additive M2D database migration and bounded target configuration are installed.</p>}
      </section>}
      {attempts.length > 0 && <section aria-label="Execution attempts" className="space-y-2 rounded bg-slate-50 p-3">
        <h3 className="font-medium">Execution attempts</h3>
        <ul className="space-y-1">{attempts.map((attempt, index) => <li key={attempt.id}>
          {index === 0 ? attempt.disposition === "active" ? "Current" : "Latest" : "Prior"} Attempt #{attempt.attemptNumber} · {attempt.disposition} · plan version {attempt.planVersion} · run <code>{attempt.id}</code> · {attempt.modelCalls} model calls · {attempt.tokens} tokens · ${attempt.costUsd}
          {attempt.target && <span className="block">Target lineage: {attempt.target.repository || "unverified"} · {attempt.target.branch || "unverified"} · base <code>{attempt.target.baseSha || "unverified"}</code>{attempt.target.previousRunId ? <> · previous run <code>{attempt.target.previousRunId}</code></> : null}</span>}
        </li>)}</ul>
        {attemptView.freshApprovalRequired && <p role="status">Attempt #{attemptView.nextAttemptNumber} is prepared for fresh planning. A new plan and explicit human approval are required before a new run can be created.</p>}
        {attemptView.canPrepare && <div className="space-y-1"><p>The prior attempt is no longer executable. Preparing another attempt closes it in the audit history, returns this same request to planning, and requires a fresh plan approval. It does not start execution.</p>
          <button type="button" disabled={busy} onClick={() => void prepareAttempt(task, attemptView.nextAttemptNumber)}>{busy && preparingTaskId === task.id ? "Preparing attempt…" : `Prepare attempt #${attemptView.nextAttemptNumber}`}</button>
        </div>}
      </section>}
      {task.status === "intake" && <button disabled={busy} onClick={() => void act({ id: task.id, version: task.version, action: "transition", value: "analyzing" })}>Begin analysis</button>}
      {task.status === "analyzing" && <form onSubmit={e => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void act({ id: task.id, version: task.version, action: "plan", value: {
          summary: String(data.get("summary")), files: String(data.get("files")).split("\n").map(f => f.trim()).filter(Boolean),
          validations: data.getAll("validation"), operations: data.getAll("operation"),
        } });
      }} className="space-y-3">
        <label className="block">Proposed plan<textarea name="summary" required maxLength={4000} className="block w-full border p-2" /></label>
        <label className="block">Files in scope (one per line, up to 20)<textarea name="files" required className="block w-full border p-2" /></label>
        <fieldset><legend>Required checks</legend>{validationCommands.map(command => <label key={command} className="mr-3 inline-block"><input type="checkbox" name="validation" value={command} defaultChecked /> {command}</label>)}</fieldset>
        <fieldset><legend>Operations requiring separate human approval</legend>{protectedOperations.map(operation => <label key={operation} className="mr-3 inline-block"><input type="checkbox" name="operation" value={operation} /> {operation.replaceAll("_", " ")}</label>)}</fieldset>
        <button disabled={busy}>Save plan</button>
      </form>}
      {task.status === "planned" && task.latestPreparation && (!task.preparedAttempt || task.preparedAttempt.planVersion !== task.version) && <div className="space-y-1"><p>Bind Attempt #{task.latestPreparation.previousAttemptNumber + 1} to this fresh plan, current immutable target, and current implementation source. This does not create a run or authorize execution.</p><button disabled={busy} onClick={() => void prepareRetrySubject(task, task.latestPreparation!.previousAttemptNumber + 1)}>{busy && preparingTaskId === task.id ? "Binding retry subject…" : `Prepare complete Attempt #${task.latestPreparation.previousAttemptNumber + 1} approval subject`}</button></div>}
      {task.status === "planned" && !task.latestPreparation && !task.preparedAttempt && <div className="space-y-1"><p>Prepare Attempt #1 to bind the current plan, immutable target, and implementation source before the approval decision. This does not create a run or authorize execution.</p><button disabled={busy} onClick={() => void prepareInitial(task)}>{busy && preparingTaskId === task.id ? "Binding plan, target, and source…" : "Prepare target-bound Attempt #1"}</button></div>}
      {task.status === "awaiting_approval" && <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
        <h3 className="font-semibold">Human plan approval required</h3>
        <p>Request <code>{task.id}</code> · task version {task.version} · {task.risk} risk · files {task.plan?.files.join(", ")}</p>
        {!task.preparedAttempt && <p role="alert">No complete plan, target, and implementation-source binding exists. Approval is blocked until the attempt is prepared.</p>}
        {task.preparedAttempt && <><p>Prepared Attempt #{task.preparedAttempt.attemptNumber} · identity <code>{task.preparedAttempt.attemptId}</code> · bound plan version {task.preparedAttempt.planVersion} · {task.preparedAttempt.risk} risk</p><p>Target revision — {task.preparedAttempt.targetRepository} · {task.preparedAttempt.targetBranch} · base SHA <code>{task.preparedAttempt.targetBaseSha}</code></p><p>Implementation source revision — <code>{task.preparedAttempt.implementationSourceRevision}</code></p><p>Current target SHA: <code>{planTarget?.baseSha ?? "loading"}</code></p></>}
        {task.preparedAttempt && planTarget && planTarget.baseSha !== task.preparedAttempt.targetBaseSha && <p role="alert">The target has changed since preparation. This approval is blocked; prepare a fresh target-bound plan.</p>}
        {targetError && <p role="alert">Approval is blocked: {targetError}</p>}
        {!targetError && !planTarget && <p role="status">Loading the current target to confirm the prepared binding remains fresh.</p>}
        <div className="flex gap-4"><button type="button" disabled={busy || !task.preparedAttempt || !planTarget || planTarget.baseSha !== task.preparedAttempt.targetBaseSha || task.preparedAttempt.planVersion !== task.version} onClick={() => task.preparedAttempt && void act({ id: task.id, version: task.version, action: "approve", preparedAttemptId: task.preparedAttempt.attemptId, targetBaseSha: task.preparedAttempt.targetBaseSha })}>Approve this prepared plan, target, and source</button>
          <button type="button" disabled={busy} onClick={() => void act({ id: task.id, version: task.version, action: "reject" })}>Reject this plan</button></div>
        <p>Approval records your decision for this exact prepared subject only. It does not create a run or start the worker. A separate explicit execution authorization is required. The worker must still verify a fresh sanitized export matches the approved source before claim.</p>
      </section>}
      {task.status === "awaiting_execution" && <section className="space-y-2 rounded border border-blue-300 bg-blue-50 p-3">
        <h3 className="font-semibold">Plan approved — execution authorization required</h3>
        <p role="status">Approval is recorded for this prepared subject. No run exists and no worker has started.</p>
        <p>Prepared Attempt #{task.preparedAttempt?.attemptNumber ?? "unavailable"} · identity <code>{task.preparedAttempt?.attemptId ?? "unavailable"}</code> · plan version {task.preparedAttempt?.planVersion ?? "unavailable"} · {task.preparedAttempt?.risk ?? "unknown"} risk</p>
        <p>Approved file scope: {task.plan?.files.join(", ") || "unavailable"} · required checks: {task.plan?.validations.join(", ") || "unavailable"} · protected operations: {task.plan?.operations.join(", ") || "None declared"}</p>
        <p>Target — {task.preparedAttempt?.targetRepository ?? "unavailable"} · {task.preparedAttempt?.targetBranch ?? "unavailable"} · base SHA <code>{task.preparedAttempt?.targetBaseSha ?? "unavailable"}</code></p>
        <p>Implementation source revision — <code>{task.preparedAttempt?.implementationSourceRevision ?? "unavailable"}</code> · source-selection policy {task.preparedAttempt?.sourceSelectionPolicyVersion ?? "unavailable"}</p>
        <p>Current target SHA: <code>{planTarget?.baseSha ?? "loading"}</code></p>
        {task.preparedAttempt && planTarget && planTarget.baseSha !== task.preparedAttempt.targetBaseSha && <p role="alert">Execution is blocked because the target changed after preparation.</p>}
        {targetError && <p role="alert">Execution authorization is blocked: {targetError}</p>}
        {!targetError && !planTarget && <p role="status">Loading the current target to confirm the approved binding remains fresh.</p>}
        {policy?.workerEnabled !== true && <p role="status">Execution authorization is unavailable because the worker is disabled.</p>}
        <button type="button" disabled={busy || policy?.workerEnabled !== true || !task.preparedAttempt || !planTarget || planTarget.baseSha !== task.preparedAttempt.targetBaseSha || task.preparedAttempt.planVersion !== task.version || task.preparedAttempt.sourceSelectionPolicyVersion !== 2} onClick={() => void authorizeExecution(task)}>Authorize execution</button>
      </section>}
      <button type="button" className="underline" disabled={historyLoading === task.id} onClick={() => void showHistory(task.id)}>{historyLoading === task.id ? "Loading audit history…" : historyByTask[task.id] ? "Hide task audit history" : "Show task audit history"}</button>
      {historyByTask[task.id] && <TaskHistoryView data={historyByTask[task.id]!} />}
    </article>;
    })}
  </div>;
}

function TaskHistoryView({ data }: { data: Record<string, unknown> }) {
  const runs = Array.isArray(data.runs) ? data.runs as Array<Record<string, unknown>> : [];
  const approvals = Array.isArray(data.approvals) ? data.approvals as Array<Record<string, unknown>> : [];
  const validations = Array.isArray(data.validations) ? data.validations as Array<Record<string, unknown>> : [];
  const costs = Array.isArray(data.costs) ? data.costs as Array<Record<string, unknown>> : [];
  const workerCalls = Array.isArray(data.workerCalls) ? data.workerCalls as Array<Record<string, unknown>> : [];
  const events = Array.isArray(data.events) ? data.events as Array<Record<string, unknown>> : [];
  const preparations = Array.isArray(data.preparations) ? data.preparations as Array<Record<string, unknown>> : [];
  return <section className="space-y-2 rounded border p-3" aria-label="Bounded task audit history">
    <h3 className="font-semibold">Task, attempt, approval, validation and cost history</h3>
    <h4 className="font-medium">Execution attempts</h4>
    {runs.map(run => {
      const target = run.target && typeof run.target === "object" ? run.target as Record<string, unknown> : {};
      return <p key={String(run.id)}>Attempt #{String(run.display_attempt_number ?? run.attempt_number)} · run <code>{String(run.id)}</code> · plan {String(run.plan_version)} · {String(run.effective_disposition ?? run.disposition ?? "active")} · {String(run.repairs)} repairs · {String(run.model_calls)} calls · {String(run.tokens)} tokens · ${String(run.cost_usd)} · preflight <code>{String(run.preflight_revision ?? "not recorded")}</code> · result <code>{String(run.worker_revision ?? "not recorded")}</code> · target {String(target.target_repository ?? "not recorded")} / {String(target.target_branch ?? "not recorded")} / <code>{String(target.target_base_sha ?? "not recorded")}</code></p>;
    })}
    {runs.length === 0 && <p>No execution attempts.</p>}
    <h4 className="font-medium">Human approvals</h4>
    {approvals.map(row => <p key={String(row.id)}>{String(row.gate)} · {String(row.decision)} · plan version {String(row.plan_version)} · {String(row.actor)} · {String(row.created_at)}</p>)}
    <h4 className="font-medium">Validation gates</h4>
    {validations.map(row => <p key={String(row.id)}>{String(row.command)} · {String(row.outcome)} · cycle {String(row.cycle)} · revision <code>{String(row.revision)}</code> · {String(row.created_at)}</p>)}
    <h4 className="font-medium">Provider accounting</h4>
    {workerCalls.map((call, index) => <p key={`${String(call.run_id)}:${index}`}>{String(call.stage)} · {String(call.model)} · reservation {String(call.state)} · progress {String(call.processing_state)} · reserved {String(call.reserved_tokens)} tokens / $${(Number(call.reserved_micros) / 1_000_000).toFixed(6)} · actual {String(call.actual_input ?? 0)} input / {String(call.actual_output ?? 0)} output tokens / $${(Number(call.actual_micros ?? 0) / 1_000_000).toFixed(6)}</p>)}
    {workerCalls.some(call => ["reserved", "sent", "uncertain"].includes(String(call.state))) && <p role="alert">Provider activity is unresolved; do not prepare or retry an attempt until the control plane confirms reconciliation.</p>}
    {costs.map(row => <p key={String(row.id)}>{String(row.tokens)} tokens · ${String(row.estimated_cost_usd)} · {String(row.created_at)}</p>)}
    {costs.length === 0 && workerCalls.every(call => String(call.state) === "settled") && <p>No settled cost records.</p>}
    <h4 className="font-medium">Lifecycle/audit events</h4>
    {events.map(row => <p key={String(row.id)}>{String(row.action)} · {String(row.actor)} · {String(row.created_at)} · <code>{JSON.stringify(row.details)}</code></p>)}
    {preparations.length > 0 && <><h4 className="font-medium">Attempt preparations</h4>{preparations.map((row, index) => <p key={index}>Prior Attempt #{String(row.previous_attempt_number)} · {String(row.previous_disposition)} · version {String(row.from_version)} → {String(row.to_version)} · {String(row.created_at)}</p>)}</>}
  </section>;
}
