"use client";

import {
  AdminPostForm,
  buildPostPayload,
  type AdminPostFormValues,
} from "@/components/admin/AdminPostForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { useRouter } from "next/navigation";

export default function AdminNewPostPage() {
  const router = useRouter();

  async function handleSubmit(values: AdminPostFormValues) {
    const response = await fetch("/api/admin/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPostPayload(values)),
    });

    const data = (await response.json()) as { error?: string; post?: { slug: string } };
    if (!response.ok) {
      throw new Error(data.error ?? "Could not publish post.");
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <AdminShell title="New blog post">
      <div className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm sm:p-8">
        <AdminPostForm mode="create" onSubmit={handleSubmit} />
      </div>
    </AdminShell>
  );
}
