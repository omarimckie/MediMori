import { sanitizeEventPayload } from "./sanitize";
import type {
  MarketingIncidentEventRecord,
  MarketingIncidentRecord,
} from "./types";
import type {
  InsertIncidentInput,
  MarketingIncidentRepository,
  UpdateIncidentPatch,
} from "./repository";

export function createMemoryIncidentRepository(): MarketingIncidentRepository & {
  /** Test helper: snapshot all incidents. */
  listIncidents(): MarketingIncidentRecord[];
  runTransaction<T>(fn: (repo: MarketingIncidentRepository) => Promise<T>): Promise<T>;
} {
  const incidents = new Map<string, MarketingIncidentRecord>();
  const byDedupe = new Map<string, string>();
  const events = new Map<string, MarketingIncidentEventRecord[]>();

  const api: MarketingIncidentRepository & {
    listIncidents(): MarketingIncidentRecord[];
    runTransaction<T>(fn: (repo: MarketingIncidentRepository) => Promise<T>): Promise<T>;
  } = {
    listIncidents: () => [...incidents.values()],

    async runTransaction(fn) {
      return fn(api);
    },

    async findByDedupeKey(dedupeKey) {
      const id = byDedupe.get(dedupeKey);
      return id ? incidents.get(id) ?? null : null;
    },

    async findById(id) {
      return incidents.get(id) ?? null;
    },

    async insertIncident(input: InsertIncidentInput) {
      if (byDedupe.has(input.dedupeKey)) {
        throw new Error("insertIncident: dedupe_key already exists");
      }
      const now = new Date().toISOString();
      const record: MarketingIncidentRecord = {
        ...input,
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
      };
      incidents.set(record.id, record);
      byDedupe.set(record.dedupeKey, record.id);
      events.set(record.id, []);
      return record;
    },

    async updateIncident(id, expectedVersion, patch) {
      const current = incidents.get(id);
      if (!current) return null;
      if (current.incidentVersion !== expectedVersion) {
        return null;
      }
      const lastSeenAt =
        patch.lastSeenAt != null
          ? new Date(
              Math.max(
                new Date(current.lastSeenAt).getTime(),
                new Date(patch.lastSeenAt).getTime(),
              ),
            ).toISOString()
          : current.lastSeenAt;
      const updated: MarketingIncidentRecord = {
        ...current,
        ...patch,
        lastSeenAt,
        incidentVersion: patch.incidentVersion ?? current.incidentVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      incidents.set(id, updated);
      return updated;
    },

    async appendEvent(input) {
      const list = events.get(input.incidentId) ?? [];
      const record: MarketingIncidentEventRecord = {
        id: input.id,
        incidentId: input.incidentId,
        eventType: input.eventType,
        actor: input.actor,
        payload: sanitizeEventPayload(input.payload),
        createdAt: input.createdAt ?? new Date().toISOString(),
      };
      list.push(record);
      events.set(input.incidentId, list);
      return record;
    },

    async listEvents(incidentId) {
      return [...(events.get(incidentId) ?? [])];
    },
  };

  return api;
}
