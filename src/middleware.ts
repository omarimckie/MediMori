import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionValueEdge,
} from "@/lib/admin-session-edge";
import {
  isMarketingPreviewReadonly,
  isMarketingPreviewReadonlyMutationRequest,
  MARKETING_PREVIEW_READONLY_MESSAGE,
} from "@/lib/marketing/preview-readonly";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  if (
    isMarketingPreviewReadonly() &&
    isMarketingPreviewReadonlyMutationRequest(pathname, method)
  ) {
    return NextResponse.json(
      { error: MARKETING_PREVIEW_READONLY_MESSAGE },
      { status: 403 },
    );
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
