"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LibrarySignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      await fetch("/api/library/logout", { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="text-sm font-semibold text-brand-charcoal/70 underline hover:text-brand-charcoal"
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
