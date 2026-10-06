import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const launchFile = fileURLToPath(import.meta.url);

export function mergeExecutorChildEnvironment(env = process.env) {
  const child = { ...env, ENGINEERING_WORKER_ENABLED: "false" };
  for (const key of ["DATABASE_URL", "ENGINEERING_WORKER_DATABASE_URL", "OPENAI_API_KEY", "ADMIN_USERS", "ADMIN_SESSION_SECRET", "GITHUB_TOKEN", "GH_TOKEN"]) delete child[key];
  return child;
}

export function mergeExecutorArgs(approvalId) {
  if (typeof approvalId !== "string" || !uuid.test(approvalId)) throw new Error("approval_id_invalid");
  const bootstrap = fileURLToPath(new URL("./engineering-worker-tsx-compat.cjs", import.meta.url));
  return [
    "--env-file=.env.engineering-merge.local",
    `--import=${pathToFileURL(resolve(bootstrap)).href}`,
    "--require=tsx/cjs",
    "scripts/engineering-merge-executor.ts",
    approvalId,
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === launchFile) {
  const approvalId = process.argv[2];
  try {
    const child = spawn(process.execPath, mergeExecutorArgs(approvalId), {
      cwd: process.cwd(), env: mergeExecutorChildEnvironment(), stdio: "inherit", windowsHide: true,
    });
    child.on("error", () => { console.error("Engineering merge executor could not start."); process.exitCode = 1; });
    child.on("exit", (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
  } catch {
    console.error("A valid durable merge approval ID is required.");
    process.exitCode = 2;
  }
}
