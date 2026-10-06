import { cleanupOwnedDockerResources, type DockerOwnership } from "../src/lib/engineering/docker-ownership";

async function main() {
  const [taskId, runId, ...extra] = process.argv.slice(2);
  if (!taskId || !runId || extra.length) throw new Error("Usage: engineering-worker-cleanup <task-uuid> <run-uuid>");
  const result = await cleanupOwnedDockerResources({ taskId, runId } satisfies DockerOwnership);
  console.log(JSON.stringify(result));
  if (result.failures.length) process.exitCode = 1;
}

main().catch(() => {
  console.error("Targeted engineering resource cleanup failed; retry with the same task and run IDs.");
  process.exitCode = 1;
});
