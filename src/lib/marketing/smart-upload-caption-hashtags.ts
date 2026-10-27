export const SMART_UPLOAD_INSTAGRAM_HASHTAG_MAX = 8;

export function normalizeInstagramHashtag(tag: string): string | null {
  const trimmed = tag.trim();
  if (!trimmed) return null;
  const core = trimmed.replace(/^#+/, "").replace(/\s+/g, "");
  if (!core || !/^[a-zA-Z0-9_]+$/.test(core)) return null;
  return `#${core}`;
}

/** Restrained Instagram hashtags: normalize, dedupe case-insensitively, cap count. */
export function normalizeInstagramHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const normalized = normalizeInstagramHashtag(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= SMART_UPLOAD_INSTAGRAM_HASHTAG_MAX) break;
  }
  return out;
}
