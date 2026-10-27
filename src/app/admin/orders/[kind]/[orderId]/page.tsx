import { AdminShell } from "@/components/admin/AdminShell";
import { AcknowledgeInventoryButton } from "@/components/admin/orders/AcknowledgeInventoryButton";
import { PhysicalShipmentControls } from "@/components/admin/orders/PhysicalShipmentControls";
import { RecoverNotificationButton } from "@/components/admin/orders/RecoverNotificationButton";
import { ShippingTestEmailControl } from "@/components/admin/orders/ShippingTestEmailControl";
import {
  loadOwnerOrderDetail,
  parseOwnerOrderRoute,
} from "@/lib/order-notifications/order-detail";
import { getLatestOwnerPushForOrder } from "@/lib/order-notifications/repository";
import {
  isApprovedShippingTestOrder,
  isShippingTestEmailEnabled,
} from "@/lib/order-notifications/shipping-test-notice";
import type { ShippingField } from "@/lib/order-notifications/present-order";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ kind: string; orderId: string }>;
};

function formatCents(cents: number | null): string | null {
  if (cents == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function FieldList({ fields }: { fields: ShippingField[] }) {
  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.label}>
          <dt className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
            {field.label}
          </dt>
          <dd className="text-sm text-brand-charcoal">{field.value ?? "Not provided"}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AdminOrderDetailPage({ params }: PageProps) {
  const { kind, orderId } = await params;
  const route = parseOwnerOrderRoute(kind, orderId);
  if (!route) notFound();

  const order = await loadOwnerOrderDetail(route.kind, route.orderId);
  if (!order) notFound();
  const notification = await getLatestOwnerPushForOrder(route.kind, route.orderId);

  return (
    <AdminShell title={order.kind === "physical" ? "Paperback order" : "Ebook order"}>
      <div className="space-y-4">
        <section className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
          <p className="text-sm font-bold text-brand-green-deep">{order.acknowledgementLabel}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {order.customerName ? (
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
                  Customer
                </dt>
                <dd className="text-sm font-semibold text-brand-charcoal">{order.customerName}</dd>
              </div>
            ) : null}
            {order.customerEmail ? (
              <div>
                <dt className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
                  Email
                </dt>
                <dd className="text-sm font-semibold text-brand-charcoal">{order.customerEmail}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
                Payment status
              </dt>
              <dd className="text-sm font-semibold text-brand-charcoal">{order.paymentStatus}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
                Fulfillment status
              </dt>
              <dd className="text-sm font-semibold text-brand-charcoal">
                {order.fulfillmentStatus}
              </dd>
            </div>
            {order.kind === "physical" ? (
              <>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
                    Carrier
                  </dt>
                  <dd className="text-sm font-semibold text-brand-charcoal">
                    {order.carrierLabel ?? "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
                    Tracking number
                  </dt>
                  <dd className="text-sm font-semibold text-brand-charcoal">
                    {order.trackingNumber ?? "Not recorded"}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
          {order.inventoryDiscrepancyOpen ? (
            <AcknowledgeInventoryButton kind={order.kind} orderId={order.orderId} />
          ) : null}
          {order.canMarkShipped ? (
            <PhysicalShipmentControls
              kind={order.kind}
              orderId={order.orderId}
              mode="ship"
              initialCarrier={null}
              initialTrackingNumber={null}
              noticeLabel={null}
              canRetry={false}
            />
          ) : null}
          {order.canCorrectShipment ? (
            <PhysicalShipmentControls
              kind={order.kind}
              orderId={order.orderId}
              mode="correct"
              initialCarrier={order.carrier}
              initialTrackingNumber={order.trackingNumber}
              noticeLabel={order.shippingNoticeLabel}
              canRetry={order.canRetryShippingNotice}
            />
          ) : null}
          {notification ? (
            <div className="mt-4 border-t border-brand-brown/10 pt-4">
              <p className="text-sm font-semibold text-brand-charcoal">
                Owner notification: {notification.status}. Attempts {notification.attemptCount} of{" "}
                {notification.maxAttempts}.
                {notification.lastError ? ` Last error: ${notification.lastError}.` : ""}
              </p>
              {notification.status === "exhausted" ? (
                <RecoverNotificationButton kind={order.kind} orderId={order.orderId} />
              ) : null}
            </div>
          ) : null}
        </section>

        {order.kind === "physical" && isApprovedShippingTestOrder(order.orderId) ? (
          <ShippingTestEmailControl
            kind={order.kind}
            orderId={order.orderId}
            enabled={isShippingTestEmailEnabled()}
          />
        ) : null}

        {order.attention.length ? (
          <section className="rounded-3xl border border-amber-300 bg-amber-50 p-6">
            <h2 className="text-lg font-extrabold text-brand-charcoal">Needs attention</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-brand-charcoal">
              {order.attention.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-extrabold text-brand-charcoal">Items</h2>
          <ul className="mt-3 divide-y divide-brand-brown/10">
            {order.items.map((item) => (
              <li key={`${item.title}-${item.quantity}`} className="flex items-baseline justify-between gap-4 py-3">
                <span className="text-sm font-semibold text-brand-charcoal">{item.title}</span>
                <span className="text-sm text-brand-charcoal/80">
                  Qty {item.quantity}
                  {formatCents(item.unitAmountCents)
                    ? ` · ${formatCents(item.unitAmountCents)} each`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {order.shippingFields ? (
          <section className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-extrabold text-brand-charcoal">Shipping address</h2>
            {order.shippingException ? (
              <p className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-brand-charcoal">
                {order.shippingException}
              </p>
            ) : null}
            <FieldList fields={order.shippingFields} />
          </section>
        ) : null}
      </div>
    </AdminShell>
  );
}
