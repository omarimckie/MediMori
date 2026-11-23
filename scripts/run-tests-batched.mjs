import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const testScript = pkg.scripts?.test ?? "";
const files = testScript
  .replace(/^tsx --test\s+/, "")
  .split(/\s+/)
  .filter((entry) => entry.endsWith(".test.ts") || entry.endsWith(".test.tsx") || entry.endsWith(".test.mjs"));

const batchSize = Number(process.env.TEST_BATCH_SIZE ?? "12");
const tsx = resolve(root, "node_modules", "tsx", "dist", "cli.mjs");
const tsxBin = tsx;

let totalPass = 0;
let totalFail = 0;
let totalSkip = 0;
const failedBatches = [];
const executed = [];

for (let i = 0; i < files.length; i += batchSize) {
  const batch = files.slice(i, i + batchSize);
  const batchNum = Math.floor(i / batchSize) + 1;
  const totalBatches = Math.ceil(files.length / batchSize);
  console.log(`\n=== Batch ${batchNum}/${totalBatches} (${batch.length} files) ===`);
  const relative = batch.map((f) => resolve(root, f));
  const result = spawnSync(process.execPath, [tsxBin, "--test", ...relative], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  executed.push(...batch);
  const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const pass = [...out.matchAll(/ℹ pass (\d+)/g)].pop()?.[1];
  const fail = [...out.matchAll(/ℹ fail (\d+)/g)].pop()?.[1];
  const skip = [...out.matchAll(/ℹ skipped (\d+)/g)].pop()?.[1];
  totalPass += Number(pass ?? 0);
  totalFail += Number(fail ?? 0);
  totalSkip += Number(skip ?? 0);
  if (result.status !== 0) {
    failedBatches.push(batchNum);
  }
}

console.log("\n=== AGGREGATE ===");
console.log(`Files in inventory: ${files.length}`);
console.log(`Files executed: ${executed.length}`);
console.log(`Pass (summed batch reports): ${totalPass}`);
console.log(`Fail (summed batch reports): ${totalFail}`);
console.log(`Skipped (summed batch reports): ${totalSkip}`);
console.log(`Failed batches: ${failedBatches.length ? failedBatches.join(", ") : "none"}`);
process.exit(failedBatches.length ? 1 : 0);