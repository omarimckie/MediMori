import { readFileSync } from "node:fs";
import { validateDockerIsolationPair } from "./dispatcher-watchdog-docker-isolation.mjs";

const [
  containerPath,
  networkPath,
  expectedContainerName,
  expectedNetworkName,
  expectedRunnerWorkspaceHostPathArg,
] = process.argv.slice(2);

if (!containerPath || !networkPath || !expectedContainerName || !expectedNetworkName) {
  console.error(
    "Usage: node dispatcher-watchdog-validate-isolation-cli.mjs <container.json> <network.json> <expectedContainerName> <expectedNetworkName> [expectedRunnerWorkspaceHostPath|-]",
  );
  process.exit(2);
}

const containerInspect = JSON.parse(readFileSync(containerPath, "utf8"));
const networkInspect = JSON.parse(readFileSync(networkPath, "utf8"));

const expectedRunnerWorkspaceHostPath =
  expectedRunnerWorkspaceHostPathArg &&
  String(expectedRunnerWorkspaceHostPathArg).trim() !== "" &&
  expectedRunnerWorkspaceHostPathArg !== "-"
    ? String(expectedRunnerWorkspaceHostPathArg)
    : undefined;

try {
  validateDockerIsolationPair(containerInspect, networkInspect, {
    expectedContainerName,
    expectedNetworkName,
    expectedRunnerWorkspaceHostPath,
  });
  console.log("docker_isolation_ok");
} catch (error) {
  console.error(error);
  process.exit(1);
}
