import { registeredProjects } from "../../registry";
import type { ProjectId } from "../../types";

const REGISTERED_PROJECT_IDS = new Set(registeredProjects.map((project) => project.id));

export type CursorBridgeProjectTarget = {
  projectId: ProjectId;
  repoUrl: string;
  startingRef?: string;
};

export type CursorBridgeConfig = {
  specialistAgentId: string;
  projectTargets: readonly CursorBridgeProjectTarget[];
  promptTemplate?: string;
};

const HTTPS_REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;

export function validateCursorBridgeConfig(value: unknown): CursorBridgeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cursor bridge configuration is invalid.");
  }
  const record = value as CursorBridgeConfig;
  if (typeof record.specialistAgentId !== "string" || !record.specialistAgentId.trim()) {
    throw new Error("Cursor bridge specialistAgentId is required.");
  }
  if (!Array.isArray(record.projectTargets) || !record.projectTargets.length) {
    throw new Error("Cursor bridge projectTargets are required.");
  }
  const seen = new Set<ProjectId>();
  for (const target of record.projectTargets) {
    if (!target || typeof target !== "object") {
      throw new Error("Cursor bridge project target is invalid.");
    }
    if (!REGISTERED_PROJECT_IDS.has(target.projectId)) {
      throw new Error(`Cursor bridge project id is invalid: ${String(target.projectId)}`);
    }
    if (seen.has(target.projectId)) {
      throw new Error(`Duplicate cursor bridge project target: ${target.projectId}`);
    }
    seen.add(target.projectId);
    if (typeof target.repoUrl !== "string" || !HTTPS_REPO.test(target.repoUrl)) {
      throw new Error(`Cursor bridge repoUrl is invalid for project ${target.projectId}.`);
    }
    if (
      target.startingRef !== undefined &&
      (typeof target.startingRef !== "string" || !target.startingRef.trim() || target.startingRef.length > 120)
    ) {
      throw new Error(`Cursor bridge startingRef is invalid for project ${target.projectId}.`);
    }
  }
  if (
    record.promptTemplate !== undefined &&
    (typeof record.promptTemplate !== "string" || record.promptTemplate.length > 4000)
  ) {
    throw new Error("Cursor bridge promptTemplate is invalid.");
  }
  return record;
}

export function resolveProjectTarget(
  config: CursorBridgeConfig,
  projectId: ProjectId,
): CursorBridgeProjectTarget {
  const target = config.projectTargets.find((row) => row.projectId === projectId);
  if (!target) {
    throw new Error(`No Cursor bridge repo target configured for project ${projectId}.`);
  }
  return target;
}
