import {
  getAuthenticatedAdminUsername,
  isAdminAuthenticated,
} from "@/lib/admin-auth";
import { marketingAuthError } from "./auth-guard";
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

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
