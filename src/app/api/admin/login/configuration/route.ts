import { getAdminConfigurationDiagnostics } from "@/lib/admin-auth";
import { NextResponse } from "next/server";

/**
 * Read-only admin auth readiness probe. Returns booleans and counts only.
 */
export async function GET() {
  const diagnostics = getAdminConfigurationDiagnostics();
  return NextResponse.json(diagnostics, {
    headers: { "Cache-Control": "no-store" },
  });
}