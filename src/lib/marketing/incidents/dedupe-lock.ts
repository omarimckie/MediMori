/**
 * Serializes recordIncident work per dedupe_key within a single Node process.
 * Cross-instance safety relies on the UNIQUE(dedupe_key) constraint plus repository logic.
 */

const chains = new Map<string, Promise<unknown>>();

export async function withIncidentDedupeLock<T>(
  dedupeKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = chains.get(dedupeKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = prior.then(() => gate);
  chains.set(dedupeKey, next);
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(dedupeKey) === next) {
      chains.delete(dedupeKey);
    }
  }
}

/** Test-only: reset in-process lock state. */
export function resetIncidentDedupeLocksForTests(): void {
  chains.clear();
}
