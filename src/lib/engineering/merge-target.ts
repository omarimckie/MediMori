import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { configuredMergeTarget, repositoryHttpsUrl } from "./merge-policy";
import { isSafeMergeRelativePath, mergeTargetPolicy } from "./merge-policy";
import { EngineeringInputError } from "./policy";

const exec = promisify(execFile);

export type TargetAncestryFailureCode = "target_resolution_failed" | "target_fetch_failed" | "target_ref_changed" | "target_commit_missing" | "target_not_ancestor";
export const targetAncestryLimits = Object.freeze({ maxCommitDepth: 50000, branchFetchTimeoutMs: 60000, commitFetchTimeoutMs: 30000, temporaryStorePrefix: "medimori-target-ancestry-" });

export class TargetAncestryError extends Error {
  constructor(readonly code: TargetAncestryFailureCode) {
    super("The immutable approved target could not be verified against the current target history.");
    this.name = "TargetAncestryError";
  }
}

async function gitReadEnvironment(configurationBoundary: string) {
  // Windows' os.devNull (`\\.\nul`) is not accepted by Git as a config file.
  // Use an owned empty file inside each fresh temporary Git cwd instead.
  const emptyConfig = join(configurationBoundary, "empty.gitconfig");
  await writeFile(emptyConfig, "", { flag: "wx" }).catch(error => {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
  });
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig,
  };
  env.GIT_CEILING_DIRECTORIES = configurationBoundary;
  // Do not inherit HOME/USERPROFILE or Git config/credential variables. Git
  // runs only from an empty temporary cwd or with an explicit isolated git-dir.
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function targetGitArgs(args: string[]) {
  // Refuse HTTP redirects as well as host config URL rewrites: the fetched
  // branch must remain the exact approved repository/branch endpoint.
  return ["-c", "http.followRedirects=false", ...args];
}

/** Read-only public ref lookup. It never fetches into or reads the current checkout. */
export async function readApprovedTargetBaseSha() {
  const target = configuredMergeTarget();
  return await readTargetBaseSha(target.repository, target.branch);
}

/** Worker lineage binds to the fixed project target even while merge execution remains disabled. */
export async function readWorkerTargetBaseSha(temporaryRoot = tmpdir()) {
  return await readTargetBaseSha(mergeTargetPolicy.repository, mergeTargetPolicy.branch, temporaryRoot);
}

export async function readTargetRefSha(repositoryUrl: string, branch: string, temporaryRoot = tmpdir()) {
  if (!/^main$/.test(branch) || !isAbsolute(temporaryRoot)) throw new EngineeringInputError("The approved merge target could not be verified. No merge approval was recorded.");
  let isolatedCwd: string | undefined;
  try {
    isolatedCwd = await mkdtemp(join(temporaryRoot, "medimori-target-resolve-"));
    const env = await gitReadEnvironment(isolatedCwd);
    const result = await exec("git", targetGitArgs(["ls-remote", "--exit-code", repositoryUrl, `refs/heads/${branch}`]), {
      cwd: isolatedCwd, env, timeout: 15000, maxBuffer: 8192, windowsHide: true,
    });
    const line = result.stdout.trim().split(/\r?\n/)[0] ?? "";
    const match = /^([a-f0-9]{40})\s+refs\/heads\/main$/.exec(line);
    if (!match) throw new Error("target_ref_invalid");
    return match[1];
  } catch {
    throw new EngineeringInputError("The approved merge target could not be verified. No merge approval was recorded.");
  } finally {
    if (isolatedCwd) await rm(isolatedCwd, { recursive: true, force: true });
  }
}

async function readTargetBaseSha(repository: string, branch: string, temporaryRoot = tmpdir()) {
  const url = repositoryHttpsUrl(repository);
  return await readTargetRefSha(url, branch, temporaryRoot);
}

/**
 * Verify target ancestry in a disposable bare object store. The engineering
 * implementation checkout is deliberately never fetched into or inspected.
 */
