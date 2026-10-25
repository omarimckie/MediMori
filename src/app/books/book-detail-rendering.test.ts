import assert from "node:assert/strict";
import { test } from "node:test";
import { dynamic, generateStaticParams } from "./[id]/page";

test("book detail keeps known IDs while rendering database-backed content at request time", () => {
  assert.equal(dynamic, "force-dynamic");

  const params = generateStaticParams();
  assert.ok(params.length > 0);
  assert.ok(params.every(({ id }) => id.length > 0));
});
