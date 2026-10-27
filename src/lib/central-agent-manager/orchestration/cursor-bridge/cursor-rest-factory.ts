import type { CursorRestHttpFetcher } from "./cursor-rest-http";
import { loadCursorRestTransportConfigFromEnv } from "./cursor-rest-config";
import { createCursorRestCloudApiTransport, type CursorRestCloudApiTransport } from "./cursor-rest-transport";

export function createCursorRestTransportFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: CursorRestHttpFetcher,
): CursorRestCloudApiTransport | null {
  const config = loadCursorRestTransportConfigFromEnv(env);
  if (!config) return null;
  const fetcher = fetchImpl ?? globalThis.fetch;
  if (!fetcher) return null;
  return createCursorRestCloudApiTransport({ config, fetchImpl: fetcher });
}
