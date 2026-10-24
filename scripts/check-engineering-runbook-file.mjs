import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const runbookPath = resolve(root, process.argv[2] ?? "docs/engineering/OPERATIONS_RUNBOOK.md");
const launcherPath = resolve(root, "scripts/engineering-worker-launch.mjs");
const runbook = await readFile(runbookPath, "utf8");
const launcher = await readFile(launcherPath, "utf8");
const required = [
  "scripts/engineering-worker.ts",
  "src/lib/engineering/worker.ts",
  "src/lib/engineering/workspace.ts",
  "src/app/api/admin/engineering/route.ts",
  "scripts/engineering-worker-launch.mjs",
];
for (const relativePath of required) {
  if (!runbook.includes(`\`${relativePath}\``)) throw new Error(`Runbook does not reference ${relativePath}`);
  await access(resolve(root, relativePath));
}
for (const option of ["--diagnose-initialization", "--diagnose-database-identity", "--diagnose-source-export"]) {
  if (!runbook.includes(`\`${option}\``)) throw new Error(`Runbook does not document ${option}`);
  if (!launcher.includes(`runId === "${option}"`)) throw new Error(`Launcher does not implement ${option}`);
}
console.log(`Engineering runbook paths and diagnostic options are valid (${runbookPath}).`);
