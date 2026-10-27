import { resolveMarketingStoreMode } from "./config";
import { MemoryMarketingStore } from "./memory-store";
import { PostgresMarketingStore } from "./postgres-store";
import type { MarketingStore } from "./store";

let memorySingleton: MemoryMarketingStore | null = null;
let postgresSingleton: PostgresMarketingStore | null = null;

export function getMarketingStore(): MarketingStore {
  const mode = resolveMarketingStoreMode();
  if (mode === "memory") {
    memorySingleton ??= new MemoryMarketingStore();
    return memorySingleton;
  }
  postgresSingleton ??= new PostgresMarketingStore();
  return postgresSingleton;
}

export function createMemoryStore() {
  return new MemoryMarketingStore();
}
