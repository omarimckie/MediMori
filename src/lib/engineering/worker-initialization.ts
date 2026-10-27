import { resolve } from "node:path";
import { EngineeringInputError } from "./policy";
import { approvedModels, pricing, type Model, type Rates } from "./worker-policy";
import { preflightEngineeringScratch } from "./workspace";
import { isWorkspaceExportError, workspaceExportDiagnostic, workspaceExportSummaries, type WorkspaceExportCode } from "./workspace-export-diagnostics";

export const restrictedWorkerDatabaseTarget = Object.freeze({
  host: "ep-gentle-dawn-au6vxirn-pooler.c-10.us-east-1.aws.neon.tech",
  branchId: "br-little-art-au7ke21s",
  database: "neondb",
  role: "medimori_engineering_2c_worker",
});

export type WorkerEnvironment = Record<string, string | undefined>;
export type InitializationStage = "configuration" | "scratch_preflight" | "database_identity" | "source_export" | "initialization";
export type InitializationCode =
  | "worker_disabled" | "required_configuration_missing" | "invalid_run_id" | "worker_database_config_missing"
  | "worker_database_config_invalid" | "worker_database_connection_failed" | "worker_database_identity_query_failed"
  | "worker_database_identity_mismatch" | "worker_database_branch_mismatch" | "worker_database_role_mismatch"
  | "worker_database_schema_mismatch"
  | "invalid_sandbox_image" | "invalid_dependency_volume"
  | "invalid_model_policy" | "invalid_rate_policy" | "invalid_scratch_configuration" | "scratch_path_missing"
  | "scratch_path_inaccessible" | "scratch_source_unsafe" | "scratch_file_size_limit" | "insufficient_scratch_capacity"
  | "scratch_preflight_failed" | "source_export_failed" | WorkspaceExportCode | "unexpected_setup_failure";

const summaries: Record<InitializationCode, string> = {
  worker_disabled: "The local engineering worker is disabled.",
  required_configuration_missing: "A required worker configuration setting is missing.",
  invalid_run_id: "The supplied run identifier is invalid.",
  worker_database_config_missing: "The restricted worker database setting is missing.",
  worker_database_config_invalid: "The restricted worker database setting is malformed.",
  worker_database_connection_failed: "The restricted worker database connection could not be established.",
  worker_database_identity_query_failed: "The restricted worker database identity query could not complete.",
  worker_database_identity_mismatch: "The connected database identity does not satisfy the restricted worker policy.",
  worker_database_branch_mismatch: "The worker database connection is not on the approved disposable branch.",
  worker_database_role_mismatch: "The connected database role is not the restricted worker identity.",
  worker_database_schema_mismatch: "The disposable worker database is missing required call-accounting or run-lineage schema.",
  invalid_sandbox_image: "The validation image is not configured as a digest-pinned image.",
  invalid_dependency_volume: "The immutable dependency volume name is invalid.",
  invalid_model_policy: "The configured model policy is invalid or outside the approved allow-list.",
  invalid_rate_policy: "The configured model rate policy is invalid.",
  invalid_scratch_configuration: "The configured source, scratch, and export paths are inconsistent.",
  scratch_path_missing: "A configured source, scratch, or export path does not exist.",
  scratch_path_inaccessible: "A configured source, scratch, or export path cannot be accessed.",
  scratch_source_unsafe: "The source tree contains an unsafe entry for scratch export.",
  scratch_file_size_limit: "A source file exceeds the configured filesystem file-size guard.",
  insufficient_scratch_capacity: "The configured scratch filesystem lacks the required free capacity.",
  scratch_preflight_failed: "The scratch filesystem preflight failed.",
  source_export_failed: "The sanitized source export could not be prepared.",
  unexpected_setup_failure: "Initialization stopped unexpectedly; sensitive error details were withheld.",
  ...workspaceExportSummaries,
};

export class WorkerInitializationError extends EngineeringInputError {
  constructor(readonly stage: InitializationStage, readonly code: InitializationCode) {
    super(summaries[code]);
    this.name = "WorkerInitializationError";
  }
}

