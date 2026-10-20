import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  assertPostgresNamedVolumePolicy,
  assertRunnerWorkspaceMountPolicy,
  expectedPostgresVolumeNameForContainer,
  parseDockerBindEntry,
  POSTGRES_DATA_MOUNT_DESTINATION,
  validateContainerInspect,
  validateDockerIsolationFromInspect,
  validateDockerIsolationPair,
} from "./dispatcher-watchdog-docker-isolation.mjs";
import {
  assertOwnedResourceName,
  validateRunId,
} from "./dispatcher-watchdog-integration-resources.mjs";
import {
  dockerDesktopLinuxMountSourceFromWindowsPath,
  expectedRunnerWorkspaceHostPathForRun,
} from "./dispatcher-watchdog-runner-workspace-path.mjs";

const fixturesDir = fileURLToPath(
  new URL("./fixtures/dispatcher-watchdog/", import.meta.url),
);

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

function pgInspect(overrides = {}) {
  const base = structuredClone(loadFixture("docker-inspect-postgres-named-volume.json"));
  Object.assign(base[0], overrides.record ?? {});
  if (overrides.hostConfig) {
    Object.assign(base[0].HostConfig, overrides.hostConfig);
  }
  if (overrides.binds !== undefined) {
    base[0].HostConfig.Binds = overrides.binds;
  }
  if (overrides.mounts !== undefined) {
    base[0].Mounts = overrides.mounts;
  }
  return base;
}

const PG_CONTAINER = "tf-watchdog-pg-run-abc123";
const PG_NETWORK = "tf-watchdog-net-run-abc123";
const PG_VOLUME = "tf-watchdog-pg-data-run-abc123";
const RUNNER_CONTAINER = "tf-watchdog-runner-run-abc123";
const RUNNER_RUN_ID = "run-abc123";

function trustedRunnerWorkspacePath() {
  return expectedRunnerWorkspaceHostPathForRun(RUNNER_RUN_ID, tmpdir());
}

function runnerInspectRecord(mutate) {
  const workspace = trustedRunnerWorkspacePath();
  const record = structuredClone(loadFixture("docker-inspect-runner-workspace-ro.json"))[0];
  record.HostConfig.Binds = [`${workspace}:/work:ro`];
  record.Mounts = [
    {
      Type: "bind",
      Source: dockerDesktopLinuxMountSourceFromWindowsPath(workspace),
      Destination: "/work",
      Mode: "ro",
      RW: false,
      Propagation: "rprivate",
    },
  ];
  if (mutate) {
    mutate(record, workspace);
  }
  return { record, workspace };
}

