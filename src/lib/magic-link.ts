import { createHash, randomBytes } from "node:crypto";
import { normalizeEmail } from "./checkout-ownership";
import { getSql } from "./db";

const TOKEN_TTL_MS = 45 * 60 * 1000;
const MAX_LINKS_PER_EMAIL_PER_WINDOW = 3;
const RATE_WINDOW_MS = 15 * 60 * 1000;

export function hashMagicToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function createRawMagicToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function countRecentMagicLinks(email: string): Promise<number> {
  const sql = getSql();
  const normalized = normalizeEmail(email);
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM magic_link_tokens
    WHERE email = ${normalized}
      AND created_at > ${since}::timestamptz
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function isMagicLinkRateLimited(email: string): Promise<boolean> {
  return (
    (await countRecentMagicLinks(email)) >= MAX_LINKS_PER_EMAIL_PER_WINDOW
  );
}

export async function insertMagicLinkToken(
  email: string,
  rawToken: string,
): Promise<void> {
  const sql = getSql();
  const normalized = normalizeEmail(email);
  const tokenHash = hashMagicToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  await sql`
    INSERT INTO magic_link_tokens (token_hash, email, expires_at)
    VALUES (${tokenHash}, ${normalized}, ${expiresAt}::timestamptz)
  `;
}

export async function consumeMagicLinkToken(
  rawToken: string,
): Promise<string | null> {
  const sql = getSql();
  const tokenHash = hashMagicToken(rawToken);
  const rows = await sql`
    UPDATE magic_link_tokens
    SET used_at = NOW()
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING email
  `;
  const email = rows[0]?.email;
  return typeof email === "string" ? normalizeEmail(email) : null;
}
