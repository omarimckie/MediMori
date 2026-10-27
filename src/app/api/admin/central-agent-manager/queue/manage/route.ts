import { getAuthenticatedAdminUsername } from "@/lib/admin-auth";
import { centralAgentManagerQueueManagementResponse } from "@/lib/central-agent-manager/queue-management-handler";

export const runtime = "nodejs";

export async function GET() {
  return centralAgentManagerQueueManagementResponse(new Request("http://local/manage", { method: "GET" }), {
    getUsername: getAuthenticatedAdminUsername,
  });
}

export async function POST(request: Request) {
  return centralAgentManagerQueueManagementResponse(request, {
    getUsername: getAuthenticatedAdminUsername,
  });
}