describe("postgres named volume isolation policy", () => {
  it("accepts exact expected PostgreSQL named volume", () => {
    const inspect = loadFixture("docker-inspect-postgres-named-volume.json");
    validateContainerInspect(inspect[0], { expectedContainerName: PG_CONTAINER });
  });

  it("accepts HostConfig.Binds and Mounts correspondence", () => {
    assertPostgresNamedVolumePolicy(
      [`${PG_VOLUME}:${POSTGRES_DATA_MOUNT_DESTINATION}`],
      [
        {
          Type: "volume",
          Name: PG_VOLUME,
          Destination: POSTGRES_DATA_MOUNT_DESTINATION,
        },
      ],
      PG_VOLUME,
    );
  });

  it("accepts valid fixture through isolation CLI", () => {
    const container = loadFixture("docker-inspect-postgres-named-volume.json");
    const network = loadFixture("docker-network-internal.json");
    validateDockerIsolationPair(container, network, {
      expectedContainerName: PG_CONTAINER,
      expectedNetworkName: PG_NETWORK,
    });
  });

  it("accepts runner workspace read-only bind policy", () => {
    const { record, workspace } = runnerInspectRecord();
    validateContainerInspect(record, {
      expectedContainerName: RUNNER_CONTAINER,
      expectedRunnerWorkspaceHostPath: workspace,
    });
  });

  it("accepts Windows-native Mounts.Source matching trusted workspace bind", () => {
    const { record, workspace } = runnerInspectRecord((r, ws) => {
      r.Mounts[0].Source = ws;
    });
    validateContainerInspect(record, {
      expectedContainerName: RUNNER_CONTAINER,
      expectedRunnerWorkspaceHostPath: workspace,
    });
  });

  it("accepts saved real-run inspect shape with Windows-native Mounts.Source", () => {
    const workspace = trustedRunnerWorkspacePath();
    const record = structuredClone(
      loadFixture("docker-inspect-runner-workspace-ro-windows-mount-source.json"),
    )[0];
    record.HostConfig.Binds = [`${workspace}:/work:ro`];
    record.Mounts[0].Source = workspace;
    validateContainerInspect(record, {
      expectedContainerName: RUNNER_CONTAINER,
      expectedRunnerWorkspaceHostPath: workspace,
    });
  });

  it("rejects arbitrary host directory at /work:ro", () => {
    const { record, workspace } = runnerInspectRecord();
    record.HostConfig.Binds = ["C:\\evil\\arbitrary:/work:ro"];
    record.Mounts[0].Source = dockerDesktopLinuxMountSourceFromWindowsPath(
      "C:\\evil\\arbitrary",
    );
    assert.throws(
      () =>
        validateContainerInspect(record, {
          expectedContainerName: RUNNER_CONTAINER,
          expectedRunnerWorkspaceHostPath: workspace,
        }),
      /docker_isolation_runner_workspace_bind_source_mismatch|docker_isolation_runner_workspace_path_mismatch/,
    );
  });

  it("rejects wrong disposable workspace path for RUN_ID", () => {
    const { record, workspace } = runnerInspectRecord();
    const wrong = workspace.replace(RUNNER_RUN_ID, "run-wrong999");
    record.HostConfig.Binds = [`${wrong}:/work:ro`];
    record.Mounts[0].Source = dockerDesktopLinuxMountSourceFromWindowsPath(wrong);
    assert.throws(
      () =>
        validateContainerInspect(record, {
          expectedContainerName: RUNNER_CONTAINER,
          expectedRunnerWorkspaceHostPath: workspace,
        }),
      /docker_isolation_runner_workspace_bind_source_mismatch/,
    );
  });

  it("requires expectedRunnerWorkspaceHostPath for runner", () => {
    const { record } = runnerInspectRecord();
    assert.throws(
      () => validateContainerInspect(record, { expectedContainerName: RUNNER_CONTAINER }),
      /docker_isolation_runner_workspace_path_required/,
    );
  });

  it("rejects HostConfig.Binds and Mounts.Source mismatch", () => {
    const { record, workspace } = runnerInspectRecord();
    record.Mounts[0].Source = dockerDesktopLinuxMountSourceFromWindowsPath(
      "C:\\other\\tf-watchdog-runner-run-abc123",
    );
    assert.throws(
      () =>
        validateContainerInspect(record, {
          expectedContainerName: RUNNER_CONTAINER,
          expectedRunnerWorkspaceHostPath: workspace,
        }),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("rejects trusted bind with Windows-native Mounts.Source on a different path", () => {
    const { record, workspace } = runnerInspectRecord();
    record.Mounts[0].Source = "C:\\evil\\arbitrary";
    assert.throws(
      () =>
        validateContainerInspect(record, {
          expectedContainerName: RUNNER_CONTAINER,
          expectedRunnerWorkspaceHostPath: workspace,
        }),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  const reject = (label, mutate, pattern) => {
    it(`rejects ${label}`, () => {
      const inspect = pgInspect();
      mutate(inspect[0]);
      assert.throws(
        () => validateContainerInspect(inspect[0], { expectedContainerName: PG_CONTAINER }),
        pattern,
      );
    });
  };

  reject("host absolute path bind", (record) => {
    record.HostConfig.Binds = ["/host/data:/var/lib/postgresql/data"];
    record.Mounts = [
      {
        Type: "bind",
        Source: "/host/data",
        Destination: POSTGRES_DATA_MOUNT_DESTINATION,
      },
    ];
  }, /postgres_volume_name_mismatch|bind_mount|postgres_mount/);

  reject("Windows drive-letter bind", (record) => {
    record.HostConfig.Binds = ["C:\\data:/var/lib/postgresql/data"];
  }, /postgres_volume_name_mismatch/);

  reject("relative host path bind", (record) => {
    record.HostConfig.Binds = ["./data:/var/lib/postgresql/data"];
  }, /postgres_volume_name_mismatch/);

  reject("UNC network path bind", (record) => {
    record.HostConfig.Binds = ["\\\\server\\share:/var/lib/postgresql/data"];
  }, /postgres_volume_name_mismatch/);

  reject("wrong named volume", (record) => {
    record.HostConfig.Binds = ["tf-watchdog-pg-data-other-run:/var/lib/postgresql/data"];
    record.Mounts[0].Name = "tf-watchdog-pg-data-other-run";
  }, /postgres_volume_name_mismatch|postgres_mount_name_mismatch/);

  reject("correct volume prefix but wrong RUN_ID", (record) => {
    record.HostConfig.Binds = ["tf-watchdog-pg-data-wrong-id:/var/lib/postgresql/data"];
    record.Mounts[0].Name = "tf-watchdog-pg-data-wrong-id";
  }, /postgres_volume_name_mismatch|postgres_mount_name_mismatch/);

  reject("correct volume at wrong destination", (record) => {
    record.HostConfig.Binds = [`${PG_VOLUME}:/var/lib/postgresql/other`];
    record.Mounts[0].Destination = "/var/lib/postgresql/other";
  }, /postgres_volume_destination_mismatch|postgres_mount_destination_mismatch/);

  reject("correct destination with wrong volume source", (record) => {
    record.HostConfig.Binds = [`tf-watchdog-pg-data-wrong:${POSTGRES_DATA_MOUNT_DESTINATION}`];
    record.Mounts[0].Name = "tf-watchdog-pg-data-wrong";
  }, /postgres_volume_name_mismatch|postgres_mount_name_mismatch/);

  reject("HostConfig.Binds without matching Mounts", (record) => {
    record.Mounts = [];
  }, /postgres_mounts_count_invalid/);

  reject("Mounts without matching HostConfig.Binds", (record) => {
    record.HostConfig.Binds = [];
  }, /postgres_binds_count_invalid/);

  reject("Mounts.Type bind on postgres", (record) => {
    record.Mounts[0].Type = "bind";
  }, /postgres_mount_type_invalid/);

  reject("extra HostConfig.Binds entry", (record) => {
    record.HostConfig.Binds.push("extra:/tmp");
  }, /postgres_binds_count_invalid/);

  reject("extra Mounts entry", (record) => {
    record.Mounts.push({
      Type: "volume",
      Name: "extra",
      Destination: "/extra",
    });
  }, /postgres_mounts_count_invalid/);

  reject("anonymous volume", (record) => {
    record.HostConfig.Binds = [`:/var/lib/postgresql/data`];
  }, /binds_malformed|postgres_volume_name_mismatch/);

  reject("malformed HostConfig.Binds", (record) => {
    record.HostConfig.Binds = ["not-a-valid-bind"];
  }, /binds_malformed/);

  reject("forbidden mount propagation", (record) => {
    record.Mounts[0].Propagation = "shared";
  }, /mount_propagation_forbidden/);

  reject("incorrect container name", (record) => {
    record.Name = "/tf-watchdog-pg-wrong";
  }, /container_name_mismatch/);

  it("rejects postgres volume on runner container", () => {
    const { record, workspace } = runnerInspectRecord((r) => {
      r.HostConfig.Binds = [`${PG_VOLUME}:${POSTGRES_DATA_MOUNT_DESTINATION}`];
      r.Mounts = [
        {
          Type: "volume",
          Name: PG_VOLUME,
          Destination: POSTGRES_DATA_MOUNT_DESTINATION,
        },
      ];
    });
    assert.throws(
      () =>
        validateContainerInspect(record, {
          expectedContainerName: RUNNER_CONTAINER,
          expectedRunnerWorkspaceHostPath: workspace,
        }),
      /runner_named_volume_forbidden|runner_bind_mount_count_invalid|runner_workspace|postgres/,
    );
  });

  it("rejects unexpected runner host bind without read-only mode", () => {
    const workspace = trustedRunnerWorkspacePath();
    const binds = [`${workspace}:/work:rw`];
    const mounts = [
      {
        Type: "bind",
        Source: dockerDesktopLinuxMountSourceFromWindowsPath(workspace),
        Destination: "/work",
        RW: true,
      },
    ];
    assert.throws(
      () => assertRunnerWorkspaceMountPolicy(binds, mounts, workspace),
      /runner_workspace_not_read_only/,
    );
  });

  it("parseDockerBindEntry preserves nested destination paths", () => {
    const parsed = parseDockerBindEntry(`${PG_VOLUME}:${POSTGRES_DATA_MOUNT_DESTINATION}`);
    assert.equal(parsed.source, PG_VOLUME);
    assert.equal(parsed.destination, POSTGRES_DATA_MOUNT_DESTINATION);
  });

  it("rejects published host port on postgres fixture", () => {
    const inspect = loadFixture("docker-inspect-published-port.json");
    assert.throws(
      () => validateContainerInspect(inspect[0], { expectedContainerName: PG_CONTAINER }),
      /docker_isolation_port_bindings_present|docker_isolation_host_ports_published/,
    );
  });

  it("rejects non-internal network through isolation pair", () => {
    const container = loadFixture("docker-inspect-postgres-named-volume.json");
    const network = structuredClone(loadFixture("docker-network-internal.json"));
    network[0].Internal = false;
    assert.throws(
      () =>
        validateDockerIsolationPair(container, network, {
          expectedContainerName: PG_CONTAINER,
          expectedNetworkName: PG_NETWORK,
        }),
      /docker_isolation_network_not_internal/,
    );
  });

  it("rejects unexpected network attachment", () => {
    const container = structuredClone(loadFixture("docker-inspect-postgres-named-volume.json"));
    container[0].NetworkSettings.Networks = {
      bridge: { IPAddress: "172.17.0.2" },
    };
    assert.throws(
      () =>
        validateDockerIsolationFromInspect(container, {
          expectedContainerName: PG_CONTAINER,
          expectedNetworkName: PG_NETWORK,
        }),
      /docker_isolation_unexpected_attached_network/,
    );
  });

  it("rejects Mounts volume with wrong Name while Binds matches expected", () => {
    const inspect = pgInspect();
    inspect[0].Mounts[0].Name = "tf-watchdog-pg-data-run-abc123-shadow";
    assert.throws(
      () => validateContainerInspect(inspect[0], { expectedContainerName: PG_CONTAINER }),
      /postgres_mount_name_mismatch/,
    );
  });

  it("rejects duplicate HostConfig.Binds entries for same volume", () => {
    const inspect = pgInspect();
    inspect[0].HostConfig.Binds = [
      `${PG_VOLUME}:${POSTGRES_DATA_MOUNT_DESTINATION}`,
      `${PG_VOLUME}:${POSTGRES_DATA_MOUNT_DESTINATION}`,
    ];
    assert.throws(
      () => validateContainerInspect(inspect[0], { expectedContainerName: PG_CONTAINER }),
      /postgres_binds_count_invalid/,
    );
  });

  it("rejects missing HostConfig on inspect record", () => {
    const inspect = pgInspect();
    delete inspect[0].HostConfig;
    assert.throws(
      () => validateContainerInspect(inspect[0], { expectedContainerName: PG_CONTAINER }),
      /docker_isolation_postgres_binds_count_invalid/,
    );
  });

  it("rejects malformed Mounts (non-array)", () => {
    const inspect = pgInspect();
    inspect[0].Mounts = null;
    assert.throws(
      () => validateContainerInspect(inspect[0], { expectedContainerName: PG_CONTAINER }),
      /docker_isolation_postgres_mounts_count_invalid/,
    );
  });

  it("rejects missing RUN_ID at resource validation layer", () => {
    assert.throws(() => validateRunId(""), /dispatcher_watchdog_run_id_required/);
  });

  it("rejects invalid RUN_ID at resource validation layer", () => {
    assert.throws(() => validateRunId("bad/id"), /dispatcher_watchdog_run_id_invalid/);
  });

  it("rejects cleanup ownership inference from volume name alone", () => {
    assert.throws(
      () => assertOwnedResourceName("run-abc123", "tf-watchdog-pg-data-other-run", "volume"),
      /cleanup_resource_not_owned/,
    );
  });

  it("rejects postgres container with invalid RUN_ID suffix", () => {
    const inspect = pgInspect();
    inspect[0].Name = "/tf-watchdog-pg-bad/id";
    assert.throws(
      () => validateContainerInspect(inspect[0], { expectedContainerName: "tf-watchdog-pg-bad/id" }),
      /dispatcher_watchdog_run_id_invalid/,
    );
  });

  it("derives expected volume only from validated container identity", () => {
    assert.equal(
      expectedPostgresVolumeNameForContainer(PG_CONTAINER),
      PG_VOLUME,
    );
  });

  it("rejects incorrect network identity", () => {
    assert.throws(
      () =>
        validateDockerIsolationPair(
          loadFixture("docker-inspect-postgres-named-volume.json"),
          loadFixture("docker-network-internal.json"),
          { expectedContainerName: PG_CONTAINER, expectedNetworkName: "tf-watchdog-net-wrong" },
        ),
      /docker_isolation_unexpected_attached_network/,
    );
  });
});
