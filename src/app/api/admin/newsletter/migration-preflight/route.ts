import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  executeNewsletterMigrationPreflight,
  migrationPreflightAdminResponse,
} from "@/lib/newsletter-migration-preflight-run";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const response = await migrationPreflightAdminResponse({
    isAdminAuthenticated,
    runPreflight: executeNewsletterMigrationPreflight,
  });
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
