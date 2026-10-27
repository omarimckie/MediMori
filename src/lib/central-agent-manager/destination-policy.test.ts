import assert from "node:assert/strict";
import test from "node:test";
import {
  isUnsafeResolvedAddress,
  validateHttpsStatusDestination,
} from "./destination-policy";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const privateLookup = async () => [{ address: "127.0.0.1", family: 4 }];

test("destination policy rejects non-HTTPS and loopback targets", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "status.example.com";
  try {
    assert.equal((await validateHttpsStatusDestination("http://status.example.com/x")).ok, false);
    assert.equal((await validateHttpsStatusDestination("https://127.0.0.1/x")).ok, false);
    assert.equal((await validateHttpsStatusDestination("https://localhost/x")).ok, false);
    assert.equal(
      (await validateHttpsStatusDestination("https://status.example.com:8443/x")).ok,
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previous;
  }
});

test("destination policy requires approved host and safe DNS resolution", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "status.example.com";
  try {
    const unapproved = await validateHttpsStatusDestination(
      "https://other.example.com/status",
      publicLookup,
    );
    assert.equal(unapproved.ok, false);

    const rebound = await validateHttpsStatusDestination(
      "https://status.example.com/status",
      privateLookup,
    );
    assert.equal(rebound.ok, false);

    const approved = await validateHttpsStatusDestination(
      "https://status.example.com/status",
      publicLookup,
    );
    assert.equal(approved.ok, true);
    if (approved.ok) {
      assert.deepEqual(approved.pinnedAddresses, ["93.184.216.34"]);
    }
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previous;
  }
});

test("destination policy rejects URL parsing bypass attempts", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = "status.example.com";
  try {
    assert.equal(
      (await validateHttpsStatusDestination("https://user:pass@status.example.com/status")).ok,
      false,
    );
    assert.equal(
      (await validateHttpsStatusDestination("https://status.example.com:8443/status")).ok,
      false,
    );
    assert.equal(
      (
        await validateHttpsStatusDestination(
          "https://status.example.com./status",
          publicLookup,
        )
      ).ok,
      true,
    );
    assert.equal(
      (await validateHttpsStatusDestination("https://not-approved.example.com/status", publicLookup))
        .ok,
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previous;
  }
});

test("isUnsafeResolvedAddress blocks metadata and RFC1918 ranges", () => {
  assert.equal(isUnsafeResolvedAddress("127.0.0.1"), true);
  assert.equal(isUnsafeResolvedAddress("10.0.0.5"), true);
  assert.equal(isUnsafeResolvedAddress("169.254.169.254"), true);
  assert.equal(isUnsafeResolvedAddress("93.184.216.34"), false);
});
