import Link from "next/link";
import type { ReactNode } from "react";
import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton";

const PRIMARY_NAV = [
  { href: "/admin/marketing", label: "Overview" },
  { href: "/admin/marketing/week", label: "Your week" },
  { href: "/admin/marketing/report", label: "Weekly report" },
];

const MORE_NAV = [
  { href: "/admin/marketing/campaigns", label: "Campaigns" },
  { href: "/admin/marketing/content", label: "Content" },
  { href: "/admin/marketing/calendar", label: "Calendar" },
  { href: "/admin/marketing/assets", label: "Assets" },
  { href: "/admin/marketing/analytics", label: "Analytics" },
  { href: "/admin/marketing/recommendations", label: "Recommendations" },
  { href: "/admin/marketing/brain", label: "Marketing brain" },
  { href: "/admin/marketing/costs", label: "Costs" },
];

export function MarketingShell({
  title,
  children,
  pathname,
}: {
  title: string;
  children: ReactNode;
  pathname: string;
}) {
  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-brand-brown/15 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
              Twilight.Feather · Marketing Autopilot
            </p>
            <h1 className="font-display text-3xl font-bold text-brand-navy">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin"
              className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal hover:bg-cream-deep"
            >
              Blog admin
            </Link>
            <AdminLogoutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        <nav className="w-full shrink-0 lg:w-56">
          <p className="mb-2 hidden text-xs font-bold uppercase tracking-wide text-brand-green-deep lg:block">
            This week
          </p>
          <ul className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {PRIMARY_NAV.map((item) => {
              const active =
                item.href === "/admin/marketing"
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold ${
                      active
                        ? "bg-brand-navy text-white"
                        : "text-brand-charcoal hover:bg-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-brand-charcoal/45">
            More
          </p>
          <ul className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {MORE_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ${
                      active
                        ? "bg-white text-brand-navy"
                        : "text-brand-charcoal/70 hover:bg-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
