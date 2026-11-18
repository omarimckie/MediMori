import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAdminConfigurationDiagnostics,
  isAdminConfigured,
  verifyAdminCredentials,
} from "./admin-auth";

test("getAdminConfigurationDiagnostics reports configured when env is valid", () => {
  const diagnostics = getAdminConfigurationDiagnostics({
    ADMIN_SESSION_SECRET: "preview-only-test-secret",
    ADMIN_USERS: JSON.stringify({ "preview-user": "preview-pass" }),
  });
  assert.equal(diagnostics.sessionSecretPresent, true);
  assert.equal(diagnostics.adminUsersRawPresent, true);
  assert.equal(diagnostics.adminUsersJsonParseable, true);
  assert.equal(diagnostics.adminUsersValidEntryCount, 1);
  assert.equal(diagnostics.configured, true);
});

test("getAdminConfigurationDiagnostics rejects invalid ADMIN_USERS JSON", () => {
  const diagnostics = getAdminConfigurationDiagnostics({
    ADMIN_SESSION_SECRET: "secret",
    ADMIN_USERS: "{not-json",
  });
  assert.equal(diagnostics.adminUsersJsonParseable, false);
  assert.equal(diagnostics.adminUsersValidEntryCount, 0);
  assert.equal(diagnostics.configured, false);
});

test("getAdminConfigurationDiagnostics accepts JSON wrapped in an extra quoted string", () => {
  const inner = JSON.stringify({ operator: "pass" });
  const diagnostics = getAdminConfigurationDiagnostics({
    ADMIN_SESSION_SECRET: "secret",
    ADMIN_USERS: JSON.stringify(inner),
  });
  assert.equal(diagnostics.adminUsersJsonParseable, true);
  assert.equal(diagnostics.adminUsersValidEntryCount, 1);
  assert.equal(diagnostics.configured, true);
});

test("verifyAdminCredentials works with parsed ADMIN_USERS env", () => {
  const previousUsers = process.env.ADMIN_USERS;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = "unit-test-secret";
  process.env.ADMIN_USERS = JSON.stringify({ alice: "hunter2" });
  assert.equal(verifyAdminCredentials("Alice", "hunter2"), true);
  assert.equal(verifyAdminCredentials("alice", "wrong"), false);
  if (previousUsers === undefined) delete process.env.ADMIN_USERS;
  else process.env.ADMIN_USERS = previousUsers;
  if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = previousSecret;
});