import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { repositoryHttpsUrl } from "./merge-policy";
import { MergeExecutionError, type MergeExecutorGit } from "./merge-executor";
import type { MergeApprovalRecord } from "./merge-protocol";

const exec = promisify(execFile);
const ignored = new Set(["node_modules", ".next", ".git", "tsconfig.tsbuildinfo", "next-env.d.ts"]);
const hex40 = /^[a-f0-9]{40}$/;

export function mergeGitProcessEnvironment(safeDirectory?: string) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  // FAT filesystems may not record ownership. Trust only this canonical
  // scratch checkout for this child process; never change global config.
  if (safeDirectory) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "safe.directory";
    env.GIT_CONFIG_VALUE_0 = safeDirectory.replaceAll("\\", "/");
  }
  // Provider, database, admin, and worker secrets are deliberately not inherited.
  return env;
}

export function mergePushArguments(approval: MergeApprovalRecord) {
  return ["push", approval.target.remote, `HEAD:refs/heads/${approval.target.branch}`];
}

async function command(args: string[], cwd?: string) {
  try {
    return (await exec("git", args, { cwd, env: mergeGitProcessEnvironment(cwd), timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
  } catch {
    throw new MergeExecutionError("git_operation_failed");
  }
}

async function commandBuffer(args: string[], cwd: string) {
  return await new Promise<Buffer>((resolveBuffer, reject) => {
    execFile("git", args, { cwd, env: mergeGitProcessEnvironment(cwd), timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: "buffer" }, (error, stdout) => {
      if (error) reject(new MergeExecutionError("git_operation_failed"));
      else resolveBuffer(Buffer.from(stdout));
    });
  });
}

function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function isWithin(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === "" || rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
function treeRevision(entries: Record<string, string>) {
  return createHash("sha1").update(JSON.stringify(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

async function noSymlinkPath(root: string, path: string) {
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) throw new MergeExecutionError("scope_mismatch");
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new MergeExecutionError("scope_mismatch"); }
    catch (error) {
      if (error instanceof MergeExecutionError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return current;
      throw new MergeExecutionError("git_operation_failed");
    }
  }
  return current;
}

async function scanWorkspace(root: string, filesWanted: string[]) {
  const manifest: Record<string, string> = {};
  const included = new Map<string, Uint8Array>();
  let count = 0;
  async function visit(prefix = "") {
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new MergeExecutionError("scope_mismatch");
      if (entry.isDirectory()) { await visit(path); continue; }
      if (!entry.isFile() || ++count > 5000) throw new MergeExecutionError("scope_mismatch");
      const bytes = await readFile(join(root, path));
      if (bytes.byteLength > 100_000_000) throw new MergeExecutionError("scope_mismatch");
      manifest[path] = sha256(bytes);
      if (filesWanted.includes(path)) included.set(path, bytes);
    }
  }
  await visit();
  return { revision: treeRevision(manifest), included };
}

async function findReviewedWorkspace(approval: MergeApprovalRecord): Promise<{ revision: string; files: Record<string, Uint8Array> }> {
  const configuredRoot = process.env.ENGINEERING_MERGE_REVIEW_ROOT?.trim() || process.env.ENGINEERING_WORKSPACE_EXPORT?.trim();
  const scratch = process.env.ENGINEERING_SCRATCH_ROOT?.trim();
  if (!configuredRoot || !scratch || !isAbsolute(configuredRoot) || !isAbsolute(scratch)) throw new MergeExecutionError("executor_configuration_invalid");
  let root: string, scratchRoot: string;
  try { [root, scratchRoot] = await Promise.all([realpath(configuredRoot), realpath(scratch)]); }
  catch { throw new MergeExecutionError("executor_configuration_invalid"); }
  const relativeRoot = relative(scratchRoot, root);
  if (relativeRoot === ".." || relativeRoot.startsWith(".." + sep) || isAbsolute(relativeRoot) || root === scratchRoot) throw new MergeExecutionError("executor_configuration_invalid");
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length > 2000) throw new MergeExecutionError("executor_configuration_invalid");
  const wanted = approval.files.map(file => file.path);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = join(root, entry.name);
    try {
      const checked = await scanWorkspace(candidate, wanted);
      if (checked.revision !== approval.resultingRevision || checked.included.size !== approval.files.length) continue;
      if (approval.files.every(file => checked.included.has(file.path) && sha256(checked.included.get(file.path)!) === file.afterSha256)) {
        return { revision: checked.revision, files: Object.fromEntries(checked.included) };
      }
    } catch (error) {
      if (error instanceof MergeExecutionError) continue;
    }
  }
  throw new MergeExecutionError("source_revision_mismatch");
}

export class IsolatedMergeGitAdapter implements MergeExecutorGit {
  private checkout = "";
  private scratch = "";

  constructor(private readonly options: { repositoryUrl?: string; scratchRoot?: string } = {}) {}

  private async ensureCheckout(approval: MergeApprovalRecord) {
    if (this.checkout) return this.checkout;
    const configured = this.options.scratchRoot || process.env.ENGINEERING_MERGE_SCRATCH_ROOT?.trim() || process.env.ENGINEERING_SCRATCH_ROOT?.trim();
    const configuredScratchRoot = process.env.ENGINEERING_SCRATCH_ROOT?.trim();
    const configuredSourceRoot = process.env.ENGINEERING_WORKSPACE_SOURCE?.trim();
    if (!configured || !isAbsolute(configured) || !configuredScratchRoot || !configuredSourceRoot || !isAbsolute(configuredScratchRoot) || !isAbsolute(configuredSourceRoot)) throw new MergeExecutionError("executor_configuration_invalid");
    let scratchRoot: string, sourceRoot: string;
    try {
      [this.scratch, scratchRoot, sourceRoot] = await Promise.all([realpath(configured), realpath(configuredScratchRoot), realpath(configuredSourceRoot)]);
    }
    catch { throw new MergeExecutionError("executor_configuration_invalid"); }
    if (!isWithin(scratchRoot, this.scratch) || isWithin(sourceRoot, this.scratch) || isWithin(this.scratch, sourceRoot)) throw new MergeExecutionError("executor_configuration_invalid");
    const temp = await mkdtemp(join(this.scratch, "medimori-merge-"));
    this.checkout = join(temp, "target");
    const targetUrl = this.options.repositoryUrl ?? repositoryHttpsUrl(approval.target.repository);
    await command(["clone", "--single-branch", "--branch", approval.target.branch, targetUrl, this.checkout]);
    const remote = await command(["remote", "get-url", approval.target.remote], this.checkout);
    if (remote.replace(/\.git$/, "").toLowerCase() !== targetUrl.replace(/\.git$/, "").toLowerCase()) throw new MergeExecutionError("executor_configuration_invalid");
    if ((await command(["status", "--porcelain"], this.checkout)) !== "") throw new MergeExecutionError("git_operation_failed");
    return this.checkout;
  }

  private async fetchTarget(approval: MergeApprovalRecord) {
    const cwd = await this.ensureCheckout(approval);
    await command(["fetch", "--no-tags", approval.target.remote, "refs/heads/" + approval.target.branch + ":refs/remotes/" + approval.target.remote + "/" + approval.target.branch], cwd);
    const sha = await command(["rev-parse", "refs/remotes/" + approval.target.remote + "/" + approval.target.branch], cwd);
    if (!hex40.test(sha)) throw new MergeExecutionError("git_operation_failed");
    return { cwd, sha };
  }

  async findRemoteCommitForApproval(approval: MergeApprovalRecord) {
    const { cwd } = await this.fetchTarget(approval);
    const found = await command(["log", "--fixed-strings", "--grep=Engineering-Approval: " + approval.id, "--format=%H", "-n", "2", "refs/remotes/" + approval.target.remote + "/" + approval.target.branch], cwd);
    const sha = found.split(/\r?\n/).find(line => hex40.test(line));
    if (!sha) return null;
    const body = await command(["show", "-s", "--format=%B", sha], cwd);
    if (!body.split(/\r?\n/).includes("Engineering-Approval: " + approval.id)) return null;
    return sha;
  }

  async readCleanTarget(approval: MergeApprovalRecord) {
    const { cwd, sha } = await this.fetchTarget(approval);
    const remoteRef = "refs/remotes/" + approval.target.remote + "/" + approval.target.branch;
    try { await command(["merge-base", "--is-ancestor", approval.targetBaseSha, remoteRef], cwd); }
    catch { throw new MergeExecutionError("target_changed"); }
    const files: Record<string, Uint8Array | null> = {};
    for (const file of approval.files) {
      await noSymlinkPath(cwd, file.path);
      try {
        await command(["cat-file", "-e", remoteRef + ":" + file.path], cwd);
        files[file.path] = await commandBuffer(["show", remoteRef + ":" + file.path], cwd);
      } catch { files[file.path] = null; }
    }
    return { baseSha: sha, files };
  }

  async readReviewedSource(approval: MergeApprovalRecord) {
    return await findReviewedWorkspace(approval);
  }

  async applyApprovedFiles(approval: MergeApprovalRecord, source: { revision: string; files: Record<string, Uint8Array> }) {
    const cwd = await this.ensureCheckout(approval);
    for (const file of approval.files) {
      const bytes = source.files[file.path];
      if (!bytes || sha256(bytes) !== file.afterSha256) throw new MergeExecutionError("file_hash_mismatch");
      const path = await noSymlinkPath(cwd, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "w" });
    }
    const changedPaths = await command(["diff", "--name-only", "--diff-filter=ACDMRTUXB"], cwd).then(value => value ? value.split(/\r?\n/).sort() : []);
    const untracked = await command(["ls-files", "--others", "--exclude-standard"], cwd).then(value => value ? value.split(/\r?\n/).sort() : []);
    if (untracked.length) throw new MergeExecutionError("scope_mismatch");
    const afterHashes: Record<string, string> = {};
    for (const file of approval.files) afterHashes[file.path] = sha256(await readFile(join(cwd, file.path)));
    return { changedPaths, afterHashes };
  }

  async validateAppliedDiff() {
    const cwd = this.checkout;
    if (!cwd) throw new MergeExecutionError("git_operation_failed");
    await command(["diff", "--check"], cwd);
  }

  async createCommit(approval: MergeApprovalRecord) {
    const cwd = await this.ensureCheckout(approval);
    await command(["add", "--", ...approval.files.map(file => file.path)], cwd);
    const message = [
      "Engineering merge for task " + approval.taskId,
      "",
      "Task: " + approval.taskId,
      "Task-Version: " + approval.taskVersion,
      "Run: " + approval.runId,
      "Attempt: " + approval.attemptNumber,
      "Plan-Version: " + approval.planVersion,
      "Result-Revision: " + approval.resultingRevision,
      "Human-Approved-By: " + approval.actor,
      "Merge-Approval: " + approval.id,
      "Engineering-Approval: " + approval.id,
    ].join("\n");
    await command(["-c", "user.name=MediMori Engineering Merge Gate", "-c", "user.email=engineering-merge@users.noreply.github.com", "commit", "-m", message], cwd);
    const sha = await command(["rev-parse", "HEAD"], cwd);
    if (!hex40.test(sha)) throw new MergeExecutionError("git_operation_failed");
    return sha;
  }

  async push(approval: MergeApprovalRecord, commitSha: string) {
    const cwd = await this.ensureCheckout(approval);
    if ((await command(["rev-parse", "HEAD"], cwd)) !== commitSha) throw new MergeExecutionError("git_operation_failed");
    await command(mergePushArguments(approval), cwd);
  }

  async verifyRemote(approval: MergeApprovalRecord, commitSha: string) {
    const { cwd } = await this.fetchTarget(approval);
    const remoteRef = "refs/remotes/" + approval.target.remote + "/" + approval.target.branch;
    try { await command(["merge-base", "--is-ancestor", commitSha, remoteRef], cwd); }
    catch { return false; }
    const body = await command(["show", "-s", "--format=%B", commitSha], cwd);
    if (!body.split(/\r?\n/).includes("Engineering-Approval: " + approval.id)) return false;
    const changed = await command(["diff-tree", "--no-commit-id", "--name-only", "-r", commitSha + "^", commitSha], cwd);
    if (changed.split(/\r?\n/).filter(Boolean).sort().join("\0") !== approval.files.map(file => file.path).sort().join("\0")) return false;
    for (const file of approval.files) {
      const bytes = await commandBuffer(["show", commitSha + ":" + file.path], cwd).catch(() => null);
      if (!bytes || sha256(bytes) !== file.afterSha256) return false;
    }
    return true;
  }

  async dispose() {
    if (!this.checkout) return;
    const parent = dirname(this.checkout);
    const relativeParent = relative(this.scratch, parent);
    if (relativeParent.startsWith("..") || isAbsolute(relativeParent)) throw new MergeExecutionError("executor_configuration_invalid");
    this.checkout = "";
    await rm(parent, { recursive: true, force: true });
  }
}
