import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { extractMarketingSmartUploadIdempotencyStatements } from "../../../scripts/apply-marketing-smart-upload-idempotency.mjs";

const migrationSqlPath = fileURLToPath(
  new URL("../../../sql/marketing-smart-upload-idempotency.sql", import.meta.url),
);

describe("marketing smart upload idempotency migration runner", () => {
  it("extracts exactly two complete statements from the migration SQL file", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const { preflight, createIndex } =
      extractMarketingSmartUploadIdempotencyStatements(file);

    assert.match(preflight, /^DO \$\$/);
    assert.match(preflight, /END \$\$;$/);
    assert.match(preflight, /END IF;/);
    assert.match(preflight, /RAISE EXCEPTION/);

    assert.match(
      createIndex,
      /^CREATE UNIQUE INDEX IF NOT EXISTS marketing_content_smart_upload_finalize_key_uq/,
    );
    assert.match(createIndex, /;$/);
  });

  it("does not break the DO block at internal semicolons (unlike naive split)", () => {
    const file = readFileSync(migrationSqlPath, "utf8");
    const naiveParts = file
      .split(/;\s*\n/)
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith("--"));

    assert.ok(
      naiveParts.length > 2,
      "naive semicolon-newline split must not be used for this migration",
    );

    const { preflight } = extractMarketingSmartUploadIdempotencyStatements(file);
    assert.equal(naiveParts[0]?.includes("END $$;"), false);
    assert.equal(preflight.includes("END $$;"), true);
  });

  it("fails clearly when expected statements are missing", () => {
    assert.throws(
      () => extractMarketingSmartUploadIdempotencyStatements("-- empty\n"),
      /Could not extract DO \$\$/,
    );
    assert.throws(
      () =>
        extractMarketingSmartUploadIdempotencyStatements(
          "DO $$ BEGIN NULL; END $$;\n",
        ),
      /Could not extract CREATE UNIQUE INDEX/,
    );
  });
});
