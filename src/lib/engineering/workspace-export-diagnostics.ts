import { createHash } from "node:crypto";

export const workspaceExportCodes = Object.freeze([
  "source_root_unavailable", "source_root_invalid", "export_root_unavailable", "export_root_creation_failed",
  "source_traversal_failed", "source_entry_unsupported", "source_symlink_rejected", "source_file_read_failed",
  "export_directory_creation_failed", "export_file_write_failed", "export_file_size_limit_exceeded",
  "export_manifest_failed", "export_revision_failed", "export_finalize_failed", "export_cleanup_failed",
  "export_sensitive_content_rejected", "source_changed_during_export",
] as const);

export type WorkspaceExportCode = typeof workspaceExportCodes[number];
export type WorkspaceExportMetadata = {
  relativePathHash?: string;
  entryType?: "file" | "directory" | "symlink" | "unsupported" | "root";
  operation?: "realpath" | "lstat" | "readdir" | "read" | "mkdir" | "write" | "mkdtemp" | "manifest" | "revision" | "finalize" | "cleanup" | "verify";
  systemCode?: "ENOENT" | "ENOTDIR" | "EACCES" | "EPERM" | "ENOSPC" | "EIO" | "EISDIR" | "EMFILE" | "ENFILE" | "ENAMETOOLONG" | "UNKNOWN";
  cleanupFailed?: boolean;
  priorCode?: WorkspaceExportCode;
};

export const workspaceExportSummaries: Record<WorkspaceExportCode, string> = {
  source_root_unavailable: "The configured source root could not be accessed.",
  source_root_invalid: "The configured source root is invalid or unsafe.",
  export_root_unavailable: "The configured export parent is unavailable or outside the scratch root.",
  export_root_creation_failed: "A unique export directory could not be created.",
  source_traversal_failed: "The source tree could not be traversed safely.",
  source_entry_unsupported: "The source tree contains an unsupported filesystem entry.",
  source_symlink_rejected: "The source tree contains a symbolic link or reparse point.",
  source_file_read_failed: "A source file could not be read.",
  export_directory_creation_failed: "An export directory could not be created.",
  export_file_write_failed: "An exported file could not be written.",
  export_file_size_limit_exceeded: "A source file exceeds the configured filesystem file-size limit.",
  export_manifest_failed: "The sanitized export manifest could not be verified.",
  export_revision_failed: "The sanitized export revision could not be calculated.",
  export_finalize_failed: "The sanitized export could not be finalized.",
  export_cleanup_failed: "The diagnostic export could not be fully cleaned up.",
  export_sensitive_content_rejected: "Sensitive or unsafe content was rejected from the sanitized export.",
  source_changed_during_export: "The canonical source changed while its export was being verified.",
};

export class WorkspaceExportError extends Error {
  readonly stage = "source_export" as const;
  readonly summary: string;
  constructor(readonly code: WorkspaceExportCode, readonly metadata: WorkspaceExportMetadata = {}) {
    super(workspaceExportSummaries[code]);
    this.name = "WorkspaceExportError";
    this.summary = workspaceExportSummaries[code];
  }
}

export function isWorkspaceExportError(error: unknown): error is WorkspaceExportError {
  return error instanceof WorkspaceExportError;
}

export function workspaceExportDiagnostic(error: WorkspaceExportError) {
  return {
    stage: error.stage,
    code: error.code,
    summary: error.summary,
    beforeClaim: true as const,
    providerCouldHaveBeenReached: false as const,
    dockerCouldHaveBeenReached: false as const,
    ...(error.metadata.relativePathHash ? { relativePathHash: error.metadata.relativePathHash } : {}),
    ...(error.metadata.entryType ? { entryType: error.metadata.entryType } : {}),
    ...(error.metadata.operation ? { operation: error.metadata.operation } : {}),
    ...(error.metadata.systemCode ? { systemCode: error.metadata.systemCode } : {}),
    ...(error.metadata.cleanupFailed ? { cleanupFailed: true as const } : {}),
    ...(error.metadata.priorCode ? { priorCode: error.metadata.priorCode } : {}),
  };
}

export function relativePathHash(path: string) {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

export function allowlistedSystemCode(error: unknown): WorkspaceExportMetadata["systemCode"] {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const allowed = new Set(["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ENOSPC", "EIO", "EISDIR", "EMFILE", "ENFILE", "ENAMETOOLONG"]);
  return typeof code === "string" && allowed.has(code) ? code as WorkspaceExportMetadata["systemCode"] : "UNKNOWN";
}
