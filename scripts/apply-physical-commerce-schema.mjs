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
const file = readFileSync(new URL("../sql/physical-commerce.sql", import.meta.url), "utf8");

/** Drop leading blank lines and `--` comments so header comments do not skip real SQL. */
function stripLeadingSqlComments(chunk) {
  const lines = chunk.split("\n");
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === "" || trimmed.startsWith("--")) {
      index += 1;
      continue;
    }
    break;
  }
  return lines.slice(index).join("\n").trim();
}

const statements = file
  .split(/;\s*\n/)
  .map((part) => stripLeadingSqlComments(part.trim()))
  .filter((part) => part.length > 0);

for (const statement of statements) {
  await sql.query(statement);
  const preview = statement.replace(/\s+/g, " ").slice(0, 88);
  console.log(`Applied: ${preview}...`);
}

console.log("Applied physical-commerce schema (inventory, orders, seed).");
