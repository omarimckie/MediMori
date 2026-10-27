import type { ManagerStatusPayload, ProjectAdapterSnapshot } from "./types";

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /postgresql:\/\/[^\s"']+/gi,
  /postgres:\/\/[^\s"']+/gi,
  /sk_(live|test)_[A-Za-z0-9]{8,}/g,
  /rk_(live|test)_[A-Za-z0-9]{8,}/g,
  /whsec_[A-Za-z0-9]{8,}/g,
  /vercel_blob_rw_[A-Za-z0-9_]{8,}/g,
];

export function scrubSecretsFromString(
  value: string,
  extraSecrets: readonly string[] = [],
): string {
  let next = value;
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  for (const secret of extraSecrets) {
    const trimmed = secret.trim();
    if (trimmed.length < 8 || !next.includes(trimmed)) continue;
    next = next.split(trimmed).join("[redacted]");
  }
  return next;
}

function scrubSnapshot(snapshot: ProjectAdapterSnapshot): ProjectAdapterSnapshot {
  return {
    ...snapshot,
    connectionDetail: scrubSecretsFromString(snapshot.connectionDetail).slice(0, 240),
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      title: scrubSecretsFromString(task.title),
      status: scrubSecretsFromString(task.status),
      blockers: task.blockers.map((blocker) => ({
        ...blocker,
        summary: scrubSecretsFromString(blocker.summary),
      })),
    })),
    pendingApprovals: snapshot.pendingApprovals.map((approval) => ({
      ...approval,
      summary: scrubSecretsFromString(approval.summary),
    })),
    activeAgents: snapshot.activeAgents.map((agent) => ({
      ...agent,
      label: scrubSecretsFromString(agent.label),
    })),
    evidence: snapshot.evidence.map((item) => ({
      ...item,
      label: scrubSecretsFromString(item.label),
      kind: scrubSecretsFromString(item.kind),
    })),
  };
}

export function scrubManagerStatusPayload(payload: ManagerStatusPayload): ManagerStatusPayload {
  return {
    ...payload,
    projects: payload.projects.map(scrubSnapshot),
  };
}
