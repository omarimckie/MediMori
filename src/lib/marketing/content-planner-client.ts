import type { MarketingContent } from "./types";

/** API: POST /api/admin/marketing/content/add-to-planner */
export type AddToPlannerResponse = {
  ok: true;
  queued: string[];
  alreadyQueued: string[];
};

export type PlannerQueueContent = Pick<
  MarketingContent,
  | "id"
  | "platform"
  | "title"
  | "status"
  | "weeklyPlanId"
  | "scheduledFor"
  | "createdAt"
  | "category"
  | "audience"
> & {
  plannerQueued?: boolean;
};

export type PlannerQueueResponse = {
  content?: PlannerQueueContent[];
  error?: string;
};

export function contentCanEnqueueToPlanner(item: {
  status: string;
  plannerQueued?: boolean;
}): boolean {
  return item.status === "approved" && item.plannerQueued !== true;
}

export function contentShowsInPlanner(item: { plannerQueued?: boolean }): boolean {
  return item.plannerQueued === true;
}

export function formatAddToPlannerSuccessMessage(
  queued: string[],
  alreadyQueued: string[],
): string {
  if (queued.length && alreadyQueued.length) {
    return `Added ${queued.length} item(s) to the planner. ${alreadyQueued.length} already in the queue.`;
  }
  if (queued.length) {
    return queued.length === 1
      ? "Added to the planning queue."
      : `Added ${queued.length} items to the planning queue.`;
  }
  if (alreadyQueued.length) {
    return alreadyQueued.length === 1
      ? "Already in the planning queue."
      : "All selected items were already in the planning queue.";
  }
  return "No items were added to the planner.";
}

function normalizePlannerIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
        return (entry as { id: string }).id;
      }
      return null;
    })
    .filter((id): id is string => Boolean(id));
}

export function parseAddToPlannerResponse(json: unknown): AddToPlannerResponse | null {
  if (!json || typeof json !== "object") return null;
  const row = json as Record<string, unknown>;
  if (row.ok !== true) return null;
  const queued = normalizePlannerIdList(row.queued);
  const alreadyQueued = normalizePlannerIdList(row.alreadyQueued);
  return { ok: true, queued, alreadyQueued };
}
