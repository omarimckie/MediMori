import { timingSafeEqual } from "node:crypto";
import { assertIdentifier } from "../supervisor/types";
import { SupervisorContractError } from "../supervisor/types";

export const CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV = "CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON";

export type AgentBearerCredential = {
  agentId: string;
  token: string;
};

function safeEqualStrings(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function parseAgentBearerCredentialsJson(raw: string): AgentBearerCredential[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SupervisorContractError("Agent bearer configuration is not valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new SupervisorContractError("Agent bearer configuration must be a JSON array.");
  }
  const credentials: AgentBearerCredential[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") {
      throw new SupervisorContractError("Agent bearer entry must be an object.");
    }
    const agentId = (row as { agentId?: unknown }).agentId;
    const token = (row as { token?: unknown }).token;
    if (typeof agentId !== "string" || typeof token !== "string") {
      throw new SupervisorContractError("Agent bearer entry requires agentId and token strings.");
    }
    assertIdentifier(agentId, "Agent id");
    if (!token.trim() || token.length > 512) {
      throw new SupervisorContractError("Agent bearer token is invalid.");
    }
    credentials.push({ agentId, token: token.trim() });
  }
  return credentials;
}

let cachedCredentials: AgentBearerCredential[] | null | undefined;

export function resetAgentBearerCacheForTests(): void {
  cachedCredentials = undefined;
}

export function loadAgentBearerCredentials(): AgentBearerCredential[] | null {
  if (cachedCredentials !== undefined) return cachedCredentials;
  const raw = process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV]?.trim();
  if (!raw) {
    cachedCredentials = null;
    return null;
  }
  try {
    cachedCredentials = parseAgentBearerCredentialsJson(raw);
    return cachedCredentials;
  } catch {
    cachedCredentials = null;
    return null;
  }
}

export function isAgentConsumerBearerConfigured(): boolean {
  const rows = loadAgentBearerCredentials();
  return Boolean(rows?.length);
}

export function verifyAgentConsumerBearer(request: Request): string | null {
  const credentials = loadAgentBearerCredentials();
  if (!credentials?.length) return null;

  const header = request.headers.get("authorization")?.trim();
  if (!header?.startsWith("Bearer ")) return null;
  const provided = header.slice("Bearer ".length).trim();
  if (!provided) return null;

  for (const row of credentials) {
    if (safeEqualStrings(provided, row.token)) {
      return row.agentId;
    }
  }
  return null;
}
