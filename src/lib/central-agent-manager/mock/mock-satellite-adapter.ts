import { contractV1ToAdapterSnapshot } from "../contract/v1-map";
import { parseContractV1Document } from "../contract/v1-parse";
import { contractV1Fixtures } from "../contract/fixtures-v1";
import { getRegisteredProject } from "../registry";
import { unavailableSnapshot } from "../stale";
import type { ProjectAdapter, ProjectId } from "../types";

export function createMockSatelliteAdapter(projectId: ProjectId): ProjectAdapter {
  const project = getRegisteredProject(projectId);

  return {
    projectId,
    displayName: project.displayName,
    async fetchSnapshot() {
      const parsed = parseContractV1Document(contractV1Fixtures[projectId], projectId);
      if (!parsed.ok) {
        return unavailableSnapshot(
          projectId,
          project.displayName,
          "Mock satellite fixture failed contract validation.",
        );
      }
      return contractV1ToAdapterSnapshot(parsed.contract, projectId);
    },
  };
}
