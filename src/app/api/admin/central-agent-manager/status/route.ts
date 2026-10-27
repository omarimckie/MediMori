import { getAuthenticatedAdminUsername } from "@/lib/admin-auth";
import { buildManagerStatusWithCache } from "@/lib/central-agent-manager/status-cache";
import { centralAgentManagerStatusResponse } from "@/lib/central-agent-manager/status-handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "true";

  return centralAgentManagerStatusResponse({
    refresh,
    getUsername: getAuthenticatedAdminUsername,
    buildStatus: ({ username, refresh: forceRefresh }) =>
      buildManagerStatusWithCache({ ownerUsername: username, refresh: forceRefresh }),
  });
}
