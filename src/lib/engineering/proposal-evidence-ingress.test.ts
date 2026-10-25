import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProposalEvidenceIngressFailure, EngineeringIngressRejectError, ingressRejectToken, toBoundedIngressError } from "./proposal-evidence-ingress";

test("ingress reject token extraction stays bounded and allow-listed", () => {
  assert.equal(ingressRejectToken(new Error("ERROR: proposal_evidence_denied")), "proposal_evidence_denied");
  assert.equal(ingressRejectToken(new Error("private host C:\\secrets\\db password=secret")), null);
  assert.equal(ingressRejectToken(null), null);
});

test("production ingress wrapper preserves allow-listed tokens without disclosing SQL text", () => {
  const raw = new Error("ERROR: proposal_evidence_denied\n  Detail: connection postgres://user:secret@host/db");
  const bounded = toBoundedIngressError(raw);
  assert.ok(bounded instanceof EngineeringIngressRejectError);
  assert.equal(bounded.rejectToken, "proposal_evidence_denied");
  assert.equal(bounded.message, "Worker ingress refused.");
  assert.equal(JSON.stringify(bounded).includes("postgres://"), false);
  assert.deepEqual(
    classifyProposalEvidenceIngressFailure(bounded, { signalAborted: false, abortCode: "lease_or_fence_lost", replacementCount: 1 }),
    { stage: "implementation", code: "proposal_evidence_rejected", replacementCount: 1 },
  );
});

test("production ingress wrapper does not treat unrelated text as structured rejects", () => {
  const bounded = toBoundedIngressError(new Error("network timeout to database host"));
  assert.equal(bounded.message, "Worker ingress refused or unavailable.");
  assert.equal(ingressRejectToken(bounded), null);
});

test("proposal evidence ingress failures classify rejection, lease, transport, and abort", () => {
  const base = { replacementCount: 2 };
  assert.deepEqual(
    classifyProposalEvidenceIngressFailure(new Error("proposal_evidence_scope_denied"), { ...base, signalAborted: false, abortCode: "lease_or_fence_lost" }),
    { stage: "implementation", code: "proposal_evidence_rejected", replacementCount: 2 },
  );
  assert.deepEqual(
    classifyProposalEvidenceIngressFailure(new Error("lease_denied"), { ...base, signalAborted: false, abortCode: "lease_or_fence_lost" }),
    { stage: "implementation", code: "lease_or_fence_lost", replacementCount: 2 },
  );
  assert.deepEqual(
    classifyProposalEvidenceIngressFailure(new Error("private transport detail"), { ...base, signalAborted: false, abortCode: "lease_or_fence_lost" }),
    { stage: "implementation", code: "proposal_evidence_persist_failed", replacementCount: 2 },
  );
  assert.deepEqual(
    classifyProposalEvidenceIngressFailure(new Error("ignored when aborted"), { ...base, signalAborted: true, abortCode: "runtime_deadline_exceeded" }),
    { stage: "implementation", code: "runtime_deadline_exceeded", replacementCount: 2 },
  );
});
