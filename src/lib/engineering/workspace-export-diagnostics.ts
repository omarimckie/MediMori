import { createHash } from "node:crypto";

export const workspaceExportCodes = Object.freeze([
  "source_root_unavailable", "source_root_invalid", "export_root_unavailable", "export_root_creation_failed",
  "source_traversal_failed", "source_entry_unsupported", "source_symlink_rejected", "source_file_read_failed",
  "export_directory_creation_failed", "export_file_write_failed", "export_file_size_limit_exceeded",
  "export_manifest_failed", "export_revision_failed", "export_finalize_failed", "export_cleanup_failed",
  "export_sensitive_content_rejected", "source_changed_during_export", "source_git_resolution_failed",
  "source_git_revision_invalid", "source_git_tree_invalid", "source_git_entry_unsupported", "source_checkout_dirty",
  "source_checkout_changed_during_export", "source_git_object_invalid", "source_git_object_read_failed",
  "source_file_count_limit_exceeded", "source_file_size_limit_exceeded", "source_total_size_limit_exceeded",
  "source_binary_unclassified", "source_file_missing", "source_file_modified",
] as const);

export type WorkspaceExportCode = typeof workspaceExportCodes[number];
export type BinaryDetectedFormat = "png" | "jpeg" | "ico" | "unknown";
export type BinaryFailureReason = "unsupported_metadata" | "invalid_structure" | "c2pa_container_invalid" | "c2pa_payload_oversized" | "ico_dib_layout_unsupported";
export type BinaryOwnerAction = "review_c2pa_asset_without_stripping_credentials" | "provide_standard_ico_encoding" | "review_unsupported_metadata_without_removing_it" | "review_or_replace_unsupported_binary";
export type WorkspaceExportMetadata = {
  relativePathHash?: string;
  relativePath?: string;
  detectedFormat?: BinaryDetectedFormat;
  binaryFailure?: BinaryFailureReason;
  metadataType?: "eXIf" | "iTXt" | "unknown";
  recommendedOwnerAction?: BinaryOwnerAction;
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
  source_git_resolution_failed: "The immutable Git source tree could not be resolved safely.",
  source_git_revision_invalid: "The immutable Git source revision is invalid.",
  source_git_tree_invalid: "The immutable Git source tree could not be parsed safely.",
  source_git_entry_unsupported: "The immutable Git source tree contains an unsupported entry.",
  source_checkout_dirty: "The implementation checkout is not clean.",
  source_checkout_changed_during_export: "The implementation checkout changed during export verification.",
  source_git_object_invalid: "A selected Git source object failed integrity verification.",
  source_git_object_read_failed: "Selected Git source objects could not be read safely.",
  source_file_count_limit_exceeded: "The canonical source exceeds the configured file-count limit.",
  source_file_size_limit_exceeded: "A canonical source file exceeds the configured file-size limit.",
  source_total_size_limit_exceeded: "The canonical source exceeds the configured aggregate-size limit.",
  source_binary_unclassified: "A canonical binary source file could not be safely classified.",
  source_file_missing: "A selected source file is missing from the implementation checkout.",
  source_file_modified: "A selected source file differs from its immutable Git object.",
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
  const ownerActions: Record<BinaryOwnerAction, string> = {
    review_c2pa_asset_without_stripping_credentials: "Have the owner review the Content Credentials structure; do not strip or rewrite the asset.",
    provide_standard_ico_encoding: "Have the owner review the icon entries and provide a standard ICO using supported DIB or PNG metadata; do not rewrite the favicon automatically.",
    review_unsupported_metadata_without_removing_it: "Have the owner review the named metadata and approve strict support or replacement; preserve the original metadata.",
    review_or_replace_unsupported_binary: "Have the owner review the unsupported binary format or metadata before changing the source asset.",
  };
  return {
    stage: error.stage,
    code: error.code,
    summary: error.summary,
    beforeClaim: true as const,
    providerCouldHaveBeenReached: false as const,
    dockerCouldHaveBeenReached: false as const,
    ...(error.metadata.relativePathHash ? { relativePathHash: error.metadata.relativePathHash } : {}),
    ...(error.metadata.relativePath ? { file: error.metadata.relativePath } : {}),
    ...(error.metadata.detectedFormat ? { detectedFormat: error.metadata.detectedFormat } : {}),
    ...(error.metadata.binaryFailure ? { failureReason: error.metadata.binaryFailure } : {}),
    ...(error.metadata.metadataType ? { metadataType: error.metadata.metadataType } : {}),
    ...(error.metadata.recommendedOwnerAction ? { recommendedOwnerAction: ownerActions[error.metadata.recommendedOwnerAction] } : {}),
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
