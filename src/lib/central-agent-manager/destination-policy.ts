import { lookup as dnsLookup } from "node:dns/promises";

export type HostLookupResult = { address: string; family: number };

export type DestinationLookup = (
  hostname: string,
) => Promise<HostLookupResult[]>;

const defaultLookup: DestinationLookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family }));
};

function parseApprovedHosts(raw: string | undefined): Set<string> {
  const normalized = raw?.trim();
  if (!normalized) return new Set();

  if (normalized.startsWith("[")) {
    try {
      const parsed = JSON.parse(normalized) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      return new Set(
        parsed
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => normalizeHostname(item)),
      );
    } catch {
      return new Set();
    }
  }

  return new Set(
    normalized
      .split(",")
      .map((item) => normalizeHostname(item))
      .filter(Boolean),
  );
}

function normalizeHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.includes("/") || trimmed.includes(":")) return "";
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

export function approvedStatusHosts(): string[] {
  return [...parseApprovedHosts(process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS)];
}

export function isApprovedStatusHost(hostname: string): boolean {
  const hosts = parseApprovedHosts(process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS);
  if (!hosts.size) return false;
  return hosts.has(normalizeHostname(hostname));
}

function parseIpv4(address: string): [number, number, number, number] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return null;
  return nums as [number, number, number, number];
}

export function isUnsafeResolvedAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const [a, b] = ipv4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }

  const lower = address.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    if (mapped.includes(".")) return isUnsafeResolvedAddress(mapped);
  }
  return false;
}

function isUnsafeLiteralHostname(hostname: string): boolean {
  const lower = normalizeHostname(hostname);
  if (!lower) return true;
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "metadata.google.internal") return true;
  if (isUnsafeResolvedAddress(lower)) return true;
  return false;
}

export type DestinationValidationResult =
  | { ok: true; url: URL; pinnedAddresses: string[] }
  | { ok: false; reason: string };

function pinnedAddressesFromRecords(records: HostLookupResult[]): string[] | null {
  const unique = [...new Set(records.map((record) => record.address))];
  if (!unique.length) return null;
  if (unique.some((address) => isUnsafeResolvedAddress(address))) return null;
  return unique.sort();
}

export async function reconfirmPinnedAddresses(
  hostname: string,
  pinnedAddresses: string[],
  lookup: DestinationLookup = defaultLookup,
): Promise<boolean> {
  let resolved: HostLookupResult[];
  try {
    resolved = await lookup(normalizeHostname(hostname));
  } catch {
    return false;
  }
  const next = pinnedAddressesFromRecords(resolved);
  if (!next) return false;
  if (next.length !== pinnedAddresses.length) return false;
  return next.every((address, index) => address === pinnedAddresses[index]);
}

export async function validateHttpsStatusDestination(
  rawUrl: string,
  lookup: DestinationLookup = defaultLookup,
): Promise<DestinationValidationResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Status URL is malformed." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Status URL must use HTTPS." };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "Status URL must not include credentials." };
  }

  if (url.hash) {
    return { ok: false, reason: "Status URL must not include a fragment." };
  }

  const port = url.port ? Number(url.port) : 443;
  if (!Number.isInteger(port) || port !== 443) {
    return { ok: false, reason: "Status URL must use port 443." };
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || isUnsafeLiteralHostname(hostname)) {
    return { ok: false, reason: "Status URL hostname is not allowed." };
  }

  if (!isApprovedStatusHost(hostname)) {
    return { ok: false, reason: "Status URL hostname is not on the approved list." };
  }

  if (isUnsafeResolvedAddress(hostname)) {
    return { ok: false, reason: "Status URL resolves to a blocked address." };
  }

  let resolved: HostLookupResult[];
  try {
    resolved = await lookup(hostname);
  } catch {
    return { ok: false, reason: "Status URL hostname could not be resolved safely." };
  }

  if (!resolved.length) {
    return { ok: false, reason: "Status URL hostname could not be resolved safely." };
  }

  const pinnedAddresses = pinnedAddressesFromRecords(resolved);
  if (!pinnedAddresses) {
    return { ok: false, reason: "Status URL resolves to a blocked address." };
  }

  return { ok: true, url, pinnedAddresses };
}
