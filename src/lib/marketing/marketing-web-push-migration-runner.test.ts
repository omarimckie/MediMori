import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  parseMarketingWebPushMigrationStatements,
  stripSqlLineComments,
} from "../../../scripts/apply-marketing-web-push-schema.mjs";

const migrationSqlPath = fileURLToPath(
  new URL("../../../sql/marketing-web-push.sql", import.meta.url),
);

describe("marketing Web Push migration runner", () => {
  it("parses five statements with tables before indexes", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const statements = parseMarketingWebPushMigrationStatements(file);

    assert.equal(statements.length, 5);
    assert.match(
      statements[0],
      /^CREATE TABLE IF NOT EXISTS marketing_push_subscriptions/,
    );
    assert.match(
      statements[1],
      /^CREATE INDEX IF NOT EXISTS marketing_push_subscriptions_admin_idx/,
    );
    assert.match(
      statements[2],
      /^CREATE TABLE IF NOT EXISTS marketing_admin_notifications/,
    );
    assert.match(
      statements[3],
      /^CREATE INDEX IF NOT EXISTS marketing_admin_notifications_created_idx/,
    );
    assert.match(
      statements[4],
      /^CREATE INDEX IF NOT EXISTS marketing_admin_notifications_unread_idx/,
    );
  });

  it("does not drop the first CREATE TABLE when the file starts with a comment", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const naiveParts = file
      .split(/;\s*\n/)
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith("--"));

    assert.equal(
      naiveParts[0]?.includes("CREATE TABLE IF NOT EXISTS marketing_push_subscriptions"),
      false,
      "legacy runner logic skipped the subscriptions table",
    );

    const statements = parseMarketingWebPushMigrationStatements(file);
    assert.match(
      statements[0],
      /^CREATE TABLE IF NOT EXISTS marketing_push_subscriptions/,
    );
  });

  it("stripSqlLineComments removes header comments only", () => {
    const stripped = stripSqlLineComments("-- header\n\nCREATE TABLE t (\n  id int\n);\n");
    assert.match(stripped.trim(), /^CREATE TABLE t/);
    assert.equal(stripped.includes("-- header"), false);
  });
});
