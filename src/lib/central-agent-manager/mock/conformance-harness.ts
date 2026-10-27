import { parseStatusDocumentToSnapshot } from "../contract/parse-status-document";
import { contractV1ToAdapterSnapshot } from "../contract/v1-map";
import { parseContractV1Document } from "../contract/v1-parse";
import { contractV1Fixtures } from "../contract/fixtures-v1";
import { registeredProjects } from "../registry";
import type { ProjectId } from "../types";
import { createHttpStatusAdapter } from "../adapters/http-status";

export type ConformanceProjectResult = {
  projectId: ProjectId;
  parseOk: boolean;
  snapshotConnection: string | null;
};

export type MockConformanceReport = {
  projects: ConformanceProjectResult[];
  allPassed: boolean;
};

/** Deterministic in-repo contract v1 conformance (no network). */
export function runMockContractConformance(): MockConformanceReport {
  const projects = registeredProjects.map((project) => {
    const parsed = parseContractV1Document(contractV1Fixtures[project.id], project.id);
    if (!parsed.ok) {
      return { projectId: project.id, parseOk: false, snapshotConnection: null };
    }
    const snapshot = contractV1ToAdapterSnapshot(parsed.contract, project.id);
    return {
      projectId: project.id,
      parseOk: true,
      snapshotConnection: snapshot.connection,
    };
  });

  return {
    projects,
    allPassed: projects.every((item) => item.parseOk),
  };
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

/** Exercises HTTP adapter + v1 parse path with injected mock transport only. */
export async function runMockHttpAdapterConformance(
  projectId: ProjectId = "twilight-feather",
): Promise<{ ok: boolean; connection: string | null }> {
  const project = registeredProjects.find((item) => item.id === projectId);
  if (!project) return { ok: false, connection: null };

  const previousUrl = process.env[`CENTRAL_AGENT_MANAGER_${project.envKey}_STATUS_URL`];
  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env[`CENTRAL_AGENT_MANAGER_${project.envKey}_STATUS_URL`] =
    "https://mock.local/status";
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "mock.local";

  try {
    const body = JSON.stringify(contractV1Fixtures[projectId]);
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { "content-type": "application/json" } });

    const adapter = createHttpStatusAdapter(
      { projectId, displayName: project.displayName, envKey: project.envKey },
      { fetchImpl, lookup: publicLookup },
    );
    const snapshot = await adapter.fetchSnapshot();
    const document = parseStatusDocumentToSnapshot(
      JSON.parse(body),
      projectId,
      project.displayName,
    );
    return {
      ok: snapshot.connection === "connected" && document?.format === "contract-v1",
      connection: snapshot.connection,
    };
  } finally {
    if (previousUrl === undefined) {
      delete process.env[`CENTRAL_AGENT_MANAGER_${project.envKey}_STATUS_URL`];
    } else process.env[`CENTRAL_AGENT_MANAGER_${project.envKey}_STATUS_URL`] = previousUrl;
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
}
