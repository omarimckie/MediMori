import { neon } from "@neondatabase/serverless";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { EngineeringInputError } from "../src/lib/engineering/policy";
import { executablePlan } from "../src/lib/engineering/worker-policy";
import { createFreshExport, diagnoseFreshExport, DockerWorkspace, exportedWorkspaceRevision } from "../src/lib/engineering/workspace";
import { openaiGenerate, runWorker, type Ingress, type IsolatedWorkspace } from "../src/lib/engineering/worker";
import { parseWorkerInitializationConfig, runScratchInitializationPreflight, diagnoseWorkerInitialization, sanitizedInitializationDiagnostic } from "../src/lib/engineering/worker-initialization";
import { verifyWorkerDatabaseIdentity } from "../src/lib/engineering/worker-database";
import { WorkspaceExportError } from "../src/lib/engineering/workspace-export-diagnostics";

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
    const exported = await diagnoseFreshExport(config.sourceRoot, config.scratchRoot, config.exportParent);
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
  const config = parseWorkerInitializationConfig(process.env, run);
  const { workerDatabaseUrl: connection, exportParent, scratchRoot, sourceRoot, sandboxImage: image, dependencyVolume, openAiKey: key, rates, models, escalationReason } = config;
  await runScratchInitializationPreflight(config);
  // Keep the SQL client in main()'s lexical scope: the ingress capability
  // below closes over it for the later claim and lifecycle calls.
  const sql = neon(connection);
  await verifyWorkerDatabaseIdentity(connection);
  let exportRoot = "";
  let preflightRevision: string;
  try {
    exportRoot = await createFreshExport(sourceRoot, exportParent);
    preflightRevision = await exportedWorkspaceRevision(exportRoot);
  } catch (error) {
    if (exportRoot) {
      try { await rm(exportRoot, { recursive: true, force: true }); }
      catch {
        throw new WorkspaceExportError("export_cleanup_failed", {
          operation: "cleanup",
          cleanupFailed: true,
          ...(error instanceof WorkspaceExportError ? { priorCode: error.code } : {}),
        });
      }
    }
    throw error;
  }
  let workspace: DockerWorkspace|undefined;
  const ingress: Ingress = async (op, owner, epoch, data = {}) => {
    try {
      const payload=op==="claim"?{...data,preflightRevision}:data;
      const rows = await sql`SELECT engineering_worker(${run}::uuid,${op},${owner},${epoch},${JSON.stringify(payload)}::jsonb) AS result`;
      const result = rows[0].result as Record<string, unknown>;
      if (op === "claim") {
        try {
          workspace = await DockerWorkspace.create(exportRoot, executablePlan(result.plan), image, dependencyVolume, { taskId: String(result.task_id ?? ""), runId: run as string }, resolve(scratchRoot));
          if ((await workspace.snapshot()).revision!==preflightRevision) throw new EngineeringInputError("Preflight revision mismatch.");
        } catch {
          await sql`SELECT engineering_worker(${run}::uuid,'block',${owner},${Number(result.lease_epoch)},${JSON.stringify({diagnostic:{stage:"worker",code:"replacement_revision_mismatch"}})}::jsonb)`.catch(()=>{});
          throw new EngineeringInputError("Preflight workspace verification failed.");
        }
      }
      return result;
    } catch (error) {
      if (error instanceof EngineeringInputError) throw error;
      throw new EngineeringInputError("Worker ingress refused or unavailable.");
    }
  };
  const proxy: IsolatedWorkspace = { preflightRevision:async()=>preflightRevision, snapshot: () => {if(!workspace)throw new EngineeringInputError("Workspace not initialized.");return workspace.snapshot();}, apply: (files, revision) => {if(!workspace)throw new EngineeringInputError("Workspace not initialized.");return workspace.apply(files, revision);}, prepareValidationEnvironment: revision => {if(!workspace)throw new EngineeringInputError("Workspace not initialized.");return workspace.prepareValidationEnvironment(revision);}, validate: (args, revision, signal) => {if(!workspace)throw new EngineeringInputError("Workspace not initialized.");return workspace.validate(args, revision, signal);}, dispose:async()=>{if(workspace)await workspace.dispose();else await rm(exportRoot,{recursive:true,force:true});} };
  // The trusted supervisor keeps its API capability in closure. Neither Docker
  // clients nor validation children inherit admin/database/API environment keys.
  for (const name of ["DATABASE_URL", "ADMIN_SESSION_SECRET", "ADMIN_USERS", "OPENAI_API_KEY", "ENGINEERING_WORKER_DATABASE_URL"]) delete process.env[name];
  try {const result = await runWorker(ingress, proxy, openaiGenerate(key), { escalationReason, rates, models });console.log(JSON.stringify({...result,reviewWorkspace:exportRoot}));}
  finally {if(workspace)await workspace.dispose().catch(()=>{});else await rm(exportRoot,{recursive:true,force:true}).catch(()=>{});}
}
