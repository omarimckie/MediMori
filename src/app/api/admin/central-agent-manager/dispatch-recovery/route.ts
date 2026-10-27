import { getAuthenticatedAdminUsername } from "@/lib/admin-auth";
import { centralAgentManagerDispatchRecoveryResponse } from "@/lib/central-agent-manager/dispatch-recovery-handler";

export const runtime = "nodejs";

export async function GET() {
  return centralAgentManagerDispatchRecoveryResponse(new Request("http://local/dispatch-recovery", { method: "GET" }), {
    getUsername: getAuthenticatedAdminUsername,
  });
}

export async function POST(request: Request) {
  return centralAgentManagerDispatchRecoveryResponse(request, {
    getUsername: getAuthenticatedAdminUsername,
  });
}
