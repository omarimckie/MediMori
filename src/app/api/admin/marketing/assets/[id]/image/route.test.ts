import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "./route";

const originalSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "admin-route-image-test-secret";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

test("unauthenticated admin asset image request rejected", async () => {
  const response = await GET(
    new Request("http://localhost/api/admin/marketing/assets/00000000-0000-4000-8000-000000000001/image"),
    { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) },
  );
  assert.equal(response.status, 401);
});
