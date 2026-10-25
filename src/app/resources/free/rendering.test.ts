import assert from "node:assert/strict";
import { test } from "node:test";
import { dynamic, metadata } from "./page";

test("free-resource catalog renders database-backed content at request time", () => {
  assert.equal(dynamic, "force-dynamic");
  assert.equal(metadata.alternates?.canonical, "/resources/free");
});
