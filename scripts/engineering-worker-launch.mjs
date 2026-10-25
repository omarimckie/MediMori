import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Encode a local preload as a file URL so NODE_OPTIONS never parses Windows backslashes as escapes. */
export function nodePreloadOption(preloadPath) {
  return `--import=${pathToFileURL(resolve(preloadPath)).href}`;
}

async function runWorkerBootstrap({ args, envFile, env, cwd, captureOutput = false }) {
  const preloadPath = fileURLToPath(new URL("./engineering-worker-tsx-compat.cjs", import.meta.url));
  const childEnv = { ...env };
  const childArgs = [
    ...(envFile ? [`--env-file=${envFile}`] : []),
    // File URL encoding keeps this safe with Windows drive letters and spaces.
    nodePreloadOption(preloadPath),
    "scripts/engineering-worker-bootstrap.cjs",
    ...args,
  ];
  const child = spawn(process.execPath, childArgs, { stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit", env: childEnv, cwd });
  return await new Promise(resolveResult => {
    let stdout = "";
    let stderr = "";
    if (captureOutput) {
      child.stdout.setEncoding("utf8").on("data", chunk => { stdout = (stdout + chunk).slice(-8192); });
      child.stderr.setEncoding("utf8").on("data", chunk => { stderr = (stderr + chunk).slice(-8192); });
    }
    child.on("error", () => {
      console.error("Engineering worker launch failed before execution.");
      resolveResult(captureOutput ? { exitCode: 1, stdout, stderr } : 1);
    });
    child.on("exit", (code, signal) => {
      const exitCode = signal ? 1 : code ?? 1;
      resolveResult(captureOutput ? { exitCode, stdout, stderr } : exitCode);
    });
  });
}

/** The production worker path uses tsx's CJS registration, like repository scripts/tests. */
export function runWorkerEntrypoint({ runId, envFile = ".env.engineering-2a.local", env = process.env, cwd = process.cwd() }) {
  return runWorkerBootstrap({ args: [runId], envFile, env, cwd });
}

/** Load the actual worker dependency graph without calling worker.main(). */
export function runWorkerModuleGraphSmoke({ env = process.env, cwd = process.cwd() } = {}) {
  const safeEnv = { ...env, ENGINEERING_WORKER_ENABLED: "false" };
  for (const name of ["DATABASE_URL", "ENGINEERING_WORKER_DATABASE_URL", "OPENAI_API_KEY", "ADMIN_USERS", "ADMIN_SESSION_SECRET", "DOCKER_HOST", "DOCKER_CONTEXT"]) delete safeEnv[name];
  return runWorkerBootstrap({ args: ["--module-graph-smoke"], env: safeEnv, cwd, captureOutput: true });
}

/** Read-only local initialization/configuration preflight; never invokes main(). */
export function runWorkerInitializationDiagnostic({ envFile = ".env.engineering-2a.local", env = process.env, cwd = process.cwd() } = {}) {
  return runWorkerBootstrap({ args: ["--initialization-diagnostic"], envFile, env, cwd, captureOutput: true });
}

/** Read-only disposable worker-identity probe through the production bootstrap/configuration path. */
export function runWorkerDatabaseIdentityDiagnostic({ envFile = ".env.engineering-2a.local", env = process.env, cwd = process.cwd() } = {}) {
  return runWorkerBootstrap({ args: ["--database-identity-diagnostic"], envFile, env, cwd, captureOutput: true });
}

/** Run the production sanitizer against the configured source and scratch paths, without worker main(). */
export function runWorkerSourceExportDiagnostic({ envFile = ".env.engineering-2a.local", env = process.env, cwd = process.cwd() } = {}) {
  return runWorkerBootstrap({ args: ["--source-export-diagnostic"], envFile, env, cwd, captureOutput: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runId = process.argv[2];
  if (runId === "--diagnose-initialization") {
    const result = await runWorkerInitializationDiagnostic();
    // Output is generated from the allow-listed diagnostic schema only.
    process.stdout.write(result.stdout);
    if (result.exitCode !== 0 && !result.stdout) {
      console.error("Engineering initialization diagnostic failed without safe details.");
    }
    process.exitCode = result.exitCode;
  } else if (runId === "--diagnose-database-identity") {
    const result = await runWorkerDatabaseIdentityDiagnostic();
    process.stdout.write(result.stdout);
    if (result.exitCode !== 0 && !result.stdout) {
      console.error("Engineering database identity diagnostic failed without safe details.");
    }
    process.exitCode = result.exitCode;
  } else if (runId === "--diagnose-source-export") {
    const result = await runWorkerSourceExportDiagnostic();
    process.stdout.write(result.stdout);
    if (result.exitCode !== 0 && !result.stdout) {
      console.error("Engineering source export diagnostic failed without safe details.");
    }
    process.exitCode = result.exitCode;
  } else if (!/^[a-f0-9-]{36}$/i.test(runId ?? "")) {
    console.error("A worker run ID is required.");
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = await runWorkerEntrypoint({ runId });
    } catch {
      console.error("Engineering worker launch preparation failed.");
      process.exitCode = 1;
    }
  }
}
