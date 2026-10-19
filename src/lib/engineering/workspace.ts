import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, statfs, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { EngineeringInputError, type Plan } from "./policy";
import { assertScope, executablePlan } from "./worker-policy";
import { cleanupOwnedDockerResources, dockerOwnershipArgs, DockerCleanupError, validateDockerOwnership, type DockerOwnership, type ExecutionResourceType } from "./docker-ownership";
import type { IsolatedWorkspace, ProposalEvidence, Snapshot } from "./worker";
import { anchorLimits, issuedAnchorId, sha256, verifyAnchorIdentity, type AnchorReplacement } from "./replacement-anchors";
import { allowlistedSystemCode, relativePathHash, WorkspaceExportError, type WorkspaceExportCode } from "./workspace-export-diagnostics";
import { makeValidationEvidence, ValidationPreparationError, withStagingCleanupFailure, type ValidationPreparationCode, type ValidationPreparationStage, type ValidationEvidence } from "./validation-diagnostics";
import { initializeNextEnvPrivateOverlayCommand, validationVolumeMountArgs } from "./validation-volume-policy";
import { populateHelperEntrypointCommand, sourceVolumePopulateTimeoutMs, streamTarDirectoryIntoDockerExec, type ValidationPreparationOperation } from "./validation-source-populate";
import { resolveCanonicalSourceManifest, verifyCanonicalSourceCheckout, copyCanonicalSourceManifest, SOURCE_SELECTION_LIMITS, SOURCE_SELECTION_POLICY_VERSION, type CanonicalSourceManifest } from "./source-manifest";
const exec = promisify(execFile);
const secret = /(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|(?:postgres(?:ql)?:\/\/)[^\s/:@]+:[^\s/@]+@[^\s]+|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}|vercel_blob_rw_[A-Za-z0-9_]{20,})/;
const gib = BigInt(1024) * BigInt(1024) * BigInt(1024);
const minimumScratchReserve = BigInt(10) * gib;
/** Applies the production scratch-capacity rule to measured or deterministic test inputs. */
export function checkedScratchCapacity(availableBytes: bigint, sourceBytes: bigint, minimumFreeBytes = minimumScratchReserve) {
  const requiredBytes = sourceBytes * BigInt(2) + minimumFreeBytes;
  if (availableBytes < requiredBytes) throw new EngineeringInputError("Configured engineering scratch has insufficient free space.");
  return { availableBytes, requiredBytes, sourceBytes };
}
async function contents(root: string, prefix = "", map: Record<string, string> = {}, count = { files: 0, bytes: 0 }) {
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || entry.name === ".git" || entry.name.startsWith(".env") && entry.name !== ".env.example") throw new EngineeringInputError("Unsafe exported workspace.");
    if (entry.isDirectory()) {
      await contents(root, path, map, count);
    } else if (entry.isFile()) {
      const bytes = await readFile(join(root, path));
      if (bytes.length > SOURCE_SELECTION_LIMITS.maxFileBytes || ++count.files > SOURCE_SELECTION_LIMITS.maxFiles || (count.bytes += bytes.length) > SOURCE_SELECTION_LIMITS.maxTotalBytes) throw new EngineeringInputError("Exported workspace size limit.");
      if (secret.test(bytes.toString("utf8"))) throw new EngineeringInputError("Secret detected; context export refused.");
      map[path] = createHash("sha256").update(bytes).digest("hex");
    } else throw new EngineeringInputError("Unsupported exported workspace entry.");
  }
  return map;
}

/** The same clean Git-tree manifest drives storage capacity, export, verification, and S. */
export async function preflightEngineeringScratch(sourceRoot: string, scratchRoot: string, exportParent: string, minimumFreeBytes = minimumScratchReserve, suppliedManifest?: CanonicalSourceManifest) {
  const source = await realpath(sourceRoot);
  const scratch = await realpath(scratchRoot);
  const parent = await realpath(exportParent);
  const relativeParent = relative(scratch, parent);
  if (scratch === source || scratch.startsWith(`${source}${sep}`) || relativeParent === ".." || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent)) {
    throw new EngineeringInputError("Invalid engineering scratch configuration.");
  }
  const manifest = suppliedManifest ?? await resolveCanonicalSourceManifest(source);
  if (manifest.root !== source) throw new EngineeringInputError("Canonical source manifest root mismatch.");
  const capacity = await statfs(scratch, { bigint: true });
  const available = capacity.bavail * capacity.bsize;
  return { ...checkedScratchCapacity(available, manifest.totalBytes, minimumFreeBytes), manifest, sourcePolicyVersion: SOURCE_SELECTION_POLICY_VERSION };
}
function exportFailure(code: WorkspaceExportCode, operation: "realpath" | "lstat" | "readdir" | "read" | "mkdir" | "write" | "mkdtemp" | "manifest" | "revision" | "finalize" | "cleanup" | "verify", relativePath = "", error?: unknown, entryType?: "file" | "directory" | "symlink" | "unsupported" | "root") {
  return new WorkspaceExportError(code, {
    operation,
    ...(relativePath ? { relativePathHash: relativePathHash(relativePath) } : {}),
    ...(entryType ? { entryType } : {}),
    ...(error !== undefined ? { systemCode: allowlistedSystemCode(error) } : {}),
  });
}


