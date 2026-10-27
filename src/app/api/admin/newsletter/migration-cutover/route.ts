import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  executeNewsletterMigrationCutover,
  migrationCutoverAdminMethodNotAllowedResponse,
  migrationCutoverAdminPostResponse,
} from "@/lib/newsletter-migration-cutover-run";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const response = migrationCutoverAdminMethodNotAllowedResponse();
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function POST(request: Request) {
  const response = await migrationCutoverAdminPostResponse(request, {
    isAdminAuthenticated,
    runCutoverApply: () => executeNewsletterMigrationCutover({ apply: true }),
  });
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
