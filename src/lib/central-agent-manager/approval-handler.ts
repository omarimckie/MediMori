import { isCentralAgentManagerEnabled, isCentralAgentManagerOwnerConfigured } from "./owner-auth";
import {
  issueTrustedOwnerApproval,
  unavailableApprovalStore,
  type TrustedApprovalStore,
} from "./supervisor/trusted-approval";
import { approvalRoutesMayServe, resolveTrustedApprovalStoreFromEnv } from "./phase6d/approval-store-resolver";
import { SupervisorContractError } from "./supervisor/types";

export type ApprovalHandlerDeps = {
  getSessionToken?: () => Promise<string | undefined>;
  store?: TrustedApprovalStore;
  environment?: string | null;
  now?: string;
  isEnabled?: () => boolean;
  isOwnerConfigured?: () => boolean;
};

function approvalEnvironment(override: string | null | undefined): string | null {
  if (override !== undefined) return override;
  const configured = process.env.CENTRAL_AGENT_MANAGER_APPROVAL_ENVIRONMENT?.trim();
  if (!configured || !/^[\w.-]{1,40}$/.test(configured)) return null;
  return configured;
}

export async function centralAgentManagerApprovalResponse(
  request: Request,
  deps: ApprovalHandlerDeps = {},
): Promise<Response> {
  const isEnabled = deps.isEnabled ?? isCentralAgentManagerEnabled;
  const isOwnerConfigured = deps.isOwnerConfigured ?? isCentralAgentManagerOwnerConfigured;
  const headers = { "Cache-Control": "no-store" };

  if (!isEnabled()) {
    return Response.json({ error: "Central Agent Manager is disabled." }, { status: 503, headers });
  }
  if (!isOwnerConfigured()) {
    return Response.json(
      { error: "Central Agent Manager owner allowlist is not configured." },
      { status: 503, headers },
    );
  }

  const environment = approvalEnvironment(deps.environment);
  if (!environment) {
    return Response.json({ error: "Trusted approval environment is not configured." }, { status: 503, headers });
  }
  if (!deps.store && !approvalRoutesMayServe()) {
    return Response.json({ error: "Trusted approval routes are not activated." }, { status: 503, headers });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400, headers });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const taskId = typeof record.taskId === "string" ? record.taskId : "";
  const operation = typeof record.operation === "string" ? record.operation : "";
  const idempotencyKey = typeof record.idempotencyKey === "string" ? record.idempotencyKey : "";

  try {
    const issued = await issueTrustedOwnerApproval({
      sessionToken: await (deps.getSessionToken ?? (async () => undefined))(),
      taskId,
      operation,
      environment,
      idempotencyKey,
      store: deps.store ?? resolveTrustedApprovalStoreFromEnv(),
      now: deps.now ?? new Date().toISOString(),
    });
    return Response.json({ approvalId: issued.record.id }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trusted approval is not available.";
    if (error instanceof SupervisorContractError) {
      if (message === "Authenticated owner session is missing.") {
        return Response.json({ error: message }, { status: 401, headers });
      }
      if (message === "Authenticated admin is not an owner.") {
        return Response.json({ error: message }, { status: 403, headers });
      }
      return Response.json({ error: "Trusted approval is not available." }, { status: 503, headers });
    }
    if (message === "Authenticated owner session is missing.") {
      return Response.json({ error: message }, { status: 401, headers });
    }
    if (message === "Authenticated admin is not an owner.") {
      return Response.json({ error: message }, { status: 403, headers });
    }
    return Response.json({ error: "Trusted approval is not available." }, { status: 503, headers });
  }
}
