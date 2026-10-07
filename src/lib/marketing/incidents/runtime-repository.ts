import { createPostgresIncidentRepository } from "./postgres-repository";
import type { MarketingIncidentRepository } from "./repository";

let testRepositoryOverride: MarketingIncidentRepository | null = null;

/** Test-only: inject in-memory repository for incident wiring tests. */
export function setMarketingIncidentRepositoryForTests(
  repository: MarketingIncidentRepository | null,
): void {
  testRepositoryOverride = repository;
}

/** Production runtime path — Postgres only (no memory store). */
export function getMarketingIncidentRepository(): MarketingIncidentRepository {
  return testRepositoryOverride ?? createPostgresIncidentRepository();
}
