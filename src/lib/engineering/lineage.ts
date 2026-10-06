import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute } from "node:path";
import { EngineeringInputError } from "./policy";

const exec = promisify(execFile);

function lineageGitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

/** Read-only local proof that the approved target commit is an ancestor of the source checkout. */
export async function verifyTargetAncestry(sourceRoot: string, targetBaseSha: string) {
  if (!isAbsolute(sourceRoot) || !/^[a-f0-9]{40}$/.test(targetBaseSha)) throw new EngineeringInputError("Worker target lineage is invalid.");
  try {
    await exec("git", ["merge-base", "--is-ancestor", targetBaseSha, "HEAD"], {
      cwd: sourceRoot,
      env: lineageGitEnvironment(),
      timeout: 15000,
      maxBuffer: 8192,
      windowsHide: true,
    });
    return { verified: true as const, targetBaseSha };
  } catch {
    throw new EngineeringInputError("The approved target revision is not proven to be an ancestor of the source checkout.");
  }
}
