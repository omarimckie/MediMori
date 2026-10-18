import { timingSafeEqual } from "node:crypto";

export const CENTRAL_AGENT_STATUS_ENDPOINT_ENV = "CENTRAL_AGENT_STATUS_ENDPOINT_ENABLED";
export const CENTRAL_AGENT_STATUS_BEARER_ENV = "CENTRAL_AGENT_STATUS_READ_BEARER";

export function isCentralAgentStatusEndpointEnabled(): boolean {
  return process.env[CENTRAL_AGENT_STATUS_ENDPOINT_ENV] === "true";
}

function safeEqualStrings(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isCentralAgentStatusBearerConfigured(): boolean {
  return Boolean(process.env[CENTRAL_AGENT_STATUS_BEARER_ENV]?.trim());
}

export function verifyCentralAgentStatusBearer(request: Request): boolean {
  const expected = process.env[CENTRAL_AGENT_STATUS_BEARER_ENV]?.trim();
  if (!expected) return false;

  const header = request.headers.get("authorization")?.trim();
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length).trim();
  if (!provided) return false;

  return safeEqualStrings(provided, expected);
}
