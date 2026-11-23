import type { TikTokMediaKind } from "../buffer-tiktok-media";

const PROBE_TIMEOUT_MS = 8_000;

export type PublicMediaProbeOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function probePublicMediaUrl(
  url: string,
  kind: TikTokMediaKind,
  options: PublicMediaProbeOptions = {},
): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Range: kind === "video" ? "bytes=0-0" : "bytes=0-1023" },
    });
    if (!response.ok && response.status !== 206) {
      return `Media URL returned HTTP ${response.status} (must be publicly reachable).`;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType) {
      if (kind === "image" && !contentType.startsWith("image/")) {
        return `Expected an image response but received ${contentType}.`;
      }
      if (kind === "video" && !contentType.startsWith("video/")) {
        return `Expected a video response but received ${contentType}.`;
      }
    }
    return null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "probe_failed";
    return `Could not reach media URL (${message}).`;
  } finally {
    clearTimeout(timer);
  }
}