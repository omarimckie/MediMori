export type CursorBridgeRunnerBudgetState = {
  dayKey: string;
  createsToday: number;
  hourKey: string;
  cyclesThisHour: number;
};

export type CursorBridgeRunnerBudgetLimits = {
  dailyCreateBudget: number;
  hourlyCycleLimit: number;
};

export function createEmptyBudgetState(now: Date): CursorBridgeRunnerBudgetState {
  return {
    dayKey: dayKey(now),
    createsToday: 0,
    hourKey: hourKey(now),
    cyclesThisHour: 0,
  };
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function hourKey(now: Date): string {
  return now.toISOString().slice(0, 13);
}

export function normalizeBudgetState(
  state: CursorBridgeRunnerBudgetState | null | undefined,
  now: Date,
): CursorBridgeRunnerBudgetState {
  const currentDay = dayKey(now);
  const currentHour = hourKey(now);
  const base = state ?? createEmptyBudgetState(now);
  return {
    dayKey: currentDay,
    createsToday: base.dayKey === currentDay ? base.createsToday : 0,
    hourKey: currentHour,
    cyclesThisHour: base.hourKey === currentHour ? base.cyclesThisHour : 0,
  };
}

/** Persists daily create capacity before an external Cursor create request is sent. */
export function reserveDailyCreateSlot(
  state: CursorBridgeRunnerBudgetState,
  limits: CursorBridgeRunnerBudgetLimits,
  now: Date,
): CursorBridgeRunnerBudgetState {
  const normalized = normalizeBudgetState(state, now);
  const allowance = budgetAllowsCycle(normalized, limits, true);
  if (!allowance.allowed) {
    throw new Error(allowance.reason ?? "daily_create_budget");
  }
  return {
    ...normalized,
    createsToday: normalized.createsToday + 1,
  };
}

export function recordRunnerCycle(
  state: CursorBridgeRunnerBudgetState,
  now: Date,
): CursorBridgeRunnerBudgetState {
  const normalized = normalizeBudgetState(state, now);
  return {
    ...normalized,
    cyclesThisHour: normalized.cyclesThisHour + 1,
  };
}

export function budgetAllowsCycle(
  state: CursorBridgeRunnerBudgetState,
  limits: CursorBridgeRunnerBudgetLimits,
  willCreate: boolean,
): { allowed: boolean; reason: string | null } {
  if (state.cyclesThisHour >= limits.hourlyCycleLimit) {
    return { allowed: false, reason: "hourly_cycle_limit" };
  }
  if (willCreate && state.createsToday >= limits.dailyCreateBudget) {
    return { allowed: false, reason: "daily_create_budget" };
  }
  return { allowed: true, reason: null };
}
