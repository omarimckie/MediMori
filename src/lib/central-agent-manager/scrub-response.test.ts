import assert from "node:assert/strict";
import test from "node:test";
import { scrubSecretsFromString } from "./scrub-response";

test("scrubSecretsFromString redacts bearer tokens and database URLs", () => {
  const stripeLikeSecret = `sk_${"test"}_${"12345678901234567890"}`;
  const input = `Bearer abc.def.ghi postgresql://user:pass@host:5432/db ${stripeLikeSecret}`;
  const output = scrubSecretsFromString(input);
  assert.equal(output.includes("Bearer abc"), false);
  assert.equal(output.includes("postgresql://"), false);
  assert.equal(output.includes("sk_test_"), false);
  assert.match(output, /\[redacted\]/);
});

test("scrubSecretsFromString redacts an explicitly supplied credential", () => {
  const secret = "bypass-secret-value";
  const output = scrubSecretsFromString(`failed ${secret} again`, [secret]);
  assert.equal(output.includes(secret), false);
  assert.match(output, /\[redacted\]/);
});
