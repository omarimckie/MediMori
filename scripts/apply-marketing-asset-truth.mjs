import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }
  try {
    const env = readFileSync(".env.local", "utf8");
    const match = env.match(/^DATABASE_URL=(.*)$/m);
    if (!match) return "";
    return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

const url = loadDatabaseUrl();
if (!url) {
  console.error("DATABASE_URL is not set. Add it to the environment or .env.local.");
  process.exit(1);
}

const sql = neon(url);
const file = readFileSync(new URL("../sql/marketing-asset-truth.sql", import.meta.url), "utf8");
const statements = file
  .split(/;\s*\n/)
  .map((part) => part.trim())
  .filter((part) => part && !part.startsWith("--"));

for (const statement of statements) {
  await sql.query(statement);
  const preview = statement.replace(/\s+/g, " ").slice(0, 88);
  console.log(`Applied: ${preview}...`);
}

console.log("Applied marketing asset-truth schema pass.");
