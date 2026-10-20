/** Browser-safe Content Queue preview: admin session proxy only (never raw blob URLs). */
export function isSafeAdminContentPreviewUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("/")) return false;
  if (/vercel-storage|blob\.|token=|sig=/i.test(trimmed)) return false;
  return /^\/api\/admin\/marketing\/assets\/[0-9a-f-]+\/image$/i.test(trimmed);
}

export function contentQueueShowsApproveReject(status: string): boolean {
  return status === "needs_review";
}

export function contentQueueRejectConfirmMessage(title: string | null, platform: string): string {
  const label = title?.trim() || "this post";
  return `Reject ${label} (${platform})? It will move to rejected and will not be scheduled or published.`;
}
