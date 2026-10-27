import {
  CAM_AUDIT_JOB_DO_NOT_TOUCH,
  CAM_COMPLETED_STAGING_JOB_5B,
  isProtectedStagingJobId,
} from "./consumer-runtime-safety";
import {
  assertStagingSessionObservation,
  redactHarnessEvidence,
  shouldStopOnHttpResponse,
  type HarnessDiagnostic,
} from "./cam-consumer-staging-acceptance-harness";

export type StagingHttpFetch = typeof fetch;

export type StagingConsumerHttpEvidence = {
  ok: boolean;
  phases: Record<string, unknown>;
};

export type StagingConsumerHttpInput = {
  baseUrl: string;
  testJobId: string;
  agentId: string;
  bearerToken: string;
  adminCookie: string;
  fetchImpl: StagingHttpFetch;
  jobAlreadyListed?: boolean;
  identityObservation?: {
    neonProjectId: string;
    neonBranchId: string;
    currentDatabase: string;
  };
};

async function consumerPost(
  fetchImpl: StagingHttpFetch,
  baseUrl: string,
  bearerToken: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetchImpl(`${baseUrl}/api/internal/central-agent-manager/assignments`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearerToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

export async function executeStagingConsumerHttpSequence(
  input: StagingConsumerHttpInput,
): Promise<StagingConsumerHttpEvidence> {
  const evidence: StagingConsumerHttpEvidence = { ok: false, phases: {} };
  if (isProtectedStagingJobId(input.testJobId)) {
    throw new Error("Test job id is protected.");
  }

  if (input.identityObservation) {
    const identity = assertStagingSessionObservation(
      input.identityObservation,
      process.env as Record<string, string | undefined>,
    );
    evidence.phases.identity = identity;
    if (identity.some((row: HarnessDiagnostic) => !row.ok)) {
      return redactHarnessEvidence(evidence) as StagingConsumerHttpEvidence;
    }
  }

  if (!input.jobAlreadyListed) {
    const enqueue = await input.fetchImpl(`${input.baseUrl}/api/admin/central-agent-manager/queue/manage`, {
      method: "POST",
      headers: { cookie: input.adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        action: "enqueue",
        id: input.testJobId,
        projectId: "medimori",
        goalId: "goal-staging-5b-consumer",
        description: "Phase 5b staging consumer acceptance",
      }),
    });
    const enqueueJson = (await enqueue.json().catch(() => ({}))) as Record<string, unknown>;
    evidence.phases.enqueue = { status: enqueue.status, jobId: (enqueueJson.job as { id?: string })?.id };
    if (shouldStopOnHttpResponse(enqueue.status, 200)) {
      return redactHarnessEvidence(evidence) as StagingConsumerHttpEvidence;
    }
  } else {
    evidence.phases.enqueue = { skipped: true };
  }

  const claim = await consumerPost(input.fetchImpl, input.baseUrl, input.bearerToken, {
    action: "claim",
    jobId: input.testJobId,
  });
  evidence.phases.claim = {
    status: claim.status,
    jobId: (claim.json.assignment as { jobId?: string })?.jobId,
  };
  if (shouldStopOnHttpResponse(claim.status, 200) || claim.json.assignment === null) {
    return redactHarnessEvidence(evidence) as StagingConsumerHttpEvidence;
  }

  const assignment = claim.json.assignment as {
    id: string;
    lease: { fenceToken: number };
  };
  const staleFence = assignment.lease.fenceToken;

  const heartbeat = await consumerPost(input.fetchImpl, input.baseUrl, input.bearerToken, {
    action: "heartbeat",
    assignmentId: assignment.id,
    leaseFenceToken: staleFence,
  });
  evidence.phases.heartbeatRenew = { status: heartbeat.status };

  const stale = await consumerPost(input.fetchImpl, input.baseUrl, input.bearerToken, {
    action: "heartbeat",
    assignmentId: assignment.id,
    leaseFenceToken: 99999,
  });
  evidence.phases.staleFence = { status: stale.status };
  if (shouldStopOnHttpResponse(stale.status, 409)) {
    return redactHarnessEvidence(evidence) as StagingConsumerHttpEvidence;
  }

  const fence = (heartbeat.json.assignment as { lease?: { fenceToken?: number } })?.lease?.fenceToken ?? staleFence;
  const evidenceId = `ev-${input.testJobId}`.slice(0, 80);
  const submit = await consumerPost(input.fetchImpl, input.baseUrl, input.bearerToken, {
    action: "submit_evidence",
    assignmentId: assignment.id,
    leaseFenceToken: fence,
    evidence: { id: evidenceId, kind: "work_completed", artifactRef: "artifacts/staging/acceptance.json" },
  });
  evidence.phases.submitEvidence = { status: submit.status };
  if (shouldStopOnHttpResponse(submit.status, 200)) {
    return redactHarnessEvidence(evidence) as StagingConsumerHttpEvidence;
  }

  const complete = await consumerPost(input.fetchImpl, input.baseUrl, input.bearerToken, {
    action: "complete",
    assignmentId: assignment.id,
    leaseFenceToken: fence,
    evidenceIds: [evidenceId],
  });
  evidence.phases.complete = { status: complete.status, jobState: complete.json.jobState };
  if (shouldStopOnHttpResponse(complete.status, 200)) {
    return redactHarnessEvidence(evidence) as StagingConsumerHttpEvidence;
  }

  const list = await input.fetchImpl(`${input.baseUrl}/api/internal/central-agent-manager/assignments`, {
    method: "GET",
    headers: { authorization: `Bearer ${input.bearerToken}` },
  });
  const listJson = (await list.json().catch(() => ({}))) as { assignments?: unknown[] };
  evidence.phases.listActive = { status: list.status, count: listJson.assignments?.length ?? -1 };

  evidence.phases.protectedJobs = {
    audit: CAM_AUDIT_JOB_DO_NOT_TOUCH,
    completed5b: CAM_COMPLETED_STAGING_JOB_5B,
  };
  evidence.ok = true;
  return redactHarnessEvidence(evidence) as StagingConsumerHttpEvidence;
}
