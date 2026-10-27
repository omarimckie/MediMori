import { listTasks } from "@/lib/engineering/store";
import type { ProjectAdapter, ProjectTaskSummary } from "../types";
import {
  connectedSnapshot,
  disconnectedSnapshot,
  unavailableSnapshot,
} from "../stale";

const ACTIVE_STATUSES = new Set([
  "implementing",
  "validating",
  "repairing",
  "reviewing",
  "merging",
  "analyzing",
]);

function summarizeRequest(request: string): string {
  const trimmed = request.trim();
  if (trimmed.length <= 400) return trimmed;
  return `${trimmed.slice(0, 397)}...`;
}

export function createMediMoriEngineeringAdapter(): ProjectAdapter {
  return {
    projectId: "medimori",
    displayName: "MediMori",
    async fetchSnapshot() {
      if (process.env.CENTRAL_AGENT_MANAGER_MEDIMORI_SOURCE?.trim() === "http") {
        return disconnectedSnapshot(
          "medimori",
          "MediMori",
          "MediMori local engineering adapter is disabled (HTTP source selected).",
        );
      }

      if (process.env.ENGINEERING_CONTROL_PLANE_ENABLED !== "true") {
        return disconnectedSnapshot(
          "medimori",
          "MediMori",
          "Engineering control plane is disabled; MediMori live task state is not connected.",
        );
      }

      try {
        const tasks = await listTasks();
        const now = new Date().toISOString();

        const summaries: ProjectTaskSummary[] = tasks.slice(0, 20).map((task) => {
          const blockers =
            task.status === "blocked" || task.status === "escalated"
              ? [
                  {
                    id: task.id,
                    summary: `Task is ${task.status}.`,
                    severity: "critical" as const,
                  },
                ]
              : [];
          return {
            id: task.id,
            title: summarizeRequest(task.request),
            status: task.status,
            blockers,
          };
        });

        const pendingApprovals = tasks
          .filter(
            (task) =>
              task.status === "awaiting_approval" ||
              (task.status === "awaiting_merge" &&
                task.mergeReview?.approvalStatus === "not_requested"),
          )
          .slice(0, 12)
          .map((task) => ({
            id: task.id,
            summary:
              task.status === "awaiting_approval"
                ? "Human approval required before execution."
                : "Merge decision required.",
          }));

        const activeAgents = tasks
          .filter((task) => ACTIVE_STATUSES.has(task.status))
          .slice(0, 12)
          .map((task) => ({
            id: task.id,
            label: `Engineering task ${task.id.slice(0, 8)}`,
            state: "active" as const,
          }));

        return connectedSnapshot({
          projectId: "medimori",
          displayName: "MediMori",
          connectionDetail: "Read-only engineering control-plane snapshot.",
          activeAgents,
          tasks: summaries,
          pendingApprovals,
          lastSuccessfulUpdate: now,
          evidence: [
            {
              kind: "engineering",
              label: "Engineering task history",
              href: "/admin/engineering",
            },
          ],
        });
      } catch {
        return unavailableSnapshot(
          "medimori",
          "MediMori",
          "Engineering snapshot could not be loaded from the configured database.",
        );
      }
    },
  };
}
