import { getAuthenticatedAdminUsername } from "@/lib/admin-auth";
import { centralAgentManagerQueueResponse } from "@/lib/central-agent-manager/queue-handler";

export const runtime = "nodejs";

export async function GET() {
  return centralAgentManagerQueueResponse({
    getUsername: getAuthenticatedAdminUsername,
  });
}
