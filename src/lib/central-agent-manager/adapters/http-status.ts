import {
  type DestinationLookup,
  reconfirmPinnedAddresses,
  validateHttpsStatusDestination,
} from "../destination-policy";
import { pinnedHttpsGetText, type PinnedHttpsGetResult } from "../pinned-https-get";
import { parseStatusDocumentToSnapshot } from "../contract/parse-status-document";
import { parseBoundedRemoteJson } from "../remote-payload";
import { scrubSecretsFromString } from "../scrub-response";
import type { ProjectAdapter, ProjectId } from "../types";
import { disconnectedSnapshot, unavailableSnapshot } from "../stale";

const FETCH_TIMEOUT_MS = 8_000;
const PROTECTION_BYPASS_HEADER = "x-vercel-protection-bypass";
const PROTECTION_BYPASS_ENV = "CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS";
const PROTECTION_BYPASS_HOST_ENV = "CENTRAL_AGENT_MANAGER_VERCEL_PROTECTION_BYPASS_HOST";

function exactHostname(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes("/") ||
    normalized.includes(":") ||
    normalized.includes("@") ||
    normalized.includes("?") ||
    normalized.includes("\\") ||
    /\s/.test(normalized)
  ) {
    return null;
  }
  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

type ProtectionBypassDecision = {
  ok: boolean;
  headers: Record<string, string>;
  secret: string | null;
  reason?: string;
};

function protectionBypassForHost(hostname: string): ProtectionBypassDecision {
  const secret = process.env[PROTECTION_BYPASS_ENV]?.trim() ?? "";
  const hostRaw = process.env[PROTECTION_BYPASS_HOST_ENV]?.trim() ?? "";
  if (!secret && !hostRaw) return { ok: true, headers: {}, secret: null };
  if (!secret || !hostRaw) {
    return {
      ok: false,
      headers: {},
      secret: secret || null,
      reason: "Protection bypass requires both a credential and one exact host.",
    };
  }
  const host = exactHostname(hostRaw);
  if (!host) {
    return {
      ok: false,
      headers: {},
      secret,
      reason: "Protection bypass host must be a single hostname.",
    };
  }
  if (exactHostname(hostname) !== host) {
    return {
      ok: false,
      headers: {},
      secret,
      reason: "Protection bypass is limited to its configured host.",
    };
  }
  return {
    ok: true,
    headers: { [PROTECTION_BYPASS_HEADER]: secret },
    secret,
  };
}

function statusUrlEnvKey(envKey: string): string {
  return `CENTRAL_AGENT_MANAGER_${envKey}_STATUS_URL`;
}

function statusBearerEnvKey(envKey: string): string {
  return `CENTRAL_AGENT_MANAGER_${envKey}_STATUS_BEARER`;
}

