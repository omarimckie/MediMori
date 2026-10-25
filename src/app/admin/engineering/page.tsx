import { getAuthenticatedAdminUsername } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { EngineeringClient } from "./task-client";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function EngineeringPage() {
  if (!await getAuthenticatedAdminUsername()) redirect("/admin/login");
  return <AdminShell title="Engineering tasks"><div className="space-y-6">
    <p>Use this control room to submit requests, review plans and attempts, and make explicit human approval decisions. Approval does not start the worker. Worker execution and merge execution require separate authorized invocations; production deployment and publishing are not available here.</p>
    {process.env.ENGINEERING_CONTROL_PLANE_ENABLED === "true" ? <EngineeringClient /> : <p>Engineering is currently disabled.</p>}
  </div></AdminShell>;
}
