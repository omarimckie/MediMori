import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodePreloadOption, runWorkerInitializationDiagnostic, runWorkerModuleGraphSmoke } from "./engineering-worker-launch.mjs";

const compatPreload = fileURLToPath(new URL("./engineering-worker-tsx-compat.cjs", import.meta.url));

async function writePreload(directory, name, source) {
  const path = join(directory, name);
  await writeFile(path, source, "utf8");
  return path;
}

function failingUserInfoPreload() {
  return `
const os = require("node:os");
try { Object.defineProperty(process, "geteuid", { configurable: true, value: undefined }); } catch {}
os.userInfo = () => {
  const error = new Error("simulated uv_os_get_passwd ENOMEM");
  error.code = "ERR_SYSTEM_ERROR";
  error.syscall = "uv_os_get_passwd";
  error.info = { code: "ENOMEM" };
  throw error;
};
`;
}

test("NODE_OPTIONS loads a preload from a Windows-style path containing spaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "MediMori worker preload "));
  try {
    const preload = join(directory, "path shim.cjs");
    await writeFile(preload, "globalThis.__engineeringPreloadLoaded = true;\n", "utf8");
    const option = nodePreloadOption(preload);
    assert.match(option, /^--import=file:/);
    if (process.platform === "win32") {
      assert.match(option, /^--import=file:\/\/\/[^ ]+\//);
      assert.match(option, /%20/);
      assert.doesNotMatch(option, /\\/);
    }
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    env.NODE_OPTIONS = option;
    const result = spawnSync(process.execPath, ["-e", "process.stdout.write(globalThis.__engineeringPreloadLoaded ? 'loaded' : 'missing')"], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "loaded");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows passwd lookup ENOMEM gets only the bounded tsx cache fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "MediMori userInfo fallback "));
  try {
    const failing = await writePreload(directory, "simulate-failure.cjs", failingUserInfoPreload());
    const env = { ...process.env, NODE_OPTIONS: `${nodePreloadOption(failing)} ${nodePreloadOption(compatPreload)}` };
    const result = spawnSync(process.execPath, ["-e", "process.stdout.write(require('node:os').userInfo().username)"], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "medimori-worker-cache");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compatibility preload leaves normal os.userInfo behavior unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "MediMori userInfo normal "));
  try {
    const normal = await writePreload(directory, "simulate-normal.cjs", `
const os = require("node:os");
Object.defineProperty(process, "geteuid", { configurable: true, value: () => 1000 });
os.userInfo = () => ({ username: "native-userInfo-result", uid: 1000, gid: 1000, shell: "", homedir: process.cwd() });
`);
    const env = { ...process.env, NODE_OPTIONS: `${nodePreloadOption(normal)} ${nodePreloadOption(compatPreload)}` };
    const result = spawnSync(process.execPath, ["-e", "process.stdout.write(require('node:os').userInfo().username)"], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "native-userInfo-result");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compatibility preload rethrows unrelated os.userInfo failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "MediMori userInfo unrelated "));
  try {
    const unrelated = await writePreload(directory, "simulate-unrelated.cjs", `
const os = require("node:os");
try { Object.defineProperty(process, "geteuid", { configurable: true, value: undefined }); } catch {}
os.userInfo = () => { const error = new Error("unrelated failure"); error.code = "EOTHER"; throw error; };
`);
    const env = { ...process.env, NODE_OPTIONS: `${nodePreloadOption(unrelated)} ${nodePreloadOption(compatPreload)}` };
    const result = spawnSync(process.execPath, ["-e", `try { require('node:os').userInfo(); process.exit(4); } catch (error) { process.stdout.write(error.code); }`], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "EOTHER");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("launcher safely loads the real worker module graph under simulated passwd lookup failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "MediMori worker graph smoke "));
  try {
    const failing = await writePreload(directory, "simulate-failure.cjs", failingUserInfoPreload());
    const env = {
      ...process.env,
      NODE_OPTIONS: nodePreloadOption(failing),
      ENGINEERING_WORKER_ENABLED: "false",
    };
    for (const name of ["DATABASE_URL", "ENGINEERING_WORKER_DATABASE_URL", "OPENAI_API_KEY", "ADMIN_USERS", "ADMIN_SESSION_SECRET", "DOCKER_HOST", "DOCKER_CONTEXT"]) delete env[name];
    const result = await runWorkerModuleGraphSmoke({
      cwd: process.cwd(),
      env,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim(), "engineering-worker-module-graph-loaded");
    assert.equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline initialization diagnostic uses bootstrap without invoking the worker entrypoint", async () => {
  const result = await runWorkerInitializationDiagnostic({
    envFile: "",
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "", ENGINEERING_WORKER_ENABLED: "false" },
  });
  assert.equal(result.exitCode, 1);
  const diagnostic = JSON.parse(result.stdout);
  assert.equal(diagnostic.ready, false);
  assert.equal(diagnostic.stage, "configuration");
  assert.equal(diagnostic.code, "worker_disabled");
  assert.equal(diagnostic.beforeClaim, true);
  assert.equal(diagnostic.providerCouldHaveBeenReached, false);
  assert.equal(diagnostic.dockerCouldHaveBeenReached, false);
  assert.equal(result.stderr, "");
});

test("production worker entrypoint typechecks its initialization and ingress closure", () => {
  const result = spawnSync(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "--noEmit", "--target", "ES2017", "--lib", "dom,dom.iterable,esnext", "--allowJs",
    "--skipLibCheck", "--strict", "--esModuleInterop", "--module", "esnext",
    "--moduleResolution", "bundler", "--resolveJsonModule", "--isolatedModules",
    "--jsx", "react-jsx", "scripts/engineering-worker.ts",
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
