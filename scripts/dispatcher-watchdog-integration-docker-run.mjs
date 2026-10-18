/**
 * Disposable integration `docker run` argv builders (pure — no Docker CLI).
 */

export const DOCKER_RUN_PULL_NEVER = "--pull=never";

/**
 * @param {string[]} argv
 */
export function assertDockerRunUsesPullNever(argv) {
  const runIndex = argv.indexOf("run");
  if (runIndex === -1) {
    throw new Error("docker_run_argv_missing_run_subcommand");
  }
  const pullIndex = argv.indexOf(DOCKER_RUN_PULL_NEVER, runIndex);
  if (pullIndex === -1) {
    const alt = argv.find((arg, i) => i > runIndex && /^--pull=never$/i.test(arg));
    if (!alt) {
      throw new Error("docker_run_argv_missing_pull_never");
    }
    return;
  }
  if (pullIndex > runIndex + 4) {
    throw new Error("docker_run_pull_never_position_invalid");
  }
}

/**
 * @param {{
 *   imageRef: string;
 *   containerName: string;
 *   networkName: string;
 *   volumeName: string;
 *   pgUser: string;
 *   pgPassword: string;
 *   pgDatabase: string;
 * }} options
 * @returns {string[]}
 */
export function buildPostgresDisposableRunArgv(options) {
  const argv = [
    "run",
    "-d",
    DOCKER_RUN_PULL_NEVER,
    "--name",
    options.containerName,
    "--network",
    options.networkName,
    "--restart",
    "no",
    "-e",
    `POSTGRES_USER=${options.pgUser}`,
    "-e",
    `POSTGRES_PASSWORD=${options.pgPassword}`,
    "-e",
    `POSTGRES_DB=${options.pgDatabase}`,
    "-v",
    `${options.volumeName}:/var/lib/postgresql/data`,
    options.imageRef,
  ];
  assertDockerRunUsesPullNever(argv);
  return argv;
}

/**
 * @param {{
 *   imageRef: string;
 *   containerName: string;
 *   networkName: string;
 *   workspaceHostPath: string;
 *   integrationEnv: Record<string, string>;
 * }} options
 * @returns {string[]}
 */
export function buildRunnerDisposableRunArgv(options) {
  const env = options.integrationEnv;
  const argv = [
    "run",
    "-d",
    DOCKER_RUN_PULL_NEVER,
    "--name",
    options.containerName,
    "--network",
    options.networkName,
    "--restart",
    "no",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=256m",
    "-v",
    `${options.workspaceHostPath}:/work:ro`,
    "-w",
    "/work",
    "-e",
    `MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW=${env.MARKETING_DISPATCHER_WATCHDOG_TEST_ALLOW}`,
    "-e",
    `MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL=${env.MARKETING_DISPATCHER_WATCHDOG_TEST_DATABASE_URL}`,
    "-e",
    `MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST=${env.MARKETING_DISPATCHER_WATCHDOG_TEST_EXPECTED_PG_HOST}`,
    "-e",
    `MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID=${env.MARKETING_DISPATCHER_WATCHDOG_TEST_RUN_ID}`,
    "-e",
    "NODE_ENV=test",
    options.imageRef,
    "sleep",
    "3600",
  ];
  assertDockerRunUsesPullNever(argv);
  return argv;
}
