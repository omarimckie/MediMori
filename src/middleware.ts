import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionValueEdge,
} from "@/lib/admin-session-edge";
import {
  evaluatePlannerStagingE2eHttpMutation,
  plannerStagingE2eMutationBlockMessage,
} from "@/lib/marketing/planner-staging-e2e-gate";
import {
  isMarketingPreviewReadonlyMutationRequest,
  MARKETING_PREVIEW_READONLY_MESSAGE,
} from "@/lib/marketing/preview-readonly";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  if (isMarketingPreviewReadonlyMutationRequest(pathname, method)) {
    const e2eDecision = evaluatePlannerStagingE2eHttpMutation(pathname, method);
    if (e2eDecision === "readonly") {
      return NextResponse.json(
        { error: MARKETING_PREVIEW_READONLY_MESSAGE },
        { status: 403 },
      );
    }
    if (e2eDecision === "scope_unarmed" || e2eDecision === "deny_allowlist") {
      return NextResponse.json(
        { error: plannerStagingE2eMutationBlockMessage(e2eDecision) },
        { status: 403 },
      );
    }
  }

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  const session = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (await verifyAdminSessionValueEdge(session)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/marketing/:path*",
    "/api/cron/marketing-publish",
    "/api/cron/marketing-reliability",
  ],
};
