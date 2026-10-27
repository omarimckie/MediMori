function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function parseOwnerUsernames(raw: string | undefined): Set<string> {
  const normalized = raw?.trim();
  if (!normalized) return new Set();

  if (normalized.startsWith("[")) {
    try {
      const parsed = JSON.parse(normalized) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      const users = parsed
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map(normalizeUsername);
      return new Set(users);
    } catch {
      return new Set();
    }
  }

  const users = normalized
    .split(",")
    .map((item) => normalizeUsername(item))
    .filter(Boolean);
  return new Set(users);
}

export function centralAgentManagerOwnerUsernames(): string[] {
  return [...parseOwnerUsernames(process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES)];
}

export function isCentralAgentManagerOwnerConfigured(): boolean {
  return parseOwnerUsernames(process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES).size > 0;
}

export function isCentralAgentManagerOwner(username: string | null | undefined): boolean {
  if (!username?.trim()) return false;
  const owners = parseOwnerUsernames(process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES);
  if (!owners.size) return false;
  return owners.has(normalizeUsername(username));
}

export function isCentralAgentManagerEnabled(): boolean {
  return process.env.CENTRAL_AGENT_MANAGER_ENABLED === "true";
}