async function sourceRootAndParent(sourceRoot: string, exportParent: string) {
  let source: string;
  try { source = await realpath(sourceRoot); }
  catch (error) { throw exportFailure("source_root_unavailable", "realpath", "", error, "root"); }
  try {
    const metadata = await lstat(sourceRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw exportFailure("source_root_invalid", "lstat", "", undefined, "root");
  } catch (error) {
    if (error instanceof WorkspaceExportError) throw error;
    throw exportFailure("source_root_unavailable", "lstat", "", error, "root");
  }
  let parent: string;
  try { parent = await realpath(exportParent); }
  catch (error) { throw exportFailure("export_root_unavailable", "realpath", "", error, "root"); }
  try {
    const metadata = await lstat(parent);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw exportFailure("export_root_unavailable", "lstat", "", undefined, "root");
  } catch (error) {
    if (error instanceof WorkspaceExportError) throw error;
    throw exportFailure("export_root_unavailable", "lstat", "", error, "root");
  }
  if (source === parent || parent.startsWith(`${source}${sep}`)) throw exportFailure("export_root_unavailable", "verify", "", undefined, "root");
  return { source, parent };
}

/** Copy only entries and bytes from the immutable Git manifest; never walk the source checkout. */
export async function createFreshExport(sourceRoot: string, exportParent: string, suppliedManifest?: CanonicalSourceManifest) {
  const { source, parent } = await sourceRootAndParent(sourceRoot, exportParent);
  const manifest = suppliedManifest ?? await resolveCanonicalSourceManifest(source);
  if (manifest.root !== source) throw exportFailure("source_git_revision_invalid", "verify", "", undefined, "root");
  let partial: string;
  try { partial = await mkdtemp(join(parent, ".medimori-worker-export-partial-")); }
  catch (error) { throw exportFailure("export_root_creation_failed", "mkdtemp", "", error, "root"); }
  const finalRoot = join(parent, `medimori-worker-export-${randomUUID()}`);
  let primary: WorkspaceExportError | undefined;
  try {
    await copyCanonicalSourceManifest(manifest, partial);
    try {
      const exported = await contents(partial);
      if (Object.keys(exported).length !== manifest.files.length || treeRevision(exported) !== manifest.revision) throw new Error("manifest_mismatch");
      await verifyCanonicalSourceCheckout(manifest);
    } catch (error) {
      if (error instanceof WorkspaceExportError) throw error;
      throw exportFailure("export_manifest_failed", "manifest", "", error);
    }
    try { await rename(partial, finalRoot); }
    catch (error) { throw exportFailure("export_finalize_failed", "finalize", "", error, "root"); }
    return finalRoot;
  } catch (error) {
    primary = error instanceof WorkspaceExportError ? error : exportFailure("export_manifest_failed", "manifest", "", error);
  }
  try { await rm(partial, { recursive: true, force: true }); }
  catch {
    throw new WorkspaceExportError("export_cleanup_failed", { operation: "cleanup", cleanupFailed: true, priorCode: primary.code });
  }
  throw primary;
}
function treeRevision(tree: Record<string, string>) {
  return createHash("sha1").update(JSON.stringify(Object.entries(tree).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest("hex");
}
export async function exportedWorkspaceRevision(root:string) {
  let manifest: Record<string, string>;
  try { manifest = await contents(root); }
  catch (error) {
    if (error instanceof EngineeringInputError && /Secret detected|Unsafe exported workspace/.test(error.message)) throw exportFailure("export_sensitive_content_rejected", "manifest");
    throw exportFailure("export_manifest_failed", "manifest", "", error);
  }
  try { return treeRevision(manifest); }
  catch (error) { throw exportFailure("export_revision_failed", "revision", "", error); }
}


async function verifySanitizedExport(root: string, manifest: CanonicalSourceManifest) {
  let count = 0;
  async function visit(prefix = "") {
    let entries;
    try { entries = await readdir(join(root, prefix), { withFileTypes: true }); }
    catch (error) { throw exportFailure("export_manifest_failed", "manifest", prefix, error); }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name.startsWith(".env") && entry.name !== ".env.example") {
        throw exportFailure("export_sensitive_content_rejected", "verify", prefix ? `${prefix}/${entry.name}` : entry.name, undefined, "unsupported");
      }
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(root, rel);
      let metadata;
      try { metadata = await lstat(fullPath); }
      catch (error) { throw exportFailure("export_manifest_failed", "lstat", rel, error); }
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) throw exportFailure("source_symlink_rejected", "verify", rel, undefined, "symlink");
      if (metadata.isDirectory()) { await visit(rel); continue; }
      if (!metadata.isFile()) throw exportFailure("source_entry_unsupported", "verify", rel, undefined, "unsupported");
      count++;
    }
  }
  await visit();
  if (count !== manifest.files.length) throw exportFailure("export_manifest_failed", "verify");
  return count;
}

