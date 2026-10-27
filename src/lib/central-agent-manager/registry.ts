import type { ProjectId } from "./types";

export type RegisteredProject = {
  id: ProjectId;
  displayName: string;
  envKey: string;
};

export const registeredProjects: RegisteredProject[] = [
  { id: "medimori", displayName: "MediMori", envKey: "MEDIMORI" },
  { id: "twilight-feather", displayName: "Twilight Feather", envKey: "TWILIGHT_FEATHER" },
  {
    id: "real-estate-analyzer",
    displayName: "Real Estate Analyzer",
    envKey: "REAL_ESTATE_ANALYZER",
  },
  { id: "on-the-way", displayName: "On the Way", envKey: "ON_THE_WAY" },
  {
    id: "ai-trainer-fitness",
    displayName: "AI Trainer / Fitness App",
    envKey: "AI_TRAINER_FITNESS",
  },
];

const byId = new Map(registeredProjects.map((project) => [project.id, project]));

export function getRegisteredProject(projectId: ProjectId): RegisteredProject {
  const project = byId.get(projectId);
  if (!project) throw new Error(`Unknown project id: ${projectId}`);
  return project;
}

export function isProjectId(value: string): value is ProjectId {
  return byId.has(value as ProjectId);
}
