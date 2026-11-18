import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { isAdminConfigured } from "@/lib/admin-auth";
import { Suspense } from "react";

/** Credentials come from Preview env at request time, not from static build output. */
export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm configured={isAdminConfigured()} />
    </Suspense>
  );
}
