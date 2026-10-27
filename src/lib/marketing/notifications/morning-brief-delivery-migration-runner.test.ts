import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseMarketingMorningBriefDeliveryMigrationStatements } from "../../../../scripts/apply-marketing-morning-brief-delivery-schema.mjs";

test("morning brief delivery migration statements are additive", () => {
  const sql = readFileSync(
    new URL("../../../../sql/marketing-morning-brief-delivery.sql", import.meta.url),
    "utf8",
  );
  const statements = parseMarketingMorningBriefDeliveryMigrationStatements(sql);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS marketing_morning_brief_delivery_claims/);
  assert.match(statements[1], /CREATE INDEX IF NOT EXISTS/);
});
