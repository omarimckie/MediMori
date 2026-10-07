import { createPostgresIncidentRepository, listIncidentsFromPostgres } from "./postgres-repository";
import type { MarketingIncidentRecord } from "./types";
import { listNotificationsByIncidentId } from "../notifications/notifications-repository";

export type ListIncidentsInput = {
  limit?: number;
  unresolvedOnly?: boolean;
  publicationId?: string | null;
};

export async function listIncidents(
  input: ListIncidentsInput = {},
): Promise<MarketingIncidentRecord[]> {
  return listIncidentsFromPostgres(input);
}

export async function getIncidentDetail(incidentId: string) {
  const repo = createPostgresIncidentRepository();
  const incident = await repo.findById(incidentId);
  if (!incident) return null;
  const events = await repo.listEvents(incidentId);
  const notifications = await listNotificationsByIncidentId(incidentId);
  return { incident, events, notifications };
}
