"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import type {
  AdminOrderFulfillmentFilter,
  AdminOrderKindFilter,
  AdminOrderListRow,
  AdminOrderPaymentFilter,
} from "@/lib/order-notifications/admin-orders-list";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

function formatOrderedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTotal(cents: number | null): string {
  if (cents == null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function kindLabel(kind: AdminOrderListRow["kind"]): string {
  return kind === "physical" ? "Physical" : "Digital";
}

export function AdminOrdersDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<AdminOrderListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const kind = (searchParams.get("kind") ?? "all") as AdminOrderKindFilter;
  const payment = (searchParams.get("payment") ?? "all") as AdminOrderPaymentFilter;
  const fulfillment = (searchParams.get("fulfillment") ??
    "all") as AdminOrderFulfillmentFilter;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (kind !== "all") params.set("kind", kind);
    if (payment !== "all") params.set("payment", payment);
    if (fulfillment !== "all") params.set("fulfillment", fulfillment);
    const value = params.toString();
    return value ? `?${value}` : "";
  }, [fulfillment, kind, payment]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/admin/orders${queryString}`);
    if (response.status === 401) {
      router.push(`/admin/login?next=/admin/orders${queryString}`);
      return;
    }
    if (!response.ok) {
      setError("Could not load orders.");
      setLoading(false);
      return;
    }
    const data = (await response.json()) as { orders?: AdminOrderListRow[] };
    setOrders(data.orders ?? []);
    setLoading(false);
  }, [queryString, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOrders();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOrders]);

  function updateFilter(
    key: "kind" | "payment" | "fulfillment",
    value: string,
  ): void {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const next = params.toString();
    router.replace(next ? `/admin/orders?${next}` : "/admin/orders");
  }

  return (
    <AdminShell
      title="Orders"
      actions={
        <Link
          href="/admin"
          className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal transition hover:bg-cream-deep"
        >
          Blog posts
        </Link>
      }
    >
      <div className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
        <p className="text-sm text-brand-charcoal/75">
          Paid physical and digital orders. Open a row to manage shipment, notifications,
          or order details. Customer contact information stays on the order detail page.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
            Type
            <select
              value={kind}
              onChange={(event) => updateFilter("kind", event.target.value)}
              className="h-10 min-w-[9rem] rounded-xl border border-brand-brown/20 bg-cream-deep px-3 text-sm font-semibold text-brand-charcoal"
            >
              <option value="all">All types</option>
              <option value="physical">Physical</option>
              <option value="digital">Digital</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
            Payment
            <select
              value={payment}
              onChange={(event) => updateFilter("payment", event.target.value)}
              className="h-10 min-w-[11rem] rounded-xl border border-brand-brown/20 bg-cream-deep px-3 text-sm font-semibold text-brand-charcoal"
            >
              <option value="all">All payments</option>
              <option value="paid">Paid</option>
              <option value="partially_refunded">Partially refunded</option>
              <option value="refunded">Refunded</option>
              <option value="fully_refunded">Fully refunded</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
            Fulfillment
            <select
              value={fulfillment}
              onChange={(event) => updateFilter("fulfillment", event.target.value)}
              className="h-10 min-w-[12rem] rounded-xl border border-brand-brown/20 bg-cream-deep px-3 text-sm font-semibold text-brand-charcoal"
            >
              <option value="all">All fulfillment</option>
              <option value="unfulfilled">Awaiting shipment</option>
              <option value="shipped">Shipped</option>
              <option value="cancelled">Cancelled</option>
              <option value="refunded">Refunded</option>
            </select>
          </label>
        </div>
        {fulfillment !== "all" ? (
          <p className="mt-3 text-xs text-brand-charcoal/60">
            Fulfillment filters apply to physical orders only.
          </p>
        ) : null}
      </div>

      <div className="mt-8">
        {error ? (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="text-sm text-brand-charcoal/70">Loading orders...</p>
        ) : orders.length ? (
          <div className="overflow-x-auto rounded-3xl border border-brand-brown/15 bg-white shadow-sm">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-brand-brown/10 bg-cream-deep/60 text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Fulfillment</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={`${order.kind}-${order.orderId}`}
                    className="border-b border-brand-brown/10 last:border-b-0"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-brand-charcoal/80">
                      {formatOrderedAt(order.orderedAt)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-brand-charcoal">
                      {order.productTitle}
                      {order.quantity > 1 ? (
                        <span className="ml-1 font-normal text-brand-charcoal/60">
                          ×{order.quantity}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{kindLabel(order.kind)}</td>
                    <td className="px-4 py-3">{order.paymentStatusLabel}</td>
                    <td className="px-4 py-3">{order.fulfillmentStatusLabel}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatTotal(order.totalAmountCents)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={order.detailPath}
                        className="inline-flex h-9 items-center rounded-xl bg-brand-yellow-bright px-3 text-xs font-bold text-section-navy transition hover:brightness-95"
                      >
                        View order
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-brand-brown/25 bg-white p-8 text-center">
            <p className="text-sm text-brand-charcoal/75">
              No orders match the current filters.
            </p>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
