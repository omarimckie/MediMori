/** Exact budget amounts in 1/10000 USD minor units (matches numeric(12,4)). */
export function toBudgetMinor(amountUsd: number): number {
  return Math.round(amountUsd * 10_000);
}

export function fromBudgetMinor(minor: number): number {
  return minor / 10_000;
}
