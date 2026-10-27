import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("calendar wires detail modal recycle to ScheduleContentModal and content POST", () => {
  const client = readFileSync(new URL("./CalendarClient.tsx", import.meta.url), "utf8");
  const detail = readFileSync(
    new URL("./CalendarPublicationDetailModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(client, /CalendarPublicationDetailModal/);
  assert.match(client, /setDetailEvent\(event\)/);
  assert.match(client, /ScheduleContentModal/);
  assert.match(client, /mode: "recycle"/);
  assert.match(client, /runMarketingWeekPostAction/);
  assert.match(client, /reloadAll/);
  assert.match(detail, /onRecycle/);
});
