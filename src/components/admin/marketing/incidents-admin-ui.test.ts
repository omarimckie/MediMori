import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function readComponent(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const OPERATIONAL_CONTROL_PATTERNS = [
  /fetch\([^)]*\/api\/admin\/marketing\/publications[^)]*retry/i,
  /fetch\([^)]*reconcile/i,
  /fetch\([^)]*meta/i,
  /publishDue/,
  /retryAdminPublication/,
  /reconcileMeta/,
];

function assertNoOperationalControls(source: string, label: string) {
  for (const pattern of OPERATIONAL_CONTROL_PATTERNS) {
    assert.doesNotMatch(source, pattern, `${label} must not include operational control: ${pattern}`);
  }
  assert.doesNotMatch(
    source,
    /<PrimaryButton[^>]*>[\s\S]*?Retry[\s\S]*?<\/PrimaryButton>/i,
    `${label} must not expose retry primary action`,
  );
  assert.doesNotMatch(
    source,
    /<PrimaryButton[^>]*>[\s\S]*?Publish[\s\S]*?<\/PrimaryButton>/i,
    `${label} must not expose publish primary action`,
  );
}

describe("Phase III-A3 incident admin UI", () => {
  it("Incidents list defaults to unresolvedOnly and includes empty state copy", () => {
    const source = readComponent("src/components/admin/marketing/IncidentsClient.tsx");
    assert.match(source, /unresolvedOnly/);
    assert.match(source, /No incidents right now/);
    assert.match(source, /limit: "100"/);
  });

  it("Incident detail delegates mutations to dedicated helper module", () => {
    const detail = readComponent("src/components/admin/marketing/IncidentDetailClient.tsx");
    const mutations = readComponent("src/components/admin/marketing/incident-detail-mutations.ts");
    assert.match(detail, /runIncidentResolveMutation/);
    assert.match(detail, /runIncidentTransitionMutation/);
    assert.match(detail, /createIncidentMutationGate/);
    assert.match(mutations, /\/resolve`/);
    assert.doesNotMatch(mutations, /status:\s*"resolved"/);
    assert.match(mutations, /409/);
    assert.match(detail, /View in Your week/);
    assert.match(detail, /RESOLVE_PRIMARY_WARNING/);
    assert.match(detail, /MANUAL_RESOLUTION_OPTIONS/);
    assert.doesNotMatch(detail, /dangerouslySetInnerHTML/);
    assertNoOperationalControls(detail, "IncidentDetailClient");
    assertNoOperationalControls(mutations, "incident-detail-mutations");
  });

  it("Marketing shell exposes Incidents near Notifications", () => {
    const source = readComponent("src/components/admin/marketing/MarketingShell.tsx");
    const incidentsIndex = source.indexOf('label: "Incidents"');
    const notificationsIndex = source.indexOf('label: "Notifications"');
    assert.ok(incidentsIndex >= 0 && notificationsIndex >= 0);
    assert.ok(incidentsIndex < notificationsIndex);
  });

  it("notifications UI links View incident when relatedIncidentId is present", () => {
    const client = readComponent("src/components/admin/marketing/NotificationsClient.tsx");
    const bell = readComponent("src/components/admin/marketing/MarketingNotificationBell.tsx");
    assert.match(client, /relatedIncidentId/);
    assert.match(client, /View incident/);
    assert.match(client, /Open/);
    assert.match(bell, /relatedIncidentId/);
    assert.match(bell, /View incident/);
    assert.match(bell, /item\.destination/);
  });
});