/** Safe local probe around the exact production exporter. It owns and removes only its unique D:-rooted directory. */
export async function diagnoseFreshExport(sourceRoot: string, scratchRoot: string, exportParent: string, suppliedManifest?: CanonicalSourceManifest) {
  const { parent } = await sourceRootAndParent(sourceRoot, exportParent);
  const scratch = await realpath(scratchRoot).catch(error => { throw exportFailure("export_root_unavailable", "realpath", "", error, "root"); });
  const relativeParent = relative(scratch, parent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent)) throw exportFailure("export_root_unavailable", "verify", "", undefined, "root");
  const sourceManifest = suppliedManifest ?? await resolveCanonicalSourceManifest(sourceRoot);
  const sourceBefore = sourceManifest.revision;
  let diagnosticRoot: string;
  try { diagnosticRoot = await mkdtemp(join(parent, "engineering-export-diagnostic-")); }
  catch (error) { throw exportFailure("export_root_creation_failed", "mkdtemp", "", error, "root"); }
  let result: { revision: string; fileCount: number; sourceBytes: number; sourcePolicyVersion: number; sourceUnchanged: boolean } | undefined;
  let failure: WorkspaceExportError | undefined;
  try {
    const exportRoot = await createFreshExport(sourceRoot, diagnosticRoot, sourceManifest);
    const revision = await exportedWorkspaceRevision(exportRoot);
    const fileCount = await verifySanitizedExport(exportRoot, sourceManifest);
    const sourceAfter = (await resolveCanonicalSourceManifest(sourceRoot)).revision;
    if (sourceBefore !== sourceAfter) throw new WorkspaceExportError("source_changed_during_export", { operation: "verify" });
    if (sourceBefore !== revision) throw new WorkspaceExportError("export_manifest_failed", { operation: "verify" });
    result = { revision, fileCount, sourceBytes: Number(sourceManifest.totalBytes), sourcePolicyVersion: SOURCE_SELECTION_POLICY_VERSION, sourceUnchanged: true };
  } catch (error) {
    failure = error instanceof WorkspaceExportError ? error : exportFailure("export_manifest_failed", "verify", "", error);
  }
  try { await rm(diagnosticRoot, { recursive: true, force: true }); }
  catch {
    throw new WorkspaceExportError("export_cleanup_failed", { operation: "cleanup", cleanupFailed: true, ...(failure ? { priorCode: failure.code } : {}) });
  }
  try {
    await lstat(diagnosticRoot);
    throw new WorkspaceExportError("export_cleanup_failed", { operation: "cleanup", cleanupFailed: true, ...(failure ? { priorCode: failure.code } : {}) });
  } catch (error) {
    if (error instanceof WorkspaceExportError) throw error;
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw new WorkspaceExportError("export_cleanup_failed", { operation: "cleanup", cleanupFailed: true, ...(failure ? { priorCode: failure.code } : {}) });
    }
  }
  if (failure) throw failure;
  return { ...result!, cleanup: "owned_diagnostic_directory_removed" as const, sensitiveExclusions: "verified" as const };
}
/** Root MUST be a disposable credential-free export, never the working checkout. */
export class DockerWorkspace implements IsolatedWorkspace {
  private base: Record<string, string> = {};
  private readonly id = randomUUID();
  private readonly sourceVolume = `medimori-worker-source-${this.id}`;
  private readonly cacheVolume = `medimori-worker-cache-${this.id}`;
  private readonly uploadsVolume = `medimori-worker-uploads-${this.id}`;
  private readonly privateVolume = `medimori-worker-private-${this.id}`;
  private resourcesMayExist = false;
  private volumesReady = false;
  private nextEnvSourceHash: string | null = null;
  private constructor(private root: string, private plan: Plan, private image: string, private dependencyVolume: string, private owner: DockerOwnership, private scratchRoot: string) {}
  static async create(root: string, plan: Plan, image: string, dependencyVolume: string, owner: DockerOwnership, scratchRoot = root) {
    executablePlan(plan);
    validateDockerOwnership(owner);
    if (root.includes(",") || !/^[-\w./:]+@sha256:[a-f0-9]{64}$/.test(image)) throw new EngineeringInputError("Pinned prebuilt sandbox image required.");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(dependencyVolume)) throw new EngineeringInputError("Read-only sandbox dependency volume required.");
    if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new EngineeringInputError("Invalid workspace root.");
    const workspace = new DockerWorkspace(root, plan, image, dependencyVolume, owner, scratchRoot);
    workspace.base = await contents(root);
    return workspace;
  }
  private typeForVolume(name: string): ExecutionResourceType {
    if (name === this.sourceVolume) return "source-volume";
    if (name === this.cacheVolume) return "cache-volume";
    if (name === this.uploadsVolume) return "uploads-volume";
    return "private-volume";
  }
  private async createVolume(name: string) {
    this.resourcesMayExist = true;
    await exec("docker", ["volume", "create", ...dockerOwnershipArgs(this.owner, this.typeForVolume(name)), name], { timeout: 15000, windowsHide: true });
  }
  private async cleanupVolumes() {
    if (!this.resourcesMayExist) return;
    const cleanup = await cleanupOwnedDockerResources(this.owner);
    if (cleanup.failures.length === 0) this.resourcesMayExist = false;
    this.volumesReady = false;
    if (cleanup.failures.length) throw new DockerCleanupError(cleanup.failures);
  }
  private async prepareVolumes(expectedRevision: string) {
    if (this.volumesReady) return;
    let staging = "";
    let helper = "";
    let failureCode: ValidationPreparationCode = "validation_source_prepare_failed";
    let failureStage: ValidationPreparationStage = "source_volume";
    let failureOperation: ValidationPreparationOperation = "local_staging_export";
    let deferredError: unknown;
    try {
      failureCode = "validation_executor_unavailable"; failureStage = "docker_preflight";
      await exec("docker", ["info", "--format={{.ServerVersion}}"], { timeout: 15000, windowsHide: true });
      failureCode = "validation_image_unavailable"; failureStage = "image_check";
      await exec("docker", ["image", "inspect", this.image], { timeout: 15000, windowsHide: true });
      failureCode = "validation_dependency_unavailable"; failureStage = "dependency_check";
      await exec("docker", ["volume", "inspect", this.dependencyVolume], { timeout: 15000, windowsHide: true });
      failureCode = "validation_source_prepare_failed"; failureStage = "source_volume"; failureOperation = "local_staging_export";
      const tree = await contents(this.root);
      if (treeRevision(tree) !== expectedRevision) throw new EngineeringInputError("Workspace changed before volume population.");
      staging = await mkdtemp(join(this.scratchRoot, "medimori-sandbox-export-"));
      for (const path of Object.keys(tree)) {
        const target = join(staging, path);
        if (!target.startsWith(`${staging}${sep}`)) throw new EngineeringInputError("Unsafe exported path.");
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(this.root, path), target);
      }
      // next-env.d.ts is part of the approved Git source revision. The runner
      // moves only its isolated volume copy to a private writable overlay.
      const nextEnv = join(this.root, "next-env.d.ts");
      const metadata = await lstat(nextEnv);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new EngineeringInputError("Unsafe Next.js declaration file.");
      const bytes = await readFile(nextEnv);
      if (secret.test(bytes.toString("utf8"))) throw new EngineeringInputError("Secret detected; context export refused.");
      this.nextEnvSourceHash = createHash("sha256").update(bytes).digest("hex");
      if (!/^[a-f0-9]{64}$/.test(tree["next-env.d.ts"] ?? "") || this.nextEnvSourceHash !== tree["next-env.d.ts"]) throw new EngineeringInputError("Next.js declaration file differs from the approved source revision.");
      failureOperation = "docker_volume_create";
      for (const volume of [this.sourceVolume, this.cacheVolume, this.uploadsVolume, this.privateVolume]) await this.createVolume(volume);
      const populateTimeoutMs = sourceVolumePopulateTimeoutMs(Object.keys(tree).length);
      const uploadPath = join(staging, "public", "marketing-uploads");
      let includeUploads = false;
      try {
        await lstat(uploadPath);
        includeUploads = true;
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      }
      helper = `medimori-worker-populate-${this.id}`;
      this.resourcesMayExist = true;
      failureOperation = "docker_populate_create";
      await exec("docker", ["create", "--name", helper, ...dockerOwnershipArgs(this.owner, "populate-container"), "--network=none", "--user=0:0",
        "--mount", `type=volume,source=${this.sourceVolume},target=/workspace`,
        "--mount", `type=volume,source=${this.cacheVolume},target=/cache`,
        "--mount", `type=volume,source=${this.uploadsVolume},target=/uploads`,
        "--mount", `type=volume,source=${this.privateVolume},target=/private`,
        "--entrypoint=/bin/sh", this.image, "-c", populateHelperEntrypointCommand(Object.keys(tree).length, includeUploads)], { timeout: 20000, windowsHide: true });
      await exec("docker", ["start", helper], { timeout: 15000, windowsHide: true });
      failureOperation = "docker_populate_workspace";
      await streamTarDirectoryIntoDockerExec(helper, staging, "/workspace", populateTimeoutMs);
      if (includeUploads) {
        failureOperation = "docker_populate_uploads";
        await streamTarDirectoryIntoDockerExec(helper, uploadPath, "/uploads", Math.min(populateTimeoutMs, 180_000));
      }
      failureOperation = "docker_populate_remove";
      await exec("docker", ["rm", "--force", helper], { timeout: 15000, windowsHide: true });
      helper = "";
      failureCode = "validation_overlay_prepare_failed"; failureStage = "next_env_overlay"; failureOperation = "docker_overlay_init";
      await exec("docker", ["run", "--rm", ...dockerOwnershipArgs(this.owner, "populate-container"), "--network=none", "--user=0:0",
        "--mount", `type=volume,source=${this.sourceVolume},target=/workspace`,
        "--mount", `type=volume,source=${this.cacheVolume},target=/cache`,
        "--mount", `type=volume,source=${this.uploadsVolume},target=/uploads`,
        "--mount", `type=volume,source=${this.privateVolume},target=/private`,
        "--entrypoint=/bin/sh", this.image, "-c", initializeNextEnvPrivateOverlayCommand(this.nextEnvSourceHash!)], { timeout: 60000, windowsHide: true });
      this.volumesReady = true;
    } catch (error) {
      if (helper) await exec("docker", ["rm", "--force", helper], { timeout: 10000, windowsHide: true }).catch(() => {});
      deferredError = error instanceof ValidationPreparationError || error instanceof EngineeringInputError
        ? error
        : new ValidationPreparationError(failureCode, failureStage, failureOperation);
      try { await this.cleanupVolumes(); }
      catch (cleanupError) {
        if (cleanupError instanceof DockerCleanupError) {
          if (deferredError instanceof ValidationPreparationError) deferredError = withStagingCleanupFailure(deferredError);
          else if (!deferredError) throw cleanupError;
        }
      }
    } finally {
      if (staging) {
        try { await rm(staging, { recursive: true, force: true }); }
        catch {
          if (!this.volumesReady) {
            if (deferredError instanceof ValidationPreparationError) deferredError = withStagingCleanupFailure(deferredError);
            else if (!deferredError) deferredError = new ValidationPreparationError("validation_source_prepare_failed", "source_volume", "staging_cleanup");
          }
        }
      }
    }
    if (deferredError) throw deferredError;
  }
  private async inspectDiagnosticSourceWrites(): Promise<{ available: boolean; changedCount: number | null; changedPaths: string[]; nextEnvEffect: "created" | "changed" | "unchanged" | "removed" | "unavailable"; failureStage: string | null }> {
    const observer = `medimori-build-observer-${this.id}`;
    let stage = "source_manifest";
    try {
      const before = await contents(this.root);
      const nodeScript = "const f=require('node:fs'),p=require('node:path'),c=require('node:crypto'),o={},skip=new Set(['.next','node_modules','.git','tsconfig.tsbuildinfo','next-env.d.ts']);function walk(d,r=''){for(const e of f.readdirSync(d,{withFileTypes:true})){if(skip.has(e.name))continue;const q=r?r+'/'+e.name:e.name,x=p.join(d,e.name);if(e.isSymbolicLink())throw Error('unsupported');if(e.isDirectory())walk(x,q);else if(e.isFile())o[q]=c.createHash('sha256').update(f.readFileSync(x)).digest('hex')}}walk('/workspace');try{o['@next-env']=c.createHash('sha256').update(f.readFileSync('/workspace/next-env.d.ts')).digest('hex')}catch{}process.stdout.write(JSON.stringify(o))";
      stage = "observer_run";
      const output = (await exec("docker", ["run", "--name", observer, ...dockerOwnershipArgs(this.owner, "validation-container"), "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=512m", "--user=1000:1000", "--cgroupns=private", "--mount", `type=volume,source=${this.sourceVolume},target=/workspace,readonly`, "--entrypoint=node", this.image, "-e", nodeScript], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
      stage = "observer_output_parse";
      const after = JSON.parse(output) as Record<string, unknown>;
      const validRelativePath = (path: string) => !path.startsWith("/") && !path.includes("\\") && !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every(part => part.length > 0 && part !== "." && part !== ".." && (!part.startsWith(".env") || part === ".env.example"));
      const entries = Object.entries(after).filter(([path, hash]) => path === "@next-env" && typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash) || validRelativePath(path) && typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));
      if (entries.length !== Object.keys(after).length || entries.length > 5000) throw new Error("manifest_invalid");
      const sourceAfter = Object.fromEntries(entries.filter(([path]) => path !== "@next-env")) as Record<string, string>;
      const sourceBefore = Object.fromEntries(Object.entries(before).filter(([path]) => path !== "next-env.d.ts"));
      const changed = [...new Set([...Object.keys(sourceBefore), ...Object.keys(sourceAfter)])].filter(path => sourceBefore[path] !== sourceAfter[path]).sort();
      const beforeNext = await readFile(join(this.root, "next-env.d.ts")).then(value => createHash("sha256").update(value).digest("hex")).catch(() => null);
      const afterNext = typeof after["@next-env"] === "string" ? after["@next-env"] : null;
      const nextEnvEffect = beforeNext === null && afterNext !== null ? "created" : beforeNext !== null && afterNext === null ? "removed" : beforeNext === null || afterNext === null ? "unavailable" : beforeNext === afterNext ? "unchanged" : "changed";
      return { available: true, changedCount: changed.length, changedPaths: changed.slice(0, 16), nextEnvEffect, failureStage: null };
    } catch {
      return { available: false, changedCount: null, changedPaths: [], nextEnvEffect: "unavailable", failureStage: stage };
    } finally {
      await exec("docker", ["rm", "--force", observer], { timeout: 10000, windowsHide: true }).catch(() => {});
    }
  }
  async dispose() {
    await this.cleanupVolumes();
  }
  async prepareValidationEnvironment(revision: string) {
    if ((await this.snapshot()).revision !== revision) throw new EngineeringInputError("Validation revision changed before environment preparation.");
    await this.prepareVolumes(revision);
  }
  async snapshot(): Promise<Snapshot> {
    const tree = await contents(this.root);
    const changedFiles = [...new Set([...Object.keys(tree), ...Object.keys(this.base)])].filter(f => tree[f] !== this.base[f]);
    assertScope(this.plan, changedFiles);
    const files: Record<string, string> = {};
    for (const path of this.plan.files) {
      if (tree[path]) files[path] = await readFile(join(this.root, path), "utf8");
      else files[path] = "";
    }
    return { revision: treeRevision(tree), files, changedFiles };
  }
  async apply(replacements: AnchorReplacement[], expectedRevision: string): Promise<ProposalEvidence> {
    if (!Array.isArray(replacements) || replacements.length < 1 || replacements.length > 8) throw new EngineeringInputError("Replacement count limit.");
    for (const replacement of replacements) {
      if (!replacement || typeof replacement !== "object" || !replacement.anchor || typeof replacement.anchor !== "object" || typeof replacement.anchor.path !== "string" || typeof replacement.anchor.id !== "string" || typeof replacement.anchor.revision !== "string" || typeof replacement.anchor.contentSha256 !== "string" || typeof replacement.anchor.content !== "string" || typeof replacement.replacement !== "string") throw new EngineeringInputError("Invalid anchor replacement.");
    }
    assertScope(this.plan, replacements.map(item => item.anchor.path));
    if ((await this.snapshot()).revision !== expectedRevision) throw new EngineeringInputError("Workspace changed before edits.");
    const replacementCount = replacements.length;
    const byPath = new Map<string, AnchorReplacement[]>();
    const usedIds = new Set<string>();
    for (const replacement of replacements) {
      if (usedIds.has(replacement.anchor.id)) throw new EngineeringInputError("Replacement overlap.");
      usedIds.add(replacement.anchor.id);
      const list = byPath.get(replacement.anchor.path) ?? [];
      list.push(replacement);
      byPath.set(replacement.anchor.path, list);
    }
    const updates:Array<{path:string;fullPath:string;original:string;output:string;replacements:AnchorReplacement[]}> = [];
    for(const [path,pathReplacements] of byPath){
      let cursor=this.root;
      for(const part of path.split("/")){cursor=join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw new EngineeringInputError("Symlink path rejected.");}
      const original=await readFile(cursor,"utf8");if(Buffer.byteLength(original)>100000)throw new EngineeringInputError("File content limit.");
      const spans:Array<{start:number;end:number;replacement:string}>=[];
      for(const replacement of pathReplacements){
        const anchor=replacement.anchor;
        verifyAnchorIdentity(anchor,expectedRevision);
        if(!this.plan.files.includes(anchor.path))throw new EngineeringInputError("File outside executable scope.");
        const anchorBytes=Buffer.byteLength(anchor.content);
        if(anchorBytes<anchorLimits.minBytes||anchorBytes>anchorLimits.maxBytes||(anchor.content.match(/[a-z0-9]{2,}/gi)?.length??0)<anchorLimits.minWords||Buffer.byteLength(replacement.replacement)>8000)throw new EngineeringInputError("Replacement content limit.");
        if(issuedAnchorId(path,expectedRevision,sha256(anchor.content))!==anchor.id)throw new EngineeringInputError("Anchor identity mismatch.");
        const at=original.indexOf(anchor.content);if(at<0)throw new EngineeringInputError("Replacement target missing.");
        if(original.indexOf(anchor.content,at+1)>=0)throw new EngineeringInputError("Replacement target ambiguous.");
        spans.push({start:at,end:at+anchor.content.length,replacement:replacement.replacement});
      }
      spans.sort((a,b)=>a.start-b.start);
      for(let i=1;i<spans.length;i++)if(spans[i].start<spans[i-1].end)throw new EngineeringInputError("Replacement overlap.");
      let output=original;for(const span of spans.reverse())output=output.slice(0,span.start)+span.replacement+output.slice(span.end);
      if(Buffer.byteLength(output)>100000||secret.test(output))throw new EngineeringInputError("Replacement content invalid.");
      updates.push({path,fullPath:cursor,original,output,replacements:pathReplacements});
    }
    for(const update of updates)await writeFile(update.fullPath,update.output,"utf8");
    const after = await this.snapshot();
    const filesEvidence = updates.map(({path,original,output,replacements}) => ({
      path,
      beforeSha256:createHash("sha256").update(original).digest("hex"),
      afterSha256:createHash("sha256").update(output).digest("hex"),
      beforeBytes:Buffer.byteLength(original),
      afterBytes:Buffer.byteLength(output),
      removedLines:replacements.reduce((count,item)=>count+(item.anchor.content.length?item.anchor.content.split(/\r\n|\r|\n/).length:0),0),
      addedLines:replacements.reduce((count,item)=>count+(item.replacement.length?item.replacement.split(/\r\n|\r|\n/).length:0),0),
    }));
    const replacementEvidence = updates.flatMap(({path,replacements}) => replacements.map(({anchor,replacement}) => {
      const expectedSha256=anchor.contentSha256;
      const replacementSha256=createHash("sha256").update(replacement).digest("hex");
      return {path,expectedSha256,replacementSha256,changeSha256:createHash("sha256").update(`${anchor.id}\0${path}\0${expectedRevision}\0${expectedSha256}\0${replacementSha256}`).digest("hex")};
    }));
    const evidence:ProposalEvidence = { schemaVersion:1, approvedPaths:[...this.plan.files].sort(), replacementCount, files:filesEvidence, replacements:replacementEvidence, workspaceRevision:after.revision };
    if (Buffer.byteLength(JSON.stringify(evidence)) > 30000) throw new EngineeringInputError("Proposal evidence limit.");
    return evidence;
  }
  async validate(args: readonly string[], revision: string, signal: AbortSignal, cycle = 0): Promise<ValidationEvidence> {
    if ((await this.snapshot()).revision !== revision || args.length !== 3 || args[0] !== "npm" || args[1] !== "run" || !this.plan.validations.includes(args[2])) throw new EngineeringInputError("Command/revision denied.");
    await this.prepareVolumes(revision);
    const container = `medimori-worker-${this.id}`;
    let evidence: ValidationEvidence | undefined;
    let containerState: { status: "created" | "running" | "exited" | "dead" | "removing"; exitCode: number | null; oomKilled: boolean } | undefined;
    try {
      this.resourcesMayExist = true;
      const result = await exec("docker", ["run", "--name", container, ...dockerOwnershipArgs(this.owner, "validation-container"), "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=2g", "--cpus=2", "--user=1000:1000", "--cgroupns=private", "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m",
        ...validationVolumeMountArgs({ source: this.sourceVolume, cache: this.cacheVolume, uploads: this.uploadsVolume, private: this.privateVolume, dependencies: this.dependencyVolume }),
        "--workdir=/workspace", "--env=MARKETING_STORE=memory", "--env=MARKETING_MOCK_MODE=true", "--entrypoint=node", this.image, "/workspace/scripts/engineering-sandbox-runner.mjs", args[2]], { signal, timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true });
      evidence = parseRunnerEvidence(result.stdout, args[2], revision, cycle);
    } catch (error) {
      const err = error && typeof error === "object" ? error as { code?: unknown; signal?: unknown; stdout?: unknown; stderr?: unknown; killed?: unknown } : {};
      const code = typeof err.code === "number" ? err.code : null;
      const timedOut = err.code === "ETIMEDOUT" || err.killed === true || signal.aborted;
      const dockerError = !timedOut && (code === 125 || code === 126 || code === 127);
      const output = [typeof err.stdout === "string" ? err.stdout : "", typeof err.stderr === "string" ? err.stderr : ""].join("\n");
      const runner = readRunnerPayload(output);
      if (runner) evidence = makeValidationEvidence({ revision, command: args[2], exitCode: runner.exitCode, signal: runner.signal, timedOut: runner.timedOut, output: runner.output, cycle });
      else evidence = makeValidationEvidence({ revision, command: args[2], exitCode: code, timedOut, dockerError, protocolError: !timedOut && !dockerError, signal: typeof err.signal === "string" ? err.signal : null, output: "", cycle });
    } finally {
      try {
        const state = (await exec("docker", ["inspect", "--format={{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}", container], { timeout: 10000, windowsHide: true })).stdout.trim().split("|");
        const statuses = ["created", "running", "exited", "dead", "removing"] as const;
        if (state.length === 3 && statuses.includes(state[0] as typeof statuses[number]) && /^-?\d{1,3}$/.test(state[1]) && ["true", "false"].includes(state[2])) containerState = { status: state[0] as typeof statuses[number], exitCode: ["running", "created"].includes(state[0]) ? null : Number(state[1]), oomKilled: state[2] === "true" };
      } catch { /* container was never created or Docker could not report it */ }
      await exec("docker", ["rm", "--force", container], { timeout: 10000, windowsHide: true }).catch(() => {});
    }
    if ((await this.snapshot()).revision !== revision) throw new EngineeringInputError("Validation mutated repository scope.");
    if (!evidence) throw new EngineeringInputError("Validation result missing.");
    return { ...evidence, containerExitCode: containerState?.exitCode ?? null, containerStatus: containerState?.status ?? null, containerOomKilled: containerState?.oomKilled ?? null };
  }

  /** Offline proof of the mounted-file boundary. Runs only after setup, with no application entrypoint. */
  async diagnoseValidationStorageBoundary() {
    if (process.env.ENGINEERING_VALIDATION_BOUNDARY_DIAGNOSTIC !== "true") throw new EngineeringInputError("Validation boundary diagnostic is unavailable.");
    const container = `medimori-boundary-diagnostic-${this.id}`;
    const probeName = `.engineering-readonly-probe-${randomUUID()}`;
    const script = `const f=require('node:fs'),c=require('node:crypto');const hash=p=>c.createHash('sha256').update(f.readFileSync(p)).digest('hex');const link=f.readlinkSync('/workspace/next-env.d.ts');const original=f.readFileSync('/workspace/next-env.d.ts');const initial=hash('/workspace/next-env.d.ts');const before=hash('/workspace/package.json');let sourceReadOnly=false;try{const fd=f.openSync('/workspace/${probeName}','wx');f.closeSync(fd);f.unlinkSync('/workspace/${probeName}')}catch(e){sourceReadOnly=e&&e.code==='EROFS'}const runtimeMarker='\\n// private overlay probe';f.appendFileSync('/workspace/next-env.d.ts',runtimeMarker);const writable=hash('/workspace/next-env.d.ts')!==initial;f.writeFileSync('/workspace/next-env.d.ts',original);const restored=hash('/workspace/next-env.d.ts')===initial;const sourceAfter=hash('/workspace/package.json');process.stdout.write(JSON.stringify({link,initial,privateWritable:writable&&restored,sourceReadOnly,sourceUnchanged:before===sourceAfter,probeAbsent:!f.existsSync('/workspace/${probeName}')}))`;
    try {
      await this.prepareVolumes((await this.snapshot()).revision);
      if (!this.nextEnvSourceHash) throw new EngineeringInputError("Validation boundary diagnostic is unavailable.");
      this.resourcesMayExist = true;
      const output = (await exec("docker", ["run", "--name", container, ...dockerOwnershipArgs(this.owner, "validation-container"), "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=2g", "--cpus=2", "--user=1000:1000", "--cgroupns=private", "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m",
        ...validationVolumeMountArgs({ source: this.sourceVolume, cache: this.cacheVolume, uploads: this.uploadsVolume, private: this.privateVolume, dependencies: this.dependencyVolume }),
        "--entrypoint=node", this.image, "-e", script], { timeout: 30000, maxBuffer: 4096, windowsHide: true })).stdout.trim();
      const result = JSON.parse(output) as Record<string, unknown>;
      const checks = {
        symlinkTargetCorrect: result.link === "private/engineering-next-env.d.ts",
        nextEnvInitializedFromSource: result.initial === this.nextEnvSourceHash,
        nextEnvRuntimeWritable: result.privateWritable === true,
        arbitrarySourceWriteDenied: result.sourceReadOnly === true,
        sourceUnchanged: result.sourceUnchanged === true,
        probeAbsent: result.probeAbsent === true,
      };
      return { ...checks, passed: Object.values(checks).every(Boolean) };
    } catch (error) {
      return { symlinkTargetCorrect: false, nextEnvInitializedFromSource: false, nextEnvRuntimeWritable: false, arbitrarySourceWriteDenied: false, sourceUnchanged: false, probeAbsent: false, passed: false, failure: "boundary_probe_failed" as const, ...(error instanceof ValidationPreparationError ? { preparationCode: error.code, preparationStage: error.stage } : {}) };
    } finally {
      await exec("docker", ["rm", "--force", container], { timeout: 10000, windowsHide: true }).catch(() => {});
    }
  }

  /** Diagnostic-only comparison path. The production validate() limits remain fixed. */
  async diagnoseBuild(variant: { workspaceWritable: boolean; nextEnvPrivateOverlay: boolean; tmpfs: "256m" | "1g"; memory: "2g" | "4g"; pidsLimit: 256 | 1024; bundler: "default" | "webpack" }) {
    if (process.env.ENGINEERING_BUILD_ISOLATION_DIAGNOSTIC !== "true") throw new EngineeringInputError("Build diagnostic mode is disabled.");
    const revision = (await this.snapshot()).revision;
    await this.prepareVolumes(revision);
    const container = `medimori-build-diagnostic-${this.id}`;
    const result: { revision: string; command: "build"; outcome: "passed" | "failed"; exitCode: number | null; signal: string | null; timedOut: boolean; category: string | null; excerpt: string[]; parentPid?: number; childPid?: number | null; childExecutable?: "npm" } = {
      revision, command: "build", outcome: "failed", exitCode: null, signal: null, timedOut: false, category: "process_spawn_failed", excerpt: [],
    };
    let containerMetadata: { status: string; exitCode: number | null; oomKilled: boolean | null; memoryBytes: number | null; pidsLimit: number | null; readOnlyRoot: boolean | null; network: string | null; tmpfs: string[]; mounts: Array<{ destination: string; readWrite: boolean }> } | null = null;
    try {
      this.resourcesMayExist = true;
      if (variant.nextEnvPrivateOverlay) {
        const setup = initializeNextEnvPrivateOverlayCommand(this.nextEnvSourceHash ?? "");
        await exec("docker", ["run", "--rm", ...dockerOwnershipArgs(this.owner, "populate-container"), "--network=none", "--user=0:0", "--mount", `type=volume,source=${this.sourceVolume},target=/workspace`, "--mount", `type=volume,source=${this.privateVolume},target=/private`, "--entrypoint=/bin/sh", this.image, "-c", setup], { timeout: 30000, windowsHide: true });
      }
      const dockerArgs = ["run", "--name", container, ...dockerOwnershipArgs(this.owner, "validation-container"), "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", `--pids-limit=${variant.pidsLimit}`, `--memory=${variant.memory}`, "--cpus=2", "--user=1000:1000", "--cgroupns=private", `--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${variant.tmpfs}`,
        "--mount", `type=volume,source=${this.sourceVolume},target=/workspace${variant.workspaceWritable ? "" : ",readonly"}`,
        "--mount", `type=volume,source=${this.cacheVolume},target=/workspace/.next`,
        "--mount", `type=volume,source=${this.uploadsVolume},target=/workspace/public/marketing-uploads`,
        "--mount", `type=volume,source=${this.privateVolume},target=/workspace/private`,
        "--mount", `type=volume,source=${this.dependencyVolume},target=/workspace/node_modules,readonly`,
        "--workdir=/workspace", "--env=MARKETING_STORE=memory", "--env=MARKETING_MOCK_MODE=true", "--env=ENGINEERING_BUILD_DIAGNOSTIC_TRACE=true",
        ...(variant.bundler === "webpack" ? ["--env=ENGINEERING_BUILD_DIAGNOSTIC_BUNDLER=webpack"] : []),
        "--entrypoint=node", this.image, "/workspace/scripts/engineering-sandbox-runner.mjs", "build"];
      try {
        const output = (await exec("docker", dockerArgs, { timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout;
        const payload = readRunnerPayload(output);
        if (payload) Object.assign(result, payload, { excerpt: payload.output.split(/\r?\n/).filter(Boolean).slice(0, 8), outcome: payload.exitCode === 0 && !payload.signal && !payload.timedOut ? "passed" : "failed", category: payload.signal ? "process_signaled" : payload.timedOut ? "validation_timeout" : payload.exitCode === 0 ? null : "command_failed" });
        else result.category = "validation_protocol_error";
      } catch (error) {
        const err = error && typeof error === "object" ? error as { code?: unknown; signal?: unknown; stdout?: unknown; stderr?: unknown; killed?: unknown } : {};
        const output = [typeof err.stdout === "string" ? err.stdout : "", typeof err.stderr === "string" ? err.stderr : ""].join("\n");
        const payload = readRunnerPayload(output);
        if (payload) Object.assign(result, payload, { excerpt: payload.output.split(/\r?\n/).filter(Boolean).slice(0, 8), outcome: payload.exitCode === 0 && !payload.signal && !payload.timedOut ? "passed" : "failed", category: payload.signal ? "process_signaled" : payload.timedOut ? "validation_timeout" : payload.exitCode === 0 ? null : "command_failed" });
        else { result.timedOut = err.code === "ETIMEDOUT" || err.killed === true; result.signal = typeof err.signal === "string" && ["SIGABRT", "SIGBUS", "SIGFPE", "SIGILL", "SIGKILL", "SIGSEGV", "SIGTERM"].includes(err.signal) ? err.signal : null; result.category = result.timedOut ? "validation_timeout" : "validation_protocol_error"; }
      }
    } finally {
      try {
        const template = "{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.HostConfig.Memory}}|{{.HostConfig.PidsLimit}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.NetworkMode}}|{{json .HostConfig.Tmpfs}}|{{range .Mounts}}{{.Destination}}={{.RW}};{{end}}";
        const fields = (await exec("docker", ["inspect", `--format=${template}`, container], { timeout: 10000, windowsHide: true })).stdout.trim().split("|");
        if (fields.length === 9) {
          const mounts = fields[8].split(";").filter(Boolean).flatMap(value => { const match = /^(\/workspace(?:\/\.next|\/node_modules|\/private|\/public\/marketing-uploads)?|\/tmp)=(true|false)$/.exec(value); return match ? [{ destination: match[1], readWrite: match[2] === "true" }] : []; });
          let tmpfs: string[] = [];
          try { const parsed = JSON.parse(fields[7]) as Record<string, string>; tmpfs = Object.keys(parsed).filter(path => path === "/tmp").map(path => `${path}:${parsed[path].slice(0, 80)}`); } catch { /* omit malformed Docker metadata */ }
          containerMetadata = { status: fields[0].slice(0, 16), exitCode: /^-?\d{1,3}$/.test(fields[1]) ? Number(fields[1]) : null, oomKilled: ["true", "false"].includes(fields[2]) ? fields[2] === "true" : null, memoryBytes: /^\d{1,12}$/.test(fields[3]) ? Number(fields[3]) : null, pidsLimit: /^\d{1,6}$/.test(fields[4]) ? Number(fields[4]) : null, readOnlyRoot: ["true", "false"].includes(fields[5]) ? fields[5] === "true" : null, network: fields[6] === "none" ? "none" : "other", tmpfs, mounts };
        }
      } catch { /* container was never created or Docker could not report it */ }
      await exec("docker", ["rm", "--force", container], { timeout: 10000, windowsHide: true }).catch(() => {});
    }
    if ((await this.snapshot()).revision !== revision) throw new EngineeringInputError("Diagnostic build changed its source tree.");
    const sourceWrites = variant.workspaceWritable && result.outcome === "passed" ? await this.inspectDiagnosticSourceWrites() : null;
    return { ...result, container: containerMetadata, sourceWrites };
  }
}

type RunnerPayload = { exitCode: number | null; signal: string | null; timedOut: boolean; output: string; failedTestFiles: string[]; parentPid?: number; childPid?: number | null; childExecutable?: "npm" };
function readRunnerPayload(output: string): RunnerPayload | null {
  const line = output.split(/\r?\n/).find(item => item.startsWith("ENGINEERING_VALIDATION_RESULT="));
  if (!line || line.length > 1024 * 1024) return null;
  try {
    const value = JSON.parse(line.slice("ENGINEERING_VALIDATION_RESULT=".length)) as Record<string, unknown>;
    if (!(value.exitCode === null || Number.isInteger(value.exitCode)) || !(value.signal === null || typeof value.signal === "string") || typeof value.timedOut !== "boolean" || typeof value.output !== "string" || !Array.isArray(value.failedTestFiles) || value.failedTestFiles.some(path => typeof path !== "string")) return null;
    return { exitCode: value.exitCode as number | null, signal: value.signal as string | null, timedOut: value.timedOut, output: value.output.slice(0, 1024 * 1024), failedTestFiles: value.failedTestFiles.slice(0, 8) as string[], ...(Number.isSafeInteger(value.parentPid) ? { parentPid: value.parentPid as number } : {}), ...(value.childPid === null || Number.isSafeInteger(value.childPid) ? { childPid: value.childPid as number | null } : {}), ...(value.childExecutable === "npm" ? { childExecutable: "npm" as const } : {}) };
  } catch { return null; }
}
function parseRunnerEvidence(output: string, command: string, revision: string, cycle: number): ValidationEvidence {
  const payload = readRunnerPayload(output);
  if (!payload) throw new EngineeringInputError("Validation runner did not return bounded evidence.");
  return makeValidationEvidence({ revision, command, exitCode: payload.exitCode, signal: payload.signal, timedOut: payload.timedOut, output: payload.output, failedTestFiles: payload.failedTestFiles, cycle });
}
