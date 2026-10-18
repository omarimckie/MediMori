import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  assertNoPortBindings,
  assertNoPublishedPorts,
  validateContainerInspect,
  validateDockerIsolationFromInspect,
  validateNetworkInspect,
} from "./dispatcher-watchdog-docker-isolation.mjs";

const fixturesDir = fileURLToPath(
  new URL("./fixtures/dispatcher-watchdog/", import.meta.url),
);

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

describe("dispatcher watchdog docker isolation validation", () => {
  it("accepts exposed-but-unpublished port mapping (5432/tcp null)", () => {
    const inspect = loadFixture("docker-inspect-exposed-unpublished-port.json");
    validateDockerIsolationFromInspect(inspect, {
      expectedContainerName: "tf-watchdog-pg-run-abc123",
      expectedNetworkName: "tf-watchdog-net-run-abc123",
    });
  });

  it("accepts isolated container inspect fixture", () => {
    const inspect = loadFixture("docker-inspect-isolated.json");
    const result = validateDockerIsolationFromInspect(inspect, {
      expectedContainerName: "tf-watchdog-pg-run-abc123",
      expectedNetworkName: "tf-watchdog-net-run-abc123",
    });
    assert.equal(result.attachedNetwork, "tf-watchdog-net-run-abc123");
    validateNetworkInspect(loadFixture("docker-network-internal.json")[0], {
      expectedNetworkName: "tf-watchdog-net-run-abc123",
    });
  });

  it("rejects published host ports", () => {
    const inspect = loadFixture("docker-inspect-published-port.json");
    assert.throws(
      () =>
        validateContainerInspect(inspect[0], {
          expectedContainerName: "tf-watchdog-pg-run-abc123",
        }),
      /docker_isolation_port_bindings_present|docker_isolation_host_ports_published/,
    );
  });

  it("treats empty PortBindings object as isolated", () => {
    assertNoPortBindings({});
    assertNoPublishedPorts({});
  });

  it("rejects non-internal network inspect", () => {
    assert.throws(
      () =>
        validateNetworkInspect({ Name: "tf-watchdog-net-run-abc123", Internal: false }, {
          expectedNetworkName: "tf-watchdog-net-run-abc123",
        }),
      /docker_isolation_network_not_internal/,
    );
  });
});
