import { neon } from "@neondatabase/serverless";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { EngineeringInputError } from "../src/lib/engineering/policy";
import { toBoundedIngressError } from "../src/lib/engineering/proposal-evidence-ingress";
import { executablePlan } from "../src/lib/engineering/worker-policy";
import { diagnoseFreshExport, DockerWorkspace } from "../src/lib/engineering/workspace";
import { createApprovedExecutionExport } from "../src/lib/engineering/source-binding";
import { openaiGenerate, runWorker, type Ingress, type IsolatedWorkspace } from "../src/lib/engineering/worker";
import { parseWorkerInitializationConfig, runScratchInitializationPreflight, diagnoseWorkerInitialization, sanitizedInitializationDiagnostic } from "../src/lib/engineering/worker-initialization";
import { verifyWorkerDatabaseIdentity } from "../src/lib/engineering/worker-database";
import { verifyWorkerTargetAncestry } from "../src/lib/engineering/merge-target";
import { classifyPreclaimFailure, PreclaimWorkerError, type PreclaimDiagnosticStage } from "../src/lib/engineering/preclaim-diagnostics";
import { isWorkspaceExportError, workspaceExportDiagnostic } from "../src/lib/engineering/workspace-export-diagnostics";
import { ApprovedSourceRevisionMismatch, SOURCE_SELECTION_POLICY_VERSION } from "../src/lib/engineering/source-binding";

export { diagnoseWorkerInitialization };

/** Read-only production-path identity diagnostic; never calls main(). */
export async function diagnoseWorkerDatabaseIdentity(env = process.env) {
  try {
    const config = parseWorkerInitializationConfig(env);
    const identity = await verifyWorkerDatabaseIdentity(config.workerDatabaseUrl);
    return {
      ready: true,
      stage: "database_identity" as const,
      code: "worker_database_identity_verified" as const,
      summary: "Restricted worker database identity and bounded privileges were verified on the disposable branch.",
      beforeClaim: true as const,
      providerCouldHaveBeenReached: false as const,
      dockerCouldHaveBeenReached: false as const,
      identity,
    };
  } catch (error) {
    return { ready: false, ...sanitizedInitializationDiagnostic(error) };
  }
}

/** Offline diagnostic for the production sanitized-export path; no DB, provider, claim, or Docker calls. */
export async function diagnoseWorkerSourceExport(env = process.env) {
  try {
    const config = parseWorkerInitializationConfig(env);
    const scratch = await runScratchInitializationPreflight(config);
    const exported = await diagnoseFreshExport(config.sourceRoot, config.scratchRoot, config.exportParent, scratch.manifest);
    return {
      ready: true,
      stage: "source_export" as const,
      code: "sanitized_source_export_verified" as const,
      summary: "The production sanitized-export path completed and its owned diagnostic directory was removed.",
      beforeClaim: true as const,
      providerCouldHaveBeenReached: false as const,
      dockerCouldHaveBeenReached: false as const,
      scratch: {
        configuredRoot: config.scratchRoot,
        availableBytes: scratch.availableBytes.toString(),
        requiredBytes: scratch.requiredBytes.toString(),
      },
      export: exported,
    };
  } catch (error) {
    return { ready: false, ...sanitizedInitializationDiagnostic(error) };
  }
}

