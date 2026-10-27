import { isMockSatelliteHarnessEnabled } from "../mock/enabled";
import { createMockSatelliteAdapter } from "../mock/mock-satellite-adapter";
import { getRegisteredProject, registeredProjects } from "../registry";
import type { ProjectAdapter, ProjectId } from "../types";
import { createHttpStatusAdapter, readProjectStatusUrl } from "./http-status";
import { createMediMoriEngineeringAdapter } from "./medimori-engineering";

function resolveAdapter(projectId: ProjectId): ProjectAdapter {
  if (isMockSatelliteHarnessEnabled()) {
    return createMockSatelliteAdapter(projectId);
  }

  const project = getRegisteredProject(projectId);

  if (projectId === "medimori") {
    const httpUrl = readProjectStatusUrl(project.envKey);
    const source = process.env.CENTRAL_AGENT_MANAGER_MEDIMORI_SOURCE?.trim();
    if (source === "http" || (httpUrl && source !== "local-engineering")) {
      return createHttpStatusAdapter({
        projectId,
        displayName: project.displayName,
        envKey: project.envKey,
      });
    }
    return createMediMoriEngineeringAdapter();
  }

  return createHttpStatusAdapter({
    projectId,
    displayName: project.displayName,
    envKey: project.envKey,
  });
}

export function listProjectAdapters(): ProjectAdapter[] {
  return registeredProjects.map((project) => resolveAdapter(project.id));
}
