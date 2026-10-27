import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { isAdminConfigured } from "@/lib/admin-auth";
import { Suspense } from "react";

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm configured={isAdminConfigured()} />
    </Suspense>
  );
}
