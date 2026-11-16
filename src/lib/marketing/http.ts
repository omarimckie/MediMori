import {
  getAuthenticatedAdminUsername,
  isAdminAuthenticated,
} from "@/lib/admin-auth";
import { marketingAuthError } from "./auth-guard";
import {
  evaluatePlannerStagingE2eHttpMutation,
  plannerStagingE2eMutationBlockMessage,
} from "./planner-staging-e2e-gate";
import {
  isMarketingPreviewReadonly,
  MARKETING_PREVIEW_READONLY_MESSAGE,
} from "./preview-readonly";
import { NextResponse } from "next/server";

export async function requireMarketingAdmin() {
  const denied = marketingAuthError(await isAdminAuthenticated());
  if (denied) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: denied.error }, { status: denied.status }),
      username: null as string | null,
    };
  }
  return {
    ok: true as const,
    response: null,
    username: await getAuthenticatedAdminUsername(),
  };
}

/** Authenticated marketing admin required, then Preview read-only mutations blocked. */
export async function requireMarketingAdminMutation(request?: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth;
  if (isMarketingPreviewReadonly()) {
    return {
      ok: false as const,
      response: marketingPreviewReadonlyResponse(),
      username: null as string | null,
    };
  }
  if (request) {
    const url = new URL(request.url);
    const decision = evaluatePlannerStagingE2eHttpMutation(url.pathname, request.method);
    if (decision === "scope_unarmed" || decision === "deny_allowlist") {
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: plannerStagingE2eMutationBlockMessage(decision) },
          { status: 403 },
        ),
        username: null as string | null,
      };
    }
  }
  return auth;
}

export function marketingPreviewReadonlyResponse() {
  return NextResponse.json(
    { error: MARKETING_PREVIEW_READONLY_MESSAGE },
    { status: 403 },
  );
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
