// Runs against an ephemeral local server. Never connects to a real database.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const port = 3117;
const origin = `http://127.0.0.1:${port}`;
const useDevServer = process.env.ENGINEERING_HTTP_SMOKE_DEV === "true";
const portProbe = createServer();
await new Promise((resolve, reject) => {
  portProbe.once("error", () => reject(new Error("Engineering HTTP smoke port is already in use.")));
  portProbe.listen(port, "127.0.0.1", resolve);
});
await new Promise(resolve => portProbe.close(resolve));
const password = randomBytes(24).toString("hex");
const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]
  .filter(key => process.env[key])
  .map(key => [key, process.env[key]]));
Object.assign(env, {
  NODE_ENV: useDevServer ? "development" : "production", DATABASE_URL: "", ENGINEERING_WORKER_DATABASE_URL: "", OPENAI_API_KEY: "",
  GITHUB_TOKEN: "", GH_TOKEN: "", VERCEL_ENV: "", ENGINEERING_CONTROL_PLANE_ENABLED: "true",
  ENGINEERING_WORKER_ENABLED: "false", ENGINEERING_MERGE_ENABLED: "false", MARKETING_STORE: "memory",
  MARKETING_MOCK_MODE: "true", ADMIN_SESSION_SECRET: randomBytes(32).toString("hex"),
  ADMIN_USERS: JSON.stringify({ "engineering-test": password }),
});
const server = spawn(process.execPath, ["--require", fileURLToPath(new URL("./engineering-worker-tsx-compat.cjs", import.meta.url)), "node_modules/next/dist/bin/next", useDevServer ? "dev" : "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
const startupDiagnostics = [];
for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => {
  startupDiagnostics.push(String(chunk).replace(/\s+/g, " ").slice(0, 300));
  if (startupDiagnostics.length > 8) startupDiagnostics.shift();
});
try {
  let ready = false;
  for (let i = 0; i < (useDevServer ? 120 : 40); i++) {
    if (server.exitCode !== null) throw new Error(`Local HTTP smoke server exited before readiness: ${startupDiagnostics.join(" | ").slice(-1800)}`);
    try { if ((await fetch(`${origin}/api/admin/engineering`)).status === 401) { ready = true; break; } } catch {}
    await delay(250);
  }
  assert.ok(ready, "Local server must start within ten seconds.");
  assert.equal((await fetch(`${origin}/admin/engineering`, { redirect: "manual" })).status, 307);
  assert.equal((await fetch(`${origin}/api/admin/engineering`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`${origin}/api/admin/engineering`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "prepare_initial_attempt", id: "b61b0dc7-d1ab-45ea-88c0-6480cda5029a", version: 0, attemptKey: "5cb8fb50-0b34-4c92-8839-6e7d9d52caf0" }) })).status, 401, "Initial preparation requires the normal admin session.");
  const login = await fetch(`${origin}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "engineering-test", password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(";")[0];
  const page = await fetch(`${origin}/admin/engineering`, { headers: { cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Engineering tasks/);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.length > 0, "The authenticated page must reference its client resources.");
  for (const path of scripts) {
    assert.ok(path.startsWith("/"), "Client assets must remain same-origin.");
    const asset = await fetch(`${origin}${path}`);
    assert.equal(asset.status, 200, `Client asset must load: ${path.split("/").at(-1)}`);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
  }
  const post = (body, requestOrigin = origin) => fetch(`${origin}/api/admin/engineering`, { method: "POST", headers: { cookie, origin: requestOrigin, "Content-Type": "application/json" }, body });
  assert.equal((await post("{}", "https://untrusted.example")).status, 403);
  assert.equal((await post("invalid-json")).status, 400);
  assert.equal((await post("[]")).status, 400);
  assert.equal((await post("x".repeat(16001))).status, 413);
  assert.equal((await post(JSON.stringify({ action: "approve", id: "bad-id", version: 1 }))).status, 400);
  assert.equal((await post(JSON.stringify({ action: "approve", id: "b61b0dc7-d1ab-45ea-88c0-6480cda5029a", version: 0 }))).status, 400, "Plan approval without an immutable target SHA is rejected before storage access.");
  const missingInitialKey = await post(JSON.stringify({ action: "prepare_initial_attempt", id: "b61b0dc7-d1ab-45ea-88c0-6480cda5029a", version: 0 }));
  assert.equal(missingInitialKey.status, 400, "Initial preparation requires a bounded idempotency key before storage access.");
  const unavailableInitialPrepare = await post(JSON.stringify({ action: "prepare_initial_attempt", id: "b61b0dc7-d1ab-45ea-88c0-6480cda5029a", version: 0, attemptKey: "5cb8fb50-0b34-4c92-8839-6e7d9d52caf0" }));
  assert.equal(unavailableInitialPrepare.status, 503, "Valid preparation is authenticated and reaches only the sanitized no-database boundary in this smoke test.");
  const missingRetrySubjectKey = await post(JSON.stringify({ action: "prepare_retry_subject", id: "b61b0dc7-d1ab-45ea-88c0-6480cda5029a", version: 0 }));
  assert.equal(missingRetrySubjectKey.status, 400, "Retry-subject preparation requires a bounded idempotency key before storage access.");
  const invalidTaskRead = await fetch(`${origin}/api/admin/engineering?id=not-a-uuid`, { headers: { cookie } });
  assert.equal(invalidTaskRead.status, 400);
  const unavailableTaskRead = await fetch(`${origin}/api/admin/engineering?id=b61b0dc7-d1ab-45ea-88c0-6480cda5029a`, { headers: { cookie } });
  assert.equal(unavailableTaskRead.status, 503);
  assert.deepEqual(await unavailableTaskRead.json(), { error: "Engineering storage unavailable. Check schema and database configuration." });
  assert.equal((await post(JSON.stringify({ action: "create", request: "Isolated test" }))).status, 400, "A missing submission key is rejected before storage access.");
  assert.equal((await post(JSON.stringify({ action: "create", request: "Isolated test", submissionKey: "not-a-uuid" }))).status, 400, "Malformed submission keys are rejected before storage access.");
  const missingDatabase = await post(JSON.stringify({ action: "create", request: "Isolated test", submissionKey: "5cb8fb50-0b34-4c92-8839-6e7d9d52caf0" }));
  assert.equal(missingDatabase.status, 503);
  assert.deepEqual(await missingDatabase.json(), { error: "Engineering storage unavailable." });
  console.log("Engineering HTTP smoke passed: authentication, same-origin client assets, admin rendering, CSRF checks, target-bound approval, malformed inputs, request limits, idempotency-key validation, and sanitized storage failures.");
} finally {
  server.kill();
}