export async function verifyTargetAncestryInIsolatedGraph(targetBaseSha: string, currentTargetSha: string, repositoryUrl: string, branch = "main", temporaryRoot = tmpdir()) {
  if (!/^[a-f0-9]{40}$/.test(targetBaseSha) || !/^[a-f0-9]{40}$/.test(currentTargetSha) || !/^main$/.test(branch) || !isAbsolute(temporaryRoot)) {
    throw new TargetAncestryError("target_resolution_failed");
  }
  const temporary = await mkdtemp(join(temporaryRoot, targetAncestryLimits.temporaryStorePrefix));
  const args = (gitArgs: string[]) => ["--git-dir=" + temporary, ...gitArgs];
  try {
    const env = await gitReadEnvironment(temporary);
    await exec("git", targetGitArgs(["init", "--bare", "--quiet"]), { cwd: temporary, env, timeout: 30000, maxBuffer: 8192, windowsHide: true });
    try {
      // Fetch commit/tree history only. No implementation source blobs enter
      // this temporary store, and no ref/object is written to the checkout.
      await exec("git", targetGitArgs(args(["fetch", `--depth=${targetAncestryLimits.maxCommitDepth}`, "--filter=blob:none", "--no-tags", repositoryUrl, `+refs/heads/${branch}:refs/remotes/origin/${branch}`])), {
        cwd: temporary, env, timeout: targetAncestryLimits.branchFetchTimeoutMs, maxBuffer: 8192, windowsHide: true,
      });
    } catch {
      throw new TargetAncestryError("target_fetch_failed");
    }
    let fetchedTargetSha: string;
    try {
      const result = await exec("git", targetGitArgs(args(["rev-parse", `refs/remotes/origin/${branch}`])), { cwd: temporary, env, timeout: 15000, maxBuffer: 8192, windowsHide: true });
      fetchedTargetSha = result.stdout.trim();
    } catch {
      throw new TargetAncestryError("target_fetch_failed");
    }
    if (fetchedTargetSha !== currentTargetSha) throw new TargetAncestryError("target_ref_changed");

    const targetObject = `${targetBaseSha}^{commit}`;
    try {
      await exec("git", targetGitArgs(args(["cat-file", "-e", targetObject])), { cwd: temporary, env, timeout: 15000, maxBuffer: 8192, windowsHide: true });
    } catch {
      try {
        await exec("git", targetGitArgs(args(["fetch", "--depth=1", "--filter=blob:none", "--no-tags", repositoryUrl, targetBaseSha])), {
          cwd: temporary, env, timeout: targetAncestryLimits.commitFetchTimeoutMs, maxBuffer: 8192, windowsHide: true,
        });
      } catch {
        // A failed fetch cannot distinguish an absent object from a remote or
        // transport failure, so report unavailable rather than guessing.
        throw new TargetAncestryError("target_fetch_failed");
      }
      try {
        await exec("git", targetGitArgs(args(["cat-file", "-e", targetObject])), { cwd: temporary, env, timeout: 15000, maxBuffer: 8192, windowsHide: true });
      } catch {
        throw new TargetAncestryError("target_commit_missing");
      }
    }

    try {
      await exec("git", targetGitArgs(args(["merge-base", "--is-ancestor", targetBaseSha, `refs/remotes/origin/${branch}`])), {
        cwd: temporary, env, timeout: 15000, maxBuffer: 8192, windowsHide: true,
      });
      return { verified: true as const, targetBaseSha, currentTargetSha };
    } catch (error) {
      const exitCode = error && typeof error === "object" && "code" in error ? Number(error.code) : NaN;
      if (exitCode !== 1) {
        throw new TargetAncestryError("target_fetch_failed");
      }
      // When both endpoints are already present in the temporary graph, a merge-base
      // exit code of 1 means there is no common history (definitive non-ancestor).
      try {
        await exec("git", targetGitArgs(args(["merge-base", targetBaseSha, `refs/remotes/origin/${branch}`])), {
          cwd: temporary, env, timeout: 15000, maxBuffer: 8192, windowsHide: true,
        });
        throw new TargetAncestryError("target_fetch_failed");
      } catch (mergeBaseError) {
        const mergeBaseExit = mergeBaseError && typeof mergeBaseError === "object" && "code" in mergeBaseError
          ? Number(mergeBaseError.code)
          : NaN;
        if (mergeBaseExit === 1) {
          throw new TargetAncestryError("target_not_ancestor");
        }
        throw new TargetAncestryError("target_fetch_failed");
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Resolves the fixed target afresh, then checks it in a disposable object graph. */
export async function verifyWorkerTargetAncestry(targetBaseSha: string, temporaryRoot = tmpdir()) {
  if (!/^[a-f0-9]{40}$/.test(targetBaseSha)) throw new TargetAncestryError("target_resolution_failed");
  let currentTargetSha: string;
  try {
    currentTargetSha = await readWorkerTargetBaseSha(temporaryRoot);
  } catch {
    throw new TargetAncestryError("target_resolution_failed");
  }
  return verifyTargetAncestryInIsolatedGraph(targetBaseSha, currentTargetSha, repositoryHttpsUrl(mergeTargetPolicy.repository), mergeTargetPolicy.branch, temporaryRoot);
}

function gitBuffer(args: string[], isolatedCwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<Buffer>((resolveBuffer, reject) => {
    execFile("git", args, { cwd: isolatedCwd, env, timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: "buffer" }, (error, stdout) => {
      if (error) reject(error);
      else resolveBuffer(Buffer.from(stdout));
    });
  });
}

/** Reads only approved paths from an immutable commit in an isolated temporary object store. */
export async function readTargetPreimagesAtSha(baseSha: string, paths: readonly string[], repositoryUrl = repositoryHttpsUrl(mergeTargetPolicy.repository)) {
  if (!/^[a-f0-9]{40}$/.test(baseSha) || paths.length < 1 || paths.length > 20 || paths.some(path => !isSafeMergeRelativePath(path)) || new Set(paths).size !== paths.length) {
    throw new EngineeringInputError("Approved target preimage request is invalid.");
  }
  const temporary = await mkdtemp(join(tmpdir(), "medimori-target-preimage-"));
  const args = (gitArgs: string[]) => ["--git-dir=" + temporary, ...gitArgs];
  try {
    const env = await gitReadEnvironment(temporary);
    await exec("git", targetGitArgs(["init", "--bare", "--quiet"]), { cwd: temporary, env, timeout: 30000, maxBuffer: 8192, windowsHide: true });
    await exec("git", targetGitArgs(args(["fetch", "--no-tags", repositoryUrl, baseSha])), { cwd: temporary, env, timeout: 30000, maxBuffer: 8192, windowsHide: true });
    const hashes: Record<string, string | null> = {};
    for (const path of paths) {
      try {
        const bytes = await gitBuffer(targetGitArgs(args(["show", `${baseSha}:${path}`])), temporary, env);
        hashes[path] = createHash("sha256").update(bytes).digest("hex");
      } catch { hashes[path] = null; }
    }
    return hashes;
  } catch {
    throw new EngineeringInputError("Approved target content could not be verified at its immutable revision.");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
