import type { HostLookupResult } from "./destination-policy";
import { isUnsafeResolvedAddress } from "./destination-policy";

export function uniqueSafeSortedAddresses(records: HostLookupResult[]): string[] | null {
  const unique = [...new Set(records.map((record) => record.address))];
  if (!unique.length) return null;
  if (unique.some((address) => isUnsafeResolvedAddress(address))) return null;
  return unique.sort();
}

export function pinnedAddressSetsMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}
