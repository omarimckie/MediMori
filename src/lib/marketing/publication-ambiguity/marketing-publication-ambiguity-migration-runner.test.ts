import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseMarketingPublicationAmbiguityMigrationStatements } from "../../../../scripts/apply-marketing-publication-ambiguity-schema.mjs";

test("publication ambiguity migration parses into expected statements", () => {
  const sql = readFileSync(
    new URL("../../../../sql/marketing-publication-ambiguity.sql", import.meta.url),
    "utf8",
  );
  const statements = parseMarketingPublicationAmbiguityMigrationStatements(sql);
  assert.equal(statements.length, 3);
  const combined = statements.join("\n");
  assert.match(combined, /ambiguity_state/i);
  assert.match(combined, /claim_token/i);
  assert.match(combined, /processing_started_at/i);
  assert.match(combined, /provider_creation_id/i);
  assert.match(combined, /marketing_publications_ambiguity_state_check/i);
  assert.match(combined, /marketing_publications_ambiguity_state_idx/i);
});
