import { EngineeringInputError } from "./policy";
import type { WorkerDiagnostic } from "./worker";

const evidenceRejectTokens = [
  "proposal_evidence_denied",
  "proposal_evidence_scope_denied",
  "proposal_evidence_file_denied",
  "proposal_evidence_replacement_denied",
  "proposal_evidence_replay_mismatch",
] as const;

const leaseOrTaskRejectTokens = [
  "lease_denied",
  "identity_denied",
  "stale_attempt",
  "call_stage_denied",
  "worker_denied",
  "approval_required",
  "unresolved_call",
  "pending_call",
] as const;

const allowlistedTokens = new Set<string>([...evidenceRejectTokens, ...leaseOrTaskRejectTokens]);

/** Structured reject token from the production ingress wrapper (no raw SQL text). */
export class EngineeringIngressRejectError extends EngineeringInputError {
  constructor(readonly rejectToken: string) {
    super("Worker ingress refused.");
    this.name = "EngineeringIngressRejectError";
  }
}

/** Extract a bounded postgres RAISE token from an ingress error without returning raw messages. */
export function ingressRejectToken(error: unknown): string | null {
  if (error instanceof EngineeringIngressRejectError) {
    return allowlistedTokens.has(error.rejectToken) ? error.rejectToken : null;
  }
  if (!error || typeof error !== "object") return null;
  const message = "message" in error && typeof (error as Error).message === "string" ? (error as Error).message : "";
  if (!message) return null;
  for (const token of allowlistedTokens) {
    if (message.includes(token)) return token;
  }
  return null;
}

/** Redact transport failures while preserving allow-listed ingress reject tokens for the worker. */
export function toBoundedIngressError(error: unknown): Error {
  if (error instanceof EngineeringInputError) return error;
  const token = ingressRejectToken(error);
  if (token) return new EngineeringIngressRejectError(token);
  return new EngineeringInputError("Worker ingress refused or unavailable.");
}

export function classifyProposalEvidenceIngressFailure(
  error: unknown,
  context: { signalAborted: boolean; abortCode: WorkerDiagnostic["code"]; replacementCount: number },
): WorkerDiagnostic {
  if (context.signalAborted) {
    return { stage: "implementation", code: context.abortCode, replacementCount: context.replacementCount };
  }
  const token = ingressRejectToken(error);
  if (token && evidenceRejectTokens.includes(token as typeof evidenceRejectTokens[number])) {
    return { stage: "implementation", code: "proposal_evidence_rejected", replacementCount: context.replacementCount };
  }
  if (token && leaseOrTaskRejectTokens.includes(token as typeof leaseOrTaskRejectTokens[number])) {
    return { stage: "implementation", code: "lease_or_fence_lost", replacementCount: context.replacementCount };
  }
  return { stage: "implementation", code: "proposal_evidence_persist_failed", replacementCount: context.replacementCount };
}
