/**
 * Conservative operating policy for the Cursor bridge runner (single-host).
 * A file lock prevents two processes on the same machine from both acquiring the lock;
 * it does not provide distributed exactly-once execution across VMs.
 */
export const CURSOR_BRIDGE_SINGLE_RUNNER_POLICY = {
  maxConcurrentRunnersPerHost: 1,
  lockRequired: true,
  distributedExactlyOnce: false,
  recommendedDeployment: "One bridge runner systemd unit per homelab VM; never run duplicate units.",
} as const;

export function describeRunnerLockPolicy(): string {
  return CURSOR_BRIDGE_SINGLE_RUNNER_POLICY.recommendedDeployment;
}
