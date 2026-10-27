import {
  createMemoryCredentialHealthHeartbeatStore,
  createPostgresCredentialHealthHeartbeatStore,
  type CredentialHealthHeartbeatStore,
} from "./heartbeat-store";

let heartbeatStoreOverride: CredentialHealthHeartbeatStore | null | undefined;

/** Test-only override; pass `null` to clear. */
export function setCredentialHealthHeartbeatStoreForTests(
  store: CredentialHealthHeartbeatStore | null,
): void {
  heartbeatStoreOverride = store;
}

export function resetCredentialHealthHeartbeatStoreForTests(): void {
  heartbeatStoreOverride = undefined;
}

/**
 * Production cron/reactive paths use Postgres when DATABASE_URL is configured.
 * Tests without a database URL get the in-memory store.
 */
export function resolveCredentialHealthHeartbeatStore(
  explicit?: CredentialHealthHeartbeatStore,
): CredentialHealthHeartbeatStore {
  if (explicit) {
    return explicit;
  }
  if (heartbeatStoreOverride !== undefined) {
    return heartbeatStoreOverride ?? createMemoryCredentialHealthHeartbeatStore();
  }
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return createPostgresCredentialHealthHeartbeatStore();
  }
  return createMemoryCredentialHealthHeartbeatStore();
}
