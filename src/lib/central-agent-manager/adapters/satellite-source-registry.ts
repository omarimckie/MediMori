import type { ProjectId } from "../types";
import { registeredProjects } from "../registry";
import { readProjectStatusUrl } from "./http-status";

export type SatelliteSourceKind = "http_contract_v1" | "medimori_engineering" | "unconfigured";

export type SatelliteSourceDescriptor = {
  projectId: ProjectId;
  displayName: string;
  kind: SatelliteSourceKind;
  envKeys: string[];
  detail: string;
};

function medimoriSource(): SatelliteSourceDescriptor {
  const httpUrl = readProjectStatusUrl("MEDIMORI");
  const source = process.env.CENTRAL_AGENT_MANAGER_MEDIMORI_SOURCE?.trim();
  if (source === "http" || (httpUrl && source !== "local-engineering")) {
    return {
      projectId: "medimori",
      displayName: "MediMori",
      kind: "http_contract_v1",
      envKeys: ["CENTRAL_AGENT_MANAGER_MEDIMORI_STATUS_URL"],
      detail: httpUrl ? "HTTP contract v1 endpoint configured." : "HTTP source selected but URL missing.",
    };
  }
  return {
    projectId: "medimori",
    displayName: "MediMori",
    kind: "medimori_engineering",
    envKeys: ["ENGINEERING_CONTROL_PLANE_ENABLED", "CENTRAL_AGENT_MANAGER_MEDIMORI_SOURCE"],
    detail: "Uses local engineering control-plane adapter when enabled; otherwise disconnected.",
  };
}

const httpProjectEnvKey: Record<Exclude<ProjectId, "medimori">, string> = {
  "twilight-feather": "TWILIGHT_FEATHER",
  "real-estate-analyzer": "REAL_ESTATE_ANALYZER",
  "on-the-way": "ON_THE_WAY",
  "ai-trainer-fitness": "AI_TRAINER_FITNESS",
};

export function describeSatelliteSource(projectId: ProjectId): SatelliteSourceDescriptor {
  if (projectId === "medimori") return medimoriSource();
  const project = registeredProjects.find((row) => row.id === projectId)!;
  const envKey = httpProjectEnvKey[projectId];
  const url = readProjectStatusUrl(envKey);
  if (!url) {
    return {
      projectId,
      displayName: project.displayName,
      kind: "unconfigured",
      envKeys: [`CENTRAL_AGENT_MANAGER_${envKey}_STATUS_URL`],
      detail: "No supported status URL configured. Adapter remains disconnected.",
    };
  }
  return {
    projectId,
    displayName: project.displayName,
    kind: "http_contract_v1",
    envKeys: [`CENTRAL_AGENT_MANAGER_${envKey}_STATUS_URL`],
    detail: "HTTP contract v1 endpoint configured.",
  };
}

export function listSatelliteSourceDescriptors(): SatelliteSourceDescriptor[] {
  return registeredProjects.map((project) => describeSatelliteSource(project.id));
}
