import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import {
  assertDockerDesktopMountSourceMatchesWorkspace,
  dockerDesktopLinuxMountSourceFromWindowsPath,
  expectedRunnerWorkspaceHostPathForRun,
  normalizeWindowsRunnerWorkspaceHostPath,
  runnerWorkspaceBasenameForRun,
} from "./dispatcher-watchdog-runner-workspace-path.mjs";
import { assertRunnerWorkspaceMountPolicy } from "./dispatcher-watchdog-docker-isolation.mjs";

const RUN_ID = "run-abc123";

function trustedWorkspace() {
  return expectedRunnerWorkspaceHostPathForRun(RUN_ID, tmpdir());
}

function runnerBindsAndMounts(workspace, mountSource) {
  return {
    binds: [`${workspace}:/work:ro`],
    mounts: [
      {
        Type: "bind",
        Source: mountSource,
        Destination: "/work",
        Mode: "ro",
        RW: false,
        Propagation: "rprivate",
      },
    ],
  };
}

describe("runner workspace host path identity", () => {
  it("builds expected basename from RUN_ID", () => {
    assert.equal(runnerWorkspaceBasenameForRun(RUN_ID), "tf-watchdog-runner-run-abc123");
  });

  it("normalizes Windows workspace paths for exact comparison", () => {
    const expected = expectedRunnerWorkspaceHostPathForRun(RUN_ID, tmpdir());
    const withForward = expected.replace(/\\/g, "/");
    const normalized = normalizeWindowsRunnerWorkspaceHostPath(withForward);
    assert.equal(normalized.toLowerCase(), expected.toLowerCase());
  });

  it("maps trusted Windows path to Docker Desktop Mounts.Source", () => {
    const win = "C:\\Users\\runner\\AppData\\Local\\Temp\\tf-watchdog-runner-run-abc123";
    const normalized = normalizeWindowsRunnerWorkspaceHostPath(win);
    assert.equal(
      dockerDesktopLinuxMountSourceFromWindowsPath(normalized),
      "/run/desktop/mnt/host/c/Users/runner/AppData/Local/Temp/tf-watchdog-runner-run-abc123",
    );
    assertDockerDesktopMountSourceMatchesWorkspace(
      "/run/desktop/mnt/host/c/Users/runner/AppData/Local/Temp/tf-watchdog-runner-run-abc123",
      normalized,
    );
  });

  it("rejects UNC workspace paths", () => {
    assert.throws(
      () => normalizeWindowsRunnerWorkspaceHostPath("\\\\server\\share\\tf-watchdog-runner-run-abc123"),
      /docker_isolation_runner_workspace_unc_forbidden/,
    );
  });

  it("rejects relative workspace paths", () => {
    assert.throws(
      () => normalizeWindowsRunnerWorkspaceHostPath(".\\tf-watchdog-runner-run-abc123"),
      /docker_isolation_runner_workspace_relative_forbidden/,
    );
  });

  it("rejects path traversal segments", () => {
    assert.throws(
      () => normalizeWindowsRunnerWorkspaceHostPath("C:\\Temp\\..\\evil\\tf-watchdog-runner-run-abc123"),
      /docker_isolation_runner_workspace_traversal_forbidden/,
    );
  });

  it("rejects suffix-only Mounts.Source impersonation", () => {
    const win = "C:\\Users\\runner\\AppData\\Local\\Temp\\tf-watchdog-runner-run-abc123";
    assert.throws(
      () =>
        assertDockerDesktopMountSourceMatchesWorkspace(
          "/run/desktop/mnt/host/c/evil/tf-watchdog-runner-run-abc123",
          win,
        ),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("P1 accepts existing Linux Docker Desktop Mounts.Source", () => {
    const workspace = trustedWorkspace();
    const linux = dockerDesktopLinuxMountSourceFromWindowsPath(workspace);
    assertDockerDesktopMountSourceMatchesWorkspace(linux, workspace);
  });

  it("P2 accepts Windows-native Mounts.Source for the trusted workspace", () => {
    const workspace = trustedWorkspace();
    assertDockerDesktopMountSourceMatchesWorkspace(workspace, workspace);
  });

  it("P3 accepts Windows-native source with forward slashes and drive casing variation", () => {
    const workspace = trustedWorkspace();
    const drive = workspace.charAt(0);
    const altDrive = drive === "C" ? "c" : drive.toLowerCase();
    const withForward = `${altDrive}:${workspace.slice(2).replace(/\\/g, "/")}`;
    assertDockerDesktopMountSourceMatchesWorkspace(withForward, workspace);
  });

  it("P4 accepts matching HostConfig.Binds and Windows-native Mounts.Source", () => {
    const workspace = trustedWorkspace();
    const { binds, mounts } = runnerBindsAndMounts(workspace, workspace);
    assertRunnerWorkspaceMountPolicy(binds, mounts, workspace);
  });

  it("P6 requires read-only /work bind via mount policy", () => {
    const workspace = trustedWorkspace();
    const binds = [`${workspace}:/work:rw`];
    const mounts = [
      {
        Type: "bind",
        Source: workspace,
        Destination: "/work",
        Mode: "rw",
        RW: true,
        Propagation: "rprivate",
      },
    ];
    assert.throws(
      () => assertRunnerWorkspaceMountPolicy(binds, mounts, workspace),
      /runner_workspace_not_read_only/,
    );
  });

  it("N1 rejects Windows-native Mounts.Source at C:\\evil\\arbitrary", () => {
    const workspace = trustedWorkspace();
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace("C:\\evil\\arbitrary", workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N2 rejects Windows-native sibling runner directory", () => {
    const workspace = trustedWorkspace();
    const sibling = `${workspace}-shadow`;
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace(sibling, workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N3 rejects Windows-native parent Temp directory", () => {
    const workspace = trustedWorkspace();
    const parent = workspace.replace(/\\tf-watchdog-runner-[^\\]+$/, "");
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace(parent, workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N4 rejects Windows-native Mounts.Source on a different drive", () => {
    const workspace = trustedWorkspace();
    const otherDrive = workspace.startsWith("C:") ? `D:${workspace.slice(2)}` : `C:${workspace.slice(2)}`;
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace(otherDrive, workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N5 rejects Windows-native Mounts.Source with traversal", () => {
    const workspace = trustedWorkspace();
    assert.throws(
      () =>
        assertDockerDesktopMountSourceMatchesWorkspace(
          workspace.replace("tf-watchdog-runner", "..\\evil\\tf-watchdog-runner"),
          workspace,
        ),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N6 rejects relative Windows-native source", () => {
    const workspace = trustedWorkspace();
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace(".\\tf-watchdog-runner-run-abc123", workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N7 rejects UNC Mounts.Source", () => {
    const workspace = trustedWorkspace();
    assert.throws(
      () =>
        assertDockerDesktopMountSourceMatchesWorkspace(
          "\\\\server\\share\\tf-watchdog-runner-run-abc123",
          workspace,
        ),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N8 rejects extended-length device Mounts.Source", () => {
    const workspace = trustedWorkspace();
    assert.throws(
      () =>
        assertDockerDesktopMountSourceMatchesWorkspace(`\\\\?\\${workspace}`, workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N9 rejects alternate-data-stream Mounts.Source", () => {
    const workspace = trustedWorkspace();
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace(`${workspace}:Zone.Identifier`, workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N10 rejects Windows-native Mounts.Source differing from trusted workspace", () => {
    const workspace = trustedWorkspace();
    const { binds, mounts } = runnerBindsAndMounts(workspace, workspace);
    mounts[0].Source = "C:\\evil\\arbitrary";
    assert.throws(
      () => assertRunnerWorkspaceMountPolicy(binds, mounts, workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N11 rejects unauthorized bind with Windows-native mount matching trusted workspace", () => {
    const workspace = trustedWorkspace();
    const { binds, mounts } = runnerBindsAndMounts("C:\\evil\\arbitrary", workspace);
    assert.throws(
      () => assertRunnerWorkspaceMountPolicy(binds, mounts, workspace),
      /docker_isolation_runner_workspace_bind_source_mismatch/,
    );
  });

  it("N12 rejects Linux Docker Desktop path under /run/desktop/mnt/host/c/evil", () => {
    const workspace = trustedWorkspace();
    assert.throws(
      () =>
        assertDockerDesktopMountSourceMatchesWorkspace(
          "/run/desktop/mnt/host/c/evil/tf-watchdog-runner-run-abc123",
          workspace,
        ),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N13 rejects Linux Docker Desktop path with unauthorized segment casing", () => {
    const workspace = trustedWorkspace();
    const linux = dockerDesktopLinuxMountSourceFromWindowsPath(workspace);
    const tampered = linux.replace("/Users/", "/users/");
    if (tampered === linux) {
      return;
    }
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace(tampered, workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N14 rejects writable runner mount", () => {
    const workspace = trustedWorkspace();
    const binds = [`${workspace}:/work:rw`];
    const { mounts } = runnerBindsAndMounts(workspace, workspace);
    mounts[0].RW = true;
    assert.throws(
      () => assertRunnerWorkspaceMountPolicy(binds, mounts, workspace),
      /runner_workspace_not_read_only/,
    );
  });

  it("N15 rejects incorrect mount destination", () => {
    const workspace = trustedWorkspace();
    const { binds, mounts } = runnerBindsAndMounts(workspace, workspace);
    mounts[0].Destination = "/evil";
    assert.throws(
      () => assertRunnerWorkspaceMountPolicy(binds, mounts, workspace),
      /runner_bind_mount_destination_invalid/,
    );
  });

  it("N16 rejects additional host bind", () => {
    const workspace = trustedWorkspace();
    const { binds, mounts } = runnerBindsAndMounts(workspace, workspace);
    binds.push(`${workspace}:/extra:ro`);
    assert.throws(
      () => assertRunnerWorkspaceMountPolicy(binds, mounts, workspace),
      /runner_binds_count_invalid/,
    );
  });

  it("N17 rejects unexpected extra mount", () => {
    const workspace = trustedWorkspace();
    const { binds, mounts } = runnerBindsAndMounts(workspace, workspace);
    mounts.push({
      Type: "bind",
      Source: workspace,
      Destination: "/extra",
      RW: false,
    });
    assert.throws(
      () => assertRunnerWorkspaceMountPolicy(binds, mounts, workspace),
      /runner_mounts_count_invalid/,
    );
  });

  it("N18 rejects missing Mounts.Source", () => {
    const workspace = trustedWorkspace();
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace("", workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N19 rejects superficially similar workspace name with suffix", () => {
    const workspace = trustedWorkspace();
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace(`${workspace}-extra`, workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });

  it("N20 rejects basename-only match in different directory", () => {
    const workspace = trustedWorkspace();
    const basename = workspace.split("\\").pop();
    assert.throws(
      () => assertDockerDesktopMountSourceMatchesWorkspace(`C:\\evil\\${basename}`, workspace),
      /docker_isolation_runner_mount_source_mismatch/,
    );
  });
});