export function readProjectStatusUrl(envKey: string): string | null {
  const value = process.env[statusUrlEnvKey(envKey)]?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function configuredSecretLiterals(envKey: string, bypassSecret: string | null): string[] {
  const bearer = process.env[statusBearerEnvKey(envKey)]?.trim();
  return [bearer, bypassSecret].filter((value): value is string => Boolean(value));
}

function safeDetail(reason: string, secrets: readonly string[]): string {
  return scrubSecretsFromString(reason, secrets).slice(0, 240);
}

export type PinnedHttpsGet = typeof pinnedHttpsGetText;

export type HttpStatusAdapterDeps = {
  /** Test override only. Production path uses pinned HTTPS transport. */
  fetchImpl?: typeof fetch;
  lookup?: DestinationLookup;
  /** Test hook to assert production transport; defaults to pinned HTTPS GET. */
  pinnedGet?: PinnedHttpsGet;
};

export function createHttpStatusAdapter(
  input: {
    projectId: ProjectId;
    displayName: string;
    envKey: string;
  },
  deps: HttpStatusAdapterDeps = {},
): ProjectAdapter {
  const customFetch = deps.fetchImpl;
  const lookup = deps.lookup;
  const pinnedGet = deps.pinnedGet ?? pinnedHttpsGetText;

  return {
    projectId: input.projectId,
    displayName: input.displayName,
    async fetchSnapshot() {
      const configuredUrl = readProjectStatusUrl(input.envKey);
      if (!configuredUrl) {
        return disconnectedSnapshot(
          input.projectId,
          input.displayName,
          "No project status URL is configured for this adapter.",
        );
      }

      const destination = await validateHttpsStatusDestination(configuredUrl, lookup);
      if (!destination.ok) {
        return unavailableSnapshot(
          input.projectId,
          input.displayName,
          safeDetail(destination.reason, configuredSecretLiterals(input.envKey, null)),
        );
      }

      const hostname = destination.url.hostname;
      const pinned = await reconfirmPinnedAddresses(
        hostname,
        destination.pinnedAddresses,
        lookup,
      );
      if (!pinned) {
        return unavailableSnapshot(
          input.projectId,
          input.displayName,
          "Status URL DNS confirmation failed before fetch.",
        );
      }

      const bypass = protectionBypassForHost(hostname);
      const secrets = configuredSecretLiterals(input.envKey, bypass.secret);
      if (!bypass.ok) {
        return unavailableSnapshot(
          input.projectId,
          input.displayName,
          safeDetail(bypass.reason ?? "Protection bypass was refused.", secrets),
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const headers: Record<string, string> = {
          accept: "application/json",
          ...bypass.headers,
        };
        const bearer = process.env[statusBearerEnvKey(input.envKey)]?.trim();
        if (bearer) headers.authorization = `Bearer ${bearer}`;
        if (destination.url.searchParams.has(PROTECTION_BYPASS_HEADER)) {
          return unavailableSnapshot(
            input.projectId,
            input.displayName,
            "Protection bypass credentials are not accepted in the status URL.",
          );
        }

        let status: number;
        let bodyText: string;

        if (customFetch) {
          const response = await customFetch(destination.url.toString(), {
            method: "GET",
            headers,
            signal: controller.signal,
            cache: "no-store",
            redirect: "manual",
          });

          if (response.status >= 300 && response.status < 400) {
            return unavailableSnapshot(
              input.projectId,
              input.displayName,
              "Status endpoint attempted a redirect; redirects are not followed.",
            );
          }

          if (!response.ok) {
            return unavailableSnapshot(
              input.projectId,
              input.displayName,
              "Status endpoint returned an error response.",
            );
          }

          status = response.status;
          bodyText = await response.text();
        } else {
          const pinnedResponse: PinnedHttpsGetResult = await pinnedGet({
            url: destination.url,
            pinnedAddresses: destination.pinnedAddresses,
            headers,
            timeoutMs: FETCH_TIMEOUT_MS,
            signal: controller.signal,
          });

          if (!pinnedResponse.ok) {
            return unavailableSnapshot(
              input.projectId,
              input.displayName,
              safeDetail(pinnedResponse.reason, secrets),
            );
          }

          status = pinnedResponse.status;
          bodyText = pinnedResponse.body;

          if (status >= 300 && status < 400) {
            return unavailableSnapshot(
              input.projectId,
              input.displayName,
              "Status endpoint attempted a redirect; redirects are not followed.",
            );
          }

          if (status < 200 || status >= 300) {
            return unavailableSnapshot(
              input.projectId,
              input.displayName,
              "Status endpoint returned an error response.",
            );
          }
        }

        const parsed = parseBoundedRemoteJson(bodyText);
        if (parsed === null) {
          return unavailableSnapshot(
            input.projectId,
            input.displayName,
            "Status endpoint returned an invalid or oversized JSON payload.",
          );
        }

        const document = parseStatusDocumentToSnapshot(
          parsed,
          input.projectId,
          input.displayName,
        );
        if (!document) {
          return unavailableSnapshot(
            input.projectId,
            input.displayName,
            "Status endpoint JSON did not match contract v1 or legacy schema.",
          );
        }

        return {
          ...document.snapshot,
          connectionDetail: safeDetail(document.snapshot.connectionDetail, secrets),
        };
      } catch (error) {
        const detail =
          error instanceof Error && error.name === "AbortError"
            ? "Status endpoint timed out."
            : "Status endpoint could not be reached safely.";
        return unavailableSnapshot(input.projectId, input.displayName, detail);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