// Explicit invocation only. Never use DATABASE_URL/admin sessions as worker identity.
export async function main(run = process.argv[2]) {
  let stage: PreclaimDiagnosticStage = "configuration";
  let config: ReturnType<typeof parseWorkerInitializationConfig>;
  let sql: ReturnType<typeof neon> | undefined;
  let exportRoot: string;
  let preflightRevision: string;
  try {
    config = parseWorkerInitializationConfig(process.env, run);
    const { workerDatabaseUrl: connection } = config;
    // Constructing a Neon client is local-only; it allows eligible pre-claim
    // failures to be recorded through the restricted diagnostic function.
    sql = neon(connection);
    stage = "scratch_preflight";
    const scratchPreflight = await runScratchInitializationPreflight(config);
    stage = "database_identity";
    await verifyWorkerDatabaseIdentity(connection);
    stage = "lineage_lookup";
    const lineageRows = await sql`SELECT engineering_worker(${run}::uuid,'lineage','worker-lineage-preflight',0,'{}'::jsonb) AS result` as unknown as Array<{ result: unknown }>;
    const lineage = lineageRows[0]?.result as Record<string, unknown> | undefined;
    if (!lineage || lineage.run_id !== run || lineage.target_repository !== "omarimckie/MediMori" || lineage.target_branch !== "main" || typeof lineage.target_base_sha !== "string" || lineage.source_binding_version !== 1 || lineage.source_selection_policy_version !== SOURCE_SELECTION_POLICY_VERSION || typeof lineage.implementation_source_revision !== "string" || !/^[a-f0-9]{40}$/.test(lineage.implementation_source_revision)) {
      throw new EngineeringInputError("Approved execution lineage is unavailable.");
    }
    stage = "target_verification";
    await verifyWorkerTargetAncestry(lineage.target_base_sha, config.scratchRoot);
    stage = "source_export";
    const exported = await createApprovedExecutionExport(
      config.sourceRoot,
      config.exportParent,
      lineage.implementation_source_revision,
      async actualRevision => { await sql!`SELECT engineering_record_source_mismatch(${run}::uuid,${actualRevision})`; },
      scratchPreflight.manifest,
    );
    exportRoot = exported.exportRoot;
    preflightRevision = exported.revision;
  } catch (error) {
    const diagnostic = classifyPreclaimFailure(error, stage);
    // Source mismatch already uses its existing authoritative, fail-closed
    // control-plane transition. All other records use only a bounded allow-list.
    if (!(error instanceof ApprovedSourceRevisionMismatch) && sql && run && /^[a-f0-9-]{36}$/i.test(run)) {
      await sql`SELECT engineering_record_preclaim_failure(${run}::uuid,${diagnostic.stage},${diagnostic.code})`.catch(() => []);
    }
    throw new PreclaimWorkerError(diagnostic, isWorkspaceExportError(error) ? workspaceExportDiagnostic(error) : undefined);
  }
  const activeConfig = config!;
  const controlPlane = sql!;
  const { scratchRoot, sandboxImage: image, dependencyVolume, openAiKey: key, rates, models, escalationReason } = activeConfig;
  let workspace: DockerWorkspace|undefined;
  let claimSucceeded = false;
  const ingress: Ingress = async (op, owner, epoch, data = {}) => {
    try {
      const payload=op==="claim"?{...data,preflightRevision}:data;
      const rows = await controlPlane`SELECT engineering_worker(${run}::uuid,${op},${owner},${epoch},${JSON.stringify(payload)}::jsonb) AS result` as unknown as Array<{ result: unknown }>;
      const result = rows[0].result as Record<string, unknown>;
      if (op === "claim") {
        claimSucceeded = true;
        try {
          workspace = await DockerWorkspace.create(exportRoot, executablePlan(result.plan), image, dependencyVolume, { taskId: String(result.task_id ?? ""), runId: run as string }, resolve(scratchRoot));
          if ((await workspace.snapshot()).revision!==preflightRevision) throw new EngineeringInputError("Preflight revision mismatch.");
        } catch {
          await controlPlane`SELECT engineering_worker(${run}::uuid,'block',${owner},${Number(result.lease_epoch)},${JSON.stringify({diagnostic:{stage:"worker",code:"replacement_revision_mismatch"}})}::jsonb)`.catch(()=>{});
          throw new EngineeringInputError("Preflight workspace verification failed.");
        }
      }
      return result;
    } catch (error) {
      throw toBoundedIngressError(error);
    }
  };
  const proxy: IsolatedWorkspace = { preflightRevision:async()=>preflightRevision, snapshot: () => {if(!workspace)throw new EngineeringInputError("Workspace not initialized.");return workspace.snapshot();}, apply: (files, revision) => {if(!workspace)throw new EngineeringInputError("Workspace not initialized.");return workspace.apply(files, revision);}, prepareValidationEnvironment: revision => {if(!workspace)throw new EngineeringInputError("Workspace not initialized.");return workspace.prepareValidationEnvironment(revision);}, validate: (args, revision, signal) => {if(!workspace)throw new EngineeringInputError("Workspace not initialized.");return workspace.validate(args, revision, signal);}, dispose:async()=>{if(workspace)await workspace.dispose();else await rm(exportRoot,{recursive:true,force:true});} };
  // The trusted supervisor keeps its API capability in closure. Neither Docker
  // clients nor validation children inherit admin/database/API environment keys.
  for (const name of ["DATABASE_URL", "ADMIN_SESSION_SECRET", "ADMIN_USERS", "OPENAI_API_KEY", "ENGINEERING_WORKER_DATABASE_URL"]) delete process.env[name];
  try {
    try {
      const result = await runWorker(ingress, proxy, openaiGenerate(key), { escalationReason, rates, models });
      console.log(JSON.stringify({...result,reviewWorkspace:exportRoot}));
    } catch (error) {
      if (!claimSucceeded) {
        const diagnostic = classifyPreclaimFailure(error, "claim_preflight");
        await controlPlane`SELECT engineering_record_preclaim_failure(${run}::uuid,${diagnostic.stage},${diagnostic.code})`.catch(() => []);
        throw new PreclaimWorkerError(diagnostic);
      }
      throw error;
    }
  }
  finally {if(workspace)await workspace.dispose().catch(()=>{});else await rm(exportRoot,{recursive:true,force:true}).catch(()=>{});}
}
