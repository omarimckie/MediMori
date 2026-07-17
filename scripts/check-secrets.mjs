#!/usr/bin/env node
/**
 * Scans git-tracked files for common secret patterns.
 * Run: npm run security:check
 */
import { execFileSync } from "node:child_process";

const patterns = [
  { name: "Stripe live secret key", regex: /sk_live_[A-Za-z0-9]{20,}/ },
  { name: "Stripe test secret key", regex: /sk_test_[A-Za-z0-9]{20,}/ },
  { name: "Stripe restricted key", regex: /rk_(live|test)_[A-Za-z0-9]{20,}/ },
  { name: "Vercel Blob token", regex: /vercel_blob_rw_[A-Za-z0-9_]{20,}/ },
];

function listTrackedFiles() {
  // -z emits null-delimited, unquoted paths, so filenames with spaces or
  // special characters arrive as literal data.
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output
    .split("\0")
    .filter(Boolean)
    .filter((file) => !file.startsWith("node_modules/"));
}

function readTrackedFile(file) {
  try {
    return execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" });
  } catch {
    return "";
  }
}

const findings = [];

for (const file of listTrackedFiles()) {
  const content = readTrackedFile(file);
  if (!content) continue;

  for (const pattern of patterns) {
    const match = content.match(pattern.regex);
    if (match) {
      findings.push({
        file,
        type: pattern.name,
        sample: `${match[0].slice(0, 12)}…`,
      });
    }
  }
}

if (findings.length) {
  console.error("Secret scan failed. Possible secrets in tracked files:\n");
  for (const finding of findings) {
    console.error(`- ${finding.type} in ${finding.file} (${finding.sample})`);
  }
  console.error(
    "\nRemove secrets from git, rotate them in the provider dashboard, and store values only in env vars.",
  );
  process.exit(1);
}

console.log("Secret scan passed: no common API key patterns found in tracked files.");
