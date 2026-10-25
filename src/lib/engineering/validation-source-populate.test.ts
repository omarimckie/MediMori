import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { populateHelperEntrypointCommand, populateHelperKeepAliveSeconds, sourceVolumePopulateTimeoutMs, streamTarDirectoryIntoDockerExec } from "./validation-source-populate";

test("source volume populate timeout scales with manifest file count", () => {
  assert.equal(sourceVolumePopulateTimeoutMs(1), 120_000);
  assert.equal(sourceVolumePopulateTimeoutMs(646), 221_500);
  assert.equal(sourceVolumePopulateTimeoutMs(10_000), 600_000);
  assert.equal(sourceVolumePopulateTimeoutMs(Number.NaN), 120_000);
});

test("populate helper lifetime exceeds 60 seconds when tar streams are allowed longer", () => {
  assert.ok(populateHelperKeepAliveSeconds(646, true) > 60);
  assert.equal(populateHelperEntrypointCommand(646, true), `sleep ${populateHelperKeepAliveSeconds(646, true)}`);
  const workspaceMs = sourceVolumePopulateTimeoutMs(646);
  const uploadsMs = Math.min(workspaceMs, 180_000);
  assert.ok(populateHelperKeepAliveSeconds(646, true) * 1000 >= workspaceMs + uploadsMs);
  assert.ok(populateHelperKeepAliveSeconds(646, false) * 1000 >= workspaceMs);
});

function mockPopulateSpawn(options: { tarExit?: number; dockerExit?: number; tarDelayDocker?: boolean } = {}) {
  const kills: string[] = [];
  const calls: string[][] = [];
  const spawnImpl = ((command: string, args: readonly string[]) => {
    calls.push([command, ...args]);
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stdin: PassThrough; exitCode: number | null; killed: boolean; kill: (signal?: string) => void };
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.exitCode = null;
    child.killed = false;
    child.kill = (signal?: string) => {
      child.killed = true;
      kills.push(`${command}:${signal ?? "SIGTERM"}`);
      child.emit("close", command === "tar" ? (options.tarExit ?? 0) : (options.dockerExit ?? 0));
    };
    if (command === "tar") {
      process.nextTick(() => {
        if (!options.tarDelayDocker) {
          child.stdout.write("fixture-bytes");
          child.stdout.end();
        }
        child.emit("close", options.tarExit ?? 0);
      });
    } else {
      const chunks: Buffer[] = [];
      child.stdin.on("data", chunk => chunks.push(Buffer.from(chunk)));
      process.nextTick(() => {
        if (!options.tarDelayDocker && (options.tarExit ?? 0) === 0) assert.equal(Buffer.concat(chunks).toString("utf8"), "fixture-bytes");
        if (!options.tarDelayDocker) child.emit("close", options.dockerExit ?? 0);
      });
    }
    return child as never;
  }) as unknown as typeof import("node:child_process").spawn;
  return { spawnImpl, calls, kills };
}

test("tar populate waits for both sides and pipes host archive bytes into docker exec", async () => {
  const { spawnImpl, calls } = mockPopulateSpawn();
  await streamTarDirectoryIntoDockerExec("helper-container", "C:\\scratch\\export", "/workspace", 5000, spawnImpl);
  assert.deepEqual(calls[0], ["tar", "-C", "C:\\scratch\\export", "-cf", "-", "."]);
  assert.deepEqual(calls[1], ["docker", "exec", "-i", "helper-container", "tar", "-xf", "-", "-C", "/workspace"]);
});

test("tar producer failure terminates the docker consumer", async () => {
  const { spawnImpl, kills } = mockPopulateSpawn({ tarExit: 2, dockerExit: 0 });
  await assert.rejects(streamTarDirectoryIntoDockerExec("helper-container", "C:\\scratch\\export", "/workspace", 5000, spawnImpl), /Populate failed/);
  assert.ok(kills.some(entry => entry.startsWith("docker:")));
});

test("docker consumer failure terminates the tar producer", async () => {
  const { spawnImpl, kills } = mockPopulateSpawn({ tarExit: 0, dockerExit: 1 });
  await assert.rejects(streamTarDirectoryIntoDockerExec("helper-container", "C:\\scratch\\export", "/workspace", 5000, spawnImpl), /Populate failed/);
  assert.ok(kills.some(entry => entry.startsWith("tar:")));
});

test("populate timeout terminates both child processes", async () => {
  const { spawnImpl, kills } = mockPopulateSpawn({ tarDelayDocker: true, tarExit: 0, dockerExit: 0 });
  await assert.rejects(streamTarDirectoryIntoDockerExec("helper-container", "C:\\scratch\\export", "/workspace", 1000, spawnImpl), /Populate timed out/);
  assert.ok(kills.some(entry => entry.startsWith("tar:")));
  assert.ok(kills.some(entry => entry.startsWith("docker:")));
});

test("tar populate rejects invalid helper names, destinations, and timeouts", async () => {
  await assert.rejects(streamTarDirectoryIntoDockerExec("../helper", "/tmp", "/workspace", 5000), /Invalid helper container/);
  await assert.rejects(streamTarDirectoryIntoDockerExec("helper", "/tmp", "/etc", 5000), /Invalid container directory/);
  await assert.rejects(streamTarDirectoryIntoDockerExec("helper", "/tmp", "/workspace", 0), /Invalid populate timeout/);
});