export type WorkerInitializationConfig = {
  runId?: string;
  workerDatabaseUrl: string;
  exportParent: string;
  scratchRoot: string;
  sourceRoot: string;
  sandboxImage: string;
  dependencyVolume: string;
  openAiKey: string;
  rates?: Record<Model, Rates>;
  models?: { luna: Model; sol: Model };
  escalationReason?: string;
};

function parseJsonObject<T>(value: string | undefined, stage: InitializationStage, code: InitializationCode): T | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as T;
  } catch {
    throw new WorkerInitializationError(stage, code);
  }
}

export function parseWorkerInitializationConfig(env: WorkerEnvironment, runId?: string): WorkerInitializationConfig {
  if (env.ENGINEERING_WORKER_ENABLED !== "true") throw new WorkerInitializationError("configuration", "worker_disabled");
  if (runId !== undefined && !/^[a-f0-9-]{36}$/i.test(runId)) throw new WorkerInitializationError("configuration", "invalid_run_id");
  const workerDatabaseUrl = env.ENGINEERING_WORKER_DATABASE_URL;
  const exportParent = env.ENGINEERING_WORKSPACE_EXPORT;
  const scratchRoot = env.ENGINEERING_SCRATCH_ROOT;
  const sourceRoot = env.ENGINEERING_WORKSPACE_SOURCE;
  const sandboxImage = env.ENGINEERING_SANDBOX_IMAGE;
  const dependencyVolume = env.ENGINEERING_NODE_MODULES_VOLUME;
  const openAiKey = env.OPENAI_API_KEY;
  if (!workerDatabaseUrl) throw new WorkerInitializationError("configuration", "worker_database_config_missing");
  if (!exportParent || !scratchRoot || !sourceRoot || !sandboxImage || !dependencyVolume || !openAiKey) {
    throw new WorkerInitializationError("configuration", "required_configuration_missing");
  }

  let database: URL;
  try {
    database = new URL(workerDatabaseUrl);
  } catch {
    throw new WorkerInitializationError("configuration", "worker_database_config_invalid");
  }
  if (!(database.protocol === "postgres:" || database.protocol === "postgresql:") || !database.hostname || !database.username || !database.password) {
    throw new WorkerInitializationError("configuration", "worker_database_config_invalid");
  }
  if (database.hostname !== restrictedWorkerDatabaseTarget.host || database.pathname !== `/${restrictedWorkerDatabaseTarget.database}`) throw new WorkerInitializationError("configuration", "worker_database_branch_mismatch");
  let username = database.username;
  try { username = decodeURIComponent(username); } catch { throw new WorkerInitializationError("configuration", "worker_database_config_invalid"); }
  if (username !== restrictedWorkerDatabaseTarget.role) throw new WorkerInitializationError("configuration", "worker_database_role_mismatch");
  if (!/^[-\w./:]+@sha256:[a-f0-9]{64}$/.test(sandboxImage)) throw new WorkerInitializationError("configuration", "invalid_sandbox_image");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(dependencyVolume)) throw new WorkerInitializationError("configuration", "invalid_dependency_volume");

  const models = parseJsonObject<{ luna: Model; sol: Model }>(env.ENGINEERING_WORKER_MODELS_JSON, "configuration", "invalid_model_policy");
  if (models && (models.luna !== approvedModels[0] || models.sol !== approvedModels[1])) throw new WorkerInitializationError("configuration", "invalid_model_policy");
  const rates = parseJsonObject<Record<Model, Rates>>(env.ENGINEERING_WORKER_RATES_JSON, "configuration", "invalid_rate_policy");
  if (rates) {
    try { for (const model of approvedModels) pricing(model, rates); }
    catch { throw new WorkerInitializationError("configuration", "invalid_rate_policy"); }
  }

  return {
    runId,
    workerDatabaseUrl,
    exportParent: resolve(exportParent),
    scratchRoot: resolve(scratchRoot),
    sourceRoot: resolve(sourceRoot),
    sandboxImage,
    dependencyVolume,
    openAiKey,
    rates,
    models,
    escalationReason: env.ENGINEERING_SOL_ESCALATION_REASON,
  };
}

