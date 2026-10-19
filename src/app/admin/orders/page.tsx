import { AdminOrdersDashboard } from "@/app/admin/orders/AdminOrdersDashboard";
import { Suspense } from "react";

export default function AdminOrdersPage() {
  return (
    <Suspense
      fallback={
        <p className="mx-auto max-w-5xl px-4 py-8 text-sm text-brand-charcoal/70 sm:px-6">
          Loading orders...
        </p>
      }
    >
      <AdminOrdersDashboard />
    </Suspense>
  );
}
