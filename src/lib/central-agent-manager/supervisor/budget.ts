import type { BudgetAllocation, BudgetUsage } from "./types";
import { SupervisorContractError } from "./types";

const usageKeys = [
  "modelCalls",
  "tokens",
  "costUsd",
  "elapsedMs",
  "repairs",
  "fileChanges",
  "concurrentSessions",
] as const;

const allocationKeys = [
  "modelCalls",
  "tokens",
  "costUsd",
  "durationMs",
  "repairs",
  "fileChanges",
  "concurrentSessions",
] as const;

function finiteLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Repair and file-change limits may be zero, meaning that resource is forbidden.
 * Usage of zero has not consumed it, so a read can still pass the pre-check.
 * A positive limit is exhausted once usage reaches it. Cost is the supplied
 * figure; this module has no price table.
 */
function boundedResourceExhausted(usage: number, limit: number): boolean {
  if (limit === 0) return usage > 0;
  return usage >= limit;
}

export function assertRetryDoesNotReset(recorded: BudgetUsage, proposed: BudgetUsage): void {
  for (const key of usageKeys) {
    const previous = recorded[key];
    const next = proposed[key];
    if (previous !== null && next !== null && next < previous) {
      throw new SupervisorContractError("Retry cannot reset the original budget.");
    }
  }
}

export function usageForEvaluation(recorded: BudgetUsage, proposed: BudgetUsage | null): BudgetUsage {
  if (!proposed) return { ...recorded };
  assertRetryDoesNotReset(recorded, proposed);
  const next = { ...recorded };
  for (const key of usageKeys) {
    const previous = recorded[key];
    const candidate = proposed[key];
    if (previous === null || candidate === null) {
      next[key] = null;
      continue;
    }
    next[key] = Math.max(previous, candidate);
  }
  return next;
}

export function budgetBlockReason(
  allocation: BudgetAllocation,
  usage: BudgetUsage,
  ceiling?: BudgetAllocation,
): string | null {
  if (!allocation || typeof allocation !== "object") return "Budget allocation is invalid.";
  for (const key of allocationKeys) {
    const value = allocation[key];
    if (!finiteLimit(value)) return "Budget allocation is invalid.";
    if (ceiling && value > ceiling[key]) return "Budget exceeds the specialist profile.";
  }
  for (const key of usageKeys) {
    const value = usage?.[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return "Required usage data is unavailable.";
    }
  }
  if (usage.modelCalls! >= allocation.modelCalls) return "Model-call budget is exhausted.";
  if (usage.tokens! >= allocation.tokens) return "Token budget is exhausted.";
  if (usage.costUsd! >= allocation.costUsd) return "Cost budget is exhausted.";
  if (usage.elapsedMs! >= allocation.durationMs) return "Runtime budget is exhausted.";
  if (boundedResourceExhausted(usage.repairs!, allocation.repairs)) return "Repair budget is exhausted.";
  if (boundedResourceExhausted(usage.fileChanges!, allocation.fileChanges)) return "File-change budget is exhausted.";
  if (usage.concurrentSessions! >= allocation.concurrentSessions) {
    return "Concurrent-session budget is exhausted.";
  }
  return null;
}