function scratchFailureCode(error: unknown): InitializationCode {
  if (isWorkspaceExportError(error)) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return "scratch_path_missing";
    if (error.code === "EACCES" || error.code === "EPERM") return "scratch_path_inaccessible";
  }
  if (error instanceof Error) {
    if (error.message === "Invalid engineering scratch configuration.") return "invalid_scratch_configuration";
    if (error.message === "Unsafe scratch source tree.") return "scratch_source_unsafe";
    if (error.message === "Scratch source contains a file too large for the configured filesystem.") return "scratch_file_size_limit";
    if (error.message === "Configured engineering scratch has insufficient free space.") return "insufficient_scratch_capacity";
  }
  return "scratch_preflight_failed";
}

export async function runScratchInitializationPreflight(config: WorkerInitializationConfig, minimumScratchFreeBytes?: bigint) {
  try {
    return await preflightEngineeringScratch(config.sourceRoot, config.scratchRoot, config.exportParent, minimumScratchFreeBytes);
  } catch (error) {
    throw new WorkerInitializationError("scratch_preflight", scratchFailureCode(error));
  }
}

export function sanitizedInitializationDiagnostic(error: unknown, beforeClaim = true) {
  if (isWorkspaceExportError(error)) return workspaceExportDiagnostic(error);
  if (error instanceof WorkerInitializationError) {
    return {
      stage: error.stage,
      code: error.code,
      summary: summaries[error.code],
      beforeClaim,
      providerCouldHaveBeenReached: false,
      dockerCouldHaveBeenReached: false,
    } as const;
  }
  return {
    stage: "initialization" as const,
    code: "unexpected_setup_failure" as const,
    summary: summaries.unexpected_setup_failure,
    beforeClaim,
    providerCouldHaveBeenReached: false,
    dockerCouldHaveBeenReached: false,
  } as const;
}

/** Read-only pre-claim check. It never connects to Neon, exports files, calls a provider, or invokes Docker. */
export async function diagnoseWorkerInitialization(env: WorkerEnvironment, options: { minimumScratchFreeBytes?: bigint } = {}) {
  let config: WorkerInitializationConfig;
  try {
    config = parseWorkerInitializationConfig(env);
  } catch (error) {
    return { ready: false, ...sanitizedInitializationDiagnostic(error) };
  }
  let scratch: Awaited<ReturnType<typeof preflightEngineeringScratch>>;
  try {
    scratch = await runScratchInitializationPreflight(config, options.minimumScratchFreeBytes);
  } catch (error) {
    return { ready: false, ...sanitizedInitializationDiagnostic(error) };
  }
  return {
    ready: true,
    stage: "pre_claim_configuration_and_scratch_ready" as const,
    code: "configuration_and_scratch_ready" as const,
    summary: "Configuration and read-only scratch checks passed; database identity connectivity, source export, claim, provider, and Docker were not tested.",
    beforeClaim: true as const,
    providerCouldHaveBeenReached: false as const,
    dockerCouldHaveBeenReached: false as const,
    checks: {
      workerEnabled: "configured",
      workerDatabase: "disposable_host_and_restricted_login_shape_validated",
      sandboxImage: "digest_pinned_shape_validated",
      dependencyVolume: "name_validated",
      modelAndRatePolicy: "allow_list_validated",
      scratchFilesystem: "passed",
    },
    scratch: {
      configuredRoot: config.scratchRoot,
      requiredFreeBytes: scratch.requiredBytes.toString(),
      availableFreeBytes: scratch.availableBytes.toString(),
      sourceBytes: scratch.sourceBytes.toString(),
      perFileSizeGuard: "passed",
    },
  };
}

/** Static countability helps tests ensure every diagnostic code has an allow-listed summary. */
export const workerInitializationCodes = Object.freeze(Object.keys(summaries) as InitializationCode[]);
export const workerInitializationLimits = Object.freeze({ maxSummaryChars: 160, databaseConnectivityTestedOffline: false, sourceExportCreatedOffline: false, providerCalledOffline: false, dockerInvokedOffline: false });
