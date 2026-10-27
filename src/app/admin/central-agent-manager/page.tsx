import { AdminShell } from "@/components/admin/AdminShell";
import { getAuthenticatedAdminUsername } from "@/lib/admin-auth";
import {
  isCentralAgentManagerEnabled,
  isCentralAgentManagerOwner,
  isCentralAgentManagerOwnerConfigured,
} from "@/lib/central-agent-manager/owner-auth";
import { redirect } from "next/navigation";
import { CentralAgentManagerClient } from "./manager-client";

export default async function CentralAgentManagerPage() {
  const username = await getAuthenticatedAdminUsername();
  if (!username) redirect("/admin/login");

  if (!isCentralAgentManagerEnabled()) {
    return (
      <AdminShell title="Central Agent Manager">
        <p className="text-sm text-brand-charcoal/75">
          Central Agent Manager is disabled. Set{" "}
          <code className="rounded bg-cream-deep px-1">CENTRAL_AGENT_MANAGER_ENABLED=true</code>{" "}
          to enable the owner dashboard and status API.
        </p>
      </AdminShell>
    );
  }

  if (!isCentralAgentManagerOwnerConfigured()) {
    return (
      <AdminShell title="Central Agent Manager">
        <p className="text-sm text-brand-charcoal/75">
          Owner access is not configured. Set{" "}
          <code className="rounded bg-cream-deep px-1">
            CENTRAL_AGENT_MANAGER_OWNER_USERNAMES
          </code>{" "}
          before using the dashboard or status API.
        </p>
      </AdminShell>
    );
  }

  if (!isCentralAgentManagerOwner(username)) {
    return (
      <AdminShell title="Central Agent Manager">
        <p className="text-sm text-brand-charcoal/75">
          This page is restricted to owner accounts configured in{" "}
          <code className="rounded bg-cream-deep px-1">
            CENTRAL_AGENT_MANAGER_OWNER_USERNAMES
          </code>
          .
        </p>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Central Agent Manager">
      <CentralAgentManagerClient />
    </AdminShell>
  );
}
