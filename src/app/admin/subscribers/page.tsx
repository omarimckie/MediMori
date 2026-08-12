"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Lead = {
  email: string;
  signedUpAt: string;
};

export default function AdminSubscribersPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadLeads() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/admin/leads");
    if (response.status === 401) {
      router.push("/admin/login");
      return;
    }

    if (!response.ok) {
      setError("Could not load the email list.");
      setLoading(false);
      return;
    }

    const data = (await response.json()) as { leads?: Lead[] };
    setLeads(data.leads ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadLeads();
  }, []);

  function formatDate(value: string) {
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

  return (
    <AdminShell
      title="Email list"
      actions={
        <>
          <Link
            href="/admin"
            className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal transition hover:bg-cream-deep"
          >
            Blog posts
          </Link>
          <a
            href="/api/admin/leads?format=csv"
            className="inline-flex h-10 items-center rounded-xl bg-brand-green-deep px-4 text-sm font-bold text-white transition hover:brightness-95"
          >
            Download CSV
          </a>
        </>
      }
    >
      <div className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
        <p className="text-sm text-brand-charcoal/75">
          People who signed up for news and the 10% off code on the homepage.
          Download the CSV to import into a newsletter tool. If Resend is
          connected, signups are also added as Contacts there (Segments/Topics
          are optional).
        </p>
        <p className="mt-3 text-sm font-semibold text-brand-charcoal">
          {loading ? "Loading…" : `${leads.length} subscriber${leads.length === 1 ? "" : "s"}`}
        </p>
        {error ? (
          <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>
        ) : null}
      </div>

      <div className="mt-8">
        {loading ? (
          <p className="text-sm text-brand-charcoal/70">Loading subscribers…</p>
        ) : leads.length ? (
          <div className="overflow-hidden rounded-3xl border border-brand-brown/15 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-cream-deep/80 text-xs font-bold uppercase tracking-wide text-brand-charcoal/70">
                <tr>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Signed up</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={`${lead.email}-${lead.signedUpAt}`}
                    className="border-t border-brand-brown/10"
                  >
                    <td className="px-5 py-3 font-semibold text-brand-charcoal">
                      {lead.email}
                    </td>
                    <td className="px-5 py-3 text-brand-charcoal/70">
                      {formatDate(lead.signedUpAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-brand-brown/25 bg-white p-8 text-center">
            <p className="text-sm text-brand-charcoal/75">
              No subscribers yet. Once someone signs up on the homepage, they will
              appear here.
            </p>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
