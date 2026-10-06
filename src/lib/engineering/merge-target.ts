import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { configuredMergeTarget, repositoryHttpsUrl } from "./merge-policy";
import { isSafeMergeRelativePath, mergeTargetPolicy } from "./merge-policy";
import { EngineeringInputError } from "./policy";

const exec = promisify(execFile);

function gitReadEnvironment() {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production", GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

/** Read-only public ref lookup. It never fetches into or reads the current checkout. */
export async function readApprovedTargetBaseSha() {
  const target = configuredMergeTarget();
  return await readTargetBaseSha(target.repository, target.branch);
}

/** Worker lineage binds to the fixed project target even while merge execution remains disabled. */
export async function readWorkerTargetBaseSha() {
  return await readTargetBaseSha(mergeTargetPolicy.repository, mergeTargetPolicy.branch);
}

async function readTargetBaseSha(repository: string, branch: string) {
  const url = repositoryHttpsUrl(repository);
  try {
    const result = await exec("git", ["ls-remote", "--exit-code", url, `refs/heads/${branch}`], { env: gitReadEnvironment(), timeout: 15000, maxBuffer: 8192, windowsHide: true });
    const line = result.stdout.trim().split(/\r?\n/)[0] ?? "";
    const match = /^([a-f0-9]{40})\s+refs\/heads\/main$/.exec(line);
    if (!match) throw new Error("target_ref_invalid");
    return match[1];
  } catch {
    throw new EngineeringInputError("The approved merge target could not be verified. No merge approval was recorded.");
  }
}

function gitBuffer(args: string[]) {
  return new Promise<Buffer>((resolveBuffer, reject) => {
    execFile("git", args, { env: gitReadEnvironment(), timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: "buffer" }, (error, stdout) => {
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
    await exec("git", ["init", "--bare", "--quiet", temporary], { env: gitReadEnvironment(), timeout: 30000, maxBuffer: 8192, windowsHide: true });
    await exec("git", args(["fetch", "--no-tags", repositoryUrl, baseSha]), { env: gitReadEnvironment(), timeout: 30000, maxBuffer: 8192, windowsHide: true });
    const hashes: Record<string, string | null> = {};
    for (const path of paths) {
      try {
        const bytes = await gitBuffer(args(["show", `${baseSha}:${path}`]));
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
