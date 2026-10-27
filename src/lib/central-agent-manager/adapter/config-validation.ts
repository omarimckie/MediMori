import type { ApprovalDatabaseIdentityConfig } from "./identity-guards";
import { endpointIdFromHost } from "./identity-guards";

const rejectedHosts = new Set(["ep-muddy-math-auxmesyz", "ep-gentle-dawn-au6vxirn"]);
const rejectedProjects = new Set(["solitary-leaf-77946642"]);
const rejectedBranches = new Set(["br-quiet-fire-ausvjkg8", "br-little-art-au7ke21s", "br-nameless-mode-b7hkls9l"]);

export type AdapterConfigDiagnostic = {
  ok: boolean;
  code: string;
  message: string;
};

function fail(code: string, message: string): AdapterConfigDiagnostic {
  return { ok: false, code, message };
}

function ok(): AdapterConfigDiagnostic {
  return { ok: true, code: "ok", message: "Adapter configuration is valid." };
}

export function validateAdapterConfig(config: ApprovalDatabaseIdentityConfig): AdapterConfigDiagnostic {
  if (!config.projectId?.trim()) return fail("missing_project", "Approval project id is required.");
  if (!config.branchId?.trim()) return fail("missing_branch", "Approval branch id is required.");
  if (!config.databaseName?.trim()) return fail("missing_database", "Approval database name is required.");
  if (!config.host?.trim()) return fail("missing_endpoint", "Approval endpoint id is required.");
  if (!config.authorityRole?.trim() || !config.executorRole?.trim()) {
    return fail("missing_role", "Approval authority and executor roles are required.");
  }
  if (config.authorityRole === config.executorRole) {
    return fail("role_collision", "Authority and executor roles must differ.");
  }
  let endpoint: string;
  try {
    endpoint = endpointIdFromHost(config.host);
  } catch {
    return fail("invalid_endpoint", "Approval endpoint id is invalid.");
  }
  if (rejectedHosts.has(endpoint)) return fail("denied_host", "Approval endpoint is not permitted.");
  if (rejectedProjects.has(config.projectId)) return fail("denied_project", "Approval project is not permitted.");
  if (rejectedBranches.has(config.branchId)) return fail("denied_branch", "Approval branch is not permitted.");
  return ok();
}

export function assertValidAdapterConfig(config: ApprovalDatabaseIdentityConfig): void {
  const result = validateAdapterConfig(config);
  if (!result.ok) {
    throw new Error(result.message);
  }
}
