import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";
import { centralAgentManagerApprovalResponse } from "@/lib/central-agent-manager/approval-handler";
import { unavailableApprovalStore } from "@/lib/central-agent-manager/supervisor/trusted-approval";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  return centralAgentManagerApprovalResponse(request, {
    getSessionToken: async () => cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    store: unavailableApprovalStore,
  });
}
