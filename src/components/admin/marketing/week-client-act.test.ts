import assert from "node:assert/strict";
import { test } from "node:test";
import { runMarketingWeekPostAction } from "./week-client-act";

async function simulateWeekAct(
  fetchFn: () => Promise<Response>,
  reload: () => Promise<void>,
): Promise<{ busy: boolean; message: string | null }> {
  let busy = false;
  let message: string | null = null;
  busy = true;
  message = null;
  try {
    const errorMessage = await runMarketingWeekPostAction(
      "/api/admin/marketing/content/test",
      { action: "schedule" },
      async () => fetchFn(),
      reload,
    );
    if (errorMessage) message = errorMessage;
  } catch (error) {
    message = error instanceof Error ? error.message : "Network error.";
  } finally {
    busy = false;
  }
  return { busy, message };
}

test("week action error does not leave busy stuck", async () => {
  let reloads = 0;
  const { busy, message } = await simulateWeekAct(
    async () =>
      new Response(JSON.stringify({ error: "invalid_aspect_ratio: too wide" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    async () => {
      reloads += 1;
    },
  );
  assert.equal(busy, false);
  assert.equal(message, "invalid_aspect_ratio: too wide");
  assert.equal(reloads, 1);
});

test("week action surfaces non-JSON error responses and resets busy", async () => {
  let reloads = 0;
  const { busy, message } = await simulateWeekAct(
    async () => new Response("<html>error</html>", { status: 500 }),
    async () => {
      reloads += 1;
    },
  );
  assert.equal(busy, false);
  assert.equal(message, "Action failed (500).");
  assert.equal(reloads, 1);
});

test("week action success reloads and clears error message", async () => {
  let reloads = 0;
  const { busy, message } = await simulateWeekAct(
    async () =>
      new Response(JSON.stringify({ result: { status: "scheduled" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    async () => {
      reloads += 1;
    },
  );
  assert.equal(busy, false);
  assert.equal(message, null);
  assert.equal(reloads, 1);
});

test("week action network failure resets busy", async () => {
  const { busy, message } = await simulateWeekAct(
    async () => {
      throw new Error("Failed to fetch");
    },
    async () => {},
  );
  assert.equal(busy, false);
  assert.equal(message, "Failed to fetch");
});
